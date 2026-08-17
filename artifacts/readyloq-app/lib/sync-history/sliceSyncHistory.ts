/**
 * Maximum number of sync-history entries displayed in the SyncHistoryBadge
 * collapsible panel.  The API may return up to 100 entries; this constant caps
 * what the UI renders so the panel stays scannable.
 *
 * Any change to this value affects the owner's view of their retry history, so
 * keep it in sync with the test in __tests__/sliceSyncHistory.test.ts.
 */
export const SYNC_HISTORY_DISPLAY_LIMIT = 10;

/**
 * Returns the newest `SYNC_HISTORY_DISPLAY_LIMIT` entries from a sync-history
 * array.  The caller is responsible for ensuring the array is already sorted
 * newest-first (which the API guarantees via ORDER BY synced_at DESC).
 */
export function sliceSyncHistory<T>(history: T[]): T[] {
  return history.slice(0, SYNC_HISTORY_DISPLAY_LIMIT);
}
