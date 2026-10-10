/**
 * Consumption-rate & replenishment-target resolution helpers.
 *
 * These back the Dual-Level Route Readiness engine (Today's Route Readiness +
 * Truck Stock Health) — both proactive, read-only views layered on top of the
 * existing reactive `restockThreshold` alert (which this file never touches).
 *
 * Data source for "how much does this technician actually use": the
 * `inventory_transactions` ledger, NOT `treatmentLogsTable.totalProductOz`.
 * A treatment log's `totalProductOz` is always recorded in fluid ounces
 * regardless of the truck's own inventory unit, but the truck-balance
 * deduction (and its ledger row) is only ever created when that truck's
 * inventory row is tracked in a compatible fl-oz unit (see the deduction
 * guard in treatment-logs.ts). Consuming the ledger instead of the raw log
 * field keeps every average expressed in the SAME unit as the on-hand
 * balance it will be divided into/compared against, and naturally yields
 * "insufficient data" (rather than a wrong number) for any product tracked
 * in an incompatible unit — consistent with this codebase's no-fabricated-
 * confidence convention.
 *
 * `truck_deduction_reversal` rows (created when a treatment log is deleted)
 * are netted out by `referenceId`: a deduction whose log was later reversed
 * did not really happen, so it counts toward neither the consumption sum
 * nor the per-application average.
 */

import {
  db,
  inventoryTransactionsTable,
  replenishmentTargetsTable,
  techInventoryTable,
  productsTable,
  type ReplenishmentTarget,
} from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TruckDeductionRow {
  productId: number;
  quantity: number;
  referenceId: number | null;
  /** When the deduction was recorded — used by predictive-restocking.ts's recency-weighted rate; unused by the flat averages below. */
  createdAt: Date;
}

/**
 * Fetches this technician's net `truck_deduction` activity (deductions minus
 * any later reversal of the same treatment log) for the given products over
 * the last `lookbackDays` days. Reversed deductions are dropped entirely —
 * they never happened net.
 */
export async function fetchRecentTruckDeductions(
  companyId: number,
  technicianId: string,
  productIds: number[],
  lookbackDays: number,
): Promise<TruckDeductionRow[]> {
  if (productIds.length === 0) return [];
  const cutoff = new Date(Date.now() - lookbackDays * DAY_MS);

  const rows = await db
    .select({
      productId: inventoryTransactionsTable.productId,
      quantity: inventoryTransactionsTable.quantity,
      movementType: inventoryTransactionsTable.movementType,
      referenceId: inventoryTransactionsTable.referenceId,
      createdAt: inventoryTransactionsTable.createdAt,
    })
    .from(inventoryTransactionsTable)
    .where(
      and(
        eq(inventoryTransactionsTable.companyId, companyId),
        eq(inventoryTransactionsTable.technicianId, technicianId),
        inArray(inventoryTransactionsTable.productId, productIds),
        inArray(inventoryTransactionsTable.movementType, ["truck_deduction", "truck_deduction_reversal"]),
        gte(inventoryTransactionsTable.createdAt, cutoff),
      ),
    );

  const reversedReferenceIds = new Set(
    rows.filter((r) => r.movementType === "truck_deduction_reversal" && r.referenceId != null).map((r) => r.referenceId),
  );

  return rows
    .filter((r) => r.movementType === "truck_deduction" && !(r.referenceId != null && reversedReferenceIds.has(r.referenceId)))
    .map((r) => ({ productId: r.productId, quantity: r.quantity, referenceId: r.referenceId, createdAt: r.createdAt }));
}

/**
 * Average daily consumption per product over a fixed `lookbackDays` window
 * (sum / lookbackDays — NOT sum / days-since-first-event, so a technician
 * with only one application 2 days ago doesn't look like they burn through
 * stock at an unsustainable daily rate). Products with no deductions in the
 * window are simply absent from the returned map — callers should treat a
 * missing entry as "insufficient data to project", never as zero consumption
 * (zero consumption would incorrectly imply infinite days of coverage).
 */
export function averageDailyConsumption(
  rows: TruckDeductionRow[],
  lookbackDays: number,
): Map<number, number> {
  const sums = new Map<number, number>();
  for (const r of rows) sums.set(r.productId, (sums.get(r.productId) ?? 0) + r.quantity);
  const result = new Map<number, number>();
  for (const [productId, sum] of sums) result.set(productId, sum / lookbackDays);
  return result;
}

/**
 * Average quantity used per application (one `truck_deduction` row = one
 * treatment-log application) — used to project "expected usage today" from
 * a stop count. Products with no applications in the window are absent from
 * the map (same "insufficient data" convention as averageDailyConsumption).
 */
export function averageUsagePerApplication(rows: TruckDeductionRow[]): Map<number, number> {
  const sums = new Map<number, { total: number; count: number }>();
  for (const r of rows) {
    const entry = sums.get(r.productId) ?? { total: 0, count: 0 };
    entry.total += r.quantity;
    entry.count += 1;
    sums.set(r.productId, entry);
  }
  const result = new Map<number, number>();
  for (const [productId, { total, count }] of sums) result.set(productId, total / count);
  return result;
}

// ─── Replenishment target resolution ───────────────────────────────────────

export type ReplenishmentTargetScope = "combined" | "technician" | "product" | "company" | "none";

export interface EffectiveReplenishmentTarget {
  /** Configured target days of on-hand supply, before the distance adjustment. Null = not configured at any scope. */
  daysOfSupply: number | null;
  /** Multiplier applied for a longer/farther route; only ever set on technician-scoped rows. */
  distanceAdjustmentFactor: number | null;
  /** `daysOfSupply * (distanceAdjustmentFactor ?? 1)`, or null when no target is configured. */
  effectiveDaysOfSupply: number | null;
  /** Which scope the resolved values came from ("none" when nothing matched). */
  scope: ReplenishmentTargetScope;
}

const NO_TARGET: EffectiveReplenishmentTarget = {
  daysOfSupply: null,
  distanceAdjustmentFactor: null,
  effectiveDaysOfSupply: null,
  scope: "none",
};

/**
 * Resolves the effective replenishment target for a (technicianId, productId)
 * pair from the four-scope `replenishment_targets` table using this
 * precedence, matching the sentinel convention documented on the schema:
 *   1. combined   — technicianId = tech AND productId = product
 *   2. technician — technicianId = tech AND productId = 0 (all products)
 *   3. product    — technicianId = "" (all technicians) AND productId = product
 *   4. company    — technicianId = "" AND productId = 0 (company default)
 *
 * `distanceAdjustmentFactor` is only ever populated on technician-scoped
 * rows, so it's read off whichever technician-scoped row applies (combined
 * or technician) even when `daysOfSupply` itself resolves from a less
 * specific scope.
 */
export function resolveReplenishmentTarget(
  rows: ReplenishmentTarget[],
  technicianId: string,
  productId: number,
): EffectiveReplenishmentTarget {
  const combined = rows.find((r) => r.technicianId === technicianId && r.productId === productId);
  const technicianScoped = rows.find((r) => r.technicianId === technicianId && r.productId === 0);
  const productScoped = rows.find((r) => r.technicianId === "" && r.productId === productId);
  const companyDefault = rows.find((r) => r.technicianId === "" && r.productId === 0);

  const match =
    (combined?.daysOfSupply != null && { row: combined, scope: "combined" as const }) ||
    (technicianScoped?.daysOfSupply != null && { row: technicianScoped, scope: "technician" as const }) ||
    (productScoped?.daysOfSupply != null && { row: productScoped, scope: "product" as const }) ||
    (companyDefault?.daysOfSupply != null && { row: companyDefault, scope: "company" as const }) ||
    null;

  if (!match) return NO_TARGET;

  const distanceAdjustmentFactor = combined?.distanceAdjustmentFactor ?? technicianScoped?.distanceAdjustmentFactor ?? null;
  const daysOfSupply = match.row.daysOfSupply as number;
  const effectiveDaysOfSupply = daysOfSupply * (distanceAdjustmentFactor ?? 1);

  return { daysOfSupply, distanceAdjustmentFactor, effectiveDaysOfSupply, scope: match.scope };
}

// ─── Truck Stock Health ─────────────────────────────────────────────────────

const STOCK_HEALTH_LOOKBACK_DAYS = 30;

export type StockHealthStatus = "trending-short" | "healthy" | "no-target-configured" | "insufficient-data";

export interface TruckStockHealthItem {
  productId: number;
  productName: string;
  unit: string;
  quantityOnHand: number;
  /** On-hand ÷ average daily consumption over the lookback window; null = no recent consumption to project from. */
  projectedDaysCoverage: number | null;
  /** The configured target window this projection is compared against; null = not configured at any scope. */
  targetDaysOfSupply: number | null;
  targetScope: ReplenishmentTargetScope;
  status: StockHealthStatus;
}

export interface TruckStockHealth {
  technicianId: string;
  lookbackDays: number;
  items: TruckStockHealthItem[];
}

/**
 * Computes Truck Stock Health for every product currently in a technician's
 * truck: a longer-range "days of coverage remaining" projection compared to
 * that product's configured replenishment target — independent of whether
 * TODAY specifically is affected (that's Today's Route Readiness, in
 * route-readiness.ts). A product with no target configured at any scope is
 * flagged "no-target-configured" rather than silently marked healthy, since
 * we have no basis to judge it either way.
 */
export async function computeTruckStockHealth(
  companyId: number,
  technicianId: string,
  lookbackDays: number = STOCK_HEALTH_LOOKBACK_DAYS,
): Promise<TruckStockHealth> {
  const invRows = await db
    .select({ inv: techInventoryTable, product: productsTable })
    .from(techInventoryTable)
    .innerJoin(productsTable, eq(productsTable.id, techInventoryTable.productId))
    .where(and(eq(techInventoryTable.companyId, companyId), eq(techInventoryTable.technicianId, technicianId)));

  if (invRows.length === 0) {
    return { technicianId, lookbackDays, items: [] };
  }

  const productIds = invRows.map((r) => r.inv.productId);

  const [deductionRows, targetRows] = await Promise.all([
    fetchRecentTruckDeductions(companyId, technicianId, productIds, lookbackDays),
    db.select().from(replenishmentTargetsTable).where(eq(replenishmentTargetsTable.companyId, companyId)),
  ]);

  const avgDailyMap = averageDailyConsumption(deductionRows, lookbackDays);

  const items: TruckStockHealthItem[] = invRows.map(({ inv, product }) => {
    const avgDaily = avgDailyMap.get(inv.productId) ?? null;
    const projectedDaysCoverage = avgDaily != null && avgDaily > 0 ? inv.quantityOnHand / avgDaily : null;
    const target = resolveReplenishmentTarget(targetRows, technicianId, inv.productId);

    let status: StockHealthStatus;
    if (projectedDaysCoverage == null) {
      status = "insufficient-data";
    } else if (target.effectiveDaysOfSupply == null) {
      status = "no-target-configured";
    } else {
      status = projectedDaysCoverage < target.effectiveDaysOfSupply ? "trending-short" : "healthy";
    }

    return {
      productId: inv.productId,
      productName: product.name,
      unit: inv.unit,
      quantityOnHand: inv.quantityOnHand,
      projectedDaysCoverage,
      targetDaysOfSupply: target.effectiveDaysOfSupply,
      targetScope: target.scope,
      status,
    };
  });

  return { technicianId, lookbackDays, items };
}
