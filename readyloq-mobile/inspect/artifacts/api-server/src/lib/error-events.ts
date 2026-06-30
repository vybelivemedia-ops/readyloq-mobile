import { db } from "@workspace/db";
import { errorEventsTable } from "@workspace/db";
import type { ErrorCategory } from "@workspace/db";

const MAX_MESSAGE = 500;

// Whitelist of context keys we allow into the persisted error log. Anything not
// listed is dropped so we never store tokens, raw object URLs, PII, or stack
// traces. Values are additionally length-capped below.
const ALLOWED_CONTEXT_KEYS = new Set([
  "status",
  "statusCode",
  "code",
  "step",
  "stage",
  "mediaType",
  "filename",
  "count",
  "kind",
  "operation",
  "model",
  "durationMs",
  "route",
  "field",
  "reason",
]);

function sanitizeContext(
  context?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!context || typeof context !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type LogErrorEventInput = {
  companyId: number;
  userId?: number | null;
  message: string;
  context?: Record<string, unknown> | null;
  inspectionId?: number | null;
  reportId?: number | null;
  source?: "server" | "client";
};

/**
 * Best-effort, company-scoped error logging that backs the Beta Center error
 * monitor. This NEVER throws and never blocks the request path — if the insert
 * fails the underlying operation must still complete (callers fall back to pino).
 * Anonymous failures (no companyId) are intentionally not persisted here.
 */
export async function logErrorEvent(
  category: ErrorCategory,
  input: LogErrorEventInput,
): Promise<void> {
  try {
    if (input.companyId == null) return;
    await db.insert(errorEventsTable).values({
      companyId: input.companyId,
      userId: input.userId ?? null,
      category,
      message: String(input.message ?? "").slice(0, MAX_MESSAGE),
      context: sanitizeContext(input.context),
      inspectionId: input.inspectionId ?? null,
      reportId: input.reportId ?? null,
      source: input.source ?? "server",
    });
  } catch {
    // Swallow: error monitoring must never break the operation it observes.
  }
}
