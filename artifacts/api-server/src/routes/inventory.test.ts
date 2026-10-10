/**
 * Inventory route integration tests — covering:
 *
 * 1. Tenant isolation: POST /company/supplier/import-csv cannot import into
 *    another company's inventory (row rejected with "not found in this company")
 *
 * 2. Idempotency: submitting the same orderRef twice skips the second row and
 *    does not double the on-hand quantity
 *
 * 3. End-to-end restock update: after a successful manual restock the
 *    GET /technician/inventory balance reflects the added quantity
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Clerk mock ────────────────────────────────────────────────────────────────

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

import app from "../app";
import {
  db,
  companiesTable,
  usersTable,
  productsTable,
  techInventoryTable,
  techRestockEventsTable,
  inventoryTransactionsTable,
  inspectionsTable,
  treatmentLogsTable,
  productLabelRulesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { withLedgerMutationBypass } from "../test/ledger-bypass";

// ── Helpers ───────────────────────────────────────────────────────────────────

function asUser(id: string | null) {
  authState.userId = id;
}

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db
    .insert(companiesTable)
    .values({ name, slug })
    .returning();
  return row!.id;
}

async function ensureUser(clerkUserId: string, companyId: number, role: "owner" | "manager" | "technician") {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));
  if (existing) return;
  await db.insert(usersTable).values({ clerkUserId, companyId, role });
}

async function ensureProduct(
  name: string,
  epa: string,
): Promise<number> {
  const [existing] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.epaRegistrationNumber, epa));
  if (existing) return existing.id;
  const [row] = await db
    .insert(productsTable)
    .values({
      name,
      epaRegistrationNumber: epa,
      productType: "insecticide",
      activeIngredients: "cypermethrin 11.8%",
      isActive: true,
    })
    .returning();
  return row!.id;
}

async function getOnHand(companyId: number, technicianId: string, productId: number): Promise<number | null> {
  const [row] = await db
    .select({ qty: techInventoryTable.quantityOnHand })
    .from(techInventoryTable)
    .where(
      and(
        eq(techInventoryTable.companyId, companyId),
        eq(techInventoryTable.technicianId, technicianId),
        eq(techInventoryTable.productId, productId),
      ),
    );
  return row?.qty ?? null;
}

// ── Test fixture setup ────────────────────────────────────────────────────────

const OWNER_A = "inv_test_owner_a";
const OWNER_B = "inv_test_owner_b";
const TECH_A  = "inv_test_tech_a";
const TECH_B  = "inv_test_tech_b";

let companyAId: number;
let companyBId: number;
let productId: number;

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Inv Test Co A", "inv-test-co-a");
  companyBId = await findOrCreateCompany("Inv Test Co B", "inv-test-co-b");

  await Promise.all([
    ensureUser(OWNER_A, companyAId, "owner"),
    ensureUser(TECH_A, companyAId, "technician"),
    ensureUser(OWNER_B, companyBId, "owner"),
    ensureUser(TECH_B, companyBId, "technician"),
  ]);

  productId = await ensureProduct("Suspend SC (test)", "34704-910-test");
});

afterAll(async () => {
  // Clean up inventory and restock rows created by these tests. The ledger
  // is DB-enforced append-only (see migrate-ledger-immutability.ts), so its
  // rows can only be cleared via the sanctioned test-only bypass.
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyAId)),
  );
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyBId)),
  );
  await db
    .delete(techRestockEventsTable)
    .where(eq(techRestockEventsTable.companyId, companyAId));
  await db
    .delete(techRestockEventsTable)
    .where(eq(techRestockEventsTable.companyId, companyBId));
  await db
    .delete(techInventoryTable)
    .where(eq(techInventoryTable.companyId, companyAId));
  await db
    .delete(techInventoryTable)
    .where(eq(techInventoryTable.companyId, companyBId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /company/supplier/import-csv", () => {
  it("tenant isolation: Company A owner cannot import into Company B technician's inventory", async () => {
    asUser(OWNER_A);

    const res = await request(app)
      .post("/api/company/supplier/import-csv")
      .set("Content-Type", "application/json")
      .send({
        rows: [
          {
            technicianId: TECH_B, // belongs to Company B — should be rejected
            productId,
            quantity: 50,
            unit: "oz",
            orderRef: "ISOLATION-001",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.unmatched).toHaveLength(1);
    expect(res.body.unmatched[0].reason).toMatch(/not found in this company/i);

    // Verify inventory for TECH_B in Company B was NOT affected.
    const qty = await getOnHand(companyBId, TECH_B, productId);
    expect(qty).toBeNull();
  });

  it("idempotency: submitting the same orderRef twice only applies the quantity once", async () => {
    asUser(OWNER_A);

    const orderRef = `IDEMPOTENT-${Date.now()}`;
    const importRow = {
      technicianId: TECH_A,
      productId,
      quantity: 32,
      unit: "oz",
      orderRef,
    };

    // First import
    const first = await request(app)
      .post("/api/company/supplier/import-csv")
      .set("Content-Type", "application/json")
      .send({ rows: [importRow] });

    expect(first.status).toBe(201);
    expect(first.body.imported).toBe(1);
    expect(first.body.skipped).toBe(0);

    const qtyAfterFirst = await getOnHand(companyAId, TECH_A, productId);
    expect(typeof qtyAfterFirst).toBe("number");

    // Second import — same orderRef
    const second = await request(app)
      .post("/api/company/supplier/import-csv")
      .set("Content-Type", "application/json")
      .send({ rows: [importRow] });

    expect(second.status).toBe(200);
    expect(second.body.imported).toBe(0);
    expect(second.body.skipped).toBe(1);

    // Quantity must not have doubled.
    const qtyAfterSecond = await getOnHand(companyAId, TECH_A, productId);
    expect(qtyAfterSecond).toBe(qtyAfterFirst);
  });

  it("successful import creates restock event and updates on-hand inventory", async () => {
    asUser(OWNER_A);

    // Get baseline (may already have stock from idempotency test above)
    const baseQty = (await getOnHand(companyAId, TECH_A, productId)) ?? 0;

    const orderRef = `SUCCESS-${Date.now()}`;
    const res = await request(app)
      .post("/api/company/supplier/import-csv")
      .set("Content-Type", "application/json")
      .send({
        rows: [
          {
            technicianId: TECH_A,
            productId,
            quantity: 16,
            unit: "oz",
            orderRef,
            date: "2026-08-21",
          },
        ],
        supplierName: "veseris",
      });

    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.unmatched).toHaveLength(0);

    const newQty = await getOnHand(companyAId, TECH_A, productId);
    expect(newQty).toBe(baseQty + 16);

    // A CSV-imported receipt must land in the immutable ledger the same way a
    // manual restock does.
    const matching = (
      await db
        .select()
        .from(inventoryTransactionsTable)
        .where(
          and(
            eq(inventoryTransactionsTable.companyId, companyAId),
            eq(inventoryTransactionsTable.technicianId, TECH_A),
            eq(inventoryTransactionsTable.productId, productId),
            eq(inventoryTransactionsTable.movementType, "truck_receipt"),
            eq(inventoryTransactionsTable.quantity, 16),
          ),
        )
    ).filter((r) => r.source === "restock:csv_import");
    expect(matching.length).toBeGreaterThan(0);
  });

  it("rejects a CSV row whose unit doesn't match an existing nonzero truck balance, reporting it as unmatched", async () => {
    asUser(OWNER_A);

    const existingQty = (await getOnHand(companyAId, TECH_A, productId))!;
    expect(existingQty).not.toBeNull();

    const orderRef = `UNIT-MISMATCH-${Date.now()}`;
    const res = await request(app)
      .post("/api/company/supplier/import-csv")
      .set("Content-Type", "application/json")
      .send({
        rows: [
          {
            technicianId: TECH_A,
            productId,
            quantity: 5,
            unit: "gallon", // existing balance for this tech+product is tracked in "oz"
            orderRef,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.unmatched).toHaveLength(1);
    expect(res.body.unmatched[0].reason).toMatch(/different unit|uses unit/i);

    // Balance must be completely unchanged.
    expect(await getOnHand(companyAId, TECH_A, productId)).toBe(existingQty);

    // No restock event or ledger row should have been created for this row.
    const events = await db
      .select()
      .from(techRestockEventsTable)
      .where(eq(techRestockEventsTable.supplierOrderRef, orderRef));
    expect(events).toHaveLength(0);
  });
});

describe("POST /company/supplier/import-csv concurrent race guard", () => {
  it("a race-past-the-SELECT-check is caught by the DB unique partial index — handled as a skip, never a double-import", async () => {
    asUser(OWNER_A);

    const orderRef = `CONCURRENT-${Date.now()}`;

    // Simulate a concurrent writer that slipped past the application-layer SELECT
    // check: directly insert the restock event into the DB, the way a racing
    // request would have done before committing.  This is the most realistic way
    // to test the race-guard in a single-process test environment.
    await db.insert(techRestockEventsTable).values({
      companyId: companyAId,
      technicianId: TECH_A,
      productId,
      quantityReceived: 24,
      unit: "oz",
      source: "csv_import",
      supplierOrderRef: orderRef,
      receivedAt: new Date(),
    });

    const baseQty = (await getOnHand(companyAId, TECH_A, productId)) ?? 0;

    // The HTTP import with the same orderRef must be skipped — either by the
    // SELECT-based fast path (row already exists) or by a 23505 thrown when the
    // unique partial index fires.
    const res = await request(app)
      .post("/api/company/supplier/import-csv")
      .set("Content-Type", "application/json")
      .send({
        rows: [{ technicianId: TECH_A, productId, quantity: 24, unit: "oz", orderRef }],
      });

    expect(res.status).toBe(200); // 0 imported → 200
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.unmatched).toHaveLength(0);

    // On-hand inventory must NOT have been changed by this import.
    const newQty = await getOnHand(companyAId, TECH_A, productId);
    expect(newQty).toBe(baseQty);
  });
});

describe("POST /technician/inventory/restock-events (manual restock)", () => {
  it("manual restock atomically updates inventory and creates an event", async () => {
    asUser(TECH_A);

    // Get baseline
    const baseQty = (await getOnHand(companyAId, TECH_A, productId)) ?? 0;

    const res = await request(app)
      .post("/api/technician/inventory/restock-events")
      .set("Content-Type", "application/json")
      .send({
        productId,
        quantityReceived: 8,
        unit: "oz",
        source: "manual",
        notes: "picked up from supply room",
      });

    expect(res.status).toBe(201);
    expect(res.body.quantityReceived).toBe(8);
    expect(res.body.source).toBe("manual");

    const newQty = await getOnHand(companyAId, TECH_A, productId);
    expect(newQty).toBe(baseQty + 8);
  });
});

describe("Applied-usage surfacing (Task #862)", () => {
  let inspectionId: number;

  beforeAll(async () => {
    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId: companyAId,
        technicianId: TECH_A,
        technicianName: "Inv Test Tech A",
        siteAddress: "1 Applied Usage St",
        status: "pending",
      })
      .returning();
    inspectionId = insp!.id;

    // Empty constraint arrays so the POST handler bypasses all label
    // validations and doesn't 404 on "Product or label rules not found".
    const [existingRules] = await db
      .select()
      .from(productLabelRulesTable)
      .where(eq(productLabelRulesTable.productId, productId));
    if (!existingRules) {
      await db.insert(productLabelRulesTable).values({
        productId,
        approvedPestTypes: [],
        approvedSiteClassifications: [],
        requiredEquipmentTypes: [],
        mixingSteps: [],
        maxRateOzPer1000Sqft: null,
        maxRateOzPerGallon: null,
        nozzleSpec: null,
        pressurePsi: null,
        dropletSize: null,
        maxTempF: null,
        phytotoxicityNotes: null,
        reEntryIntervalHours: null,
      });
    }

    // Baseline on-hand so the deduction below has plenty of room and doesn't
    // interact with the clamp behaviour covered elsewhere.
    await db
      .insert(techInventoryTable)
      .values({
        companyId: companyAId,
        technicianId: TECH_A,
        productId,
        quantityOnHand: 100,
        unit: "fl oz",
      })
      .onConflictDoUpdate({
        target: [techInventoryTable.companyId, techInventoryTable.technicianId, techInventoryTable.productId],
        set: { quantityOnHand: 100, unit: "fl oz" },
      });
  });

  afterAll(async () => {
    await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.inspectionId, inspectionId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
  });

  it("GET /technician/inventory surfaces lastAppliedAt/lastAppliedOz after a treatment log is finalized", async () => {
    asUser(TECH_A);

    const applyOz = 6;
    const created = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .set("Content-Type", "application/json")
      .send({
        productId,
        targetPest: "cockroach",
        siteClassification: "residential_interior",
        environmentalWarningAcknowledged: false,
        totalProductOz: applyOz,
      });
    expect(created.status).toBe(201);

    const res = await request(app).get("/api/technician/inventory");
    expect(res.status).toBe(200);

    const item = res.body.find((i: { productId: number }) => i.productId === productId);
    expect(item).toBeDefined();
    expect(item.lastAppliedOz).toBe(applyOz);
    expect(item.lastAppliedAt).toBeTruthy();
    expect(new Date(item.lastAppliedAt).getTime()).not.toBeNaN();
  });

  it("GET /manager/team-inventory surfaces appliedToday summed across today's logs for that tech+product", async () => {
    // A second application today, on top of the one from the previous test,
    // so appliedToday must reflect the sum, not just the latest log.
    asUser(TECH_A);
    const secondOz = 4;
    const created = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .set("Content-Type", "application/json")
      .send({
        productId,
        targetPest: "ant",
        siteClassification: "residential_interior",
        environmentalWarningAcknowledged: false,
        totalProductOz: secondOz,
      });
    expect(created.status).toBe(201);

    asUser(OWNER_A);
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const res = await request(app).get(`/api/manager/team-inventory?tzOffsetMinutes=${tzOffsetMinutes}`);
    expect(res.status).toBe(200);

    const techEntry = res.body.find((t: { technicianId: string }) => t.technicianId === TECH_A);
    expect(techEntry).toBeDefined();
    const item = techEntry.items.find((i: { productId: number }) => i.productId === productId);
    expect(item).toBeDefined();
    // 6 (previous test) + 4 (this test) applied today for this tech+product.
    expect(item.appliedToday).toBeGreaterThanOrEqual(10);
  });

  it("never mislabels ounce-based appliedToday/lastAppliedOz with a gallon-tracked product's on-hand unit", async () => {
    // Products with on-hand inventory tracked in gallons are exempt from the
    // treatment-log deduction (it only deducts 'fl oz'/'oz' rows), but
    // treatment_logs.totalProductOz is still recorded in fl oz and must still
    // surface as applied usage — labelled "fl oz", never as the product's
    // gallon on-hand unit.
    const gallonProductId = await ensureProduct("Gallon-Tracked Product (test)", "GALLON-TEST-001");
    await db
      .insert(productLabelRulesTable)
      .values({
        productId: gallonProductId,
        approvedPestTypes: [],
        approvedSiteClassifications: [],
        requiredEquipmentTypes: [],
        mixingSteps: [],
        maxRateOzPer1000Sqft: null,
        maxRateOzPerGallon: null,
        nozzleSpec: null,
        pressurePsi: null,
        dropletSize: null,
        maxTempF: null,
        phytotoxicityNotes: null,
        reEntryIntervalHours: null,
      })
      .onConflictDoNothing();
    await db
      .insert(techInventoryTable)
      .values({
        companyId: companyAId,
        technicianId: TECH_A,
        productId: gallonProductId,
        quantityOnHand: 2, // 2 gallons
        unit: "gallon",
      })
      .onConflictDoUpdate({
        target: [techInventoryTable.companyId, techInventoryTable.technicianId, techInventoryTable.productId],
        set: { quantityOnHand: 2, unit: "gallon" },
      });

    asUser(TECH_A);
    const applyOz = 5; // 5 fl oz applied — far less than "2" of the gallon unit
    const created = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .set("Content-Type", "application/json")
      .send({
        productId: gallonProductId,
        targetPest: "termite",
        siteClassification: "residential_interior",
        environmentalWarningAcknowledged: false,
        totalProductOz: applyOz,
      });
    expect(created.status).toBe(201);
    // The gallon-tracked balance itself must be untouched by the deduction.
    expect(created.body.updatedInventory).toBeNull();
    expect(await getOnHand(companyAId, TECH_A, gallonProductId)).toBe(2);

    // Technician view: lastAppliedOz reflects the fl-oz amount, while unit
    // (the on-hand tracking unit) independently stays "gallon".
    const techRes = await request(app).get("/api/technician/inventory");
    expect(techRes.status).toBe(200);
    const techItem = techRes.body.find((i: { productId: number }) => i.productId === gallonProductId);
    expect(techItem).toBeDefined();
    expect(techItem.unit).toBe("gallon");
    expect(techItem.lastAppliedOz).toBe(applyOz);

    // Manager view: appliedToday is the fl-oz figure, never conflated with
    // (or scaled/interpreted against) the gallon on-hand unit.
    asUser(OWNER_A);
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const mgrRes = await request(app).get(`/api/manager/team-inventory?tzOffsetMinutes=${tzOffsetMinutes}`);
    expect(mgrRes.status).toBe(200);
    const techEntry = mgrRes.body.find((t: { technicianId: string }) => t.technicianId === TECH_A);
    const mgrItem = techEntry.items.find((i: { productId: number }) => i.productId === gallonProductId);
    expect(mgrItem).toBeDefined();
    expect(mgrItem.unit).toBe("gallon");
    expect(mgrItem.quantityOnHand).toBe(2); // untouched — never reinterpreted as fl oz
    expect(mgrItem.appliedToday).toBe(applyOz);
  });
});
