/**
 * Typed API client for the schedule / calendar feature.
 *
 * DELIBERATELY hand-written, not generated: this app's `lib/api-client/generated/`
 * is a manually-frozen fork of Orval output (see
 * .agents/memory/mobile-generated-api-client-fork.md) that lib/api-spec's
 * `pnpm run codegen` does not regenerate, and it is NOT wired up for
 * schedule/products/treatment-log/daily-rig endpoints at all — those features
 * have always used the hand-written fetchers in this directory instead. That
 * split is intentional and stays intentional: adopting the frozen fork here
 * would mean hand-patching it in lockstep with every schedule-route change to
 * `lib/api-spec/openapi.yaml`, which is strictly more maintenance than the
 * thin hand-written wrappers below already are. New schedule/products/
 * treatment-log/daily-rig endpoints should keep following this file's
 * pattern (typed interfaces + a `customFetch` call) rather than reaching for
 * `generated/`.
 *
 * Endpoints:
 *   GET /api/schedule?start=YYYY-MM-DD&end=YYYY-MM-DD
 *     — list all company inspection stops in a date window
 *
 *   GET /api/schedule/property-profile?address=...
 *     — pre-inspection briefing for a specific address
 *
 *   GET /api/schedule/property-visit/:inspectionId
 *     — drill-down detail for a past visit (unit breakdowns + chemical ledger)
 *
 *   GET /api/schedule/route-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
 *     — Integrated Route Calendar summary, grouped by day, with a Route
 *       Readiness flag and rolled-up Route Chemical Outlook counts per stop
 *
 *   GET /api/schedule/route-outlook/:inspectionId
 *     — full Route Chemical Outlook for a single stop's address
 */

import { customFetch } from "./custom-fetch";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleEntry {
  id: number;
  siteAddress: string;
  clientName: string | null;
  /** Unit / apartment number for multi-family properties. */
  unitNumber: string | null;
  technicianName: string;
  technicianId: string | null;
  status: string;
  severity: string | null;
  pestTypes: string[];
  scheduledDate: string | null;
  calendarDate: string; // YYYY-MM-DD
  createdAt: string;
  completedAt: string | null;
}

export interface RecentInspectionSummary {
  id: number;
  status: string;
  severity: string | null;
  pestTypes: string[];
  technicianName: string;
  calendarDate: string; // YYYY-MM-DD
  findingsCount: number;
  completedAt: string | null;
}

export interface PropertyNoteSummary {
  id: number;
  note: string;
  zone: string | null;
  category: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface HistoricalFinding {
  category: string;
  description: string;
  frequency: number;
  severity?: "low" | "medium" | "high";
}

export interface StopHistoryPhoto {
  id: number;
  url: string;
  filename: string | null;
  caption: string | null;
  inspectionId: number;
  calendarDate: string;
  createdAt: string;
}

export interface PropertyProfile {
  address: string;
  addressKey: string;
  recentInspections: RecentInspectionSummary[];
  historicalPhotos: StopHistoryPhoto[];
  materialHistory: ChemicalLedgerEntry[];
  activeBaitStations: number;
  historicalPests: string[];
  historicalFindings: HistoricalFinding[];
  notes: PropertyNoteSummary[];
}

export type PestPacHistoryStatus =
  | "available"
  | "disabled"
  | "not_configured"
  | "not_mapped"
  | "unavailable";

export interface PestPacLegacyNote {
  id: string;
  note: string;
  category: string | null;
  authorName: string | null;
  createdAt: string | null;
}

export interface PestPacStopHistory {
  status: PestPacHistoryStatus;
  notes: PestPacLegacyNote[];
}

export interface StopHistory extends PropertyProfile {
  stopId: number;
  pestPacHistory: PestPacStopHistory;
}

/** One unit-level inspection within a visit (a "visit" = every inspection
 *  sharing the same company + site address + calendar date). */
export interface PropertyVisitUnit {
  id: number;
  unitNumber: string | null;
  clientName: string | null;
  technicianName: string;
  technicianId: string | null;
  status: string;
  severity: string | null;
  pestTypes: string[];
  notes: string | null;
  visitPurpose: string | null;
  findingsCount: number;
  mediaCount: number;
  completedAt: string | null;
}

/** Retreatment-interval compliance for one chemical application, checked
 *  against the most recent PRIOR application of the same product at the same
 *  address. */
export interface ChemicalLedgerCompliance {
  retreatmentIntervalDays: number | null;
  priorApplicationAt: string | null;
  daysSincePrior: number | null;
  isCompliant: boolean;
  nextEligibleReapplicationDate: string | null;
  eligibleNow: boolean;
}

export interface ChemicalLedgerEntry {
  id: number;
  inspectionId: number;
  productId: number;
  productName: string;
  epaRegistrationNumber: string | null;
  targetPest: string;
  siteClassification: string;
  areaSqft: number | null;
  linearFt: number | null;
  totalProductOz: number | null;
  equipmentUsed: string | null;
  notes: string | null;
  appliedAt: string;
  compliance: ChemicalLedgerCompliance;
}

export interface PropertyVisitDetail {
  address: string;
  calendarDate: string; // YYYY-MM-DD
  units: PropertyVisitUnit[];
  chemicalLedger: ChemicalLedgerEntry[];
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

/**
 * Fetch inspection stops for a date window (YYYY-MM-DD strings).
 * Returns all company stops visible to the authenticated user.
 */
export async function getScheduleEntries(
  start: string,
  end: string,
): Promise<ScheduleEntry[]> {
  return customFetch<ScheduleEntry[]>(
    `/api/schedule?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );
}

/**
 * Fetch the pre-inspection briefing for a specific property address.
 * Returns null when the server has no history for that address (404).
 */
export async function getPropertyProfile(
  address: string,
): Promise<PropertyProfile | null> {
  try {
    return await customFetch<PropertyProfile>(
      `/api/schedule/property-profile?address=${encodeURIComponent(address)}`,
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

/**
 * Fetch complete pre-service history for one scheduled stop. The server
 * resolves the property from the stop and enforces exact technician assignment.
 */
export async function getStopHistory(
  inspectionId: number,
): Promise<StopHistory | null> {
  try {
    return await customFetch<StopHistory>(
      `/api/schedule/stop-history/${inspectionId}`,
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

/**
 * Fetch the drill-down detail for a past visit, anchored on any one
 * inspection from that visit. Returns null when the inspection no longer
 * exists (404).
 */
export async function getPropertyVisit(
  inspectionId: number,
): Promise<PropertyVisitDetail | null> {
  try {
    return await customFetch<PropertyVisitDetail>(
      `/api/schedule/property-visit/${inspectionId}`,
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

// ─── Integrated Route Calendar ──────────────────────────────────────────────

export type RouteOutlookStatus = "ok" | "due-soon" | "overdue";

export interface RouteOutlookProduct {
  productId: number;
  productName: string;
  targetPest: string;
  lastAppliedAt: string;
  daysSinceApplication: number;
  retreatmentIntervalDays: number | null;
  nextEligibleReapplicationDate: string | null;
  eligibleNow: boolean;
  outlookStatus: RouteOutlookStatus;
  applicationsLast90Days: number;
}

export interface RouteOutlookDetail {
  address: string;
  calendarDate: string;
  products: RouteOutlookProduct[];
}

export interface RouteCalendarStop {
  id: number;
  siteAddress: string;
  clientName: string | null;
  unitNumber: string | null;
  technicianName: string;
  technicianId: string | null;
  status: string;
  severity: string | null;
  pestTypes: string[];
  calendarDate: string; // YYYY-MM-DD
  /** Route Readiness flag: null when the stop has no assigned technician. */
  readiness: { dailyRigSetUp: boolean | null };
  /** Rolled-up Route Chemical Outlook counts so a flag shows without opening the stop. */
  outlook: { overdueCount: number; dueSoonCount: number; okCount: number; hasOutlookData: boolean };
}

export interface RouteCalendarDay {
  date: string; // YYYY-MM-DD
  stops: RouteCalendarStop[];
}

/**
 * Fetch the Integrated Route Calendar summary for a date window, grouped by
 * day, with Route Readiness + Route Chemical Outlook annotations per stop.
 *
 * `start`/`end` must be this device's own LOCAL calendar dates (matching
 * `technicianDailyRigsTable.rigDate`, which the daily-rig client also writes
 * using local device date — see daily-route.ts). We send the device's UTC
 * offset so the server buckets/labels every stop's calendarDate in the same
 * local frame instead of UTC, keeping it consistent with Route Readiness.
 */
export async function getRouteCalendar(
  start: string,
  end: string,
): Promise<RouteCalendarDay[]> {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  return customFetch<RouteCalendarDay[]>(
    `/api/schedule/route-calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&tzOffsetMinutes=${tzOffsetMinutes}`,
  );
}

/**
 * Fetch the full Route Chemical Outlook for a single stop, anchored on its
 * inspection id. Returns null when the inspection no longer exists (404).
 */
export async function getRouteOutlook(
  inspectionId: number,
): Promise<RouteOutlookDetail | null> {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  try {
    return await customFetch<RouteOutlookDetail>(
      `/api/schedule/route-outlook/${inspectionId}?tzOffsetMinutes=${tzOffsetMinutes}`,
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}
