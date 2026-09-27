/**
 * FAIE predictive restocking — pure forecast math unit tests (Task #918).
 *
 * Coverage:
 *  1. recencyWeightedDailyConsumption — recent activity outweighs older
 *     activity of the same total quantity (recency weighting actually bites).
 *  2. recencyWeightedDailyConsumption — normalizes by the FULL lookback
 *     window, not just active days, so one lone deduction doesn't inflate
 *     the rate to look like everyday consumption (sparse-history sanity).
 *  3. resolveLeadTimeDays — product override beats supplier beats company
 *     default beats none, in that precedence order.
 *  4. computePredictiveRestockForecast — insufficient-data / no-target /
 *     no-lead-time short-circuit statuses never fabricate a number.
 *  5. computePredictiveRestockForecast — upcoming scheduled demand can push
 *     the projected rate (and therefore recommendedByAt) higher than
 *     historical trend alone would.
 *  6. computePredictiveRestockForecast fires earlier than the reactive
 *     threshold alert would: reorderPointQuantity building in lead time
 *     means "predicted-shortfall" trips while on-hand stock is still above
 *     a same-value static restockThreshold.
 */

import { describe, expect, it } from "vitest";
import {
  recencyWeightedDailyConsumption,
  resolveLeadTimeDays,
  computePredictiveRestockForecast,
  TREND_LOOKBACK_DAYS,
  TREND_HALF_LIFE_DAYS,
} from "./predictive-restocking";
import type { TruckDeductionRow } from "./inventory-forecasting";
import type { ReplenishmentTarget, SupplierConnection } from "@workspace/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-23T12:00:00Z");

function deduction(productId: number, quantity: number, daysAgo: number): TruckDeductionRow {
  return { productId, quantity, referenceId: null, createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) };
}

function target(overrides: Partial<ReplenishmentTarget>): ReplenishmentTarget {
  return {
    id: 1,
    companyId: 1,
    technicianId: "",
    productId: 0,
    daysOfSupply: null,
    distanceAdjustmentFactor: null,
    leadTimeDays: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function supplier(overrides: Partial<SupplierConnection>): SupplierConnection {
  return {
    id: 1,
    companyId: 1,
    supplierName: "veseris",
    displayName: null,
    accountIdentifier: "acct-1",
    credentialsRef: null,
    status: "active",
    statusMessage: null,
    lastSyncedAt: null,
    leadTimeDays: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("recencyWeightedDailyConsumption", () => {
  it("1. weighs recent activity more heavily than older activity of the same quantity", () => {
    // Product 1: 10 units used 1 day ago. Product 2: 10 units used 40 days ago.
    const rows = [deduction(1, 10, 1), deduction(2, 10, 40)];
    const rates = recencyWeightedDailyConsumption(rows, TREND_LOOKBACK_DAYS, TREND_HALF_LIFE_DAYS, NOW);
    expect(rates.get(1)!).toBeGreaterThan(rates.get(2)!);
  });

  it("2. normalizes by the full lookback window, not just active days (sparse history stays modest)", () => {
    // A single 100-unit deduction today, in an otherwise-empty 45-day window.
    const rows = [deduction(1, 100, 0)];
    const rate = recencyWeightedDailyConsumption(rows, 45, 10, NOW).get(1)!;
    // If this were normalized only by the one active day, the rate would be
    // 100/day — an absurd sustained-consumption claim from a single event.
    // Normalizing by the whole window's weight keeps it far below that.
    expect(rate).toBeLessThan(20);
    expect(rate).toBeGreaterThan(0);
  });
});

describe("resolveLeadTimeDays", () => {
  it("3a. product override takes precedence over supplier and company default", () => {
    const rows = [
      target({ technicianId: "", productId: 0, leadTimeDays: 5 }), // company default
      target({ id: 2, technicianId: "", productId: 42, leadTimeDays: 2 }), // product override
    ];
    const result = resolveLeadTimeDays(rows, supplier({ leadTimeDays: 9 }), 42);
    expect(result).toEqual({ leadTimeDays: 2, scope: "product" });
  });

  it("3b. supplier override wins over company default when no product override exists", () => {
    const rows = [target({ technicianId: "", productId: 0, leadTimeDays: 5 })];
    const result = resolveLeadTimeDays(rows, supplier({ leadTimeDays: 9 }), 42);
    expect(result).toEqual({ leadTimeDays: 9, scope: "supplier" });
  });

  it("3c. falls back to company default when neither product nor supplier is set", () => {
    const rows = [target({ technicianId: "", productId: 0, leadTimeDays: 5 })];
    const result = resolveLeadTimeDays(rows, null, 42);
    expect(result).toEqual({ leadTimeDays: 5, scope: "company" });
  });

  it("3d. resolves to none when nothing is configured anywhere", () => {
    const result = resolveLeadTimeDays([], null, 42);
    expect(result).toEqual({ leadTimeDays: null, scope: "none" });
  });
});

describe("computePredictiveRestockForecast — explicit status, never a fabricated number", () => {
  it("4a. insufficient-data when there is no consumption history and no scheduled stops", () => {
    const forecast = computePredictiveRestockForecast({
      companyId: 1,
      technicianId: "tech-1",
      productId: 1,
      quantityOnHand: 10,
      unit: "fl oz",
      deductionRows: [],
      targetRows: [target({ technicianId: "", productId: 0, daysOfSupply: 7, leadTimeDays: 3 })],
      supplierConnection: null,
      scheduledStopCount: 0,
      now: NOW,
    });
    expect(forecast.status).toBe("insufficient-data");
    expect(forecast.reorderPointQuantity).toBeNull();
    expect(forecast.recommendedOrderQuantity).toBeNull();
  });

  it("4b. no-target-configured when consumption exists but no safety-stock days are set", () => {
    const forecast = computePredictiveRestockForecast({
      companyId: 1,
      technicianId: "tech-1",
      productId: 1,
      quantityOnHand: 10,
      unit: "fl oz",
      deductionRows: [deduction(1, 5, 1)],
      targetRows: [target({ technicianId: "", productId: 0, leadTimeDays: 3 })], // no daysOfSupply
      supplierConnection: null,
      scheduledStopCount: 0,
      now: NOW,
    });
    expect(forecast.status).toBe("no-target-configured");
    expect(forecast.reorderPointQuantity).toBeNull();
  });

  it("4c. no-lead-time-configured when a safety-stock target exists but no lead time anywhere", () => {
    const forecast = computePredictiveRestockForecast({
      companyId: 1,
      technicianId: "tech-1",
      productId: 1,
      quantityOnHand: 10,
      unit: "fl oz",
      deductionRows: [deduction(1, 5, 1)],
      targetRows: [target({ technicianId: "", productId: 0, daysOfSupply: 7 })], // no leadTimeDays
      supplierConnection: null,
      scheduledStopCount: 0,
      now: NOW,
    });
    expect(forecast.status).toBe("no-lead-time-configured");
    expect(forecast.reorderPointQuantity).toBeNull();
  });
});

describe("computePredictiveRestockForecast — upcoming schedule can raise the projected rate", () => {
  it("5. a busy upcoming week can push the rate above flat historical trend alone", () => {
    // Modest, steady historical trend: 1 unit/app, roughly 1 app in the window so far.
    const deductionRows = [deduction(1, 1, 5)];
    const targetRows = [target({ technicianId: "", productId: 0, daysOfSupply: 5, leadTimeDays: 5 })];

    const quiet = computePredictiveRestockForecast({
      companyId: 1, technicianId: "tech-1", productId: 1, quantityOnHand: 20, unit: "fl oz",
      deductionRows, targetRows, supplierConnection: null, scheduledStopCount: 0, now: NOW,
    });
    const busy = computePredictiveRestockForecast({
      companyId: 1, technicianId: "tech-1", productId: 1, quantityOnHand: 20, unit: "fl oz",
      deductionRows, targetRows, supplierConnection: null, scheduledStopCount: 20, now: NOW,
    });

    expect(busy.projectedDailyRate!).toBeGreaterThan(quiet.projectedDailyRate!);
  });
});

describe("computePredictiveRestockForecast — fires earlier than the reactive threshold alert", () => {
  it("6. flags predicted-shortfall while on-hand is still above a same-value static threshold", () => {
    // A perfectly steady 2 units/day across the ENTIRE lookback window — a
    // constant per-day quantity is weight-invariant, so the recency-weighted
    // rate resolves to exactly 2/day regardless of the half-life, giving an
    // unambiguous, hand-checkable expected rate for this test.
    const deductionRows = Array.from({ length: TREND_LOOKBACK_DAYS }, (_, d) => deduction(1, 2, d));
    // Safety-stock window of 5 days + a 4-day supplier lead time.
    const targetRows = [target({ technicianId: "", productId: 0, daysOfSupply: 5, leadTimeDays: 4 })];

    // The reactive alert's static threshold, if it were configured at the
    // same "5 days of supply at ~2/day" level, would be ~10 units — it only
    // fires once on-hand actually drops to/under that.
    const reactiveThreshold = 10;

    // On-hand stock still comfortably ABOVE the reactive threshold...
    const quantityOnHand = 15;

    const forecast = computePredictiveRestockForecast({
      companyId: 1,
      technicianId: "tech-1",
      productId: 1,
      quantityOnHand,
      unit: "fl oz",
      deductionRows,
      targetRows,
      supplierConnection: null,
      scheduledStopCount: 0,
      now: NOW,
    });

    // ...yet the predictive forecast already flags a shortfall, because its
    // reorder point bakes in the supplier lead time (4 days) on top of the
    // safety-stock window (5 days) = 9 days × ~2/day ≈ 18, which sits above
    // today's on-hand of 15 even though 15 > the reactive threshold of 10.
    expect(quantityOnHand).toBeGreaterThan(reactiveThreshold);
    expect(forecast.status).toBe("predicted-shortfall");
    expect(forecast.reorderPointQuantity).toBeGreaterThan(quantityOnHand);
    expect(forecast.recommendedByAt).not.toBeNull();
  });
});
