/**
 * Typed API client for the technician's daily route chemical assignments.
 *
 * Replaces the previous "rig inventory" model with explicit product-to-pest
 * pairings for the day's route. Example: Suspend SC → German Cockroaches.
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
