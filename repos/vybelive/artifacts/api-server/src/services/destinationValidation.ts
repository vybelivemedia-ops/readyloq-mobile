/**
 * Pure, side-effect-free destination & preflight validation helpers.
 *
 * These functions take already-fetched plain data (no DB, no network) and return
 * preflight check results. Keeping them pure makes the go-live validation logic
 * unit-testable and lets the /preflight route stay a thin data-fetching shell.
 */

import { KickAutoProvisionUnavailableError } from "./oauthProviders";

export type PreflightStatus = "pass" | "warn" | "fail" | "client_check";

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
}

/** Minimal shape of an OAuth connection needed for preflight evaluation. */
export interface ConnectionLike {
  status: string;
  tokenExpiresAt?: Date | string | null;
}

/** Minimal shape of a manual RTMP platform destination. */
export interface ManualDestinationLike {
  type: string;
  name?: string | null;
  rtmpUrl?: string | null;
  streamKey?: string | null;
  isActive?: boolean;
}

export interface ConnectionSummary {
  connectedCount: number;
  expiredCount: number;
  refreshNeededCount: number;
}

/**
 * Summarize OAuth connections into connected / expired / refresh-needed counts.
 * A connection counts as connected only when its status is "connected" AND its
 * token has not expired. Expiry is derived from tokenExpiresAt vs. `now`.
 */
export function summarizeConnections(
  connections: ConnectionLike[],
  now: Date = new Date(),
): ConnectionSummary {
  let connectedCount = 0;
  let expiredCount = 0;
  let refreshNeededCount = 0;

  for (const c of connections) {
    const expiresAt = c.tokenExpiresAt ? new Date(c.tokenExpiresAt) : null;
    const isExpired = c.status === "expired" || (expiresAt !== null && expiresAt <= now);
    if (isExpired) {
      expiredCount++;
    } else if (c.status === "refresh_needed") {
      refreshNeededCount++;
    } else if (c.status === "connected") {
      connectedCount++;
    }
  }

  return { connectedCount, expiredCount, refreshNeededCount };
}

/** "At least one platform connected" check — fails when nothing is connected. */
export function evaluatePlatformConnectedCheck(connectedCount: number): PreflightCheck {
  return {
    id: "platform_connected",
    label: "Platform connected",
    status: connectedCount > 0 ? "pass" : "fail",
    detail: connectedCount > 0
      ? `${connectedCount} platform${connectedCount > 1 ? "s" : ""} connected`
      : "No platforms connected — connect at least one in Settings",
  };
}

/** Token-validity check — warns when any token is expired or needs refresh. */
export function evaluateTokenValidityCheck(
  expiredCount: number,
  refreshNeededCount: number,
): PreflightCheck {
  return {
    id: "token_valid",
    label: "Platform tokens valid",
    status: expiredCount > 0 || refreshNeededCount > 0 ? "warn" : "pass",
    detail: expiredCount > 0
      ? `${expiredCount} platform${expiredCount > 1 ? "s" : ""} need reauthorization`
      : refreshNeededCount > 0
        ? `${refreshNeededCount} platform${refreshNeededCount > 1 ? "s" : ""} token refresh needed`
        : "All tokens valid",
  };
}

/** Per-platform expected RTMP ingest host hints for manual destinations. */
const EXPECTED_HOST_HINTS: Record<string, string> = {
  tiktok: "tiktok",
};

export interface ManualDestinationResult {
  status: "pass" | "warn" | "fail";
  detail: string;
}

/**
 * Validate a single manual RTMP destination's stored credentials.
 *
 * - fail: missing stream key or missing/malformed RTMP URL (cannot stream).
 * - warn: well-formed but the host doesn't match the platform's expected ingest
 *   host (likely pasted from the wrong place) — streaming may still work.
 * - pass: non-empty key + rtmp(s):// URL whose host matches any expected hint.
 *
 * Mirrors the client-side validation in the mobile platforms screen so the
 * server independently re-checks before going live.
 */
export function validateManualDestination(dest: ManualDestinationLike): ManualDestinationResult {
  const url = (dest.rtmpUrl ?? "").trim();
  const key = (dest.streamKey ?? "").trim();
  const label = dest.name ?? dest.type;

  if (!url) {
    return { status: "fail", detail: `${label}: missing RTMP URL` };
  }
  if (!/^rtmps?:\/\//i.test(url)) {
    return { status: "fail", detail: `${label}: RTMP URL must start with rtmp:// or rtmps://` };
  }
  if (!key) {
    return { status: "fail", detail: `${label}: missing stream key` };
  }

  const hint = EXPECTED_HOST_HINTS[dest.type];
  if (hint && !url.toLowerCase().includes(hint)) {
    return {
      status: "warn",
      detail: `${label}: RTMP URL doesn't look like a ${dest.type} ingest host (expected "${hint}")`,
    };
  }

  return { status: "pass", detail: `${label}: ready` };
}

/**
 * Build one preflight check per active manual destination. Each destination is
 * evaluated independently — a single invalid destination produces its own
 * fail/warn check without suppressing the others. Returns an empty array when
 * there are no active manual destinations.
 */
export function buildManualDestinationChecks(
  destinations: ManualDestinationLike[],
): PreflightCheck[] {
  return destinations
    .filter((d) => d.isActive !== false)
    .map((d) => {
      const result = validateManualDestination(d);
      return {
        id: `manual_destination_${d.type}`,
        label: `${d.name ?? d.type} destination`,
        status: result.status,
        detail: result.detail,
      };
    });
}

export interface PushDestinationError {
  status: "manual_fallback_required" | "failed";
  manualFallback: boolean;
  message: string;
}

/**
 * Classify an error thrown while starting/reconnecting a single push
 * destination. A Kick auto-provision failure is a manual-RTMP-fallback signal
 * (the account couldn't mint creds, but the user can add them manually) rather
 * than a generic failure; everything else is a hard failure. Used by the push
 * start/reconnect loops so one destination's outcome never aborts the others.
 */
export function classifyPushDestinationError(err: unknown): PushDestinationError {
  const manualFallback = err instanceof KickAutoProvisionUnavailableError;
  return {
    status: manualFallback ? "manual_fallback_required" : "failed",
    manualFallback,
    message: err instanceof Error ? err.message : String(err),
  };
}
