/**
 * Lightweight module-level intent store for cross-tab filter delivery.
 *
 * Problem: Expo Router doesn't reliably propagate `router.push({ params })`
 * to already-mounted tab screens — the screen never remounts, so
 * `useLocalSearchParams` + `useEffect` silently no-ops.
 *
 * Solution: the navigation caller writes a pending intent here immediately
 * before pushing the route. The destination screen reads it once inside
 * `useFocusEffect`, which fires on every tab focus regardless of mount state.
 */

const pending: Record<string, string | null> = {};
const pendingParams: Record<string, Record<string, string> | null> = {};

export const filterIntent = {
  /** Set a pending filter for the named screen ("reports" | "leads"). */
  set(screen: string, filter: string): void {
    pending[screen] = filter;
  },

  /**
   * Set a pending filter AND extra params (e.g. timeframe) for the named
   * screen. The extra params are consumed separately via `consumeParams`.
   */
  setWithParams(
    screen: string,
    filter: string,
    extra: Record<string, string>,
  ): void {
    pending[screen] = filter;
    pendingParams[screen] = extra;
  },

  /**
   * Read **and clear** the pending filter.
   * Call exactly once per `useFocusEffect` callback so stale intents
   * don't re-apply on subsequent manual tab taps.
   */
  consume(screen: string): string | null {
    const f = pending[screen] ?? null;
    pending[screen] = null;
    return f;
  },

  /**
   * Read **and clear** the pending extra params (e.g. `{ timeframe: "30d" }`).
   * Always call alongside `consume` so both sides stay in sync.
   */
  consumeParams(screen: string): Record<string, string> | null {
    const p = pendingParams[screen] ?? null;
    pendingParams[screen] = null;
    return p;
  },
};
