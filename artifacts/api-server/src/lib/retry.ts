/**
 * Shared retry utility for external HTTP calls.
 *
 * Provides exponential back-off so any service that calls an external endpoint
 * can stay resilient without re-implementing its own retry logic.
 */

/**
 * Sleep for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fallible async operation up to `maxAttempts` times with exponential
 * back-off.  A result is considered a failure when `shouldRetry(result)` is
 * true.  Throws the last error (or the error returned by `shouldRetry`) if all
 * attempts are exhausted.
 *
 * Back-off schedule (base 500 ms, ×2 per attempt):
 *   attempt 1 → immediate
 *   attempt 2 → 500 ms
 *   attempt 3 → 1 000 ms
 *
 * @example
 * // Retry an HTTP fetch until the response is OK, up to 3 times.
 * const res = await withRetry(
 *   () => fetch(url, options),
 *   (r) => !r.ok,
 * );
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastResult: T | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (!shouldRetry(result)) return result;
      lastResult = result;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // Return the last non-throw result (shouldRetry was true every time)
  return lastResult as T;
}

/**
 * Same behaviour as `withRetry` but also returns how many retries were needed.
 *
 * `retries` is the number of *extra* attempts beyond the first (0 = succeeded
 * on the first try, 1 = one retry needed, etc.).  This lets callers surface
 * flakiness to operators without changing the existing `withRetry` signature.
 */
export async function withRetryTracked<T>(
  operation: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<{ result: T; retries: number }> {
  let lastResult: T | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    try {
      const result = await operation();
      if (!shouldRetry(result)) return { result, retries: attempt - 1 };
      lastResult = result;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // All attempts exhausted — return the last non-throw result
  return { result: lastResult as T, retries: attempts - 1 };
}
