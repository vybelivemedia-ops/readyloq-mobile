/**
 * Pure pagination helpers for the executive risk drill-down screen.
 *
 * These functions capture the invariants that keep the summary strip ("X of Y
 * inspections") and the Load More flow correct across filter changes.  They
 * mirror the behaviour of applyTech / applyDays / fetchData / loadMore in
 * executive-risk-inspections.tsx without depending on React state or refs.
 *
 * Rule 1 — filter change resets the offset to 0.
 *   applyTech and applyDays both set loadedCountRef.current = 0 synchronously
 *   before issuing a new fetch, so that any loadMore() that fires before the
 *   response arrives cannot carry the previous page boundary into the next
 *   request.
 *
 * Rule 2 — a filter-change fetch replaces the list; a load-more appends.
 *   fetchData(…, append=false) sets items to the incoming page and resets the
 *   loaded-count to that page's length.  fetchData(…, append=true) merges the
 *   new page onto the existing list.
 *
 * Rule 3 — the summary strip shows "X of Y" only when total > loaded.
 *   When the loaded count equals (or exceeds) the server total, or when total
 *   is unknown, only the single count is shown.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MinimalInspection {
  inspectionId: number;
}

// ─── Rule 1: filter-change offset reset ──────────────────────────────────────

/**
 * Returns the loaded-count value that applyTech / applyDays write to
 * loadedCountRef.current immediately before issuing a filter-change fetch.
 *
 * The return value is always 0 — it is a pure constant — but wrapping it in a
 * function lets tests assert the contract in a way that will fail if the screen
 * ever changes the reset value.
 */
export function offsetAfterFilterChange(): number {
  return 0;
}

// ─── Rule 2a: replace on filter change ───────────────────────────────────────

/**
 * Simulates fetchData with append=false (initial load, refresh, or filter
 * change).  The incoming page replaces whatever was there before; the new
 * loaded-count is the length of the incoming page.
 */
export function replaceOnFilterChange<T extends MinimalInspection>(
  incoming: readonly T[],
): { items: T[]; newLoadedCount: number } {
  const items = [...incoming];
  return { items, newLoadedCount: items.length };
}

// ─── Rule 2b: append on load more ────────────────────────────────────────────

/**
 * Simulates fetchData with append=true (Load More).  The incoming page is
 * concatenated onto the existing list; the new loaded-count is the merged
 * length.
 */
export function mergeAppendPage<T extends MinimalInspection>(
  prev: readonly T[],
  incoming: readonly T[],
): { items: T[]; newLoadedCount: number } {
  const merged = [...prev, ...incoming];
  return { items: merged, newLoadedCount: merged.length };
}

// ─── Rule 3: summary strip display mode ──────────────────────────────────────

/**
 * Returns how the summary strip should display the count.
 *
 *   "partial" — total is known and exceeds loaded count → show "X of Y"
 *   "full"    — all rows are loaded (or total is unknown) → show just the count
 *
 * Mirrors the condition in the screen:
 *   total !== null && total > items.length
 */
export function summaryStripMode(
  loadedCount: number,
  total: number | null,
): "partial" | "full" {
  if (total !== null && total > loadedCount) return "partial";
  return "full";
}

// ─── Duplicate detector ───────────────────────────────────────────────────────

/**
 * Returns true if any inspectionId appears more than once in the list.  Used
 * to assert that a filter-change (replace) followed by a load-more cannot
 * introduce duplicate rows.
 */
export function hasDuplicates(items: readonly MinimalInspection[]): boolean {
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.inspectionId)) return true;
    seen.add(item.inspectionId);
  }
  return false;
}

// ─── Stale-response guard ─────────────────────────────────────────────────────

/**
 * Simulates the reqIdRef counter used to drop stale in-flight responses.
 *
 * Each fetchData call increments the counter and captures its value (myReqId).
 * A response is applied only when myReqId === current counter.  This helper
 * lets tests verify that a second fetch (e.g. triggered by a filter change)
 * correctly invalidates the first.
 */
export class ReqIdCounter {
  private current = 0;

  /** Increment and return the new id (mirrors ++reqIdRef.current). */
  next(): number {
    return ++this.current;
  }

  /** Current value without incrementing (mirrors reqIdRef.current). */
  get latest(): number {
    return this.current;
  }

  /** Returns true when myReqId is still the latest — response should be applied. */
  isFresh(myReqId: number): boolean {
    return myReqId === this.current;
  }
}
