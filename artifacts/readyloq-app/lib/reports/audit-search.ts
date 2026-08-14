/**
 * Pure helpers for the Management Report Audit search bar.
 *
 * Extracted from reports-detail.tsx so they can be unit-tested without a
 * React Native renderer or Expo native dependencies.
 */

import type { Report } from "@/lib/api-client/generated/api.schemas";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A Report extended with the optional `clientName` field used in search. */
export type SearchableReport = Report & { clientName?: string | null };

/** The four tab filters exposed in the audit screen. */
export type AuditFilter = "all" | "pipeline" | "critical" | "pending";

// ─── filterReports ────────────────────────────────────────────────────────────

/**
 * Client-side text search applied on top of the already server-filtered tab
 * data.  Matching is:
 *   - case-insensitive
 *   - substring (the query just has to appear anywhere in the haystack)
 *   - across `title`, `siteAddress`, and `clientName`
 *
 * Returns the full list unchanged when `query` is blank/whitespace-only.
 */
export function filterReports(
  reports: SearchableReport[],
  query: string,
): SearchableReport[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return reports;

  return reports.filter((r) => {
    const haystack = [r.title, r.siteAddress, r.clientName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

// ─── emptyStateMessage ────────────────────────────────────────────────────────

/**
 * Returns the human-readable message shown inside the empty-state view when
 * the filtered list is empty.
 *
 * @param searchQuery  The raw (un-trimmed) search query currently in the input.
 * @param activeTab    Which tab filter is active.
 * @param tabLabel     Display label of `activeTab` (e.g. "Pipeline").
 */
export function emptyStateMessage(
  searchQuery: string,
  activeTab: AuditFilter,
  tabLabel: string,
): string {
  const trimmed = searchQuery.trim();
  if (trimmed) return `No results for "${trimmed}".`;
  if (activeTab === "all") return "Complete an inspection to generate a report.";
  return `No reports match the "${tabLabel}" filter.`;
}

// ─── normalizeFilterParam ─────────────────────────────────────────────────────

const VALID_FILTERS = new Set<AuditFilter>(["all", "pipeline", "critical", "pending"]);

/**
 * Coerces a raw URL param value (string | string[] | undefined) to a valid
 * AuditFilter.  Falls back to "all" for missing or unrecognised values so a
 * bad deep-link never lands on an undefined tab.
 */
export function normalizeFilterParam(
  raw: string | string[] | undefined,
): AuditFilter {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return val && VALID_FILTERS.has(val as AuditFilter)
    ? (val as AuditFilter)
    : "all";
}

// ─── Screen state machine ─────────────────────────────────────────────────────

/**
 * Snapshot of the two pieces of React state the audit screen manages for
 * search and tab selection.
 */
export interface AuditScreenState {
  activeTab: AuditFilter;
  searchQuery: string;
}

/**
 * Pure state transition for when the user manually taps a tab button.
 *
 * Mirrors `handleTabChange` in ReportsDetailScreen: switches the active tab
 * and resets the search query to "" so stale results don't bleed into the
 * newly selected tab.
 */
export function applyTabChange(
  state: AuditScreenState,
  nextTab: AuditFilter,
): AuditScreenState {
  return { activeTab: nextTab, searchQuery: "" };
}

/**
 * Pure state transition for when the `filter` (and optional `q`) URL params
 * change (deep-link or back-navigation).
 *
 * Mirrors the `useEffect([filterParam, qParam])` in ReportsDetailScreen:
 * normalises the raw filter param, updates the active tab, and seeds the
 * search query from `rawQ` when provided (falling back to "" so results from
 * the previous tab don't leak when no search term is supplied).
 */
export function applyFilterParamChange(
  state: AuditScreenState,
  rawParam: string | string[] | undefined,
  rawQ?: string | string[] | undefined,
): AuditScreenState {
  const q = Array.isArray(rawQ) ? (rawQ[0] ?? "") : (rawQ ?? "");
  return { activeTab: normalizeFilterParam(rawParam), searchQuery: q };
}
