import { logger } from "../lib/logger";

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
import { appendProcessingMilestone } from "../lib/inspection-processing-events";
import crypto from "node:crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import { toFile } from "openai";
import { db, inspectionsTable, inspectionMediaTable, metaGlassesSessionsTable } from "@workspace/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();
import { requireAuth, requireCompany, requireBetaAccess, requireRole } from "../middleware/require-auth";
import { analyzePhotoFromBase64 } from "../lib/intelligence-ai";
import { zoomGlassesFrame } from "../lib/glasses-zoom";
import { logErrorEvent } from "../lib/error-events";
// Note: req.query values are string | string[] | ParsedQs | ParsedQs[].
// Always coerce via String() before using them as session IDs or timestamps.

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
  /**
   * One-word subject label from the Gemini digital-zoom clarification pass,
   * e.g. "cockroach", "mousetrap", "crack". Present when the stored frame
   * was cropped to this subject.
   */
  zoomSubject?: string;
  /**
   * Original client-push event type (e.g. "ble_frame_dropped", "ble_reconnect",
   * "ble_link_lost").  Always set by POST /events/:sessionId so telemetry queries
   * can filter on a stable field regardless of the caller-supplied text.
   */
  clientEventType?: string;
  /** BLE device identifier supplied by the mobile app for telemetry events. */
  deviceId?: string;
  /** Human-readable drop reason supplied by the mobile app. */
  reason?: string;
  /**
   * Number of frames dropped in this event (for bulk driver drops).
   * Server-validated: always a finite positive integer in [1..MAX_EVENT_COUNT].
   * Defaults to 1 when not present.
   */
  count?: number;
}

/** Maximum frame count per telemetry event — guards against forged/inflated totals. */
const MAX_EVENT_COUNT = 10_000;

interface ActiveSession {
  sessionId: string;
  code: string; // 6-char human-readable code
  inspectionId: number;
  companyId: number;
  userId: number;
  createdAt: number;
  events: GlassesEvent[];
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const MAX_EVENTS = 100;

async function findSession(sessionId: string): Promise<ActiveSession | undefined> {
  // Polls must see webhook/telemetry writes from any API instance, not an
  // instance-local snapshot that can remain stale for the full session TTL.
  const [row] = await db.select().from(metaGlassesSessionsTable)
    .where(and(eq(metaGlassesSessionsTable.sessionId, sessionId), gt(metaGlassesSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!row) return undefined;
  const session: ActiveSession = {
    sessionId: row.sessionId,
    code: row.code,
    inspectionId: row.inspectionId,
    companyId: row.companyId,
    userId: row.userId,
    createdAt: row.createdAt.getTime(),
    events: (row.events as GlassesEvent[]) ?? [],
  };
  return session;
}

// Bound session creation per authenticated user, not per shared office IP.
const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user!.id),
  message: { error: "Too many glasses session requests, please try again later." },
});

/** Prune expired sessions every 15 minutes. */
setInterval(() => {
  // Purge expired DB rows — fire-and-forget.
  void db
    .delete(metaGlassesSessionsTable)
    .where(lt(metaGlassesSessionsTable.expiresAt, new Date()))
    .catch(() => { /* best-effort — non-fatal */ });
}, 15 * 60 * 1000).unref();

function makeCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. "A3F9BC"
}

function makeSessionId(): string {
  return crypto.randomUUID();
}

async function pushEvent(session: ActiveSession, event: GlassesEvent): Promise<void> {
  // PostgreSQL locks the row during UPDATE; each append sees the previous
  // committed events even when webhooks hit different API processes.
  await db
    .update(metaGlassesSessionsTable)
    .set({ events: sql`(
      SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(
        ${metaGlassesSessionsTable.events} || ${JSON.stringify([event])}::jsonb
      ) WITH ORDINALITY AS items(value, ordinal)
      WHERE ordinal > GREATEST(0, jsonb_array_length(${metaGlassesSessionsTable.events}) + 1 - ${MAX_EVENTS})
    )` })
    .where(eq(metaGlassesSessionsTable.sessionId, session.sessionId))
    .returning({ sessionId: metaGlassesSessionsTable.sessionId });
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
  sessionLimiter,
  async (req: Request, res: Response) => {
    const { inspectionId } = req.body ?? {};
    if (!inspectionId || typeof inspectionId !== "number") {
      return res.status(400).json({ error: "inspectionId is required" });
    }

    const companyId = req.user!.companyId!;
    // Verify inspection belongs to this company — filters by both id AND
    // companyId so a technician at Company A cannot hijack Company B's session.
    const [inspection] = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)))
      .limit(1);

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    // Serialize registrations across API instances. Without the DB lock,
    // concurrent requests all observe "no session" and mint different codes.
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(977, ${inspectionId})`);
      const [existing] = await tx.select({
        sessionId: metaGlassesSessionsTable.sessionId,
        code: metaGlassesSessionsTable.code,
      }).from(metaGlassesSessionsTable)
        .where(and(
          eq(metaGlassesSessionsTable.inspectionId, inspectionId),
          eq(metaGlassesSessionsTable.companyId, companyId),
          eq(metaGlassesSessionsTable.userId, req.user!.id),
          gt(metaGlassesSessionsTable.expiresAt, new Date()),
        ))
        .orderBy(sql`${metaGlassesSessionsTable.createdAt} DESC`)
        .limit(1);
      if (existing) return existing;

      const sessionId = makeSessionId();
      const code = makeCode();
      await tx.insert(metaGlassesSessionsTable).values({
        sessionId,
        code,
        inspectionId,
        companyId,
        userId: req.user!.id,
        events: [],
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      console.log(`[meta-glasses] session created: ${sessionId} inspection=${inspectionId} company=${companyId}`);
      return { sessionId, code };
    });
    // Transaction has committed: another instance can immediately poll by ID.
    return res.json(result);
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
      logger.warn("[meta-glasses] webhook: invalid HMAC signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Resolve session from ?session= query param
    const sessionId = String(req.query.session ?? "");
    const session = await findSession(sessionId);
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
    let persistedZoomSubject: string | undefined;
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
        const rawBuffer = Buffer.from(base64Image, "base64");

        // ── Digital zoom: crop to the detected subject before storage (#114) ──
        // zoomGlassesFrame asks Gemini for a bounding box and crops + upscales
        // the JPEG so the stored frame is evidence-quality, not a wide-angle snap.
        // Falls back to the original buffer silently on any failure.
        const zoomResult = await zoomGlassesFrame(
          rawBuffer,
          findingFromImage?.confidence,
          findingFromImage?.species ?? undefined,
        );
        const frameBuffer = zoomResult.buffer;
        if (zoomResult.subject) persistedZoomSubject = zoomResult.subject;

        const storagePath = await objectStorageService.uploadObjectBuffer(
          session.companyId,
          frameBuffer,
          "image/jpeg",
        );
        const caption = findingFromImage
          ? `Glasses capture: ${findingFromImage.description}`
          : "Glasses frame capture";
        const mediaRow = await db.transaction(async (tx) => {
          const [created] = await tx
          .insert(inspectionMediaTable)
          .values({
            companyId: session.companyId,
            inspectionId: session.inspectionId,
            mediaType: "image",
            url: storagePath,
            captureSource: "smart_glasses",
            caption,
            filename: `glasses_${Date.now()}.jpg`,
            zoomSubject: persistedZoomSubject ?? null,
          })
          .returning();
          if (!created) throw new Error("Failed to register glasses evidence");
          await appendProcessingMilestone(tx, {
            companyId: session.companyId, inspectionId: session.inspectionId,
            eventType: "evidence.registered", sourceType: "inspection_media",
            sourceId: created.id, actor: "system:meta-relay", occurredAt: created.createdAt,
          });
          return created;
        });
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
        zoomSubject: persistedZoomSubject,
      };
      await pushEvent(session, event);
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

// ── POST /events/:sessionId — push a client-side telemetry event (auth-gated) ──
//
// Used by the mobile app to record BLE telemetry (e.g. frame drops) directly
// into the session event ring without going through the Meta webhook.
//
// Allowed event types are restricted to CLIENT_PUSH_TYPES; any other type
// returns 400 to prevent misuse.  Cross-company injection is prevented the same
// way as the GET route: the session is looked up by ID and then its companyId
// is compared to req.user.companyId — a mismatch yields 404 so that session
// existence is not leaked.
const CLIENT_PUSH_TYPES = new Set(["ble_frame_dropped", "ble_reconnect", "ble_link_lost"]);

router.post(
  "/events/:sessionId",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const session = await findSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    // Prevent cross-company injection: return 404 (not 403) so session
    // existence is not leaked to a caller from a different company.
    if (session.companyId !== req.user!.companyId) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    const { type, ...rest } = req.body ?? {};

    if (!type || !CLIENT_PUSH_TYPES.has(type as string)) {
      return res.status(400).json({
        error: `Unsupported event type. Allowed types: ${[...CLIENT_PUSH_TYPES].join(", ")}`,
      });
    }

    // Validate and normalize the optional frame-drop count.
    // We accept only finite positive integers in [1..MAX_EVENT_COUNT].
    // Invalid / missing / out-of-range values are clamped to 1 so a single
    // bad payload cannot inflate or corrupt aggregate totals.
    const rawCount = (rest as Record<string, unknown>).count;
    const parsedCount = typeof rawCount === "number" ? rawCount
      : typeof rawCount === "string" ? Number(rawCount)
      : NaN;
    const validatedCount =
      Number.isFinite(parsedCount) && parsedCount >= 1
        ? Math.min(Math.floor(parsedCount), MAX_EVENT_COUNT)
        : 1;

    // Spread permitted client metadata first (deviceId, reason, custom text …)
    // then override with authoritative server-owned fields so callers cannot
    // forge id, timestamp, type, clientEventType, or count.
    const event: GlassesEvent = {
      ...(rest as Partial<GlassesEvent>),
      // Server-owned fields always win over the client payload:
      id: crypto.randomUUID(),
      type: "status", // client-push events are categorised as status events
      timestamp: Date.now(),
      text: (rest.text as string | undefined) ?? `Client event: ${type}`,
      // Preserve the VALIDATED original event type so telemetry queries
      // (e.g. frame-drop stats) can filter on a stable field regardless
      // of what text the caller supplies.  Overrides any forged value.
      clientEventType: type as string,
      // Validated count — always a finite positive integer in [1..MAX_EVENT_COUNT].
      count: validatedCount,
    };

    await pushEvent(session, event);
    return res.status(204).end();
  },
);

// ── GET /events/:sessionId — poll for buffered events (auth-gated) ────────────
router.get(
  "/events/:sessionId",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const session = await findSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    // Ensure this session belongs to the authenticated user's company.
    // Return 404 (not 403) so that session existence is not leaked to
    // a caller from a different company.
    if (session.companyId !== req.user!.companyId) {
      return res.status(404).json({ error: "Session not found or expired" });
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

// ── GET /frame-drop-stats — aggregate ble_frame_dropped telemetry (auth-gated, manager+) ─────────
//
// Queries the meta_glasses_sessions table JSONB events column for every session
// belonging to the calling company, unnests the event array, and returns drop
// counts grouped by deviceId and reason.  Only events with
// clientEventType = "ble_frame_dropped" are counted — reconnect / link-lost
// events are excluded.  Filters on the dedicated `clientEventType` field
// (not `text`) so counts are accurate regardless of the caller-supplied text.
//
// Response shape:
//   { stats: Array<{ deviceId: string|null, reason: string|null, dropCount: number }>, queriedAt: number }
router.get(
  "/frame-drop-stats",
  requireAuth,
  requireCompany,
  requireRole("manager"),
  (req: Request, res: Response) => {
    const companyId = req.user!.companyId!;

    // Use a raw SQL lateral join to unnest the JSONB events array and filter
    // for ble_frame_dropped entries.  The original client event type is baked
    // into the text field as "Client event: ble_frame_dropped" by the push
    // handler (the `type` key is stripped before spreading into GlassesEvent).
    void db
      .execute(
        sql`
          SELECT
            e->>'deviceId'  AS device_id,
            e->>'reason'    AS reason,
            SUM(
              CASE
                -- Accept only digit-only strings where the value is >= 1.
                -- LEAST caps oversized values at 10 000; negative/non-numeric
                -- strings fall back to 1 so malformed events can never crash
                -- the cast or inflate totals beyond the per-event ceiling.
                WHEN (e->>'count') ~ '^[0-9]+$'
                 AND (e->>'count')::bigint >= 1
                THEN LEAST((e->>'count')::bigint, 10000)::int
                -- No count field, unparseable, or negative → single-frame drop.
                ELSE 1
              END
            )::int          AS drop_count
          FROM meta_glasses_sessions s,
               jsonb_array_elements(s.events) AS e
          WHERE s.company_id = ${companyId}
            AND e->>'clientEventType' = 'ble_frame_dropped'
          GROUP BY 1, 2
          ORDER BY drop_count DESC, device_id ASC NULLS LAST
        `,
      )
      .then((result) => {
        const stats = (result.rows as Array<{ device_id: string | null; reason: string | null; drop_count: number }>).map(
          (row) => ({
            deviceId: row.device_id ?? null,
            reason: row.reason ?? null,
            dropCount: Number(row.drop_count),
          }),
        );
        res.json({ stats, queriedAt: Date.now() });
      })
      .catch((err) => {
        logger.warn("[meta-glasses] frame-drop-stats query failed: " + String(err));
        res.status(500).json({ error: "Failed to query frame-drop stats" });
      });
  },
);

export default router;
