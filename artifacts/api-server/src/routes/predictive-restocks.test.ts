/**
 * Predictive restock recommendation integration tests — Task #918.
 *
 * Coverage:
 *  1. A treatment-log deduction that leaves on-hand below the adaptive
 *     reorder point (which bakes in lead time + safety stock) fires a
 *     predictive recommendation — even while stock is still above what a
 *     same-value reactive threshold would require ("fires earlier" proof).
 *  2. GET /manager/predictive-restocks returns the recommendation joined
 *     with product name.
 *  3. PATCH .../:id → "dismissed" removes it from the pending list.
 *  4. A dismissed-then-still-short recommendation reopens on the next
 *     recompute (mirrors the reactive alert's reopen behavior).
 *  5. POST .../:id/convert-to-alert creates a pending_restock_requests row
 *     and marks the recommendation "converted" (never places a supplier
 *     order directly).
 *  6. A "converted" recommendation is never silently reopened by a later
 *     recompute.
 *  7. GET never returns another company's recommendation rows (scoping).
 *  8. With no replenishment target/lead-time configured at all, a deduction
 *     produces no predictive recommendation (explicit no-config status,
 *     never a fabricated one).
 *  9. convert-to-alert never resurrects an already-'approved' pending_restock_
 *     requests row back to 'pending' — doing so would let a second, unrelated
 *     approval click re-trigger supplier order placement for the same
 *     real-world order. The approved row (and its snapshot fields) must be
 *     left untouched; the recommendation still links to it as "converted".
 */

import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Auth mock (must be hoisted above all imports that touch the server) ────────

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// ── App + DB imports ──────────────────────────────────────────────────────────

import app from "../app";
import {
  db,
  companiesTable,
  usersTable,
  productsTable,
  productLabelRulesTable,
  inspectionsTable,
  techInventoryTable,
  replenishmentTargetsTable,
  predictiveRestockRecommendationsTable,
  pendingRestockRequestsTable,
  inventoryTransactionsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { withLedgerMutationBypass } from "../test/ledger-bypass";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG         = "predictive-restock-test-co";
const OTHER_SLUG   = "predictive-restock-other-co";
const TECH_ID      = "predictive_test_tech_001";
const MGR_ID       = "predictive_test_mgr_001";
const OTHER_MGR_ID = "predictive_test_other_mgr_001";

let companyId:      number;
let otherCompanyId: number;
let productId:      number;
let inspectionId:   number;

// ── Auth helpers ──────────────────────────────────────────────────────────────

function asTech()     { authState.userId = TECH_ID; }
function asMgr()      { authState.userId = MGR_ID; }
function asOtherMgr() { authState.userId = OTHER_MGR_ID; }

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findOrCreateCompany(name: string, slug: string) {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

async function clearPredictiveState() {
  await db.execute(
    sql`DELETE FROM predictive_restock_recommendations WHERE company_id IN (${companyId}, ${otherCompanyId})`,
  );
  await db.execute(sql`DELETE FROM pending_restock_requests WHERE company_id IN (${companyId}, ${otherCompanyId})`);
}

/** Seed (or reset) the tech's inventory row with a specific quantity, no static restockThreshold. */
async function seedInventory(quantityOnHand: number) {
  await db
    .insert(techInventoryTable)
    .values({ companyId, technicianId: TECH_ID, productId, quantityOnHand, unit: "fl oz", restockThreshold: null })
    .onConflictDoUpdate({
      target: [techInventoryTable.companyId, techInventoryTable.technicianId, techInventoryTable.productId],
      set: { quantityOnHand, unit: "fl oz", restockThreshold: null, updatedAt: new Date() },
    });
}

/** Company-default safety-stock (days of supply) + lead time, used by every test below. */
async function seedCompanyTarget(daysOfSupply: number, leadTimeDays: number) {
  await db
    .insert(replenishmentTargetsTable)
    .values({ companyId, technicianId: "", productId: 0, daysOfSupply, leadTimeDays })
    .onConflictDoUpdate({
      target: [replenishmentTargetsTable.companyId, replenishmentTargetsTable.technicianId, replenishmentTargetsTable.productId],
      set: { daysOfSupply, leadTimeDays, updatedAt: new Date() },
    });
}

async function clearCompanyTarget() {
  await db
    .delete(replenishmentTargetsTable)
    .where(
      and(
        eq(replenishmentTargetsTable.companyId, companyId),
        eq(replenishmentTargetsTable.technicianId, ""),
        eq(replenishmentTargetsTable.productId, 0),
      ),
    );
}

/**
 * Seeds `count` historical `truck_deduction` ledger rows of `quantityEach`,
 * all timestamped "now" (dayIndex 0), so the recency-weighted rate resolves
 * to a precise, hand-checkable number: with a 10-day half-life and 45-day
 * lookback, `Σweight ≈ 14.273`, so `rate = (count × quantityEach) / 14.273`.
 * Seeded directly against the ledger (bypassing treatment-log posts) so the
 * trend history is exact and the test stays fast; the event-triggered
 * recompute itself is still exercised via a real POST in each test below.
 */
async function seedHistoricalDeductions(quantityEach: number, count: number) {
  const rows = Array.from({ length: count }, () => ({
    companyId,
    productId,
    quantity: quantityEach,
    unit: "fl oz",
    movementType: "truck_deduction" as const,
    source: `truck:${TECH_ID}`,
    destination: `property:${inspectionId}`,
    technicianId: TECH_ID,
    actingUserId: TECH_ID,
    referenceId: null,
  }));
  await db.insert(inventoryTransactionsTable).values(rows);
}

/** POST a treatment log as the technician (fires the event-triggered recompute). */
function postLog(oz: number) {
  asTech();
  return request(app)
    .post(`/api/inspections/${inspectionId}/treatment-logs`)
    .set("Content-Type", "application/json")
    .send({
      productId,
      targetPest: "ants",
      siteClassification: "residential_interior",
      environmentalWarningAcknowledged: false,
      totalProductOz: oz,
    });
}

/** The recompute is fire-and-forget after the request resolves; give it a beat to land. */
function waitForRecompute() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

async function getRecommendationRow() {
  const [row] = await db
    .select()
    .from(predictiveRestockRecommendationsTable)
    .where(
      and(
        eq(predictiveRestockRecommendationsTable.companyId, companyId),
        eq(predictiveRestockRecommendationsTable.technicianId, TECH_ID),
        eq(predictiveRestockRecommendationsTable.productId, productId),
      ),
    );
  return row ?? null;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId      = await findOrCreateCompany("Predictive Restock Test Co", SLUG);
  otherCompanyId = await findOrCreateCompany("Predictive Restock Other Co", OTHER_SLUG);

  await clearPredictiveState();
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(replenishmentTargetsTable).where(eq(replenishmentTargetsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));

  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID,      role: "technician", companyId },
    { clerkUserId: MGR_ID,       role: "manager",    companyId },
    { clerkUserId: OTHER_MGR_ID, role: "manager",    companyId: otherCompanyId },
  ]);

  const [prod] = await db
    .insert(productsTable)
    .values({ name: "Predictive Test Product", epaRegistrationNumber: "PRD-TST-001", productType: "general-use", activeIngredients: "Test 1%", isActive: true })
    .returning();
  productId = prod.id;

  await db.insert(productLabelRulesTable).values({
    productId,
    approvedPestTypes: [], approvedSiteClassifications: [], requiredEquipmentTypes: [], mixingSteps: [],
    maxRateOzPer1000Sqft: null, maxRateOzPerGallon: null, nozzleSpec: null,
    pressurePsi: null, dropletSize: null, maxTempF: null, phytotoxicityNotes: null, reEntryIntervalHours: null,
  });

  const [insp] = await db
    .insert(inspectionsTable)
    .values({ companyId, technicianId: TECH_ID, technicianName: "Predictive Tester", siteAddress: "1 Predictive Ave", status: "pending" })
    .returning();
  inspectionId = insp.id;
});

afterAll(async () => {
  await clearPredictiveState();
  await db.execute(sql`DELETE FROM treatment_logs WHERE company_id = ${companyId}`);
  // The ledger is DB-enforced append-only (see migrate-ledger-immutability.ts);
  // its rows can only be cleared via the sanctioned test-only bypass.
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyId)),
  );
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(replenishmentTargetsTable).where(eq(replenishmentTargetsTable.companyId, companyId));
  await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, productId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));
  await db.delete(companiesTable).where(eq(companiesTable.slug, SLUG));
  await db.delete(companiesTable).where(eq(companiesTable.slug, OTHER_SLUG));
});

// ── Event-triggered recompute ─────────────────────────────────────────────────

describe("predictive restock — event-triggered recompute fires earlier than a same-value reactive threshold", () => {
  it("1. flags a recommendation while on-hand is still above what a same-value static threshold would require", async () => {
    // 20 same-day (dayIndex 0) ledger deductions of 2 oz each. With a 10-day
    // half-life over a 45-day lookback (Σweight ≈ 14.273, hand-verified),
    // the recency-weighted rate resolves to (20×2)/14.273 ≈ 2.80 oz/day —
    // an exact, reproducible number rather than a guess.
    await seedCompanyTarget(5, 4); // 5 days safety stock + 4 days supplier lead time → horizon 9 days
    await seedHistoricalDeductions(2, 20);
    // reorderPoint ≈ 2.80 × 9 ≈ 25.2. A same-value REACTIVE threshold (just
    // the safety-stock window, no lead time) would only require
    // ≈ 2.80 × 5 ≈ 14.0. Put on-hand at 20: comfortably above the reactive
    // threshold, but below the lead-time-aware predictive reorder point.
    await seedInventory(20);

    const res = await postLog(0.01); // negligible deduction, just to trigger the event recompute
    expect(res.status).toBe(201);
    await waitForRecompute();

    const row = await getRecommendationRow();
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
    expect(row!.reorderPointQuantity).toBeGreaterThan(20); // predictive: already short
    expect(row!.reorderPointQuantity).toBeGreaterThan(14); // vs. what a same-value reactive threshold would need
    expect(row!.recommendedByAt).toBeTruthy();
  });
});

// ── GET /manager/predictive-restocks ──────────────────────────────────────────

describe("GET /manager/predictive-restocks", () => {
  it("2. returns the pending recommendation with product name", async () => {
    asMgr();
    const res = await request(app).get("/api/manager/predictive-restocks").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const rec = res.body.find((r: { productId: number }) => r.productId === productId);
    expect(rec).toBeDefined();
    expect(rec.productName).toBe("Predictive Test Product");
    expect(rec.status).toBe("pending");
    expect(rec.technicianId).toBe(TECH_ID);
  });

  it("7. never returns another company's recommendation rows", async () => {
    await db
      .insert(predictiveRestockRecommendationsTable)
      .values({
        companyId: otherCompanyId,
        technicianId: OTHER_MGR_ID,
        productId,
        quantityOnHand: 1,
        unit: "fl oz",
        projectedDailyRate: 5,
        leadTimeDays: 3,
        safetyStockDays: 5,
        reorderPointQuantity: 40,
        recommendedOrderQuantity: 39,
        scheduledStopCount: 0,
        recommendedByAt: new Date(),
        status: "pending",
      })
      .onConflictDoUpdate({
        target: [
          predictiveRestockRecommendationsTable.companyId,
          predictiveRestockRecommendationsTable.technicianId,
          predictiveRestockRecommendationsTable.productId,
        ],
        set: { recommendedOrderQuantity: 39, status: "pending", updatedAt: new Date() },
      });

    try {
      asMgr();
      const ownList = await request(app).get("/api/manager/predictive-restocks").expect(200);
      expect(ownList.body.every((r: { technicianId: string }) => r.technicianId !== OTHER_MGR_ID)).toBe(true);

      asOtherMgr();
      const otherList = await request(app).get("/api/manager/predictive-restocks").expect(200);
      expect(otherList.body.some((r: { technicianId: string }) => r.technicianId === OTHER_MGR_ID)).toBe(true);
      expect(otherList.body.every((r: { technicianId: string }) => r.technicianId !== TECH_ID)).toBe(true);
    } finally {
      await db
        .delete(predictiveRestockRecommendationsTable)
        .where(
          and(
            eq(predictiveRestockRecommendationsTable.companyId, otherCompanyId),
            eq(predictiveRestockRecommendationsTable.technicianId, OTHER_MGR_ID),
            eq(predictiveRestockRecommendationsTable.productId, productId),
          ),
        );
    }
  });
});

// ── PATCH (dismiss) + reopen + convert ────────────────────────────────────────

describe("PATCH /manager/predictive-restocks/:id and conversion", () => {
  it("3. dismiss removes the recommendation from the pending list", async () => {
    asMgr();
    const list = await request(app).get("/api/manager/predictive-restocks").expect(200);
    const rec = list.body.find((r: { productId: number }) => r.productId === productId);
    expect(rec).toBeDefined();

    await request(app).patch(`/api/manager/predictive-restocks/${rec.id}`).send({ status: "dismissed" }).expect(200);

    const list2 = await request(app).get("/api/manager/predictive-restocks").expect(200);
    expect(list2.body.find((r: { productId: number }) => r.productId === productId)).toBeUndefined();
  });

  it("4. reopens on the next recompute while still predicted-short", async () => {
    const res = await postLog(0.01);
    expect(res.status).toBe(201);
    await waitForRecompute();

    const row = await getRecommendationRow();
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
  });

  it("5. convert-to-alert creates a pending_restock_requests row and marks the recommendation converted", async () => {
    const before = await getRecommendationRow();
    expect(before).not.toBeNull();

    asMgr();
    const res = await request(app)
      .post(`/api/manager/predictive-restocks/${before!.id}/convert-to-alert`)
      .expect(200);
    expect(res.body.status).toBe("converted");
    expect(typeof res.body.alertId).toBe("number");

    const [alert] = await db
      .select()
      .from(pendingRestockRequestsTable)
      .where(eq(pendingRestockRequestsTable.id, res.body.alertId));
    expect(alert).toBeDefined();
    expect(alert.companyId).toBe(companyId);
    expect(alert.technicianId).toBe(TECH_ID);
    expect(alert.productId).toBe(productId);
    expect(alert.status).toBe("pending");

    const after = await getRecommendationRow();
    expect(after!.status).toBe("converted");
    expect(after!.convertedAlertId).toBe(res.body.alertId);

    // Clean up the alert this conversion created so it doesn't leak into
    // other restock-alert tests/state.
    await db.delete(pendingRestockRequestsTable).where(eq(pendingRestockRequestsTable.id, res.body.alertId));
  });

  it("6. a converted recommendation is never silently reopened by a later recompute", async () => {
    const res = await postLog(0.01);
    expect(res.status).toBe(201);
    await waitForRecompute();

    const row = await getRecommendationRow();
    expect(row).not.toBeNull();
    expect(row!.status).toBe("converted"); // still converted, not reopened to 'pending'
  });
});

// ── convert-to-alert must never resurrect an approved alert ───────────────────

describe("convert-to-alert never resurrects an approved pending_restock_requests row", () => {
  it("9. leaves an already-approved alert untouched and links the recommendation to it", async () => {
    await clearPredictiveState();
    await seedCompanyTarget(5, 4);
    await seedHistoricalDeductions(2, 20);
    await seedInventory(20);

    const res = await postLog(0.01);
    expect(res.status).toBe(201);
    await waitForRecompute();

    const rec = await getRecommendationRow();
    expect(rec).not.toBeNull();
    expect(rec!.status).toBe("pending");

    // Simulate a reactive alert for this same technician/product that a
    // manager already approved (and, in the real flow, that triggered a real
    // supplier order) *before* the predictive recommendation is converted.
    const approvedResolvedAt = new Date("2026-01-01T00:00:00.000Z");
    const [approvedAlert] = await db
      .insert(pendingRestockRequestsTable)
      .values({
        companyId,
        technicianId: TECH_ID,
        productId,
        quantityOnHand: 999,
        restockThreshold: 999,
        shortfall: 999,
        status: "approved",
        resolvedAt: approvedResolvedAt,
      })
      .onConflictDoUpdate({
        target: [
          pendingRestockRequestsTable.companyId,
          pendingRestockRequestsTable.technicianId,
          pendingRestockRequestsTable.productId,
        ],
        set: {
          quantityOnHand: 999,
          restockThreshold: 999,
          shortfall: 999,
          status: "approved",
          resolvedAt: approvedResolvedAt,
          updatedAt: new Date(),
        },
      })
      .returning();

    try {
      asMgr();
      const convertRes = await request(app)
        .post(`/api/manager/predictive-restocks/${rec!.id}/convert-to-alert`)
        .expect(200);
      expect(convertRes.body.status).toBe("converted");
      expect(convertRes.body.alertId).toBe(approvedAlert.id);
      expect(convertRes.body.alertStatus).toBe("approved");

      // The approved alert's own status and snapshot fields must be
      // completely untouched by the conversion — not reset to 'pending',
      // not overwritten with the recommendation's numbers.
      const [alertAfter] = await db
        .select()
        .from(pendingRestockRequestsTable)
        .where(eq(pendingRestockRequestsTable.id, approvedAlert.id));
      expect(alertAfter.status).toBe("approved");
      expect(alertAfter.quantityOnHand).toBe(999);
      expect(alertAfter.restockThreshold).toBe(999);
      expect(alertAfter.shortfall).toBe(999);
      expect(new Date(alertAfter.resolvedAt!).getTime()).toBe(approvedResolvedAt.getTime());

      // The recommendation still records the conversion, linked to the
      // already-approved alert rather than a freshly reopened one.
      const afterRec = await getRecommendationRow();
      expect(afterRec!.status).toBe("converted");
      expect(afterRec!.convertedAlertId).toBe(approvedAlert.id);
    } finally {
      await db.delete(pendingRestockRequestsTable).where(eq(pendingRestockRequestsTable.id, approvedAlert.id));
    }
  });
});

// ── No-config guard ────────────────────────────────────────────────────────────

describe("predictive restock — explicit no-config status, never fabricated", () => {
  it("8. with no replenishment target configured, a deduction produces no recommendation", async () => {
    await clearPredictiveState();
    await clearCompanyTarget();
    await seedInventory(5); // very low on-hand, would obviously look "short" if a number were fabricated

    const res = await postLog(1);
    expect(res.status).toBe(201);
    await waitForRecompute();

    const row = await getRecommendationRow();
    expect(row).toBeNull();
  });
});
