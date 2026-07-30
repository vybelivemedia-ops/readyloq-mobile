/**
 * Typed API client for the daily technician rig.
 *
 * Endpoints:
 *  POST /technician/daily-rig          — create / replace today's rig
 *  GET  /technician/daily-rig          — fetch today's rig with full product data
 *  GET  /technician/recent-mixes       — last 30 days treatment logs, deduped by
 *                                        product+site classification
 */
import { customFetch } from "./custom-fetch";
import type { Product } from "./products";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface DailyRig {
  id: number;
  technicianId: string;
  rigDate: string; // "YYYY-MM-DD"
  productIds: number[];
  products: Product[]; // populated on GET
  createdAt: string;
  updatedAt: string;
}

export interface RecentMix {
  /** Server treatment-log row id. */
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

// ─── API wrappers ─────────────────────────────────────────────────────────────

/** Today's date in "YYYY-MM-DD" format using the device's local clock. */
export function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Create or replace the technician's rig for today.
 * The server uses an UPSERT on (companyId, technicianId, rigDate) so retries
 * are safe.
 */
export async function upsertDailyRig(productIds: number[]): Promise<DailyRig> {
  return customFetch<DailyRig>("/api/technician/daily-rig", {
    method: "POST",
    body: JSON.stringify({ productIds, date: todayDateString() }),
  });
}

/**
 * Fetch the technician's daily rig for a given date (defaults to **local** today).
 *
 * Always sends an explicit `date` query param so the server interprets dates
 * in the technician's local timezone rather than the server's UTC clock. This
 * prevents incorrect 404s near day-boundary hours.
 *
 * Returns null when no rig has been set up for the requested date.
 */
export async function getDailyRig(date?: string): Promise<DailyRig | null> {
  // Default to the device's local date — never rely on server UTC as default.
  const dateParam = date ?? todayDateString();
  try {
    return await customFetch<DailyRig>(
      `/api/technician/daily-rig?date=${encodeURIComponent(dateParam)}`,
    );
  } catch (e) {
    // 404 means no rig set up yet — treat as null rather than throwing.
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

/**
 * Fetch the last 30 days of treatment logs for the requesting technician,
 * deduplicated by (productId, siteClassification), newest first.
 * Returns up to 5 entries.
 */
export async function getRecentMixes(inspectionType?: string): Promise<RecentMix[]> {
  const qs = inspectionType ? `?inspectionType=${encodeURIComponent(inspectionType)}` : "";
  return customFetch<RecentMix[]>(`/api/technician/daily-rig/recent-mixes${qs}`);
}
