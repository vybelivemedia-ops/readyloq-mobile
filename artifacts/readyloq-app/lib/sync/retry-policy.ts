/** Durable retry deadline. Both foreground and background workers honor it. */
export function retryDelayMs(
  error: unknown,
  attempts: number,
  now = Date.now(),
  random = Math.random,
): number {
  const response = error as {
    status?: number;
    response?: { status?: number; headers?: { get(name: string): string | null } };
    headers?: { get(name: string): string | null };
  } | null;
  const status = response?.status ?? response?.response?.status;
  const headers = response?.headers ?? response?.response?.headers;
  const limited = status === 429;
  const base = limited ? 60_000 : 10_000;
  const cap = limited ? 15 * 60_000 : 5 * 60_000;
  const exponential = Math.min(cap, base * 2 ** Math.min(Math.max(attempts - 1, 0), 20));
  const jittered = Math.round(exponential * (0.75 + random() * 0.25));

  const after = headers?.get("Retry-After");
  let serverDelay = 0;
  if (after) {
    const seconds = Number(after);
    serverDelay = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Math.max(0, Date.parse(after) - now || 0);
  }
  // express-rate-limit emits RateLimit-Reset (seconds until the window resets).
  const reset = headers?.get("RateLimit-Reset");
  if (limited && reset && Number.isFinite(Number(reset)) && Number(reset) >= 0) {
    serverDelay = Math.max(serverDelay, Number(reset) * 1000);
  }
  // The exponential component is bounded; a valid server-provided deadline
  // takes precedence even when it exceeds that cap.
  return Math.max(jittered, Number.isFinite(serverDelay) ? serverDelay : 0);
}