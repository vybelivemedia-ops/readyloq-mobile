import { describe, expect, it } from "vitest";
import {
  SYNC_HISTORY_DISPLAY_LIMIT,
  sliceSyncHistory,
} from "../sliceSyncHistory";

describe("SYNC_HISTORY_DISPLAY_LIMIT", () => {
  it("is exactly 10", () => {
    // The SyncHistoryBadge collapsible panel shows at most 10 entries.
    // If this constant changes, owners' retry history will be silently hidden.
    expect(SYNC_HISTORY_DISPLAY_LIMIT).toBe(10);
  });
});

describe("sliceSyncHistory", () => {
  it("returns all entries when the array has fewer than 10 items", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    expect(sliceSyncHistory(entries)).toHaveLength(5);
    expect(sliceSyncHistory(entries)).toEqual(entries);
  });

  it("returns exactly 10 entries when the array has exactly 10 items", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    expect(sliceSyncHistory(entries)).toHaveLength(10);
  });

  it("truncates to 10 when the array has more than 10 items", () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({ id: i }));
    const result = sliceSyncHistory(entries);
    expect(result).toHaveLength(10);
    // The newest entries (first in the array, per API ordering) must be kept.
    expect(result[0]).toEqual({ id: 0 });
    expect(result[9]).toEqual({ id: 9 });
    // Entry 10 and beyond must be dropped.
    expect(result.find((e) => e.id === 10)).toBeUndefined();
    expect(result.find((e) => e.id === 14)).toBeUndefined();
  });

  it("returns an empty array when given an empty array", () => {
    expect(sliceSyncHistory([])).toEqual([]);
  });

  it("preserves the array element type (string entries)", () => {
    const entries = Array.from({ length: 3 }, (_, i) => `entry-${i}`);
    const result = sliceSyncHistory(entries);
    expect(result).toEqual(["entry-0", "entry-1", "entry-2"]);
  });
});
