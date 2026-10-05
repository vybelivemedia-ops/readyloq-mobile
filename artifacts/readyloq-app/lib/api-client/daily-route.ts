/**
 * Typed API client for the technician's daily route chemical assignments.
 *
 * Replaces the previous "rig inventory" model with explicit product-to-pest
 * pairings for the day's route. Example: Suspend SC → German Cockroaches.
 *
 * DELIBERATELY hand-written, not generated — see the matching note at the top
 * of `./schedule.ts`. This app's `lib/api-client/generated/` fork is not wired
 * up for daily-rig endpoints; the hand-written fetchers below are the
 * intended long-term pattern for this feature area, not a stopgap.
 *
 * Endpoints:
 *  POST /technician/daily-rig          — create / replace today's assignments
 *  GET  /technician/daily-rig          — fetch today's assignments with full product data
 *  GET  /technician/daily-rig/recent-mixes — last-30-day treatment logs, deduped
 */

import { customFetch } from "./custom-fetch";
import type { Product } from "./products";

// ─── Core types ───────────────────────────────────────────────────────────────

/**
 * A single route chemical assignment: the technician intends to use this
 * product against this pest type on today's route.
 */
export interface RouteAssignment {
  productId: number;
  /** Canonical pest name — e.g. "German Cockroaches", "Ants" */
  targetPest: string;
  /** Optional free-text context, e.g. "perimeter only", "kitchen drains" */
  notes?: string;
}

/**
 * A route assignment enriched with the full server-side product record
 * (including label rules). Returned by GET /technician/daily-rig.
 */
export interface RouteAssignmentWithProduct extends RouteAssignment {
  product: Product | null;
}

export interface DailyRoute {
  id: number;
  technicianId: string;
  rigDate: string; // "YYYY-MM-DD"
  assignments: RouteAssignmentWithProduct[];
  createdAt: string;
  updatedAt: string;
}

export interface RecentMix {
  logId: number;
  productId: number;
  productName: string;
  productActiveIngredients: string;
  targetPest: string;
  siteClassification: string;
  areaSqft: number | null;
  linearFt: number | null;
  totalProductOz: number | null;
  equipmentUsed: string | null;
  appliedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns today's date as "YYYY-MM-DD" using the device's local clock. */
export function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

/**
 * Create or replace the technician's route assignments for today.
 * Server uses an UPSERT on (companyId, technicianId, rigDate) so retries
 * are safe.
 */
export async function upsertDailyRoute(assignments: RouteAssignment[]): Promise<DailyRoute> {
  return customFetch<DailyRoute>("/api/technician/daily-rig", {
    method: "POST",
    body: JSON.stringify({ assignments, date: todayDateString() }),
  });
}

/**
 * Fetch the technician's route assignments for today (or a specific date).
 * Always passes an explicit local date to avoid UTC day-boundary 404s.
 * Returns null when no assignments exist for the requested date.
 */
export async function getDailyRoute(date?: string): Promise<DailyRoute | null> {
  const dateParam = date ?? todayDateString();
  try {
    return await customFetch<DailyRoute>(
      `/api/technician/daily-rig?date=${encodeURIComponent(dateParam)}`,
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

/**
 * Fetch recent mixes for quick-pick in the treatment wizard.
 * Returns up to 5 entries, deduped by (productId, siteClassification).
 */
export async function getRecentMixes(): Promise<RecentMix[]> {
  return customFetch<RecentMix[]>(`/api/technician/daily-rig/recent-mixes`);
}

// ─── Read-only Route Readiness lookup (any technician/date) ────────────────

export interface DailyRouteLookupResult {
  setUp: boolean;
  technicianId: string;
  rigDate: string;
  assignments: RouteAssignmentWithProduct[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Read-only lookup of a Route Readiness (daily rig) status for ANY
 * technician/date pair — used by the Integrated Route Calendar so a manager,
 * or a technician looking at a future date, can see readiness without the
 * editing affordances of `getDailyRoute`/`upsertDailyRoute` (which always
 * target the authenticated technician's own current-day rig).
 * Returns `{ setUp: false }` when no rig exists for that date (404), and
 * throws on a genuine access-denied (403) from looking up another
 * technician while not a manager/owner.
 */
export async function lookupDailyRoute(
  technicianId: string,
  date: string,
): Promise<DailyRouteLookupResult | { setUp: false }> {
  try {
    return await customFetch<DailyRouteLookupResult>(
      `/api/technician/daily-rig/lookup?technicianId=${encodeURIComponent(technicianId)}&date=${encodeURIComponent(date)}`,
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) return { setUp: false };
    throw e;
  }
}

// ─── Today's Route Readiness ─────────────────────────────────────────────────
//
// Compares today's scheduled stops against on-hand truck quantities for the
// products declared on today's rig. A proactive "will I run out TODAY"
// signal — distinct from Truck Stock Health (see inventory.ts), which is a
// longer-range trending projection independent of today's schedule.

export type RouteReadinessProductStatus = "ready" | "short" | "insufficient-data";
export type RouteReadinessOverallStatus = "ready" | "short" | "not-set-up";

export interface RouteReadinessProduct {
  productId: number;
  productName: string;
  targetPest: string;
  unit: string;
  quantityOnHand: number;
  avgUsagePerStop: number | null;
  expectedUsageToday: number | null;
  status: RouteReadinessProductStatus;
}

export interface RouteReadiness {
  technicianId: string;
  date: string;
  stopCount: number;
  rigSetUp: boolean;
  overallStatus: RouteReadinessOverallStatus;
  products: RouteReadinessProduct[];
}

/** Fetches Today's Route Readiness for the authenticated technician (or, for a
 *  manager/owner/sales viewer, for `technicianId` when provided). */
export async function getRouteReadiness(params?: {
  technicianId?: string;
  date?: string;
}): Promise<RouteReadiness> {
  const date = params?.date ?? todayDateString();
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  const search = new URLSearchParams({ date, tzOffsetMinutes: String(tzOffsetMinutes) });
  if (params?.technicianId) search.set("technicianId", params.technicianId);
  return customFetch<RouteReadiness>(`/api/technician/daily-rig/route-readiness?${search.toString()}`);
}

/** Manager/owner: Today's Route Readiness for every technician on the team. */
export async function getTeamRouteReadiness(date?: string): Promise<RouteReadiness[]> {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  const search = new URLSearchParams({
    date: date ?? todayDateString(),
    tzOffsetMinutes: String(tzOffsetMinutes),
  });
  return customFetch<RouteReadiness[]>(`/api/technician/daily-rig/team-route-readiness?${search.toString()}`);
}
