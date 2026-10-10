/**
 * FAIE predictive restocking & adaptive logistics (Task #918).
 *
 * A third, distinct proactive signal — alongside the reactive
 * `restockThreshold` alert (treatment-logs.ts) and the derive-on-read
 * Today's Route Readiness / Truck Stock Health views (route-readiness.ts,
 * inventory-forecasting.ts) — that projects FORWARD from a recency-weighted
 * consumption trend plus upcoming *scheduled* route demand, factoring in a
 * configurable supplier lead time, to fire a specific, dated recommendation
 * before a technician actually runs out.
 *
 * This is a statistically-adjusted rolling calculation, not a trained model:
 *   1. Recency-weighted daily consumption rate (exponential decay over a
 *      lookback window) from the `inventory_transactions` ledger — the same
 *      reversal-netted source every other forecast in this codebase uses.
 *   2. Upcoming scheduled-route demand: count of this technician's scheduled
 *      stops (same `inspections.scheduledDate` data the Integrated Route
 *      Calendar reads — see routes/schedule.ts) over the forecast horizon,
 *      multiplied by the historical average usage per application.
 *   3. The greater of the two daily rates is the "projected daily rate" —
 *      so a busier upcoming week can trigger a recommendation earlier than
 *      historical trend alone would, without a trained model.
 *   4. A reorder point (= projected rate × (lead time + safety-stock days))
 *      and recommended order quantity, using the resolved supplier lead
 *      time and the existing replenishment-target "days of supply" as the
 *      safety-stock window.
 *
 * Recommendations are persisted in `predictive_restock_recommendations`
 * (recomputed in place, not derive-on-read) so a manager's dismissal sticks
 * across page reloads — recomputation only happens event-triggered (after a
 * treatment-log deduction, for that one product) or via the periodic sweep
 * (predictive-restocking-scheduler.ts), never on a plain GET.
 */

import {
  db,
  inspectionsTable,
  techInventoryTable,
  replenishmentTargetsTable,
  supplierConnectionsTable,
  predictiveRestockRecommendationsTable,
  type ReplenishmentTarget,
  type SupplierConnection,
} from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  fetchRecentTruckDeductions,
  averageUsagePerApplication,
  resolveReplenishmentTarget,
  type TruckDeductionRow,
} from "./inventory-forecasting";
import { logger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lookback window for the recency-weighted consumption trend. */
export const TREND_LOOKBACK_DAYS = 45;

/** Weight halves every this many days — recent consumption dominates the rate. */
export const TREND_HALF_LIFE_DAYS = 10;

// ─── Recency-weighted consumption trend ────────────────────────────────────

/**
 * Recency-weighted daily consumption rate per product: each day in the
 * lookback window (0 = today) is weighted `0.5 ** (dayIndex / halfLifeDays)`,
 * and the rate is `Σ(quantity × weight) / Σ(weight over every day in the
 * window)` — NOT `/ Σ(weight of days with activity)`, so sparse or bursty
 * history still yields a realistic *daily* rate rather than inflating it to
 * only the active days. Products with zero deductions in the window are
 * simply absent — same "insufficient data, never zero" convention as
 * averageDailyConsumption in inventory-forecasting.ts.
 */
export function recencyWeightedDailyConsumption(
  rows: TruckDeductionRow[],
  lookbackDays: number = TREND_LOOKBACK_DAYS,
  halfLifeDays: number = TREND_HALF_LIFE_DAYS,
  now: Date = new Date(),
): Map<number, number> {
  let totalWeight = 0;
  for (let d = 0; d < lookbackDays; d++) totalWeight += Math.pow(0.5, d / halfLifeDays);

  const weightedSums = new Map<number, number>();
  for (const r of rows) {
    const dayIndex = Math.min(
      lookbackDays - 1,
      Math.max(0, Math.floor((now.getTime() - r.createdAt.getTime()) / DAY_MS)),
    );
    const weight = Math.pow(0.5, dayIndex / halfLifeDays);
    weightedSums.set(r.productId, (weightedSums.get(r.productId) ?? 0) + r.quantity * weight);
  }

  const result = new Map<number, number>();
  for (const [productId, weightedSum] of weightedSums) result.set(productId, weightedSum / totalWeight);
  return result;
}

// ─── Lead-time resolution ───────────────────────────────────────────────────

export type LeadTimeScope = "product" | "supplier" | "company" | "none";

export interface EffectiveLeadTime {
  leadTimeDays: number | null;
  scope: LeadTimeScope;
}

/**
 * Resolves the effective supplier replenishment lead time for a product,
 * precedence most → least specific:
 *   1. Per-product override (replenishment_targets: technicianId="", productId=X)
 *   2. Per-supplier override (the company's active supplier_connections row —
 *      same "most recently active" selection the approval flow already uses,
 *      since there is no per-product→supplier mapping in this schema)
 *   3. Company default (replenishment_targets: technicianId="", productId=0)
 */
export function resolveLeadTimeDays(
  targetRows: ReplenishmentTarget[],
  supplierConnection: SupplierConnection | null,
  productId: number,
): EffectiveLeadTime {
  const productOverride = targetRows.find((r) => r.technicianId === "" && r.productId === productId);
  if (productOverride?.leadTimeDays != null) {
    return { leadTimeDays: productOverride.leadTimeDays, scope: "product" };
  }

  if (supplierConnection?.leadTimeDays != null) {
    return { leadTimeDays: supplierConnection.leadTimeDays, scope: "supplier" };
  }

  const companyDefault = targetRows.find((r) => r.technicianId === "" && r.productId === 0);
  if (companyDefault?.leadTimeDays != null) {
    return { leadTimeDays: companyDefault.leadTimeDays, scope: "company" };
  }

  return { leadTimeDays: null, scope: "none" };
}

/** The company's supplier connection used for lead-time resolution and order placement — most recently updated active connection. */
export async function fetchActiveSupplierConnection(companyId: number): Promise<SupplierConnection | null> {
  const [connection] = await db
    .select()
    .from(supplierConnectionsTable)
    .where(and(eq(supplierConnectionsTable.companyId, companyId), eq(supplierConnectionsTable.status, "active")))
    .orderBy(desc(supplierConnectionsTable.updatedAt))
    .limit(1);
  return connection ?? null;
}

// ─── Upcoming scheduled-route demand ────────────────────────────────────────

/**
 * Counts this technician's scheduled stops in `[now, now + windowDays]` —
 * the same `inspections.scheduledDate` source the Integrated Route Calendar
 * reads (routes/schedule.ts). Unscheduled future work is invisible here by
 * design: a stop only counts toward demand once it has an actual scheduled
 * date, mirroring how Today's Route Readiness counts today's stops.
 */
export async function countUpcomingScheduledStops(
  companyId: number,
  technicianId: string,
  windowDays: number,
  now: Date = new Date(),
): Promise<number> {
  const windowEnd = new Date(now.getTime() + windowDays * DAY_MS);
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.technicianId, technicianId),
        sql`${inspectionsTable.scheduledDate} IS NOT NULL`,
        sql`${inspectionsTable.scheduledDate} >= ${now}`,
        sql`${inspectionsTable.scheduledDate} <= ${windowEnd}`,
      ),
    );
  return row?.value ?? 0;
}

// ─── Forecast ───────────────────────────────────────────────────────────────

export type PredictiveForecastStatus =
  | "predicted-shortfall"
  | "healthy"
  | "insufficient-data"
  | "no-target-configured"
  | "no-lead-time-configured";

export interface PredictiveRestockForecast {
  companyId: number;
  technicianId: string;
  productId: number;
  quantityOnHand: number;
  unit: string;
  /** max(recency-weighted historical rate, schedule-implied rate) — null when both are unknown. */
  projectedDailyRate: number | null;
  leadTimeDays: number | null;
  leadTimeScope: LeadTimeScope;
  safetyStockDays: number | null;
  safetyStockScope: ReturnType<typeof resolveReplenishmentTarget>["scope"];
  reorderPointQuantity: number | null;
  recommendedOrderQuantity: number | null;
  scheduledStopCount: number;
  /** Days until on-hand is projected to hit zero at the current rate; null when the rate is zero/unknown. */
  daysOfCoverageRemaining: number | null;
  projectedBreachAt: Date | null;
  recommendedByAt: Date | null;
  status: PredictiveForecastStatus;
}

/**
 * Computes the adaptive predictive-restock forecast for one
 * (technician, product) pair. Pure function over pre-fetched rows so callers
 * (single-product event trigger, bulk periodic sweep) can batch their own
 * queries efficiently — see recomputePredictiveRecommendations() below for
 * the DB-fetching wrapper used by both.
 */
export function computePredictiveRestockForecast(params: {
  companyId: number;
  technicianId: string;
  productId: number;
  quantityOnHand: number;
  unit: string;
  deductionRows: TruckDeductionRow[];
  targetRows: ReplenishmentTarget[];
  supplierConnection: SupplierConnection | null;
  scheduledStopCount: number;
  now?: Date;
}): PredictiveRestockForecast {
  const {
    companyId,
    technicianId,
    productId,
    quantityOnHand,
    unit,
    deductionRows,
    targetRows,
    supplierConnection,
    scheduledStopCount,
    now = new Date(),
  } = params;

  const target = resolveReplenishmentTarget(targetRows, technicianId, productId);
  const leadTime = resolveLeadTimeDays(targetRows, supplierConnection, productId);

  const horizonDays = (leadTime.leadTimeDays ?? 0) + (target.effectiveDaysOfSupply ?? 0) || 30;

  const historicalRateMap = recencyWeightedDailyConsumption(deductionRows, TREND_LOOKBACK_DAYS, TREND_HALF_LIFE_DAYS, now);
  const avgPerAppMap = averageUsagePerApplication(deductionRows);

  const historicalRate = historicalRateMap.get(productId) ?? null;
  const avgPerApp = avgPerAppMap.get(productId) ?? null;
  const scheduleImpliedRate =
    avgPerApp != null && scheduledStopCount > 0 ? (avgPerApp * scheduledStopCount) / horizonDays : null;

  const projectedDailyRate =
    historicalRate == null && scheduleImpliedRate == null
      ? null
      : Math.max(historicalRate ?? 0, scheduleImpliedRate ?? 0);

  let status: PredictiveForecastStatus;
  let reorderPointQuantity: number | null = null;
  let recommendedOrderQuantity: number | null = null;
  let daysOfCoverageRemaining: number | null = null;
  let projectedBreachAt: Date | null = null;
  let recommendedByAt: Date | null = null;

  if (projectedDailyRate == null) {
    status = "insufficient-data";
  } else if (target.effectiveDaysOfSupply == null) {
    status = "no-target-configured";
  } else if (leadTime.leadTimeDays == null) {
    status = "no-lead-time-configured";
  } else {
    reorderPointQuantity = projectedDailyRate * (leadTime.leadTimeDays + target.effectiveDaysOfSupply);
    recommendedOrderQuantity = Math.max(0, reorderPointQuantity - quantityOnHand);

    if (projectedDailyRate > 0) {
      daysOfCoverageRemaining = quantityOnHand / projectedDailyRate;
      projectedBreachAt = new Date(now.getTime() + daysOfCoverageRemaining * DAY_MS);

      const daysUntilReorderPoint = (quantityOnHand - reorderPointQuantity) / projectedDailyRate;
      recommendedByAt = new Date(now.getTime() + Math.max(0, daysUntilReorderPoint) * DAY_MS);
    }

    status = quantityOnHand < reorderPointQuantity ? "predicted-shortfall" : "healthy";
  }

  return {
    companyId,
    technicianId,
    productId,
    quantityOnHand,
    unit,
    projectedDailyRate,
    leadTimeDays: leadTime.leadTimeDays,
    leadTimeScope: leadTime.scope,
    safetyStockDays: target.effectiveDaysOfSupply,
    safetyStockScope: target.scope,
    reorderPointQuantity,
    recommendedOrderQuantity,
    scheduledStopCount,
    daysOfCoverageRemaining,
    projectedBreachAt,
    recommendedByAt,
    status,
  };
}

// ─── Persisted recommendation recompute ────────────────────────────────────

/**
 * Recomputes predictive-restock recommendations for every product currently
 * in a technician's truck and upserts/clears `predictive_restock_recommendations`
 * accordingly:
 *  - "predicted-shortfall" → upsert with status='pending' (reopens a
 *    'dismissed' row — this call represents genuinely new information,
 *    either a real deduction or a periodic sweep, matching the reactive
 *    alert's own unconditional-reopen convention). A 'converted' row is left
 *    untouched — it already fed the manager-approval pipeline.
 *  - anything else (healthy / insufficient-data / no config) → deletes an
 *    existing 'pending' row for that product (stale, no longer relevant).
 *    'dismissed'/'converted' rows are never touched here.
 *
 * Returns the number of pairs evaluated, for logging by callers.
 */
export async function recomputePredictiveRecommendationsForTechnician(
  companyId: number,
  technicianId: string,
  now: Date = new Date(),
): Promise<{ evaluated: number; flagged: number }> {
  const invRows = await db
    .select()
    .from(techInventoryTable)
    .where(and(eq(techInventoryTable.companyId, companyId), eq(techInventoryTable.technicianId, technicianId)));

  if (invRows.length === 0) return { evaluated: 0, flagged: 0 };

  const productIds = invRows.map((r) => r.productId);

  // Horizon (and therefore the scheduled-stop count) depends on each
  // product's own resolved lead time + safety-stock days, so it is computed
  // per-product inside the loop below rather than once up front.
  const [deductionRows, targetRows, supplierConnection] = await Promise.all([
    fetchRecentTruckDeductions(companyId, technicianId, productIds, TREND_LOOKBACK_DAYS),
    db.select().from(replenishmentTargetsTable).where(eq(replenishmentTargetsTable.companyId, companyId)),
    fetchActiveSupplierConnection(companyId),
  ]);

  let flagged = 0;

  for (const inv of invRows) {
    const target = resolveReplenishmentTarget(targetRows, technicianId, inv.productId);
    const leadTime = resolveLeadTimeDays(targetRows, supplierConnection, inv.productId);
    const horizonDays = (leadTime.leadTimeDays ?? 0) + (target.effectiveDaysOfSupply ?? 0) || 30;
    const scheduledStopCount = await countUpcomingScheduledStops(companyId, technicianId, horizonDays, now);

    const forecast = computePredictiveRestockForecast({
      companyId,
      technicianId,
      productId: inv.productId,
      quantityOnHand: inv.quantityOnHand,
      unit: inv.unit,
      deductionRows,
      targetRows,
      supplierConnection,
      scheduledStopCount,
      now,
    });

    if (forecast.status === "predicted-shortfall") {
      flagged++;
      await db
        .insert(predictiveRestockRecommendationsTable)
        .values({
          companyId,
          technicianId,
          productId: inv.productId,
          quantityOnHand: forecast.quantityOnHand,
          unit: forecast.unit,
          projectedDailyRate: forecast.projectedDailyRate as number,
          leadTimeDays: forecast.leadTimeDays as number,
          safetyStockDays: forecast.safetyStockDays as number,
          reorderPointQuantity: forecast.reorderPointQuantity as number,
          recommendedOrderQuantity: forecast.recommendedOrderQuantity as number,
          scheduledStopCount: forecast.scheduledStopCount,
          projectedBreachAt: forecast.projectedBreachAt,
          recommendedByAt: forecast.recommendedByAt as Date,
          status: "pending",
          resolvedAt: null,
        })
        .onConflictDoUpdate({
          target: [
            predictiveRestockRecommendationsTable.companyId,
            predictiveRestockRecommendationsTable.technicianId,
            predictiveRestockRecommendationsTable.productId,
          ],
          set: {
            quantityOnHand: forecast.quantityOnHand,
            unit: forecast.unit,
            projectedDailyRate: forecast.projectedDailyRate as number,
            leadTimeDays: forecast.leadTimeDays as number,
            safetyStockDays: forecast.safetyStockDays as number,
            reorderPointQuantity: forecast.reorderPointQuantity as number,
            recommendedOrderQuantity: forecast.recommendedOrderQuantity as number,
            scheduledStopCount: forecast.scheduledStopCount,
            projectedBreachAt: forecast.projectedBreachAt,
            recommendedByAt: forecast.recommendedByAt as Date,
            // Only reopen from 'dismissed'; a 'converted' row already fed the
            // manager-approval pipeline and must not be silently reopened by
            // a background recompute — the SQL below is a targeted CASE, not
            // a blind overwrite of status.
            status: sql`CASE WHEN ${predictiveRestockRecommendationsTable.status} = 'converted' THEN ${predictiveRestockRecommendationsTable.status} ELSE 'pending' END`,
            resolvedAt: sql`CASE WHEN ${predictiveRestockRecommendationsTable.status} = 'converted' THEN ${predictiveRestockRecommendationsTable.resolvedAt} ELSE NULL END`,
            updatedAt: now,
          },
        });
    } else {
      // No longer a predicted shortfall — clear a stale 'pending' recommendation.
      // 'dismissed'/'converted' rows are historical and untouched.
      await db
        .delete(predictiveRestockRecommendationsTable)
        .where(
          and(
            eq(predictiveRestockRecommendationsTable.companyId, companyId),
            eq(predictiveRestockRecommendationsTable.technicianId, technicianId),
            eq(predictiveRestockRecommendationsTable.productId, inv.productId),
            eq(predictiveRestockRecommendationsTable.status, "pending"),
          ),
        );
    }
  }

  return { evaluated: invRows.length, flagged };
}

/**
 * Recomputes predictive-restock recommendations for a single
 * (technician, product) pair — the cheap path called right after a
 * treatment-log deduction, so the forecast reflects consumption the moment
 * it happens rather than waiting for the next periodic sweep.
 */
export async function recomputePredictiveRecommendationForProduct(
  companyId: number,
  technicianId: string,
  productId: number,
  now: Date = new Date(),
): Promise<void> {
  const [inv] = await db
    .select()
    .from(techInventoryTable)
    .where(
      and(
        eq(techInventoryTable.companyId, companyId),
        eq(techInventoryTable.technicianId, technicianId),
        eq(techInventoryTable.productId, productId),
      ),
    );
  if (!inv) return;

  const [deductionRows, targetRows, supplierConnection] = await Promise.all([
    fetchRecentTruckDeductions(companyId, technicianId, [productId], TREND_LOOKBACK_DAYS),
    db.select().from(replenishmentTargetsTable).where(eq(replenishmentTargetsTable.companyId, companyId)),
    fetchActiveSupplierConnection(companyId),
  ]);

  const target = resolveReplenishmentTarget(targetRows, technicianId, productId);
  const leadTime = resolveLeadTimeDays(targetRows, supplierConnection, productId);
  const horizonDays = (leadTime.leadTimeDays ?? 0) + (target.effectiveDaysOfSupply ?? 0) || 30;
  const scheduledStopCount = await countUpcomingScheduledStops(companyId, technicianId, horizonDays, now);

  const forecast = computePredictiveRestockForecast({
    companyId,
    technicianId,
    productId,
    quantityOnHand: inv.quantityOnHand,
    unit: inv.unit,
    deductionRows,
    targetRows,
    supplierConnection,
    scheduledStopCount,
    now,
  });

  if (forecast.status === "predicted-shortfall") {
    await db
      .insert(predictiveRestockRecommendationsTable)
      .values({
        companyId,
        technicianId,
        productId,
        quantityOnHand: forecast.quantityOnHand,
        unit: forecast.unit,
        projectedDailyRate: forecast.projectedDailyRate as number,
        leadTimeDays: forecast.leadTimeDays as number,
        safetyStockDays: forecast.safetyStockDays as number,
        reorderPointQuantity: forecast.reorderPointQuantity as number,
        recommendedOrderQuantity: forecast.recommendedOrderQuantity as number,
        scheduledStopCount: forecast.scheduledStopCount,
        projectedBreachAt: forecast.projectedBreachAt,
        recommendedByAt: forecast.recommendedByAt as Date,
        status: "pending",
        resolvedAt: null,
      })
      .onConflictDoUpdate({
        target: [
          predictiveRestockRecommendationsTable.companyId,
          predictiveRestockRecommendationsTable.technicianId,
          predictiveRestockRecommendationsTable.productId,
        ],
        set: {
          quantityOnHand: forecast.quantityOnHand,
          unit: forecast.unit,
          projectedDailyRate: forecast.projectedDailyRate as number,
          leadTimeDays: forecast.leadTimeDays as number,
          safetyStockDays: forecast.safetyStockDays as number,
          reorderPointQuantity: forecast.reorderPointQuantity as number,
          recommendedOrderQuantity: forecast.recommendedOrderQuantity as number,
          scheduledStopCount: forecast.scheduledStopCount,
          projectedBreachAt: forecast.projectedBreachAt,
          recommendedByAt: forecast.recommendedByAt as Date,
          status: sql`CASE WHEN ${predictiveRestockRecommendationsTable.status} = 'converted' THEN ${predictiveRestockRecommendationsTable.status} ELSE 'pending' END`,
          resolvedAt: sql`CASE WHEN ${predictiveRestockRecommendationsTable.status} = 'converted' THEN ${predictiveRestockRecommendationsTable.resolvedAt} ELSE NULL END`,
          updatedAt: now,
        },
      });
  } else {
    await db
      .delete(predictiveRestockRecommendationsTable)
      .where(
        and(
          eq(predictiveRestockRecommendationsTable.companyId, companyId),
          eq(predictiveRestockRecommendationsTable.technicianId, technicianId),
          eq(predictiveRestockRecommendationsTable.productId, productId),
          eq(predictiveRestockRecommendationsTable.status, "pending"),
        ),
      );
  }
}

/** Iterates every technician with truck inventory in a company — used by the periodic sweep. */
export async function recomputeAllPredictiveRecommendationsForCompany(
  companyId: number,
): Promise<{ technicianCount: number; evaluated: number; flagged: number }> {
  const technicians = await db
    .selectDistinct({ technicianId: techInventoryTable.technicianId })
    .from(techInventoryTable)
    .where(eq(techInventoryTable.companyId, companyId));

  let evaluated = 0;
  let flagged = 0;

  for (const { technicianId } of technicians) {
    try {
      const result = await recomputePredictiveRecommendationsForTechnician(companyId, technicianId);
      evaluated += result.evaluated;
      flagged += result.flagged;
    } catch (err) {
      logger.error({ err, companyId, technicianId }, "[predictive-restocking] recompute failed for technician");
    }
  }

  return { technicianCount: technicians.length, evaluated, flagged };
}
