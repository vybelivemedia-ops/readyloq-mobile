/**
 * Dual-Level Route Readiness — integration tests against the isolated test
 * database.
 *
 * Coverage:
 *  1. computeRouteReadiness returns "not-set-up" when no daily rig exists.
 *  2. computeRouteReadiness returns "ready" when a rig has zero assignments.
 *  3. computeRouteReadiness flags a product "short" when on-hand quantity is
 *     less than (avg usage per stop * stop count), using truck_deduction
 *     ledger history — and reversed deductions are excluded from that average.
 *  4. computeRouteReadiness reports "insufficient-data" for a product with no
 *     usage history, rather than fabricating a false "ready"/"short" verdict.
 *  5. computeTruckStockHealth flags "trending-short" when projected days of
 *     coverage (on-hand / avg daily consumption) is below the configured
 *     replenishment target, "healthy" when above it.
 *  6. computeTruckStockHealth reports "no-target-configured" when no
 *     replenishment target exists at any scope, and "insufficient-data" when
 *     there's no consumption history to project from.
 *  7. Company isolation: a technician's readiness/health never reflects
 *     another company's inspections, rig, inventory, or ledger rows.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  companiesTable,
  productsTable,
  inspectionsTable,
  technicianDailyRigsTable,
  techInventoryTable,
  inventoryTransactionsTable,
  replenishmentTargetsTable,
  treatmentLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeRouteReadiness } from "./route-readiness";
import { computeTruckStockHealth } from "./inventory-forecasting";
import { withLedgerMutationBypass } from "../test/ledger-bypass";

const SLUG_A = "rr-test-co-a";
const SLUG_B = "rr-test-co-b";
const TECH_A = "rr_test_tech_a";
const TECH_B = "rr_test_tech_b";
const ACTOR = "rr_test_actor";

let companyAId: number;
let companyBId: number;
let productId: number; // fl-oz product, plenty of usage history
let quietProductId: number; // no usage history at all

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row!.id;
}

async function createProduct(name: string): Promise<number> {
  const [row] = await db
    .insert(productsTable)
    .values({
      name,
      productType: "general-use",
      activeIngredients: "Test Ingredient 1%",
    })
    .returning();
  return row!.id;
}

/** Inserts a treatment log AND its corresponding truck_deduction ledger row,
 *  mirroring what treatment-logs.ts does on create. */
async function logDeduction(opts: {
  companyId: number;
  technicianId: string;
  productId: number;
  quantity: number;
  daysAgo: number;
}) {
  const createdAt = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
  const [inspection] = await db
    .insert(inspectionsTable)
    .values({
      companyId: opts.companyId,
      siteAddress: `${opts.daysAgo} Ledger Test Ave`,
      technicianName: opts.technicianId,
      technicianId: opts.technicianId,
      status: "completed",
      createdAt,
    })
    .returning();

  const [log] = await db
    .insert(treatmentLogsTable)
    .values({
      companyId: opts.companyId,
      inspectionId: inspection!.id,
      productId: opts.productId,
      targetPest: "rodent",
      siteClassification: "residential",
      totalProductOz: opts.quantity,
      createdAt,
    })
    .returning();

  await db.insert(inventoryTransactionsTable).values({
    companyId: opts.companyId,
    productId: opts.productId,
    quantity: opts.quantity,
    unit: "fl oz",
    movementType: "truck_deduction",
    source: `truck:${opts.technicianId}`,
    destination: `property:${inspection!.id}`,
    technicianId: opts.technicianId,
    actingUserId: opts.technicianId,
    referenceId: log!.id,
    createdAt,
  });

  return { inspectionId: inspection!.id, logId: log!.id };
}

async function reverseDeduction(companyId: number, technicianId: string, productId: number, logId: number, quantity: number) {
  await db.insert(inventoryTransactionsTable).values({
    companyId,
    productId,
    quantity,
    unit: "fl oz",
    movementType: "truck_deduction_reversal",
    source: `property:reversal`,
    destination: `truck:${technicianId}`,
    technicianId,
    actingUserId: ACTOR,
    referenceId: logId,
  });
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("RR Test Co A", SLUG_A);
  companyBId = await findOrCreateCompany("RR Test Co B", SLUG_B);
  productId = await createProduct("RR Test Rodenticide");
  quietProductId = await createProduct("RR Test Quiet Product");

  await db.insert(techInventoryTable).values([
    { companyId: companyAId, technicianId: TECH_A, productId, quantityOnHand: 10, unit: "fl oz" },
    { companyId: companyAId, technicianId: TECH_A, productId: quietProductId, quantityOnHand: 5, unit: "fl oz" },
  ]);
});

afterAll(async () => {
  // The ledger is DB-enforced append-only (see migrate-ledger-immutability.ts);
  // its rows can only be cleared via the sanctioned test-only bypass.
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyAId)),
  );
  await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.companyId, companyAId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyAId));
  await db.delete(technicianDailyRigsTable).where(eq(technicianDailyRigsTable.companyId, companyAId));
  await db.delete(replenishmentTargetsTable).where(eq(replenishmentTargetsTable.companyId, companyAId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyAId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(productsTable).where(eq(productsTable.id, quietProductId));
});

describe("computeRouteReadiness", () => {
  it("returns not-set-up when the technician has no daily rig for the date", async () => {
    const result = await computeRouteReadiness(companyAId, TECH_A, "2026-01-01", 0);
    expect(result.rigSetUp).toBe(false);
    expect(result.overallStatus).toBe("not-set-up");
    expect(result.products).toHaveLength(0);
  });

  it("returns ready when the rig exists but declares zero assignments", async () => {
    await db.insert(technicianDailyRigsTable).values({
      companyId: companyAId,
      technicianId: TECH_A,
      rigDate: "2026-01-02",
      assignments: [],
    });
    const result = await computeRouteReadiness(companyAId, TECH_A, "2026-01-02", 0);
    expect(result.rigSetUp).toBe(true);
    expect(result.overallStatus).toBe("ready");
    expect(result.products).toHaveLength(0);
  });

  it("flags a product short when on-hand can't cover today's expected usage, and excludes reversed deductions from the average", async () => {
    // Seed usage history: three applications of 4 fl oz each (avg 4/stop),
    // plus a fourth of 4 fl oz that gets reversed and must NOT count.
    await logDeduction({ companyId: companyAId, technicianId: TECH_A, productId, quantity: 4, daysAgo: 1 });
    await logDeduction({ companyId: companyAId, technicianId: TECH_A, productId, quantity: 4, daysAgo: 2 });
    await logDeduction({ companyId: companyAId, technicianId: TECH_A, productId, quantity: 4, daysAgo: 3 });
    const { logId } = await logDeduction({ companyId: companyAId, technicianId: TECH_A, productId, quantity: 40, daysAgo: 4 });
    await reverseDeduction(companyAId, TECH_A, productId, logId, 40);

    // Two stops scheduled today.
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(inspectionsTable).values([
      { companyId: companyAId, siteAddress: "1 Route Test St", technicianName: TECH_A, technicianId: TECH_A, status: "pending" },
      { companyId: companyAId, siteAddress: "2 Route Test St", technicianName: TECH_A, technicianId: TECH_A, status: "pending" },
    ]);

    await db.insert(technicianDailyRigsTable).values({
      companyId: companyAId,
      technicianId: TECH_A,
      rigDate: today,
      assignments: [{ productId, targetPest: "rodent" }, { productId: quietProductId, targetPest: "rodent" }],
    });

    const result = await computeRouteReadiness(companyAId, TECH_A, today, 0);
    expect(result.rigSetUp).toBe(true);
    expect(result.stopCount).toBe(2);

    const main = result.products.find((p) => p.productId === productId)!;
    // avg usage per stop should be 4 (reversed 40oz excluded), expected today = 4*2 = 8, on-hand = 10 -> ready
    expect(main.avgUsagePerStop).toBeCloseTo(4, 5);
    expect(main.expectedUsageToday).toBeCloseTo(8, 5);
    expect(main.status).toBe("ready");

    const quiet = result.products.find((p) => p.productId === quietProductId)!;
    expect(quiet.avgUsagePerStop).toBeNull();
    expect(quiet.status).toBe("insufficient-data");
    expect(result.overallStatus).toBe("ready");
  });

  it("marks overall status short when a product's on-hand can't cover expected usage", async () => {
    const date = "2026-01-05";
    // 5 stops today, avg usage 4/stop => expected 20, on-hand only 10 -> short
    for (let i = 0; i < 5; i++) {
      await db.insert(inspectionsTable).values({
        companyId: companyAId,
        siteAddress: `Short Test ${i}`,
        technicianName: TECH_A,
        technicianId: TECH_A,
        status: "pending",
        scheduledDate: new Date(`${date}T12:00:00Z`),
      });
    }
    await db.insert(technicianDailyRigsTable).values({
      companyId: companyAId,
      technicianId: TECH_A,
      rigDate: date,
      assignments: [{ productId, targetPest: "rodent" }],
    });

    const result = await computeRouteReadiness(companyAId, TECH_A, date, 0);
    expect(result.stopCount).toBe(5);
    const main = result.products.find((p) => p.productId === productId)!;
    expect(main.status).toBe("short");
    expect(result.overallStatus).toBe("short");
  });

  it("never reflects another company's inspections, rig, or inventory", async () => {
    const result = await computeRouteReadiness(companyBId, TECH_B, "2026-01-05", 0);
    expect(result.rigSetUp).toBe(false);
    expect(result.stopCount).toBe(0);
  });
});

describe("computeTruckStockHealth", () => {
  it("reports no-target-configured when there's consumption history but no replenishment target at any scope", async () => {
    const health = await computeTruckStockHealth(companyAId, TECH_A, 30);
    const main = health.items.find((i) => i.productId === productId)!;
    expect(main.projectedDaysCoverage).not.toBeNull();
    expect(main.status).toBe("no-target-configured");

    const quiet = health.items.find((i) => i.productId === quietProductId)!;
    expect(quiet.projectedDaysCoverage).toBeNull();
    expect(quiet.status).toBe("insufficient-data");
  });

  it("flags trending-short when projected coverage is below the configured target, healthy when above it", async () => {
    // Total logged so far for `productId`: 3 x 4oz = 12oz over a 30-day lookback
    // => avg daily consumption = 12/30 = 0.4/day. On-hand = 10 => ~25 days coverage.
    await db.insert(replenishmentTargetsTable).values({
      companyId: companyAId,
      technicianId: "",
      productId: 0,
      daysOfSupply: 40, // above ~25 projected days -> trending-short
    });

    let health = await computeTruckStockHealth(companyAId, TECH_A, 30);
    let main = health.items.find((i) => i.productId === productId)!;
    expect(main.targetDaysOfSupply).toBe(40);
    expect(main.status).toBe("trending-short");

    await db
      .update(replenishmentTargetsTable)
      .set({ daysOfSupply: 10 }) // below ~25 projected days -> healthy
      .where(eq(replenishmentTargetsTable.companyId, companyAId));

    health = await computeTruckStockHealth(companyAId, TECH_A, 30);
    main = health.items.find((i) => i.productId === productId)!;
    expect(main.status).toBe("healthy");
  });

  it("never reflects another company's inventory or targets", async () => {
    const health = await computeTruckStockHealth(companyBId, TECH_B, 30);
    expect(health.items).toHaveLength(0);
  });
});
