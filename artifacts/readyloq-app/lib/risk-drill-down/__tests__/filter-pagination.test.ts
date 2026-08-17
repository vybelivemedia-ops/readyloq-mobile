/**
 * Unit tests — executive risk drill-down filter & pagination correctness
 *
 * Confirms three invariants that keep the summary strip and Load More flow
 * correct after a filter is applied mid-scroll:
 *
 *  1. Applying a filter (tech or date) resets the offset to 0 so Load More
 *     cannot carry the previous page boundary into the new filtered fetch.
 *
 *  2. A filter-change fetch REPLACES the list (append=false path) so the
 *     summary strip shows the count for the NEW filter, not the old one.
 *     A subsequent Load More APPENDS without introducing duplicates.
 *
 *  3. The summary strip shows "X of Y" only while total > loaded-count; once
 *     all rows are loaded it collapses to just the total.
 *
 * These are pure-logic tests — no React Native rendering required.
 */

import { describe, expect, it } from "vitest";
import {
  offsetAfterFilterChange,
  replaceOnFilterChange,
  mergeAppendPage,
  summaryStripMode,
  hasDuplicates,
  ReqIdCounter,
} from "../filter-pagination";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInspections(ids: number[]) {
  return ids.map((inspectionId) => ({
    inspectionId,
    siteAddress: `${inspectionId} Main St`,
    technicianName: `Tech ${inspectionId}`,
    riskLevel: "critical" as const,
    qualityScore: 50,
    scoredAt: new Date().toISOString(),
  }));
}

// ─── Rule 1: filter change resets the offset to 0 ────────────────────────────

describe("offsetAfterFilterChange — reset to 0 on every filter change", () => {
  it("returns 0 (the offset applyTech writes to loadedCountRef before fetching)", () => {
    expect(offsetAfterFilterChange()).toBe(0);
  });

  it("returns 0 even when called multiple times (idempotent reset)", () => {
    // applyTech and applyDays may be called in rapid succession; each must
    // produce 0 so loadMore never slips in with a stale offset.
    expect(offsetAfterFilterChange()).toBe(0);
    expect(offsetAfterFilterChange()).toBe(0);
  });
});

// ─── Rule 2a: filter-change fetch replaces the list ──────────────────────────

describe("replaceOnFilterChange — replaces the list with the new filter's page", () => {
  it("returns only the incoming items — previous filter's items are gone", () => {
    // Simulate: owner loaded page 1 under no filter (IDs 1-10), then applied
    // a tech filter.  replaceOnFilterChange should discard the old items.
    const { items } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(items.map((i) => i.inspectionId)).toEqual([11, 12, 13]);
  });

  it("sets newLoadedCount to the incoming page length", () => {
    const { newLoadedCount } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(newLoadedCount).toBe(3);
  });

  it("sets newLoadedCount to 0 when the filtered result is empty", () => {
    const { newLoadedCount } = replaceOnFilterChange([]);
    expect(newLoadedCount).toBe(0);
  });

  it("does not contain any item from the previous unfiltered page", () => {
    // Items 1-10 were loaded before the filter change.  After the replace, only
    // the new filter's results (11-13) should be present.
    const { items } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    const ids = new Set(items.map((i) => i.inspectionId));
    for (let id = 1; id <= 10; id++) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it("the replaced list has no duplicate inspectionIds", () => {
    // A clean server response should never contain duplicates; confirm the
    // replace path does not introduce any.
    const { items } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(hasDuplicates(items)).toBe(false);
  });
});

// ─── Rule 2b: load-more appends from offset 0 after a filter change ──────────

describe("mergeAppendPage — Load More after filter change starts from offset 0", () => {
  it("appends the second page to the first page of the NEW filter", () => {
    // Simulate: filter changed → page 1 of new filter = IDs 11-13 (replace)
    const { items: page1, newLoadedCount: count1 } = replaceOnFilterChange(
      makeInspections([11, 12, 13]),
    );
    expect(count1).toBe(3); // offset for next load-more = 3

    // Load More fetches page 2 at offset 3 of the new filter.
    const { items: merged, newLoadedCount: count2 } = mergeAppendPage(
      page1,
      makeInspections([14, 15]),
    );
    expect(merged.map((i) => i.inspectionId)).toEqual([11, 12, 13, 14, 15]);
    expect(count2).toBe(5);
  });

  it("no duplicate inspectionIds after a filter-change replace followed by a load-more", () => {
    const { items: page1 } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    const { items: merged } = mergeAppendPage(page1, makeInspections([14, 15]));
    expect(hasDuplicates(merged)).toBe(false);
  });

  it("does NOT contain any item from the pre-filter page after replace + load-more", () => {
    // The old filter had IDs 1-10 loaded.  After a filter change and two load-
    // more pages, none of those IDs should appear.
    const { items: page1 } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    const { items: merged } = mergeAppendPage(page1, makeInspections([14, 15]));
    const ids = new Set(merged.map((i) => i.inspectionId));
    for (let id = 1; id <= 10; id++) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it("the load-more offset equals the loaded-count written by the previous fetch", () => {
    // Confirm that newLoadedCount from each fetch is the correct offset to pass
    // to the next load-more request — this is the contract that loadedCountRef
    // implements in the screen.
    const { newLoadedCount: offsetForPage2 } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(offsetForPage2).toBe(3); // page 2 must be fetched at offset 3

    const { newLoadedCount: offsetForPage3 } = mergeAppendPage(
      makeInspections([11, 12, 13]),
      makeInspections([14, 15]),
    );
    expect(offsetForPage3).toBe(5); // page 3 must be fetched at offset 5
  });

  it("Load More offset after a filter change is 0, not the old page boundary", () => {
    // Before filter change: 10 items loaded (offset for next page was 10).
    // Filter changes → offsetAfterFilterChange() must be 0, NOT 10.
    const oldOffset = 10; // simulates loadedCountRef before filter change
    const resetOffset = offsetAfterFilterChange(); // what applyTech/applyDays writes
    expect(resetOffset).toBe(0);
    expect(resetOffset).not.toBe(oldOffset);
  });
});

// ─── Rule 3: summary strip "X of Y" display mode ─────────────────────────────

describe("summaryStripMode — shows 'X of Y' only while more rows remain", () => {
  it("returns 'partial' when total is known and exceeds loaded count", () => {
    // After page 1 of new filter: 3 loaded, 10 total → show "3 of 10"
    expect(summaryStripMode(3, 10)).toBe("partial");
  });

  it("returns 'full' when loaded count equals total (all rows fetched)", () => {
    // After loading all pages: 10 loaded, 10 total → show "10" only
    expect(summaryStripMode(10, 10)).toBe("full");
  });

  it("returns 'full' when total is null (unknown)", () => {
    expect(summaryStripMode(5, null)).toBe("full");
  });

  it("returns 'full' when loaded count exceeds total (defensive)", () => {
    // Should not happen in practice, but must not crash or show "X of Y".
    expect(summaryStripMode(12, 10)).toBe("full");
  });

  it("shows 'partial' immediately after a filter change when total > page size", () => {
    // Simulate: filter applied → first page has 3 items, total is 7 → "3 of 7"
    const { newLoadedCount } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(summaryStripMode(newLoadedCount, 7)).toBe("partial");
  });

  it("collapses to 'full' once the second load-more completes the result set", () => {
    // Page 1: 3 items loaded, 5 total → partial
    const { newLoadedCount: after1 } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(summaryStripMode(after1, 5)).toBe("partial");

    // Page 2: merged to 5 items, total 5 → full
    const { newLoadedCount: after2 } = mergeAppendPage(
      makeInspections([11, 12, 13]),
      makeInspections([14, 15]),
    );
    expect(summaryStripMode(after2, 5)).toBe("full");
  });

  it("shows 'partial' after a tech-filter change even when unfiltered total was larger", () => {
    // Unfiltered had 50 items; after tech filter only 8 remain.  Page 1 returns
    // 3 of those 8 → "3 of 8" (partial), not "3 of 50".
    const { newLoadedCount } = replaceOnFilterChange(makeInspections([11, 12, 13]));
    expect(summaryStripMode(newLoadedCount, 8)).toBe("partial");
  });
});

// ─── Stale-response guard: reqIdRef prevents old fetches from overwriting new ones ──

describe("ReqIdCounter — stale in-flight responses are dropped after a filter change", () => {
  it("increments monotonically; each call to next() returns a unique id", () => {
    const counter = new ReqIdCounter();
    const id1 = counter.next();
    const id2 = counter.next();
    const id3 = counter.next();
    expect(id2).toBeGreaterThan(id1);
    expect(id3).toBeGreaterThan(id2);
  });

  it("isFresh returns true for the most recent id only", () => {
    const counter = new ReqIdCounter();
    const id1 = counter.next(); // first fetch (e.g. unfiltered page 1)
    const id2 = counter.next(); // second fetch (e.g. after filter change)

    // The first fetch's response arrives AFTER the second was issued → stale
    expect(counter.isFresh(id1)).toBe(false);
    // The second fetch's response is still current → apply it
    expect(counter.isFresh(id2)).toBe(true);
  });

  it("a filter-change fetch invalidates the previous in-flight fetch", () => {
    // Simulates: load-more for page 2 is in flight (id1), then the user
    // changes the tech filter (id2).  When the page-2 response arrives, isFresh
    // must return false so the stale rows are discarded.
    const counter = new ReqIdCounter();
    const loadMoreReqId = counter.next(); // load-more started
    const filterChangeReqId = counter.next(); // filter changed — new fetch

    expect(counter.isFresh(loadMoreReqId)).toBe(false); // stale → discard
    expect(counter.isFresh(filterChangeReqId)).toBe(true); // fresh → apply
  });

  it("isFresh remains true until the next increment", () => {
    const counter = new ReqIdCounter();
    const id = counter.next();
    expect(counter.isFresh(id)).toBe(true);
    // No new fetch yet — id is still current
    expect(counter.isFresh(id)).toBe(true);
  });
});

// ─── hasDuplicates helper ─────────────────────────────────────────────────────

describe("hasDuplicates — detects repeated inspectionIds in the rendered list", () => {
  it("returns false for an empty list", () => {
    expect(hasDuplicates([])).toBe(false);
  });

  it("returns false when all ids are unique", () => {
    expect(hasDuplicates(makeInspections([1, 2, 3]))).toBe(false);
  });

  it("returns true when the same id appears twice", () => {
    expect(hasDuplicates(makeInspections([1, 2, 1]))).toBe(true);
  });

  it("returns true when a stale load-more appends a row that was already in the list", () => {
    // Simulate the bug that the offset reset prevents: page 2 is fetched at the
    // old offset (10) instead of 0, so rows 11-13 appear in both page 1 and
    // page 2 of the new filter response.
    const page1 = makeInspections([11, 12, 13]);
    const stalePage2 = makeInspections([11, 12, 13, 14, 15]); // wrong offset
    const { items: merged } = mergeAppendPage(page1, stalePage2);
    expect(hasDuplicates(merged)).toBe(true);
  });

  it("returns false after a correctly-offset load-more (no overlapping rows)", () => {
    const page1 = makeInspections([11, 12, 13]);
    const correctPage2 = makeInspections([14, 15]); // correct offset = 3
    const { items: merged } = mergeAppendPage(page1, correctPage2);
    expect(hasDuplicates(merged)).toBe(false);
  });
});
