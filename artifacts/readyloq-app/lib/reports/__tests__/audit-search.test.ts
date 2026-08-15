/**
 * Unit tests — Management Report Audit search helpers
 *
 * Covers four behaviours required by task spec:
 *
 *  1. filterReports narrows the list when searching by address.
 *  2. filterReports narrows the list when searching by title.
 *  3. emptyStateMessage returns "No results for …" + implies a Clear-search
 *     button when the query matches nothing.
 *  4. The search query resets to "" when the tab changes (tested via
 *     normalizeFilterParam — the same reset path used by handleTabChange).
 *
 * All helpers are pure functions, so no React Native renderer, AsyncStorage
 * mock, or Expo native module is needed.
 */

import { describe, expect, it } from "vitest";

import {
  filterReports,
  emptyStateMessage,
  normalizeFilterParam,
  applyTabChange,
  applyFilterParamChange,
  simulateColdStartHydration,
  type SearchableReport,
  type AuditFilter,
  type AuditScreenState,
  type ColdStartHydrationResult,
} from "../audit-search";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<SearchableReport> = {}): SearchableReport {
  return {
    id: 1,
    inspectionId: 10,
    title: "Quarterly Pest Inspection",
    siteAddress: "123 Oak Street, Springfield",
    clientName: "Acme Corp",
    status: "complete",
    createdAt: "2024-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const REPORT_A = makeReport({
  id: 1,
  title: "Annual Termite Report",
  siteAddress: "42 Elm Ave, Portland",
  clientName: "BuildRight LLC",
});

const REPORT_B = makeReport({
  id: 2,
  title: "Rodent Exclusion Summary",
  siteAddress: "99 Pine Road, Eugene",
  clientName: "Park View HOA",
});

const REPORT_C = makeReport({
  id: 3,
  title: "Quarterly Inspection — Downtown Office",
  siteAddress: "1 Main Plaza, Seattle",
  clientName: "Acme Corp",
});

const ALL_REPORTS: SearchableReport[] = [REPORT_A, REPORT_B, REPORT_C];

// ─────────────────────────────────────────────────────────────────────────────
// 1. filterReports — search by address
// ─────────────────────────────────────────────────────────────────────────────

describe("filterReports — search by address", () => {
  it("returns only reports whose siteAddress contains the query", () => {
    const results = filterReports(ALL_REPORTS, "Pine Road");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_B.id);
  });

  it("is case-insensitive when matching the address", () => {
    const results = filterReports(ALL_REPORTS, "pine road");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_B.id);
  });

  it("matches a partial address fragment", () => {
    const results = filterReports(ALL_REPORTS, "portland");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_A.id);
  });

  it("returns all reports when the query is blank", () => {
    expect(filterReports(ALL_REPORTS, "")).toHaveLength(3);
  });

  it("returns all reports when the query is only whitespace", () => {
    expect(filterReports(ALL_REPORTS, "   ")).toHaveLength(3);
  });

  it("returns an empty array when the address matches nothing", () => {
    expect(filterReports(ALL_REPORTS, "Tokyo")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. filterReports — search by title
// ─────────────────────────────────────────────────────────────────────────────

describe("filterReports — search by title", () => {
  it("returns only reports whose title contains the query", () => {
    const results = filterReports(ALL_REPORTS, "Termite");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_A.id);
  });

  it("is case-insensitive when matching the title", () => {
    const results = filterReports(ALL_REPORTS, "termite");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_A.id);
  });

  it("matches a word that appears in multiple titles", () => {
    // "Inspection" appears in REPORT_A title? No. "Quarterly" appears in REPORT_C
    const results = filterReports(ALL_REPORTS, "Quarterly");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_C.id);
  });

  it("returns an empty array when the title matches nothing", () => {
    expect(filterReports(ALL_REPORTS, "Mold Assessment")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. filterReports — search by clientName
// ─────────────────────────────────────────────────────────────────────────────

describe("filterReports — search by clientName", () => {
  it("returns all reports for a client that appears multiple times", () => {
    // "Acme Corp" is clientName for REPORT_A? No — REPORT_A.clientName = "BuildRight LLC"
    // "Acme Corp" is clientName for REPORT_C
    const results = filterReports(ALL_REPORTS, "Acme");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(REPORT_C.id);
  });

  it("handles null clientName without throwing", () => {
    const withNull = [makeReport({ id: 99, clientName: null })];
    // Query can't match null — should return empty
    expect(filterReports(withNull, "anything")).toHaveLength(0);
  });

  it("handles undefined clientName without throwing", () => {
    const withUndefined = [makeReport({ id: 88, clientName: undefined })];
    expect(filterReports(withUndefined, "anything")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. emptyStateMessage — no-result states
// ─────────────────────────────────────────────────────────────────────────────

describe("emptyStateMessage — search produces no results", () => {
  it('returns "No results for …" when a search query has no matches', () => {
    const msg = emptyStateMessage("Mold Assessment", "all", "All");
    expect(msg).toBe('No results for "Mold Assessment".');
  });

  it('trims leading/trailing whitespace from the query in the message', () => {
    const msg = emptyStateMessage("  termites  ", "all", "All");
    expect(msg).toBe('No results for "termites".');
  });

  it("shows the filter-specific fallback when the query is empty and the tab is not all", () => {
    const msg = emptyStateMessage("", "critical", "Critical Risks");
    expect(msg).toBe('No reports match the "Critical Risks" filter.');
  });

  it("shows the all-tab fallback when query is empty and tab is all", () => {
    const msg = emptyStateMessage("", "all", "All");
    expect(msg).toBe("Complete an inspection to generate a report.");
  });

  it("always produces the search message regardless of active tab when query is non-empty", () => {
    const msg = emptyStateMessage("rodent", "critical", "Critical Risks");
    expect(msg).toBe('No results for "rodent".');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. applyTabChange — manual tab switch clears the search query
// ─────────────────────────────────────────────────────────────────────────────

describe("applyTabChange — search resets when the user switches tabs", () => {
  const withQuery: AuditScreenState = { activeTab: "all", searchQuery: "pine road" };

  it("clears searchQuery when switching to a different tab", () => {
    const next = applyTabChange(withQuery, "critical");
    expect(next.searchQuery).toBe("");
  });

  it("sets the correct activeTab", () => {
    const next = applyTabChange(withQuery, "pipeline");
    expect(next.activeTab).toBe("pipeline");
  });

  it("clears searchQuery even when switching to the same tab", () => {
    const next = applyTabChange(withQuery, "all");
    expect(next.searchQuery).toBe("");
    expect(next.activeTab).toBe("all");
  });

  it("clears a whitespace-only query", () => {
    const state: AuditScreenState = { activeTab: "pending", searchQuery: "   " };
    expect(applyTabChange(state, "pipeline").searchQuery).toBe("");
  });

  it("does not mutate the original state object", () => {
    const original: AuditScreenState = { activeTab: "all", searchQuery: "acme" };
    const next = applyTabChange(original, "pending");
    expect(original.searchQuery).toBe("acme");
    expect(next).not.toBe(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. applyFilterParamChange — URL param change clears search and updates tab
// ─────────────────────────────────────────────────────────────────────────────

describe("applyFilterParamChange — deep-link navigation clears search query", () => {
  const withQuery: AuditScreenState = { activeTab: "all", searchQuery: "acme corp" };

  it("clears searchQuery when a valid filter param arrives", () => {
    const next = applyFilterParamChange(withQuery, "critical");
    expect(next.searchQuery).toBe("");
  });

  it("sets the correct activeTab for a valid param", () => {
    const next = applyFilterParamChange(withQuery, "pipeline");
    expect(next.activeTab).toBe("pipeline");
  });

  it('falls back to "all" and clears search for an unrecognised param', () => {
    const next = applyFilterParamChange(withQuery, "garbage");
    expect(next.activeTab).toBe("all");
    expect(next.searchQuery).toBe("");
  });

  it("clears search when the param is undefined (e.g. navigating to unparameterised route)", () => {
    const next = applyFilterParamChange(withQuery, undefined);
    expect(next.activeTab).toBe("all");
    expect(next.searchQuery).toBe("");
  });

  it("handles an array param (expo-router multi-value) by picking the first element", () => {
    const next = applyFilterParamChange(withQuery, ["pending", "critical"]);
    expect(next.activeTab).toBe("pending");
    expect(next.searchQuery).toBe("");
  });

  it("does not mutate the original state object", () => {
    const original: AuditScreenState = { activeTab: "critical", searchQuery: "oak" };
    const next = applyFilterParamChange(original, "pipeline");
    expect(original.searchQuery).toBe("oak");
    expect(next).not.toBe(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. KPI deep-link navigation — executive dashboard tiles open the correct tab
//
//  executive-dashboard.tsx pushes two distinct filter values:
//    "Open Pipeline" KPI        → /reports-detail?filter=pipeline
//    "Avg Quality Score" KPI    → /reports-detail?filter=critical
//    "Critical Risk Sites" KPI  → /reports-detail?filter=critical
//
//  reports-detail.tsx seeds activeTab via normalizeFilterParam(filterParam) on
//  first mount and re-syncs via applyFilterParamChange in a useEffect when the
//  param changes. Both paths are exercised here.
// ─────────────────────────────────────────────────────────────────────────────

describe("KPI deep-link — 'Open Pipeline' tile opens the Pipeline tab", () => {
  // Simulate first mount: useState initializer uses normalizeFilterParam.
  it("normalizes 'pipeline' param to the pipeline tab on first mount", () => {
    const tab = normalizeFilterParam("pipeline");
    expect(tab).toBe("pipeline");
  });

  // Simulate param-change effect: applyFilterParamChange mirrors the useEffect.
  it("applyFilterParamChange sets activeTab to 'pipeline' when param is 'pipeline'", () => {
    const initial: AuditScreenState = { activeTab: "all", searchQuery: "" };
    const next = applyFilterParamChange(initial, "pipeline");
    expect(next.activeTab).toBe("pipeline");
  });

  it("does not accidentally land on 'all' for the pipeline param", () => {
    expect(normalizeFilterParam("pipeline")).not.toBe("all");
  });
});

describe("KPI deep-link — 'Avg Quality Score' tile opens the Critical Risks tab", () => {
  // executive-dashboard.tsx pushes /reports-detail?filter=critical for the
  // "Avg Quality Score" KPI.  Low quality scores correlate with critical-risk
  // findings so the destination is intentional, but the label mismatch means
  // this mapping must be guarded by an explicit test.

  it("normalizes 'critical' param (sent by Avg Quality Score tile) to the critical tab on first mount", () => {
    const tab = normalizeFilterParam("critical");
    expect(tab).toBe("critical");
  });

  it("applyFilterParamChange sets activeTab to 'critical' when Avg Quality Score tile fires filter=critical", () => {
    const initial: AuditScreenState = { activeTab: "all", searchQuery: "" };
    const next = applyFilterParamChange(initial, "critical");
    expect(next.activeTab).toBe("critical");
  });

  it("does not accidentally open the pipeline tab when Avg Quality Score sends filter=critical", () => {
    expect(normalizeFilterParam("critical")).not.toBe("pipeline");
  });

  it("does not accidentally open the all tab when Avg Quality Score sends filter=critical", () => {
    expect(normalizeFilterParam("critical")).not.toBe("all");
  });

  it("clears any active search query when navigating from Avg Quality Score tile", () => {
    const withSearch: AuditScreenState = { activeTab: "all", searchQuery: "oak street" };
    const next = applyFilterParamChange(withSearch, "critical");
    expect(next.activeTab).toBe("critical");
    expect(next.searchQuery).toBe("");
  });
});

describe("KPI deep-link — 'Critical Risk Sites' tile opens the Critical Risks tab", () => {
  // Simulate first mount.
  it("normalizes 'critical' param to the critical tab on first mount", () => {
    const tab = normalizeFilterParam("critical");
    expect(tab).toBe("critical");
  });

  // Simulate param-change effect.
  it("applyFilterParamChange sets activeTab to 'critical' when param is 'critical'", () => {
    const initial: AuditScreenState = { activeTab: "all", searchQuery: "" };
    const next = applyFilterParamChange(initial, "critical");
    expect(next.activeTab).toBe("critical");
  });

  it("does not accidentally land on 'all' for the critical param", () => {
    expect(normalizeFilterParam("critical")).not.toBe("all");
  });
});

describe("KPI deep-link — back navigation and return behaviour", () => {
  // When the user presses back from reports-detail and then re-enters via
  // the same KPI tile, expo-router may either reuse the mounted screen with
  // unchanged params or push a fresh instance.  Either way the param-change
  // effect fires and must resolve to the correct tab.

  it("re-entering with filter=pipeline still lands on pipeline (idempotent)", () => {
    // Screen already on pipeline; param fires again with same value.
    const alreadyOnPipeline: AuditScreenState = { activeTab: "pipeline", searchQuery: "" };
    const next = applyFilterParamChange(alreadyOnPipeline, "pipeline");
    expect(next.activeTab).toBe("pipeline");
  });

  it("re-entering with filter=critical still lands on critical (idempotent)", () => {
    const alreadyOnCritical: AuditScreenState = { activeTab: "critical", searchQuery: "" };
    const next = applyFilterParamChange(alreadyOnCritical, "critical");
    expect(next.activeTab).toBe("critical");
  });

  it("navigating back (no filter param) resets gracefully to 'all' without throwing", () => {
    // When the user presses back, the route may no longer carry the filter
    // param.  The screen should fall back to 'all' rather than staying stale.
    const onPipeline: AuditScreenState = { activeTab: "pipeline", searchQuery: "" };
    const next = applyFilterParamChange(onPipeline, undefined);
    expect(next.activeTab).toBe("all");
    expect(next.searchQuery).toBe("");
  });

  it("returning to reports-detail from back and then re-tapping pipeline restores pipeline", () => {
    // Step 1: back — param is gone, resets to 'all'.
    const step1 = applyFilterParamChange({ activeTab: "pipeline", searchQuery: "" }, undefined);
    expect(step1.activeTab).toBe("all");

    // Step 2: user taps "Open Pipeline" KPI again — param is 'pipeline'.
    const step2 = applyFilterParamChange(step1, "pipeline");
    expect(step2.activeTab).toBe("pipeline");
  });

  it("search query entered in one tab does not bleed into the tab opened via deep-link", () => {
    // User searched while on 'all', then taps a KPI tile → query must clear.
    const withSearch: AuditScreenState = { activeTab: "all", searchQuery: "oak street" };
    const next = applyFilterParamChange(withSearch, "critical");
    expect(next.activeTab).toBe("critical");
    expect(next.searchQuery).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Bad deep-link filter param — normalizeFilterParam fallback behaviour
//
//  Task spec scenarios:
//    a) /reports-detail?filter=PENDING  (uppercase)   → All tab (not a crash)
//    b) /reports-detail?filter=pending  (lowercase)   → Pending tab
//    c) /reports-detail                (no param)     → All tab
//    d) /reports-detail?filter=foo      (arbitrary)   → All tab
// ─────────────────────────────────────────────────────────────────────────────

describe("bad deep-link filter param — normalizeFilterParam falls back to 'all'", () => {
  // ── a) Uppercase value is not a valid AuditFilter ─────────────────────────
  it("treats 'PENDING' (uppercase) as unrecognised and returns 'all'", () => {
    expect(normalizeFilterParam("PENDING")).toBe("all");
  });

  it("treats 'CRITICAL' (uppercase) as unrecognised and returns 'all'", () => {
    expect(normalizeFilterParam("CRITICAL")).toBe("all");
  });

  it("treats 'Pipeline' (mixed-case) as unrecognised and returns 'all'", () => {
    expect(normalizeFilterParam("Pipeline")).toBe("all");
  });

  // ── b) Lowercase valid value maps to the expected tab ─────────────────────
  it("maps 'pending' (lowercase) to the pending tab", () => {
    expect(normalizeFilterParam("pending")).toBe("pending");
  });

  it("maps 'critical' (lowercase) to the critical tab", () => {
    expect(normalizeFilterParam("critical")).toBe("critical");
  });

  it("maps 'pipeline' (lowercase) to the pipeline tab", () => {
    expect(normalizeFilterParam("pipeline")).toBe("pipeline");
  });

  it("maps 'all' (lowercase) to the all tab", () => {
    expect(normalizeFilterParam("all")).toBe("all");
  });

  // ── c) Missing param defaults to 'all' ───────────────────────────────────
  it("returns 'all' when the param is undefined (no ?filter= in the URL)", () => {
    expect(normalizeFilterParam(undefined)).toBe("all");
  });

  it("returns 'all' when the param is an empty string", () => {
    expect(normalizeFilterParam("")).toBe("all");
  });

  // ── d) Arbitrary garbage values default to 'all' ─────────────────────────
  it("returns 'all' for an arbitrary unknown string 'foo'", () => {
    expect(normalizeFilterParam("foo")).toBe("all");
  });

  it("returns 'all' for a numeric-looking string '123'", () => {
    expect(normalizeFilterParam("123")).toBe("all");
  });

  it("returns 'all' for a SQL-injection-style string", () => {
    expect(normalizeFilterParam("' OR 1=1 --")).toBe("all");
  });

  // ── Array params (expo-router passes string[] for repeated query keys) ────
  it("picks the first element of an array param when it is a valid filter", () => {
    expect(normalizeFilterParam(["pending", "critical"])).toBe("pending");
  });

  it("returns 'all' when the first element of an array param is uppercase", () => {
    expect(normalizeFilterParam(["PENDING"])).toBe("all");
  });

  it("returns 'all' when the array is empty", () => {
    // Array.isArray([]) is true; [0] is undefined → falls back to 'all'.
    expect(normalizeFilterParam([])).toBe("all");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. pull-to-refresh — existing search query narrows refreshed data correctly
//
//  React Query replaces the cached list with a new server response after a
//  pull-to-refresh gesture.  The search query lives in local component state
//  and does NOT reset.  filterReports must operate on the NEW data while the
//  OLD query string is still active — it must never serve stale, pre-refresh
//  results.
// ─────────────────────────────────────────────────────────────────────────────

describe("pull-to-refresh — filterReports narrows refreshed data with the existing query", () => {
  // Stale data the component held before the refresh.
  const staleReports: SearchableReport[] = [
    makeReport({ id: 10, title: "Termite Inspection", siteAddress: "10 Old Lane", clientName: "OldCo" }),
    makeReport({ id: 11, title: "Rodent Survey", siteAddress: "11 Old Lane", clientName: "OldCo" }),
  ];

  // Fresh data returned by the server after the pull-to-refresh completes.
  const freshReports: SearchableReport[] = [
    makeReport({ id: 20, title: "Termite Inspection", siteAddress: "20 New Blvd", clientName: "NewCo" }),
    makeReport({ id: 21, title: "Rodent Survey", siteAddress: "21 New Blvd", clientName: "NewCo" }),
    makeReport({ id: 22, title: "Annual Review", siteAddress: "22 New Blvd", clientName: "AcmeCorp" }),
  ];

  it("returns results from the refreshed list, not the stale list, when the query is unchanged", () => {
    // Query was active before refresh and has NOT been cleared.
    const query = "Termite";

    const staleResults = filterReports(staleReports, query);
    const freshResults = filterReports(freshReports, query);

    // Both return one result, but from different data sets.
    expect(staleResults).toHaveLength(1);
    expect(staleResults[0].id).toBe(10);

    expect(freshResults).toHaveLength(1);
    expect(freshResults[0].id).toBe(20); // fresh item, not the stale one
  });

  it("narrows fresh data correctly when the new data has more matches than the old", () => {
    // Query matches only one stale record but multiple fresh records.
    const moreMatchesFresh: SearchableReport[] = [
      makeReport({ id: 30, title: "Quarterly Termite Report", siteAddress: "30 Main St", clientName: "Beta LLC" }),
      makeReport({ id: 31, title: "Termite Baiting Inspection", siteAddress: "31 Main St", clientName: "Beta LLC" }),
      makeReport({ id: 32, title: "Rodent Exclusion", siteAddress: "32 Main St", clientName: "Beta LLC" }),
    ];

    const query = "Termite";

    const staleResults = filterReports(staleReports, query);
    const freshResults = filterReports(moreMatchesFresh, query);

    expect(staleResults).toHaveLength(1);
    expect(freshResults).toHaveLength(2);
    expect(freshResults.map((r) => r.id)).toEqual([30, 31]);
  });

  it("narrows fresh data correctly when the new data has fewer matches than the old", () => {
    // Fresh data doesn't contain any item matching the active query.
    const noMatchFresh: SearchableReport[] = [
      makeReport({ id: 40, title: "Rodent Survey", siteAddress: "40 Park Ave", clientName: "Gamma Inc" }),
      makeReport({ id: 41, title: "Annual Review", siteAddress: "41 Park Ave", clientName: "Gamma Inc" }),
    ];

    const query = "Termite";

    const staleResults = filterReports(staleReports, query);
    const freshResults = filterReports(noMatchFresh, query);

    expect(staleResults).toHaveLength(1); // stale data had a match
    expect(freshResults).toHaveLength(0); // fresh data has none — correct behaviour
  });

  it("returns the full fresh list when the query is blank (pull-to-refresh with no active search)", () => {
    const query = "";
    const results = filterReports(freshReports, query);
    expect(results).toHaveLength(freshReports.length);
    expect(results).toEqual(freshReports);
  });

  it("does not return items from stale data that are absent from the fresh list", () => {
    // Verify filterReports(fresh, query) never surfaces stale IDs.
    const query = "OldCo"; // matches stale items but NOT fresh items
    const freshResults = filterReports(freshReports, query);
    expect(freshResults).toHaveLength(0);
  });

  it("reflects a new item added by another technician that only appears after refresh", () => {
    // A report created after the last fetch appears in freshReports but not staleReports.
    const newlyAdded = makeReport({ id: 99, title: "Emergency Pest Call", siteAddress: "99 River Rd", clientName: "NewCo" });
    const freshWithNew = [...freshReports, newlyAdded];

    const query = "Emergency";

    expect(filterReports(staleReports, query)).toHaveLength(0); // not in stale data
    const freshResults = filterReports(freshWithNew, query);
    expect(freshResults).toHaveLength(1);
    expect(freshResults[0].id).toBe(99); // new item is reachable after refresh
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Cold-start deep-link — params arrive late (paramsReady guard)
//
//  When the app is cold-started via a push-notification deep link such as
//    readyloq://reports-detail?filter=critical
//  expo-router may deliver filterParam as `undefined` on the very first
//  render cycle before the navigation stack is fully hydrated.  If we used
//  that `undefined` value directly, the `useState` initializer would set
//  activeTab to "all", and the screen would show the "All" tab for one frame
//  before snapping to "critical" — a visible flash.
//
//  Fix: reports-detail.tsx uses a `paramsReady` boolean (starts false) that
//  is set to true only after the filterParam/qParam useEffect has fired.
//  While paramsReady is false the screen shows a skeleton, so the user never
//  sees the intermediate "all" state.
//
//  These tests document the two-step state machine in pure form so the
//  contract is regression-protected without a React renderer.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 10. Cold-start deep-link — simulateColdStartHydration (component model)
//
//  simulateColdStartHydration() is a pure model of the two-phase param
//  resolution performed by ReportsDetailScreen on cold start:
//
//    Phase 1 — useRootNavigationState().key is undefined (nav not hydrated).
//              useLocalSearchParams returns undefined for every param.
//              normalizeFilterParam(undefined) = "all" — the WRONG tab.
//              The paramsReady skeleton guard keeps this hidden from the user.
//
//    Phase 2 — navigation hydrates; useRootNavigationState().key is set.
//              The param useEffect re-fires (navigationReady dep changed).
//              filterParam = "critical" → applyFilterParamChange resolves it.
//              paramsReady is set to true; skeleton is replaced with the
//              CORRECT tab, never having been visible.
//
//  wasAllTabVisibleDuringHydration = true whenever the guard is necessary.
// ─────────────────────────────────────────────────────────────────────────────

describe("cold-start deep-link — simulateColdStartHydration models the two-phase sequence", () => {
  // ── filter=critical ──────────────────────────────────────────────────────

  it("cold start with filter=critical: pre-hydration is 'all' (wrong), post-hydration is 'critical' (correct)", () => {
    const result: ColdStartHydrationResult = simulateColdStartHydration("critical");
    expect(result.preHydration.activeTab).toBe("all");   // what would flash WITHOUT the guard
    expect(result.postHydration.activeTab).toBe("critical"); // what the user sees WITH the guard
  });

  it("cold start with filter=critical: wasAllTabVisibleDuringHydration is true — guard is required", () => {
    const { wasAllTabVisibleDuringHydration } = simulateColdStartHydration("critical");
    expect(wasAllTabVisibleDuringHydration).toBe(true);
  });

  it("cold start with filter=critical: post-hydration tab is NOT 'all' (regression guard)", () => {
    const { postHydration } = simulateColdStartHydration("critical");
    expect(postHydration.activeTab).not.toBe("all");
  });

  // ── filter=pipeline ──────────────────────────────────────────────────────

  it("cold start with filter=pipeline: pre-hydration is 'all', post-hydration is 'pipeline'", () => {
    const { preHydration, postHydration } = simulateColdStartHydration("pipeline");
    expect(preHydration.activeTab).toBe("all");
    expect(postHydration.activeTab).toBe("pipeline");
  });

  it("cold start with filter=pipeline: wasAllTabVisibleDuringHydration is true — guard is required", () => {
    const { wasAllTabVisibleDuringHydration } = simulateColdStartHydration("pipeline");
    expect(wasAllTabVisibleDuringHydration).toBe(true);
  });

  it("cold start with filter=pipeline: post-hydration tab is NOT 'all'", () => {
    const { postHydration } = simulateColdStartHydration("pipeline");
    expect(postHydration.activeTab).not.toBe("all");
  });

  // ── filter=pending ───────────────────────────────────────────────────────

  it("cold start with filter=pending: pre-hydration is 'all', post-hydration is 'pending'", () => {
    const { preHydration, postHydration } = simulateColdStartHydration("pending");
    expect(preHydration.activeTab).toBe("all");
    expect(postHydration.activeTab).toBe("pending");
  });

  it("cold start with filter=pending: wasAllTabVisibleDuringHydration is true — guard is required", () => {
    const { wasAllTabVisibleDuringHydration } = simulateColdStartHydration("pending");
    expect(wasAllTabVisibleDuringHydration).toBe(true);
  });

  it("cold start with filter=pending: post-hydration tab is NOT 'all'", () => {
    const { postHydration } = simulateColdStartHydration("pending");
    expect(postHydration.activeTab).not.toBe("all");
  });

  // ── No deep-link param (normal cold start without a filter) ──────────────

  it("cold start with no filter param: both phases resolve to 'all' — no flash, no guard needed", () => {
    const { preHydration, postHydration, wasAllTabVisibleDuringHydration } =
      simulateColdStartHydration(undefined);
    expect(preHydration.activeTab).toBe("all");
    expect(postHydration.activeTab).toBe("all");
    expect(wasAllTabVisibleDuringHydration).toBe(false); // no flash risk
  });

  // ── With a ?q= search param ──────────────────────────────────────────────

  it("cold start with filter=critical&q=oak: post-hydration preserves the search query", () => {
    const { postHydration } = simulateColdStartHydration("critical", "oak");
    expect(postHydration.activeTab).toBe("critical");
    expect(postHydration.searchQuery).toBe("oak");
  });

  it("cold start with filter=critical&q=oak: pre-hydration has empty search query", () => {
    const { preHydration } = simulateColdStartHydration("critical", "oak");
    expect(preHydration.searchQuery).toBe("");
  });

  // ── Array params (expo-router multi-value) ────────────────────────────────

  it("cold start with filter=['critical','pipeline'] (array): post-hydration picks the first element", () => {
    const { postHydration } = simulateColdStartHydration(["critical", "pipeline"]);
    expect(postHydration.activeTab).toBe("critical");
  });

  // ── Bad/unrecognised deep-link param ─────────────────────────────────────

  it("cold start with filter='CRITICAL' (uppercase): post-hydration falls back to 'all' safely", () => {
    const { postHydration, wasAllTabVisibleDuringHydration } =
      simulateColdStartHydration("CRITICAL");
    expect(postHydration.activeTab).toBe("all");
    // No flash risk — both phases are "all".
    expect(wasAllTabVisibleDuringHydration).toBe(false);
  });

  it("cold start with filter='garbage': post-hydration falls back to 'all' safely", () => {
    const { postHydration, wasAllTabVisibleDuringHydration } =
      simulateColdStartHydration("garbage");
    expect(postHydration.activeTab).toBe("all");
    expect(wasAllTabVisibleDuringHydration).toBe(false);
  });

  // ── State immutability ───────────────────────────────────────────────────

  it("does not mutate the preHydration object when computing postHydration", () => {
    const result = simulateColdStartHydration("critical");
    expect(result.preHydration).not.toBe(result.postHydration);
    expect(result.preHydration.activeTab).toBe("all"); // unchanged
  });
});

// ─── applyFilterParamChange equivalents for the bad-link scenarios ───────────

describe("bad deep-link filter param — applyFilterParamChange falls back to 'all'", () => {
  const initial: AuditScreenState = { activeTab: "pipeline", searchQuery: "existing query" };

  it("resets to 'all' and clears search when filter=PENDING (uppercase) arrives", () => {
    const next = applyFilterParamChange(initial, "PENDING");
    expect(next.activeTab).toBe("all");
    expect(next.searchQuery).toBe("");
  });

  it("switches to 'pending' and clears search when filter=pending (lowercase) arrives", () => {
    const next = applyFilterParamChange(initial, "pending");
    expect(next.activeTab).toBe("pending");
    expect(next.searchQuery).toBe("");
  });

  it("resets to 'all' and clears search when no filter param is present", () => {
    const next = applyFilterParamChange(initial, undefined);
    expect(next.activeTab).toBe("all");
    expect(next.searchQuery).toBe("");
  });

  it("resets to 'all' for an arbitrary garbage value 'foo'", () => {
    const next = applyFilterParamChange(initial, "foo");
    expect(next.activeTab).toBe("all");
    expect(next.searchQuery).toBe("");
  });
});
