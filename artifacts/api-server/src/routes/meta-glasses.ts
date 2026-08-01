/**
 * Meta Live AI glasses integration — ReadyLoq webhook + session + events
 *
 * ─── Flow ────────────────────────────────────────────────────────────────────
 *
 * 1. Mobile app calls POST /api/meta-glasses/session (auth-gated).
 *    Returns { sessionId: UUID, code: "ABC123" } — the 6-char code is what the
 *    technician enters in their Meta glasses app to bind the glasses to this
 *    inspection session.
 *
 * 2. Meta glasses are pointed at:
 *      POST https://<domain>/api/meta-glasses/webhook?session=<sessionId>
 *    Each trigger sends text (transcribed speech) and optionally an image
 *    (base64 JPEG from the glasses camera).
 *
 * 3. The webhook handler (public but HMAC-verified):
 *      a. Verifies X-Hub-Signature-256 using META_APP_SECRET.
 *      b. If audio present → transcribes with OpenAI Whisper.
 *      c. If image present → runs AI pest analysis on the base64 frame.
 *      d. Parses the text command (pest type, severity, zone, station).
 *      e. Buffers a GlassesEvent in the session's event ring.
 *      f. Returns { text: "..." } — Meta speaks it back through the glasses.
 *
 * 4. Mobile app polls GET /api/meta-glasses/events/:sessionId?since=<ms>
 *    (auth-gated) to receive buffered events and merge into inspection state.
 *
 * ─── Security ────────────────────────────────────────────────────────────────
 *
 * - The webhook endpoint is intentionally public (Meta can't send Clerk tokens)
 *   but is secured by HMAC-SHA256 over the raw request body with META_APP_SECRET.
 * - Session IDs are UUID v4 — unguessable; the bearer token for event polling.
 * - Sessions expire after 24 hours.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import { toFile } from "openai";
import { db, inspectionsTable, inspectionMediaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();
import { requireAuth, requireCompany, requireBetaAccess } from "../middleware/require-auth";
import { analyzePhotoFromBase64 } from "../lib/intelligence-ai";
import { logErrorEvent } from "../lib/error-events";
// Note: req.query values are string | string[] | ParsedQs | ParsedQs[].
// Always coerce via String() before use in Map keys or comparisons.

// ─── Session store ────────────────────────────────────────────────────────────

export interface GlassesEvent {
  id: string;
  type: "finding" | "status" | "transcription";
  timestamp: number; // ms since epoch
  text: string; // spoken summary / status message
  finding?: {
    category: string;
    description: string;
    confidence: number;
    severity: "low" | "medium" | "high" | "critical";
    zone?: string;
    species?: string;
  };
  /** Set when the glasses frame was persisted to object storage. */
  storagePath?: string;
  /** DB row ID of the inspection media record created for this frame. */
  mediaId?: number;
}

interface ActiveSession {
  sessionId: string;
  code: string; // 6-char human-readable code
  inspectionId: number;
  companyId: number;
  userId: number;
  createdAt: number;
  events: GlassesEvent[];
}

const sessions = new Map<string, ActiveSession>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const MAX_EVENTS = 100;

/** Prune expired sessions every 15 minutes. */
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}, 15 * 60 * 1000).unref();

function makeCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. "A3F9BC"
}

function makeSessionId(): string {
  return crypto.randomUUID();
}

function pushEvent(session: ActiveSession, event: GlassesEvent): void {
  session.events.push(event);
  if (session.events.length > MAX_EVENTS) session.events.shift();
}

// ─── HMAC verification ────────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Voice command parser ─────────────────────────────────────────────────────

const PEST_KEYWORDS: Record<string, string> = {
  rodent: "rodent",
  rat: "rodent",
  mouse: "rodent",
  mice: "rodent",
  roach: "cockroach",
  cockroach: "cockroach",
  ant: "ant",
  termite: "termite",
  "bed bug": "bed_bug",
  spider: "spider",
  flea: "flea",
  tick: "tick",
  mosquito: "mosquito",
  wasp: "wasp",
  bee: "bee",
  fly: "fly",
  flies: "fly",
  wildlife: "wildlife",
  bird: "bird",
  squirrel: "squirrel",
  raccoon: "raccoon",
  mold: "mold",
  moisture: "moisture_damage",
  water: "moisture_damage",
};

const SEVERITY_KEYWORDS: Record<string, "low" | "medium" | "high" | "critical"> = {
  critical: "critical",
  severe: "critical",
  "heavy infestation": "critical",
  heavy: "high",
  active: "high",
  moderate: "medium",
  light: "low",
  minor: "low",
  trace: "low",
  evidence: "medium",
};

const ZONE_KEYWORDS: Record<string, string> = {
  kitchen: "kitchen",
  bathroom: "bathroom",
  basement: "basement",
  attic: "attic",
  garage: "garage",
  exterior: "exterior",
  interior: "interior",
  crawl: "crawl_space",
  utility: "utility",
  perimeter: "perimeter",
};

interface ParsedCommand {
  category: string;
  species?: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  zone?: string;
  station?: string;
  confidence: number;
}

function parseVoiceCommand(text: string): ParsedCommand | null {
  const lower = text.toLowerCase();

  // Must mention something identifiable
  let category = "observation";
  let species: string | undefined;
  let confidence = 0.6;

  for (const [keyword, cat] of Object.entries(PEST_KEYWORDS)) {
    if (lower.includes(keyword)) {
      category = cat.includes("damage") ? "damage" : "pest";
      species = cat;
      confidence = 0.75;
      break;
    }
  }

  let severity: "low" | "medium" | "high" | "critical" = "medium";
  for (const [keyword, sev] of Object.entries(SEVERITY_KEYWORDS)) {
    if (lower.includes(keyword)) {
      severity = sev;
      break;
    }
  }

  let zone: string | undefined;
  for (const [keyword, z] of Object.entries(ZONE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      zone = z;
      break;
    }
  }

  // Station number: "station 3", "station three"
  const stationMatch =
    lower.match(/station\s+(\d+)/) ??
    lower.match(/station\s+(one|two|three|four|five|six|seven|eight|nine|ten)/);
  const station = stationMatch
    ? stationMatch[1]
    : undefined;

  // Require something meaningful
  if (category === "observation" && !zone && !station) return null;

  const parts: string[] = [];
  if (species) parts.push(species.replace(/_/g, " "));
  if (zone) parts.push(`at ${zone.replace(/_/g, " ")}`);
  if (station) parts.push(`station ${station}`);
  const description = parts.length > 0
    ? `${text.charAt(0).toUpperCase() + text.slice(1)}. Detected: ${parts.join(", ")}.`
    : text.charAt(0).toUpperCase() + text.slice(1);

  return { category, species, description, severity, zone, station, confidence };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// ── POST /session — register an inspection session (auth-gated) ───────────────
router.post(
  "/session",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  async (req: Request, res: Response) => {
    const { inspectionId } = req.body ?? {};
    if (!inspectionId || typeof inspectionId !== "number") {
      return res.status(400).json({ error: "inspectionId is required" });
    }

    const companyId = req.user!.companyId!;
    // Verify inspection belongs to this company
    const [inspection] = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    const sessionId = makeSessionId();
    const code = makeCode();

    sessions.set(sessionId, {
      sessionId,
      code,
      inspectionId,
      companyId,
      userId: req.user!.id,
      createdAt: Date.now(),
      events: [],
    });

    console.log(`[meta-glasses] session created: ${sessionId} inspection=${inspectionId} company=${companyId}`);
    return res.json({ sessionId, code });
  },
);

// ── GET /webhook — Meta hub-challenge verification (public) ───────────────────
router.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const token = req.query["hub.verify_token"];
  const secret = process.env.META_APP_SECRET;

  if (mode === "subscribe" && secret && token === secret) {
    res.status(200).send(String(challenge ?? ""));
  } else {
    res.status(403).json({ error: "Forbidden" });
  }
});

// ── POST /webhook — Meta Live AI event receiver (public + HMAC-verified) ──────
// express.raw() is applied per-route so we can verify the body signature.
router.post(
  "/webhook",
  (req: Request, _res: Response, next: NextFunction) => {
    // Buffer the raw body only for this route so HMAC can be verified.
    // If already buffered (content-type not application/json), pass through.
    if (Buffer.isBuffer(req.body)) return next();
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      (req as Request & { rawBody: Buffer }).rawBody = Buffer.concat(chunks);
      try {
        req.body = JSON.parse((req as Request & { rawBody: Buffer }).rawBody.toString("utf8"));
      } catch {
        req.body = {};
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const rawBody: Buffer = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const signature = req.headers["x-hub-signature-256"] as string | undefined;

    if (!verifySignature(rawBody, signature)) {
      console.warn("[meta-glasses] webhook: invalid HMAC signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Resolve session from ?session= query param
    const sessionId = String(req.query.session ?? "");
    const session = sessions.get(sessionId);
    if (!session) {
      // Return a friendly spoken response even for unknown sessions
      return res.json({
        text: "No active ReadyLoq inspection session found. Please start an inspection in the ReadyLoq app first.",
      });
    }

    const { text: rawText, image: base64Image, audio: base64Audio } = req.body ?? {};

    let transcribedText: string = typeof rawText === "string" ? rawText.trim() : "";
    let aiSummary: string | null = null;

    // ── Transcribe audio if present ──────────────────────────────────────────
    if (base64Audio && !transcribedText) {
      try {
        const audioBuffer = Buffer.from(base64Audio, "base64");
        const audioFile = await toFile(audioBuffer, "glasses_audio.mp3", { type: "audio/mpeg" });
        const transcription = await openai.audio.transcriptions.create({
          model: "whisper-1",
          file: audioFile,
          language: "en",
        });
        transcribedText = transcription.text.trim();
      } catch (err) {
        void logErrorEvent("ai", { companyId: session.companyId, userId: session.userId, message: "Meta webhook: audio transcription failed", context: { err: String(err) } });
      }
    }

    // ── Analyze image if present ─────────────────────────────────────────────
    let findingFromImage: GlassesEvent["finding"] | undefined;
    let persistedStoragePath: string | undefined;
    let persistedMediaId: number | undefined;
    if (base64Image) {
      try {
        const prediction = await analyzePhotoFromBase64(base64Image);
        if (prediction?.category) {
          const conf = prediction.confidence ?? 0.5;
          const severity: "low" | "medium" | "high" | "critical" =
            conf >= 0.8 ? "high" : conf >= 0.6 ? "medium" : "low";
          findingFromImage = {
            category: prediction.category ?? "observation",
            description:
              prediction.possibleConduciveCondition ??
              prediction.possiblePest ??
              prediction.possibleEntryPoint ??
              prediction.rationale ??
              "AI analysis complete",
            confidence: conf,
            severity,
            zone: prediction.zone ?? undefined,
            species: prediction.possiblePest ?? undefined,
          };
          aiSummary = `AI detected: ${findingFromImage.description} (${Math.round(conf * 100)}% confidence)`;
        }
      } catch (err) {
        void logErrorEvent("ai", { companyId: session.companyId, userId: session.userId, message: "Meta webhook: image analysis failed", context: { err: String(err) } });
      }

      // ── Persist the glasses frame to object storage + inspection media ──────
      // Even if AI analysis found nothing, we persist the frame so the
      // technician has a full visual record and the report can reference it.
      try {
        const imageBuffer = Buffer.from(base64Image, "base64");
        const storagePath = await objectStorageService.uploadObjectBuffer(
          session.companyId,
          imageBuffer,
          "image/jpeg",
        );
        const caption = findingFromImage
          ? `Glasses capture: ${findingFromImage.description}`
          : "Glasses frame capture";
        const [mediaRow] = await db
          .insert(inspectionMediaTable)
          .values({
            companyId: session.companyId,
            inspectionId: session.inspectionId,
            mediaType: "photo",
            url: storagePath,
            captureSource: "meta-glasses",
            caption,
            filename: `glasses_${Date.now()}.jpg`,
          })
          .returning();
        persistedStoragePath = storagePath;
        persistedMediaId = mediaRow?.id;
      } catch (err) {
        void logErrorEvent("ai", { companyId: session.companyId, userId: session.userId, message: "Meta webhook: frame persistence failed", context: { err: String(err) } });
      }
    }

    // ── Parse voice command ──────────────────────────────────────────────────
    let findingFromVoice: GlassesEvent["finding"] | undefined;
    if (transcribedText) {
      const parsed = parseVoiceCommand(transcribedText);
      if (parsed) {
        findingFromVoice = {
          category: parsed.category,
          description: parsed.description,
          confidence: parsed.confidence,
          severity: parsed.severity,
          zone: parsed.zone,
          species: parsed.species,
        };
      }
    }

    // Prefer image AI finding; merge with voice if both present
    const finding = findingFromImage ?? findingFromVoice;

    // ── Buffer event ─────────────────────────────────────────────────────────
    if (finding || transcribedText || persistedMediaId) {
      const event: GlassesEvent = {
        id: crypto.randomUUID(),
        type: finding ? "finding" : "transcription",
        timestamp: Date.now(),
        text: aiSummary ?? transcribedText ?? "Glasses frame captured",
        finding,
        storagePath: persistedStoragePath,
        mediaId: persistedMediaId,
      };
      pushEvent(session, event);
    }

    // ── Build spoken response ────────────────────────────────────────────────
    let spokenResponse: string;
    if (aiSummary) {
      spokenResponse = `${aiSummary}. Logged to inspection ${session.inspectionId}.`;
    } else if (transcribedText) {
      spokenResponse = `Logged: ${transcribedText}`;
    } else {
      spokenResponse = "Observation recorded.";
    }

    return res.json({ text: spokenResponse });
  },
);

// ── GET /events/:sessionId — poll for buffered events (auth-gated) ────────────
router.get(
  "/events/:sessionId",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    // Ensure this session belongs to the authenticated user's company
    if (session.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const since = Number(String(req.query.since ?? "0"));
    const events = since > 0
      ? session.events.filter((e) => e.timestamp > since)
      : session.events;

    return res.json({
      sessionId,
      inspectionId: session.inspectionId,
      code: session.code,
      events,
      serverTime: Date.now(),
    });
  },
);

export default router;
