/**
 * Pure logic helpers for the Gate component's offline / auto-create flow.
 *
 * Extracted from app/(app)/_layout.tsx so the state-machine transitions can
 * be tested in a plain Node.js environment without a React renderer.
 */

/**
 * Returns true when the thrown value looks like a network / connectivity
 * failure rather than a business-logic or server error.
 *
 * Matches the same heuristics used in the Gate component so a future
 * refactor cannot accidentally diverge the two.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg =
    e instanceof Error
      ? e.message.toLowerCase()
      : typeof e === "string"
        ? e.toLowerCase()
        : "";
  return (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("offline") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("socket")
  );
}

/**
 * Computes the `showOfflineBanner` prop passed to Onboarding.
 *
 * True only when:
 *  - the auto-create previously failed due to a network error, AND
 *  - we are currently offline
 *
 * When both conditions hold the user should see the "retrying automatically"
 * banner instead of the normal manual-form helper text.
 */
export function shouldShowOfflineBanner(
  autoCreateNetworkError: boolean,
  online: boolean,
): boolean {
  return autoCreateNetworkError && !online;
}

/**
 * Returns true when the offline→online transition should trigger an automatic
 * retry of the failed auto-create call.
 *
 * All five conditions must hold simultaneously:
 *  1. We are now online (`online === true`).
 *  2. We were offline on the previous render (`wasOffline === true`).
 *  3. The previous auto-create attempt failed with a network error.
 *  4. A derived company name is available to send.
 *  5. Another auto-create is not already in flight.
 */
export function shouldRetryAutoCreate(opts: {
  wasOffline: boolean;
  online: boolean;
  autoCreateNetworkError: boolean;
  hasDerivedName: boolean;
  autoCreating: boolean;
}): boolean {
  const { wasOffline, online, autoCreateNetworkError, hasDerivedName, autoCreating } =
    opts;
  if (!online) return false;
  if (!wasOffline) return false;
  if (!autoCreateNetworkError) return false;
  if (!hasDerivedName) return false;
  if (autoCreating) return false;
  return true;
}

/**
 * Returns true when the Onboarding submit action should be blocked because the
 * device is currently offline.
 *
 * Mirrors the `if (isOffline) return;` guard at the top of Onboarding.submit()
 * so that the policy can be verified independently of the React render cycle.
 */
export function isSubmitBlocked(isOffline: boolean): boolean {
  return isOffline;
}
