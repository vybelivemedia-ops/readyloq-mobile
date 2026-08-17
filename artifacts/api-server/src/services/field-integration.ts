/**
 * Field-service platform sync service.
 *
 * Packages a finalized ReadyLoq inspection into the payload format expected by
 * PestPac or FieldRoutes and fires the outgoing API calls. Uses native fetch —
 * no extra HTTP library dependencies.
 *
 * API keys are loaded from the database by the calling route and are NEVER
 * logged or forwarded to any client.
 */

import type { FieldIntegrationSystem } from "@workspace/db";
import { logger } from "../lib/logger";
import { withRetry, withRetryTracked } from "../lib/retry";

/**
 * Returns true only for errors that are worth retrying.
 *
 * Permanent client-side failures (4xx except 408 Request Timeout and
 * 429 Too Many Requests) can never succeed on a retry — the credential is
 * dead or the request is malformed.  Retrying them only wastes time and
 * burns through the back-off budget.  Transient server errors (5xx) and
 * rate-limit / timeout responses (429, 408) are still retried.
 */
function isRetryableResponse(res: Response): boolean {
  if (res.ok) return false;
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    return false; // permanent auth / client error — fail fast
  }
  return true;
}

/**
 * Returns true for auth failures that can never succeed on a retry regardless
 * of back-off.  Passing this as the `isFatal` predicate to `withRetryTracked`
 * causes the helper to throw immediately instead of burning through the
 * retry budget on a dead credential.
 */
function isFatalResponse(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

export interface PhotoSyncItem {
  url: string;
  caption: string | null;
  severity: string;
}

export interface TreatmentConditions {
  pestsFound: string[];
  chemicalsUsed: string[];
  temperature?: number | null;
  notes?: string | null;
}

/** Stamped / estimated physical dimensions attached to a finding. */
export interface SyncFindingMeasurements {
  widthMm?: number;
  heightMm?: number;
  /** 0–1 model or sensor confidence. */
  confidence?: number;
  surfaceType?: string;
}

/** Structured AI finding included in the Enterprise Bridge sync payload. */
export interface SyncFindingItem {
  category: string;
  severity: string;
  evidencePhotoUrl: string | null;
  /** Present only when a stamped/estimated measurement exists for the finding. */
  measurements?: SyncFindingMeasurements;
}

/** Compliance sign-off record included in the sync payload. */
export interface SignatureAudit {
  technicianSigned: boolean;
  ownerSigned: boolean;
  ownerNotAvailable: boolean;
  /** ISO-8601 timestamp of the first signature — null if unsigned. */
  signedAt: string | null;
}

export interface SyncPayload {
  externalSystem: FieldIntegrationSystem;
  /** Account / customer ID within the external platform. */
  accountId: string;
  /** Caller-supplied API credential — never log this value. */
  apiKey: string;
  /**
   * Second credential for systems requiring dual-token auth (FieldRoutes
   * authenticationToken). Never log this value.
   */
  apiToken?: string | null;
  /** Optional base URL override (defaults to production endpoint). */
  apiBaseUrl?: string | null;
  inspectionDate: string;
  reportSummary: string;
  photos: PhotoSyncItem[];
  treatmentConditions: TreatmentConditions;
  /** Structured AI findings (category, severity, photo, measurements). */
  findings?: SyncFindingItem[];
  /** Signature status for the inspection. */
  signatureAudit?: SignatureAudit;
}

export interface SyncResult {
  success: boolean;
  externalSystem: FieldIntegrationSystem;
  postedNotes: boolean;
  attachmentsPosted: number;
  /** Number of retries needed to post the note (0 = succeeded on first attempt). */
  noteRetries: number;
  /** Total number of retries across all attachment uploads (0 = all succeeded first try). */
  attachmentRetries: number;
  error?: string;
}

// ─── PestPac ──────────────────────────────────────────────────────────────────

const PESTPAC_DEFAULT_BASE = "https://api.pestpac.com/v1";

async function syncToPestPac(payload: SyncPayload): Promise<SyncResult> {
  const base = payload.apiBaseUrl?.replace(/\/$/, "") ?? PESTPAC_DEFAULT_BASE;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${payload.apiKey}`,
  };
  const customerId = payload.accountId;

  // 1 — Post AI narrative as a service note (up to 3 attempts with exponential back-off)
  const { result: noteRes, retries: noteRetries } = await withRetryTracked(
    () =>
      fetch(`${base}/customers/${customerId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          note: `[ReadyLoq AI Report] ${payload.reportSummary}`,
          date: payload.inspectionDate,
          // Structured Enterprise Bridge fields — each finding carries its
          // measurements as custom fields; signature status rides alongside.
          ...(payload.findings && {
            findings: payload.findings.map((f) => ({
              category: f.category,
              severity: f.severity,
              evidencePhotoUrl: f.evidencePhotoUrl,
              ...(f.measurements && { customFields: f.measurements }),
            })),
          }),
          ...(payload.signatureAudit && { signatureAudit: payload.signatureAudit }),
        }),
      }),
    isRetryableResponse,
    3,
    500,
    isFatalResponse,
  );
  if (!noteRes.ok) {
    const body = await noteRes.text();
    throw new Error(`PestPac note POST failed (${noteRes.status}): ${body}`);
  }

  // 2 — Attach photos (up to 3 attempts each with exponential back-off)
  let attachmentsPosted = 0;
  let attachmentRetries = 0;
  for (const photo of payload.photos) {
    try {
      const { result: attachRes, retries } = await withRetryTracked(
        () =>
          fetch(`${base}/customers/${customerId}/attachments`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              fileUrl: photo.url,
              description: `${photo.severity.toUpperCase()}: ${photo.caption ?? ""}`,
            }),
          }),
        isRetryableResponse,
        3,
        500,
        isFatalResponse,
      );
      attachmentRetries += retries;
      if (attachRes.ok) {
        attachmentsPosted++;
      } else {
        // All retry attempts returned a non-OK response — log and continue.
        const body = await attachRes.text();
        logger.warn(
          { status: attachRes.status, body },
          "PestPac attachment POST failed after retries",
        );
      }
    } catch (err) {
      // Network-level error (fetch threw) after all retries — non-fatal, skip this photo.
      // Count the retries that were consumed before the throw (maxAttempts - 1 = 2).
      attachmentRetries += 2;
      logger.warn(
        { url: photo.url, err: String(err) },
        "PestPac attachment POST threw after retries",
      );
    }
  }

  return { success: true, externalSystem: "pestpac", postedNotes: true, attachmentsPosted, noteRetries, attachmentRetries };
}

// ─── FieldRoutes ──────────────────────────────────────────────────────────────

const FIELDROUTES_DEFAULT_BASE = "https://api.fieldroutes.com/api/v1";

async function syncToFieldRoutes(payload: SyncPayload): Promise<SyncResult> {
  const base = payload.apiBaseUrl?.replace(/\/$/, "") ?? FIELDROUTES_DEFAULT_BASE;
  // FieldRoutes requires BOTH credentials: authenticationKey (apiKey) and
  // authenticationToken (apiToken). The Bearer header is kept for older
  // gateway deployments that proxy on it.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${payload.apiKey}`,
    authenticationKey: payload.apiKey,
    ...(payload.apiToken ? { authenticationToken: payload.apiToken } : {}),
  };
  const customerId = payload.accountId;

  // Retry the service-history POST up to 3 times before surfacing a hard error.
  const { result: histRes, retries: noteRetries } = await withRetryTracked(
    () =>
      fetch(`${base}/customer/${customerId}/service-history`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          summary: payload.reportSummary,
          conditions: {
            pestsFound: payload.treatmentConditions.pestsFound,
            chemicalsUsed: payload.treatmentConditions.chemicalsUsed,
            temperature: payload.treatmentConditions.temperature ?? null,
            notes: payload.treatmentConditions.notes ?? null,
          },
          mediaUrls: payload.photos.map((p) => p.url),
          date: payload.inspectionDate,
          // Structured Enterprise Bridge fields.
          ...(payload.findings && {
            findings: payload.findings.map((f) => ({
              category: f.category,
              severity: f.severity,
              evidencePhotoUrl: f.evidencePhotoUrl,
              ...(f.measurements && { customFields: f.measurements }),
            })),
          }),
          ...(payload.signatureAudit && { signatureAudit: payload.signatureAudit }),
        }),
      }),
    isRetryableResponse,
    3,
    500,
    isFatalResponse,
  );

  if (!histRes.ok) {
    const body = await histRes.text();
    throw new Error(`FieldRoutes service-history POST failed (${histRes.status}): ${body}`);
  }

  // FieldRoutes bundles media into the service-history POST — no separate
  // attachment step, so attachmentRetries is always 0.
  return {
    success: true,
    externalSystem: "fieldroutes",
    postedNotes: true,
    attachmentsPosted: payload.photos.length,
    noteRetries,
    attachmentRetries: 0,
  };
}

// ─── Credential probe ─────────────────────────────────────────────────────────

export type ProbeFailureReason = "auth_failed" | "network_error";

export interface ProbeResult {
  ok: boolean;
  reason?: ProbeFailureReason;
  message?: string;
}

/**
 * Fires a single lightweight read against the external system's auth endpoint
 * to confirm the stored credentials are accepted.  No data is written.
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, reason: "auth_failed"  } on 401 / 403.
 * Returns { ok: false, reason: "network_error" } on fetch-level failures or
 * unexpected 5xx that indicate the host is unreachable / unavailable.
 */
async function probePestPac(apiKey: string, accountId: string, apiBaseUrl?: string | null): Promise<ProbeResult> {
  const base = apiBaseUrl?.replace(/\/$/, "") ?? PESTPAC_DEFAULT_BASE;
  try {
    const res = await fetch(`${base}/customers/${encodeURIComponent(accountId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      // Short timeout — we only want to confirm auth, not wait for a slow response.
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth_failed", message: `Authentication rejected (HTTP ${res.status}) — check your API key.` };
    }
    // Treat 404 as auth-ok (the account ID might not exist in the sandbox,
    // but the credential itself was accepted).
    if (res.status === 404) return { ok: true };
    return { ok: false, reason: "network_error", message: `Unexpected response from PestPac (HTTP ${res.status}).` };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      reason: "network_error",
      message: isTimeout
        ? "PestPac did not respond within 8 seconds — check your network connection."
        : `Could not reach PestPac: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function probeFieldRoutes(
  apiKey: string,
  accountId: string,
  apiBaseUrl?: string | null,
  apiToken?: string | null,
): Promise<ProbeResult> {
  const base = apiBaseUrl?.replace(/\/$/, "") ?? FIELDROUTES_DEFAULT_BASE;
  try {
    // FieldRoutes requires BOTH credentials: authenticationKey (apiKey) and
    // authenticationToken (apiToken) — same header contract as syncToFieldRoutes.
    // The Bearer header is kept for older gateway deployments that proxy on it.
    const res = await fetch(`${base}/customer/${encodeURIComponent(accountId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        authenticationKey: apiKey,
        ...(apiToken ? { authenticationToken: apiToken } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth_failed", message: `Authentication rejected (HTTP ${res.status}) — check your API key.` };
    }
    if (res.status === 404) return { ok: true };
    return { ok: false, reason: "network_error", message: `Unexpected response from FieldRoutes (HTTP ${res.status}).` };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      reason: "network_error",
      message: isTimeout
        ? "FieldRoutes did not respond within 8 seconds — check your network connection."
        : `Could not reach FieldRoutes: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function probeIntegrationCredentials(
  systemType: FieldIntegrationSystem,
  apiKey: string,
  accountId: string,
  apiBaseUrl?: string | null,
  apiToken?: string | null,
): Promise<ProbeResult> {
  switch (systemType) {
    case "pestpac":
      return probePestPac(apiKey, accountId, apiBaseUrl);
    case "fieldroutes":
      return probeFieldRoutes(apiKey, accountId, apiBaseUrl, apiToken);
    case "servsuite": {
      const { probeServSuite } = await import("./integration/adapters/servsuiteAdapter");
      return probeServSuite(apiKey, apiBaseUrl);
    }
    default: {
      const exhaustive: never = systemType;
      throw new Error(`Unknown external system: ${String(exhaustive)}`);
    }
  }
}

// ─── Public entrypoint ────────────────────────────────────────────────────────

export async function syncInspectionToExternalSystem(
  payload: SyncPayload,
): Promise<SyncResult> {
  switch (payload.externalSystem) {
    case "pestpac":
      return syncToPestPac(payload);
    case "fieldroutes":
      return syncToFieldRoutes(payload);
    case "servsuite":
      // ServSuite uses EnterpriseAdapterRouter which builds the full structured
      // payload from the DB. The legacy text-note SyncPayload doesn't apply.
      throw new Error(
        "ServSuite must be dispatched via EnterpriseAdapterRouter, not syncInspectionToExternalSystem",
      );
    default: {
      const exhaustive: never = payload.externalSystem;
      throw new Error(`Unknown external system: ${String(exhaustive)}`);
    }
  }
}
