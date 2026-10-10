import { openai } from "@workspace/integrations-openai-ai-server";
import {
  INTELLIGENCE_TAXONOMY,
  TAXONOMY_CATEGORY_SLUGS,
  type AiPrediction,
} from "@workspace/db";
import type { File } from "@google-cloud/storage";
import { ObjectStorageService } from "./objectStorage";
import { ZONE_SLUGS, normalizeZone } from "./zone-coverage";

/**
 * Real vision-model suggestion step for the Intelligence Dataset.
 *
 * Given a company-private object-storage image, ask a vision model to suggest a
 * structured field-intelligence label (category, subcategory, confidence, tags,
 * possible pest / conducive condition / entry point, corrective action). The
 * technician then confirms or corrects this; the delta between the AI suggestion
 * and the human label is the training signal we persist.
 *
 * Failure is explicit, never silent-but-wrong: any storage/model/parse error
 * yields `fallbackPrediction()` (confidence 0, empty labels) so the caller always
 * gets a well-formed, clearly-low-confidence suggestion to hand to the technician.
 */

const MODEL = "gpt-5.4";
const storage = new ObjectStorageService();
const DEFAULT_PHOTO_TIMEOUT_MS = 35_000;
const DEFAULT_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 750;
// OpenAI vision requests carry the image as base64 in the JSON request body.
// Keep the binary source below 20 MiB so the encoded payload remains safely
// below provider request limits while leaving room for the prompt and response.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface AnalyzePhotoOptions {
  timeoutMs?: number;
  deadlineAt?: number;
  rateLimitRetries?: number;
  /** Receives the terminal per-photo provider outcome without changing the
   * legacy nullable return value used by existing callers. */
  onOutcome?: (status: PhotoAnalysisOutcomeStatus) => void;
}

export type PhotoAnalysisOutcomeStatus =
  | "completed"
  | "failed"
  | "deferred"
  | "rate_limited";

export type PhotoAnalysisOutcome =
  | { status: "completed"; prediction: AiPrediction }
  | { status: Exclude<PhotoAnalysisOutcomeStatus, "completed">; prediction: null };

type RetryOutcome<T> =
  | { status: "completed"; value: T }
  | { status: "failed" | "deferred" | "rate_limited"; value: null };

async function withRateLimitRetryOutcome<T>(
  operation: (signal: AbortSignal, remainingMs: number, deadlineAt: number) => Promise<T>,
  options: AnalyzePhotoOptions,
): Promise<RetryOutcome<T>> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_PHOTO_TIMEOUT_MS);
  const requestedRetries = options.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
  const retries = Math.min(
    MAX_RATE_LIMIT_RETRIES,
    Math.max(
      0,
      Math.floor(Number.isFinite(requestedRetries) ? requestedRetries : DEFAULT_RATE_LIMIT_RETRIES),
    ),
  );
  const deadlineAt = options.deadlineAt ?? Date.now() + timeoutMs;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const remainingMs = Math.min(timeoutMs, deadlineAt - Date.now());
    if (remainingMs <= 0) return { status: "deferred", value: null };

    const controller = new AbortController();
    try {
      const value = await withDeadline(
        operation(controller.signal, remainingMs, deadlineAt),
        remainingMs,
        () => controller.abort(),
      );
      return { status: "completed", value };
    } catch (error) {
      if (error instanceof PhotoAnalysisTimeoutError) {
        return { status: "deferred", value: null };
      }
      if (!isRateLimitError(error)) return { status: "failed", value: null };
      if (attempt === retries) return { status: "rate_limited", value: null };

      const exponentialDelay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
      const jitter = Math.floor(Math.random() * 250);
      const nowMs = Date.now();
      const requestedDelayMs = retryAfterMs(error, nowMs) ?? exponentialDelay + jitter;
      const delayMs = Math.min(requestedDelayMs, Math.max(0, deadlineAt - nowMs));
      await sleep(delayMs);
    }
  }
  return { status: "rate_limited", value: null };
}

async function withRateLimitRetry<T>(
  operation: (signal: AbortSignal, remainingMs: number, deadlineAt: number) => Promise<T>,
  options: AnalyzePhotoOptions,
): Promise<T | null> {
  const outcome = await withRateLimitRetryOutcome(operation, options);
  return outcome.status === "completed" ? outcome.value : null;
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  return value.status === 429 || value.response?.status === 429 || value.code === 429 || value.code === "rate_limit_exceeded";
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === "function") {
    const value = get.call(headers, name);
    return typeof value === "string" ? value : null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      return null;
    }
  }
  return null;
}

function retryAfterMs(error: unknown, nowMs: number): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as {
    headers?: unknown;
    response?: { headers?: unknown };
  };
  const raw = headerValue(value.headers, "retry-after")
    ?? headerValue(value.response?.headers, "retry-after");
  if (raw == null) return null;

  const trimmed = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PhotoAnalysisTimeoutError extends Error {}

class PhotoTooLargeError extends Error {}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new PhotoAnalysisTimeoutError("Photo analysis deadline exceeded"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function fallbackPrediction(): AiPrediction {
  return {
    category: null,
    subcategory: null,
    confidence: 0,
    tags: [],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: null,
    possibleLifeStage: null,
    possibleHarborage: null,
    possibleMoistureIssue: null,
    possibleStructuralIssue: null,
    zone: null,
    pestCandidates: [],
  };
}

function assertStorageDeadline(signal: AbortSignal, deadlineAt: number): void {
  if (signal.aborted || deadlineAt - Date.now() <= 0) {
    throw new PhotoAnalysisTimeoutError("Photo analysis deadline exceeded");
  }
}

function storageTimeoutMs(deadlineAt: number): number {
  return Math.max(1, deadlineAt - Date.now());
}

async function readStorageFile(
  file: File,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<{ buffer: Buffer; contentType: string }> {
  assertStorageDeadline(signal, deadlineAt);
  const timeoutMs = storageTimeoutMs(deadlineAt);

  // The installed File typings expose no cancellable getMetadata/download
  // operation. A bounded range read is the concrete metadata+content request:
  // the response headers provide Content-Length before content, and destroying
  // this stream cancels the underlying GCS request.
  const stream = file.createReadStream({
    start: 0,
    // HTTP ranges are inclusive, so request one byte beyond the cap. An
    // oversized object can then be rejected from Content-Length before data.
    end: MAX_IMAGE_BYTES,
    validation: false,
  });
  return new Promise<{ buffer: Buffer; contentType: string }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let contentType = "image/jpeg";
    let settled = false;

    const onResponse = (response: {
      headers?: Record<string, unknown> & {
        get?: (name: string) => string | null;
      };
    }) => {
      const rawLength = typeof response.headers?.get === "function"
        ? response.headers.get("content-length")
        : response.headers?.["content-length"];
      const contentLength = Number(rawLength);
      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        settleFailure(new PhotoTooLargeError("Stored image exceeds the maximum supported size"), true);
        return;
      }
      const rawType = typeof response.headers?.get === "function"
        ? response.headers.get("content-type")
        : response.headers?.["content-type"];
      if (typeof rawType === "string" && rawType.length > 0) contentType = rawType;
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) {
        settleFailure(new PhotoTooLargeError("Stored image exceeds the maximum supported size"), true);
        return;
      }
      chunks.push(chunk);
    };
    const onError = (error: unknown) => settleFailure(error, false);
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ buffer: Buffer.concat(chunks, total), contentType });
    };
    const onClose = () => {
      if (!settled) {
        settleFailure(new Error("Object stream closed before completing"), false);
      }
    };
    const timer = setTimeout(() => {
      settleFailure(new PhotoAnalysisTimeoutError("Photo download deadline exceeded"), true);
    }, timeoutMs);
    const abort = () => {
      settleFailure(new PhotoAnalysisTimeoutError("Photo download aborted"), true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      stream.removeListener("response", onResponse);
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
      stream.removeListener("close", onClose);
    };
    const settleFailure = (error: unknown, destroy: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (destroy && !stream.destroyed) stream.destroy();
      reject(error);
    };

    signal.addEventListener("abort", abort, { once: true });
    stream.on("response", onResponse);
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
    stream.once("close", onClose);
  });
}

async function objectToDataUrl(
  objectPath: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<string> {
  assertStorageDeadline(signal, deadlineAt);
  // Handle acquisition is validation-only and must not perform an unbounded
  // exists() request. The bounded range read below establishes existence.
  const file = storage.getObjectEntityFileHandle(objectPath);
  assertStorageDeadline(signal, deadlineAt);
  const { buffer, contentType } = await readStorageFile(file, signal, deadlineAt);
  assertStorageDeadline(signal, deadlineAt);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new PhotoTooLargeError("Downloaded image exceeds the maximum supported size");
  }
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function taxonomyText(): string {
  return INTELLIGENCE_TAXONOMY.map((group) => {
    const subs = group.subcategories.map((s) => s.slug).join(", ");
    return `- ${group.slug} (${group.label}): ${group.description}\n    subcategories: ${subs}`;
  }).join("\n");
}

const SYSTEM_PROMPT =
  "You are a senior pest-control field-intelligence analyst. You examine a single " +
  "field photo taken by a technician and produce a precise, structured assessment " +
  "for a training dataset. Be conservative: when the image is ambiguous, lower your " +
  "confidence rather than guessing. Respond with a single JSON object only.";

function userPrompt(technicianNote?: string | null): string {
  const noteClause = technicianNote
    ? [
        "",
        `Technician note for this photo: "${technicianNote.trim()}"`,
        "Use this note as additional context when classifying — the technician was on-site and",
        "may have spotted something not immediately obvious in the image. Do NOT simply repeat",
        "the note verbatim; ground your response in what is visually present.",
      ]
    : [];
  return [
    "Classify this pest-control field photo. Choose the single best category and",
    "subcategory from this taxonomy (use the exact slug strings shown):",
    "",
    taxonomyText(),
    "",
    "Return a JSON object with EXACTLY these keys:",
    '- "category": one taxonomy category slug, or null if unclear',
    '- "subcategory": one subcategory slug belonging to that category, or null',
    '- "confidence": a number from 0 to 1 (your confidence in the single best pest/category identification)',
    '- "tags": array of 1-6 short lowercase keyword strings describing the image',
    '- "possiblePest": the single most likely pest species/common name if any, else null',
    '- "pestCandidates": array of up to 3 candidate pest species sorted by confidence descending.',
    '  Each entry: {"species":"<common name>","confidence":<0-1>}.',
    '  Include only candidates genuinely plausible in this image; use [] when no pest is visible.',
    '  Example: [{"species":"Bed Bug","confidence":0.72},{"species":"Spider Beetle","confidence":0.18},{"species":"Carpet Beetle","confidence":0.10}]',
    '- "possibleLifeStage": pest life stage VISIBLE in the image (e.g. egg, larva, nymph, pupa, adult, juvenile), else null',
    '- "possibleConduciveCondition": conducive condition observed, else null',
    '- "possibleHarborage": harborage (nesting/shelter site) observed, else null',
    '- "possibleMoistureIssue": moisture problem observed (leak, standing water, damp material, condensation), else null',
    '- "possibleStructuralIssue": structural deficiency observed (gap, crack, hole, damaged material, failed seal), else null',
    '- "measurementEstimate": ONLY when possibleStructuralIssue is non-null — estimate the physical dimensions',
    '  of the defect using visible reference objects (door frame ≈ 7 ft tall, standard brick course ≈ 2.25 in,',
    '  12-in floor tile, US electrical outlet ≈ 4.5 in × 2.75 in, hand-width ≈ 4 in) or structural norms.',
    '  Return: {"linearFt":<number|null>,"gapWidthIn":<number|null>,"heightFt":<number|null>,"confidence":<0-1>,"source":"ai_vision_estimate"}',
    '  linearFt: total run length of the defect (e.g. gap perimeter, roofline section); null if indeterminate.',
    '  gapWidthIn: opening width in inches; null if no gap is clearly present.',
    '  heightFt: height of the opening in feet; null if not applicable.',
    '  Set confidence < 0.35 when no reference object or structural norm is visible in the frame.',
    '  Return null (not the object) when possibleStructuralIssue is null.',
    '- "possibleEntryPoint": entry point observed, else null',
    '- "suggestedCorrectiveAction": one concise recommended corrective action, else null',
    '- "rationale": one short sentence explaining the classification',
    `- "zone": the single inspection zone this photo depicts, one of: ${ZONE_SLUGS.join(", ")}; or null if the scene is unclear`,
    "",
    "Only report what is actually visible in THIS image. Every field must be",
    "grounded in visible evidence — when the image shows no such evidence,",
    "return null for that field rather than guessing.",
    ...noteClause,
  ].join("\n");
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseMeasurementEstimate(
  raw: unknown,
): AiPrediction["measurementEstimate"] {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const confidence = typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const linearFt = asNumberOrNull(r.linearFt);
  const gapWidthIn = asNumberOrNull(r.gapWidthIn);
  const heightFt = asNumberOrNull(r.heightFt);
  // Discard if the model returned the object but nothing is measured.
  if (linearFt === null && gapWidthIn === null && heightFt === null) return null;
  return { linearFt, gapWidthIn, heightFt, confidence, source: "ai_vision_estimate" };
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === "null"
    ? null
    : trimmed;
}

function parsePrediction(raw: string): AiPrediction | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  let category = asStringOrNull(parsed.category);
  if (category && !TAXONOMY_CATEGORY_SLUGS.includes(category)) {
    // The model returned something outside our taxonomy; keep the tag/pest
    // detail it surfaced but don't assert an invalid category.
    category = null;
  }
  let subcategory = asStringOrNull(parsed.subcategory);
  if (category) {
    const group = INTELLIGENCE_TAXONOMY.find((g) => g.slug === category);
    if (
      subcategory &&
      !group?.subcategories.some((s) => s.slug === subcategory)
    ) {
      subcategory = null;
    }
  } else {
    subcategory = null;
  }

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .slice(0, 6)
    : [];

  const pestCandidates = Array.isArray(parsed.pestCandidates)
    ? (parsed.pestCandidates as unknown[])
        .filter(
          (c): c is { species: string; confidence: number } =>
            c !== null &&
            typeof c === "object" &&
            typeof (c as Record<string, unknown>).species === "string" &&
            typeof (c as Record<string, unknown>).confidence === "number",
        )
        .map((c) => ({
          species: c.species.trim(),
          confidence: clampConfidence(c.confidence),
        }))
        .filter((c) => c.species.length > 0)
        .slice(0, 3)
    : [];

  return {
    category,
    subcategory,
    confidence: clampConfidence(parsed.confidence),
    tags,
    possiblePest: asStringOrNull(parsed.possiblePest),
    possibleConduciveCondition: asStringOrNull(parsed.possibleConduciveCondition),
    possibleEntryPoint: asStringOrNull(parsed.possibleEntryPoint),
    suggestedCorrectiveAction: asStringOrNull(parsed.suggestedCorrectiveAction),
    rationale: asStringOrNull(parsed.rationale),
    possibleLifeStage: asStringOrNull(parsed.possibleLifeStage),
    possibleHarborage: asStringOrNull(parsed.possibleHarborage),
    possibleMoistureIssue: asStringOrNull(parsed.possibleMoistureIssue),
    possibleStructuralIssue: asStringOrNull(parsed.possibleStructuralIssue),
    measurementEstimate: parseMeasurementEstimate(parsed.measurementEstimate),
    zone: normalizeZone(parsed.zone),
    pestCandidates,
  };
}

export interface RegeneratedFindingContent {
  description: string;
  treatment: string | null;
}

function boundedGeneratedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, limit) : null;
}

/**
 * Produces final, client-facing copy after a technician corrects the species.
 *
 * The technician's label is authoritative. This deliberately does not update
 * the original prediction or its confidence because those fields are needed to
 * retain a clean AI-to-human training signal.
 */
export async function regenerateFindingAfterTechnicianCorrection(input: {
  category: string;
  description: string;
  treatment: string | null;
  location: string | null;
  correctedSpecies: string;
  technicianNotes?: string | null;
}, options: AnalyzePhotoOptions = {}): Promise<RegeneratedFindingContent | null> {
  try {
    const completion = await withRateLimitRetry(
      (signal, remainingMs) => openai.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You revise a pest-control inspection finding after an on-site technician " +
              "has corrected the pest identification. The technician's corrected species is " +
              "authoritative. Return JSON only. Preserve only evidence supplied in the input; " +
              "do not invent visible damage, life stages, locations, products, application " +
              "rates, dilution, or regulatory claims. The treatment field must be concise " +
              "integrated-pest-management guidance, never chemical instructions. When product " +
              "use may be appropriate, direct a licensed technician to the approved site " +
              "protocol and product label.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Regenerate the final summary and treatment recommendation for this corrected finding.",
              requiredResponse: {
                description:
                  "One concise, factual sentence. Clearly identify the technician-verified species and use only supplied evidence.",
                treatment:
                  "A concise IPM recommendation, or null when no recommendation can be supported from the supplied context.",
              },
              finding: input,
            }),
          },
        ],
      }, { signal, timeout: remainingMs, maxRetries: 0 }),
      options,
    );
    if (!completion) return null;
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const description = boundedGeneratedText(parsed.description, 800);
    if (!description) return null;
    return {
      description,
      treatment: boundedGeneratedText(parsed.treatment, 800),
    };
  } catch {
    return null;
  }
}

/**
 * Run the vision model against a stored object path (e.g.
 * `/objects/companies/5/uploads/abc`).
 *
 * Returns `null` when the analysis genuinely FAILED — a storage/model/parse
 * error or an empty model response. A successfully parsed result (even a
 * conservative, low-/zero-confidence one) is returned as-is. Callers that must
 * distinguish "analysis failed" from "analysis found nothing notable" should
 * use this directly; callers that just want a well-formed suggestion should use
 * {@link generateAiPrediction}.
 */
export async function analyzePhoto(
  objectPath: string,
  technicianNote?: string | null,
  options: AnalyzePhotoOptions = {},
): Promise<AiPrediction | null> {
  const outcome = await analyzePhotoWithOutcome(objectPath, technicianNote, options);
  try {
    options.onOutcome?.(outcome.status);
  } catch {
    // Outcome telemetry must never alter the legacy provider result contract.
  }
  return outcome.status === "completed" ? outcome.prediction : null;
}

/**
 * Failure-aware variant used by the inspection analysis route. The legacy
 * analyzePhoto() contract remains nullable for existing callers, while this
 * variant preserves enough information for the API to tell a technician
 * whether a photo failed, was deferred by a deadline, or exhausted 429 retry.
 */
export async function analyzePhotoWithOutcome(
  objectPath: string,
  technicianNote?: string | null,
  options: AnalyzePhotoOptions = {},
): Promise<PhotoAnalysisOutcome> {
  try {
    const outcome = await withRateLimitRetryOutcome(
      async (signal, remainingMs, deadlineAt) => {
        const dataUrl = await objectToDataUrl(objectPath, signal, deadlineAt);
        assertStorageDeadline(signal, deadlineAt);
        return openai.chat.completions.create({
          model: MODEL,
          max_completion_tokens: 8192,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt(technicianNote) },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }, {
          signal,
          timeout: remainingMs,
          maxRetries: 0,
        });
      },
      options,
    );
    if (outcome.status !== "completed") {
      return { status: outcome.status, prediction: null };
    }
    const raw = outcome.value.choices[0]?.message?.content;
    if (!raw) return { status: "failed", prediction: null };
    const prediction = parsePrediction(raw);
    return prediction
      ? { status: "completed", prediction }
      : { status: "failed", prediction: null };
  } catch {
    return { status: "failed", prediction: null };
  }
}

/**
 * Never-failing wrapper around {@link analyzePhoto}: any failure yields
 * `fallbackPrediction()` (confidence 0, empty labels) so the Intelligence
 * Dataset contribution flow always gets a well-formed, clearly-low-confidence
 * suggestion to hand to the technician.
 */
export async function generateAiPrediction(
  objectPath: string,
): Promise<AiPrediction> {
  return (await analyzePhoto(objectPath)) ?? fallbackPrediction();
}

/**
 * Variant of {@link analyzePhoto} that accepts a raw base64-encoded JPEG
 * directly (e.g. from a Meta Live AI webhook frame) instead of an object-
 * storage path.  No file I/O — the data URL is constructed in memory.
 */
export async function analyzePhotoFromBase64(
  base64Jpeg: string,
  options: AnalyzePhotoOptions = {},
): Promise<AiPrediction | null> {
  try {
    const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`;
    const completion = await withRateLimitRetry(
      (signal, remainingMs) => openai.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt() },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }, { signal, timeout: remainingMs, maxRetries: 0 }),
      options,
    );
    if (!completion) return null;
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    return parsePrediction(raw);
  } catch {
    return null;
  }
}
