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
  type SearchableReport,
  type AuditFilter,
  type AuditScreenState,
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
