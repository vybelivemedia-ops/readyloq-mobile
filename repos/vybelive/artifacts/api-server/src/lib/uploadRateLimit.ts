/**
 * Sliding-window in-memory rate limiter for upload URL issuance.
 *
 * Tracks per-key (e.g. userId or "userId:streamId") request timestamps in a
 * rolling window.  Does NOT persist across process restarts, which is fine for
 * a defence-in-depth control — the goal is to blunt automated abuse, not to
 * provide a perfect accounting guarantee.
 *
 * Limits enforced:
 *  - General upload-url endpoint: UPLOAD_URL_MAX per UPLOAD_URL_WINDOW_MS per user
 *  - Recording upload-url endpoint: RECORDING_URL_MAX per RECORDING_URL_WINDOW_MS per user
 */

const UPLOAD_URL_MAX = 10;
const UPLOAD_URL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const RECORDING_URL_MAX = 5;
const RECORDING_URL_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

const MAX_DECLARED_SIZE_BYTES = 2_000_000_000; // 2 GB

const ALLOWED_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
]);

/** Stored as sorted arrays of timestamps (oldest → newest). */
const windows = new Map<string, number[]>();

function prune(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < timestamps.length && timestamps[i]! < cutoff) i++;
  return i === 0 ? timestamps : timestamps.slice(i);
}

function check(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const ts = prune(windows.get(key) ?? [], windowMs, now);
  if (ts.length >= max) return false;
  ts.push(now);
  windows.set(key, ts);
  return true;
}

/** Returns true if the request is allowed; false if the rate limit is exceeded. */
export function checkUploadUrlRateLimit(userId: string): boolean {
  return check(`upload:${userId}`, UPLOAD_URL_MAX, UPLOAD_URL_WINDOW_MS);
}

/** Returns true if the request is allowed; false if the rate limit is exceeded. */
export function checkRecordingUrlRateLimit(userId: string): boolean {
  return check(`recording:${userId}`, RECORDING_URL_MAX, RECORDING_URL_WINDOW_MS);
}

const WEB_DELETE_MAX = 5;
const WEB_DELETE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Throttle public, unauthenticated web account-deletion requests by client IP
 * to blunt automated spam against the admin review queue. Returns true if the
 * request is allowed; false if the per-IP hourly limit is exceeded.
 */
export function checkWebDeleteRateLimit(ip: string): boolean {
  return check(`webdelete:${ip}`, WEB_DELETE_MAX, WEB_DELETE_WINDOW_MS);
}

/**
 * Validate the client-declared upload metadata.
 * Returns an error string if invalid, or null if acceptable.
 */
export function validateUploadMetadata(
  size: number,
  contentType: string
): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return "size must be a positive number";
  }
  if (size > MAX_DECLARED_SIZE_BYTES) {
    return `size exceeds the maximum allowed value of ${MAX_DECLARED_SIZE_BYTES} bytes (2 GB)`;
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return `contentType '${contentType}' is not permitted; allowed types: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`;
  }
  return null;
}
