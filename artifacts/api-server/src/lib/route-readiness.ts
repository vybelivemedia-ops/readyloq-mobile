/**
 * Today's Route Readiness — compares a technician's scheduled stops for a
 * given calendar day against their truck's on-hand quantities for the
 * products they've declared on their daily rig, using recent per-application
 * usage history to project what today is likely to consume.
 *
 * This is a proactive, "will I run out TODAY" signal — distinct from Truck
 * Stock Health (inventory-forecasting.ts + consumers), which is a longer-
 * range "will this truck run dry before its next restock" projection.
 * Read-only; never mutates inventory, and never touches the reactive
 * `restockThreshold` alert (treatment-logs.ts).
 */

import { db, inspectionsTable, technicianDailyRigsTable, productsTable, techInventoryTable } from "@workspace/db";
import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { localMidnightUtc, localEndOfDayUtc } from "./calendar-tz";
import { fetchRecentTruckDeductions, averageUsagePerApplication } from "./inventory-forecasting";

const USAGE_LOOKBACK_DAYS = 30;

export type RouteReadinessProductStatus = "ready" | "short" | "insufficient-data";
export type RouteReadinessOverallStatus = "ready" | "short" | "not-set-up";

export interface RouteReadinessProduct {
  productId: number;
  productName: string;
  targetPest: string;
  unit: string;
  quantityOnHand: number;
  /** Average quantity used per application over the last 30 days; null = no history yet. */
  avgUsagePerStop: number | null;
  /** avgUsagePerStop * stopCount; null when avgUsagePerStop is null. */
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

interface RawAssignment {
  productId: number;
  targetPest: string;
  notes?: string;
}

/**
 * Computes Today's Route Readiness for one technician on one calendar date.
 * `tzOffsetMinutes` must match the frame the caller's `date` string is in
 * (see calendar-tz.ts) so the stop count lines up with the same local day
 * the technician's daily rig was declared for.
 */
export async function computeRouteReadiness(
  companyId: number,
  technicianId: string,
  date: string,
  tzOffsetMinutes: number,
): Promise<RouteReadiness> {
  const startDate = localMidnightUtc(date, tzOffsetMinutes);
  const endDate = localEndOfDayUtc(date, tzOffsetMinutes);

  const [{ value: stopCount }] = await db
    .select({ value: count() })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.technicianId, technicianId),
        sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) >= ${startDate}`,
        sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) <= ${endDate}`,
      ),
    );

  const [rig] = await db
    .select()
    .from(technicianDailyRigsTable)
    .where(
      and(
        eq(technicianDailyRigsTable.companyId, companyId),
        eq(technicianDailyRigsTable.technicianId, technicianId),
        eq(technicianDailyRigsTable.rigDate, date),
      ),
    )
    .limit(1);

  if (!rig) {
    return { technicianId, date, stopCount, rigSetUp: false, overallStatus: "not-set-up", products: [] };
  }

  const rawAssignments: RawAssignment[] =
    Array.isArray(rig.assignments) && rig.assignments.length > 0
      ? (rig.assignments as RawAssignment[])
      : (rig.productIds ?? []).map((id: number) => ({ productId: id, targetPest: "" }));

  if (rawAssignments.length === 0) {
    // Rig was set up with no products declared — nothing to check readiness
    // against. This is a distinct condition from "not-set-up" (surfaced via
    // rigSetUp) but we have no basis to flag anything as short.
    return { technicianId, date, stopCount, rigSetUp: true, overallStatus: "ready", products: [] };
  }

  const productIds = [...new Set(rawAssignments.map((a) => a.productId))];

  const [productRows, invRows, deductionRows] = await Promise.all([
    db.select().from(productsTable).where(inArray(productsTable.id, productIds)),
    db
      .select()
      .from(techInventoryTable)
      .where(
        and(
          eq(techInventoryTable.companyId, companyId),
          eq(techInventoryTable.technicianId, technicianId),
          inArray(techInventoryTable.productId, productIds),
        ),
      ),
    fetchRecentTruckDeductions(companyId, technicianId, productIds, USAGE_LOOKBACK_DAYS),
  ]);

  const productMap = new Map(productRows.map((p) => [p.id, p]));
  const invMap = new Map(invRows.map((r) => [r.productId, r]));
  const avgPerAppMap = averageUsagePerApplication(deductionRows);

  const products: RouteReadinessProduct[] = rawAssignments.map((a) => {
    const inv = invMap.get(a.productId);
    const quantityOnHand = inv?.quantityOnHand ?? 0;
    const unit = inv?.unit ?? "unit";
    const avgUsagePerStop = avgPerAppMap.get(a.productId) ?? null;
    const expectedUsageToday = avgUsagePerStop != null ? avgUsagePerStop * stopCount : null;

    let status: RouteReadinessProductStatus;
    if (stopCount === 0) {
      status = "ready"; // nothing scheduled today, so nothing can be short today
    } else if (avgUsagePerStop == null) {
      status = "insufficient-data";
    } else {
      status = quantityOnHand < (expectedUsageToday as number) ? "short" : "ready";
    }

    return {
      productId: a.productId,
      productName: productMap.get(a.productId)?.name ?? `Product #${a.productId}`,
      targetPest: a.targetPest,
      unit,
      quantityOnHand,
      avgUsagePerStop,
      expectedUsageToday,
      status,
    };
  });

  const overallStatus: RouteReadinessOverallStatus = products.some((p) => p.status === "short") ? "short" : "ready";

  return { technicianId, date, stopCount, rigSetUp: true, overallStatus, products };
}
