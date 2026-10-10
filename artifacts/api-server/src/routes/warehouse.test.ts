/**
 * Warehouse tier & inventory transaction ledger — integration tests.
 *
 * Coverage:
 *  1. POST /manager/warehouse/receive creates/increments a warehouse balance
 *     and writes a "warehouse_receipt" ledger row.
 *  2. POST /manager/warehouse/transfer atomically moves stock from the
 *     warehouse into a technician's truck and writes a
 *     "warehouse_to_truck_transfer" ledger row.
 *  3. A transfer that would leave the warehouse balance negative is rejected
 *     (409) and changes nothing.
 *  4. POST /technician/inventory/restock-events writes a "truck_receipt"
 *     ledger row (in addition to its existing behavior).
 *  5. Treatment-log deduction writes a "truck_deduction" ledger row, and
 *     deleting that log writes a "truck_deduction_reversal" row.
 *  6. GET /manager/inventory-transactions is scoped to the caller's company
 *     and can be filtered by technicianId.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

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
  productLabelRulesTable,
  techInventoryTable,
  techRestockEventsTable,
  warehouseInventoryTable,
  inventoryTransactionsTable,
  inspectionsTable,
  treatmentLogsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { withLedgerMutationBypass } from "../test/ledger-bypass";

function asUser(id: string | null) {
  authState.userId = id;
}

const OWNER_A = "wh_test_owner_a";
const TECH_A = "wh_test_tech_a";
const OWNER_B = "wh_test_owner_b";
const TECH_B = "wh_test_tech_b";
const SLUG_A = "wh-test-co-a";
const SLUG_B = "wh-test-co-b";

let companyAId: number;
let companyBId: number;
let productId: number;
let inspectionId: number;

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row!.id;
}

async function getWarehouseQty(companyId: number, productId: number): Promise<number | null> {
  const [row] = await db
    .select({ qty: warehouseInventoryTable.quantityOnHand })
    .from(warehouseInventoryTable)
    .where(and(eq(warehouseInventoryTable.companyId, companyId), eq(warehouseInventoryTable.productId, productId)));
  return row?.qty ?? null;
}

async function getTechQty(companyId: number, technicianId: string, productId: number): Promise<number | null> {
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

async function getLedgerRows(companyId: number, movementType?: string) {
  const rows = await db
    .select()
    .from(inventoryTransactionsTable)
    .where(eq(inventoryTransactionsTable.companyId, companyId));
  return movementType ? rows.filter((r) => r.movementType === movementType) : rows;
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Warehouse Test Co A", SLUG_A);
  companyBId = await findOrCreateCompany("Warehouse Test Co B", SLUG_B);

  await Promise.all([
    db
      .insert(usersTable)
      .values({ clerkUserId: OWNER_A, companyId: companyAId, role: "owner" })
      .onConflictDoNothing(),
    db
      .insert(usersTable)
      .values({ clerkUserId: TECH_A, companyId: companyAId, role: "technician" })
      .onConflictDoNothing(),
    db
      .insert(usersTable)
      .values({ clerkUserId: OWNER_B, companyId: companyBId, role: "owner" })
      .onConflictDoNothing(),
    db
      .insert(usersTable)
      .values({ clerkUserId: TECH_B, companyId: companyBId, role: "technician" })
      .onConflictDoNothing(),
  ]);

  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Warehouse Test Product",
      epaRegistrationNumber: "WH-TEST-001",
      productType: "general-use",
      activeIngredients: "Test ingredient 1%",
      isActive: true,
    })
    .returning();
  productId = product!.id;

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

  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      technicianId: TECH_A,
      technicianName: "WH Test Tech",
      siteAddress: "1 Warehouse Test St",
      status: "pending",
    })
    .returning();
  inspectionId = insp!.id;
});

afterAll(async () => {
  await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.companyId, companyAId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyAId));
  // The ledger is DB-enforced append-only (see migrate-ledger-immutability.ts);
  // its rows can only be cleared via the sanctioned test-only bypass.
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyAId)),
  );
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyBId)),
  );
  await db.delete(warehouseInventoryTable).where(eq(warehouseInventoryTable.companyId, companyAId));
  await db.delete(warehouseInventoryTable).where(eq(warehouseInventoryTable.companyId, companyBId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyAId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyBId));
  await db.delete(techRestockEventsTable).where(eq(techRestockEventsTable.productId, productId));
  await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, productId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
});

describe("POST /manager/warehouse/receive", () => {
  it("creates a warehouse balance and a warehouse_receipt ledger row", async () => {
    asUser(OWNER_A);
    const res = await request(app)
      .post("/api/manager/warehouse/receive")
      .set("Content-Type", "application/json")
      .send({ productId, quantity: 100, unit: "fl oz" });

    expect(res.status).toBe(201);
    expect(res.body.warehouse).toMatchObject({ productId, quantityOnHand: 100, unit: "fl oz" });

    expect(await getWarehouseQty(companyAId, productId)).toBe(100);

    const ledgerRows = await getLedgerRows(companyAId, "warehouse_receipt");
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      productId,
      quantity: 100,
      source: "supplier",
      destination: "warehouse",
      actingUserId: OWNER_A,
    });
  });

  it("increments an existing warehouse balance on a second receipt", async () => {
    asUser(OWNER_A);
    const res = await request(app)
      .post("/api/manager/warehouse/receive")
      .set("Content-Type", "application/json")
      .send({ productId, quantity: 50, unit: "fl oz" });

    expect(res.status).toBe(201);
    expect(await getWarehouseQty(companyAId, productId)).toBe(150);
  });

  it("rejects a receipt in a different unit than the existing warehouse balance, and changes nothing", async () => {
    asUser(OWNER_A);
    const before = (await getWarehouseQty(companyAId, productId))!;

    const res = await request(app)
      .post("/api/manager/warehouse/receive")
      .set("Content-Type", "application/json")
      .send({ productId, quantity: 1, unit: "gallon" }); // existing balance is tracked in "fl oz"

    expect(res.status).toBe(409);
    expect(await getWarehouseQty(companyAId, productId)).toBe(before);
    // No new ledger row written for the rejected receipt (still just the two
    // successful receipts from the tests above).
    expect(await getLedgerRows(companyAId, "warehouse_receipt")).toHaveLength(2);
  });
});

describe("POST /manager/warehouse/transfer", () => {
  it("moves stock from the warehouse into the technician's truck and writes a ledger row", async () => {
    asUser(OWNER_A);
    const warehouseBefore = (await getWarehouseQty(companyAId, productId))!;
    const truckBefore = (await getTechQty(companyAId, TECH_A, productId)) ?? 0;

    const res = await request(app)
      .post("/api/manager/warehouse/transfer")
      .set("Content-Type", "application/json")
      .send({ technicianId: TECH_A, productId, quantity: 20 });

    expect(res.status).toBe(201);
    expect(res.body.warehouseQuantityOnHand).toBe(warehouseBefore - 20);

    expect(await getWarehouseQty(companyAId, productId)).toBe(warehouseBefore - 20);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(truckBefore + 20);

    const ledgerRows = await getLedgerRows(companyAId, "warehouse_to_truck_transfer");
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      productId,
      quantity: 20,
      source: "warehouse",
      destination: `truck:${TECH_A}`,
      technicianId: TECH_A,
      actingUserId: OWNER_A,
    });
  });

  it("rejects a transfer that would leave the warehouse balance negative, and changes nothing", async () => {
    asUser(OWNER_A);
    const warehouseBefore = (await getWarehouseQty(companyAId, productId))!;
    const truckBefore = (await getTechQty(companyAId, TECH_A, productId))!;

    const res = await request(app)
      .post("/api/manager/warehouse/transfer")
      .set("Content-Type", "application/json")
      .send({ technicianId: TECH_A, productId, quantity: warehouseBefore + 1000 });

    expect(res.status).toBe(409);

    // Nothing changed.
    expect(await getWarehouseQty(companyAId, productId)).toBe(warehouseBefore);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(truckBefore);
    expect(await getLedgerRows(companyAId, "warehouse_to_truck_transfer")).toHaveLength(1); // unchanged from prior test
  });

  it("rejects a transfer for a technician outside the caller's company", async () => {
    asUser(OWNER_A);
    const res = await request(app)
      .post("/api/manager/warehouse/transfer")
      .set("Content-Type", "application/json")
      .send({ technicianId: TECH_B, productId, quantity: 1 });

    expect(res.status).toBe(404);
  });

  it("rejects a transfer when the technician's truck already holds this product in a different unit", async () => {
    asUser(OWNER_A);

    // Give TECH_B's own company a truck balance in a different unit so we can
    // safely mutate it without disturbing TECH_A's fixtures used elsewhere.
    await db
      .insert(techInventoryTable)
      .values({ companyId: companyAId, technicianId: TECH_A, productId, quantityOnHand: 1, unit: "gallon" })
      .onConflictDoUpdate({
        target: [techInventoryTable.companyId, techInventoryTable.technicianId, techInventoryTable.productId],
        set: { unit: "gallon" },
      });

    const warehouseBefore = (await getWarehouseQty(companyAId, productId))!;
    const truckBefore = (await getTechQty(companyAId, TECH_A, productId))!;

    const res = await request(app)
      .post("/api/manager/warehouse/transfer")
      .set("Content-Type", "application/json")
      .send({ technicianId: TECH_A, productId, quantity: 1 }); // warehouse tracks this product in "fl oz"

    expect(res.status).toBe(409);
    expect(await getWarehouseQty(companyAId, productId)).toBe(warehouseBefore);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(truckBefore);

    // Restore TECH_A's truck balance back to "fl oz" for the remaining tests in this file.
    await db
      .update(techInventoryTable)
      .set({ unit: "fl oz" })
      .where(
        and(
          eq(techInventoryTable.companyId, companyAId),
          eq(techInventoryTable.technicianId, TECH_A),
          eq(techInventoryTable.productId, productId),
        ),
      );
  });
});

describe("Ledger wiring — baseline & manual adjustment routes", () => {
  it("POST /technician/inventory/baseline writes a truck_adjustment ledger row sized to the delta", async () => {
    asUser(TECH_A);
    const before = (await getTechQty(companyAId, TECH_A, productId)) ?? 0;

    const res = await request(app)
      .post("/api/technician/inventory/baseline")
      .set("Content-Type", "application/json")
      .send({ items: [{ productId, quantityOnHand: before + 7, unit: "fl oz" }] });

    expect(res.status).toBe(201);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(before + 7);

    const rows = await getLedgerRows(companyAId, "truck_adjustment");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId,
      quantity: 7,
      destination: `truck:${TECH_A}`,
      technicianId: TECH_A,
      actingUserId: TECH_A,
    });
  });

  it("PATCH /technician/inventory/:productId writes a truck_adjustment ledger row for a decrease", async () => {
    asUser(TECH_A);
    const before = (await getTechQty(companyAId, TECH_A, productId))!;

    const res = await request(app)
      .patch(`/api/technician/inventory/${productId}`)
      .set("Content-Type", "application/json")
      .send({ quantityOnHand: before - 4 });

    expect(res.status).toBe(200);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(before - 4);

    const rows = await getLedgerRows(companyAId, "truck_adjustment");
    // One row from the baseline test above, one from this decrease.
    expect(rows).toHaveLength(2);
    const decreaseRow = rows.find((r) => r.source === `truck:${TECH_A}`);
    expect(decreaseRow).toMatchObject({
      productId,
      quantity: 4,
      destination: "adjustment:manual",
      technicianId: TECH_A,
      actingUserId: TECH_A,
    });
  });

  it("does not write a ledger row when the set quantity equals the current balance", async () => {
    asUser(TECH_A);
    const current = (await getTechQty(companyAId, TECH_A, productId))!;
    const before = (await getLedgerRows(companyAId, "truck_adjustment")).length;

    const res = await request(app)
      .patch(`/api/technician/inventory/${productId}`)
      .set("Content-Type", "application/json")
      .send({ quantityOnHand: current });

    expect(res.status).toBe(200);
    expect(await getLedgerRows(companyAId, "truck_adjustment")).toHaveLength(before);
  });

  it("rejects a baseline unit change on a nonzero existing balance, and changes nothing", async () => {
    asUser(TECH_A);
    const before = (await getTechQty(companyAId, TECH_A, productId))!;
    expect(before).not.toBe(0);
    const ledgerCountBefore = (await getLedgerRows(companyAId, "truck_adjustment")).length;

    const res = await request(app)
      .post("/api/technician/inventory/baseline")
      .set("Content-Type", "application/json")
      .send({ items: [{ productId, quantityOnHand: before, unit: "gallon" }] });

    expect(res.status).toBe(409);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(before);
    expect(await getLedgerRows(companyAId, "truck_adjustment")).toHaveLength(ledgerCountBefore);
  });

  it("rejects a PATCH unit change on a nonzero existing balance, and changes nothing", async () => {
    asUser(TECH_A);
    const before = (await getTechQty(companyAId, TECH_A, productId))!;
    expect(before).not.toBe(0);
    const ledgerCountBefore = (await getLedgerRows(companyAId, "truck_adjustment")).length;

    const res = await request(app)
      .patch(`/api/technician/inventory/${productId}`)
      .set("Content-Type", "application/json")
      .send({ quantityOnHand: before, unit: "gallon" });

    expect(res.status).toBe(409);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(before);
    expect(await getLedgerRows(companyAId, "truck_adjustment")).toHaveLength(ledgerCountBefore);
  });
});

describe("Ledger wiring — restock events & treatment logs", () => {
  it("POST /technician/inventory/restock-events writes a truck_receipt ledger row", async () => {
    asUser(TECH_A);
    const res = await request(app)
      .post("/api/technician/inventory/restock-events")
      .set("Content-Type", "application/json")
      .send({ productId, quantityReceived: 5, unit: "fl oz", source: "manual" });

    expect(res.status).toBe(201);

    const ledgerRows = await getLedgerRows(companyAId, "truck_receipt");
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      productId,
      quantity: 5,
      destination: `truck:${TECH_A}`,
      technicianId: TECH_A,
      actingUserId: TECH_A,
    });
  });

  it("treatment-log deduction writes a truck_deduction row; deleting the log writes a reversal", async () => {
    asUser(TECH_A);

    const before = (await getTechQty(companyAId, TECH_A, productId))!;

    const createRes = await request(app)
      .post(`/api/inspections/${inspectionId}/treatment-logs`)
      .set("Content-Type", "application/json")
      .send({
        productId,
        targetPest: "cockroach",
        siteClassification: "residential_interior",
        environmentalWarningAcknowledged: false,
        totalProductOz: 3,
      });

    expect(createRes.status).toBe(201);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(before - 3);

    const deductionRows = await getLedgerRows(companyAId, "truck_deduction");
    expect(deductionRows).toHaveLength(1);
    expect(deductionRows[0]).toMatchObject({
      productId,
      quantity: 3,
      source: `truck:${TECH_A}`,
      destination: `property:${inspectionId}`,
      technicianId: TECH_A,
      actingUserId: TECH_A,
      referenceId: createRes.body.id,
    });

    const deleteRes = await request(app).delete(
      `/api/inspections/${inspectionId}/treatment-logs/${createRes.body.id}`,
    );
    expect(deleteRes.status).toBe(204);
    expect(await getTechQty(companyAId, TECH_A, productId)).toBe(before);

    const reversalRows = await getLedgerRows(companyAId, "truck_deduction_reversal");
    expect(reversalRows).toHaveLength(1);
    expect(reversalRows[0]).toMatchObject({
      productId,
      quantity: 3,
      source: `property:${inspectionId}`,
      destination: `truck:${TECH_A}`,
      technicianId: TECH_A,
    });
  });

  it("refuses to move a zeroed-out fl-oz balance to a different unit while an undeleted treatment log still holds a deduction against it, and allows the switch once that log is deleted", async () => {
    asUser(OWNER_A);
    const [product] = await db
      .insert(productsTable)
      .values({
        name: "Zero-Balance Unit Switch Test Product",
        epaRegistrationNumber: "WH-ZBUS-001",
        productType: "general-use",
        activeIngredients: "Test ingredient 1%",
        isActive: true,
      })
      .returning();
    const pid = product!.id;
    await db.insert(productLabelRulesTable).values({
      productId: pid,
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

    try {
      asUser(TECH_A);
      // Baseline a fresh 3 fl oz balance for this technician+product.
      const baselineRes = await request(app)
        .post("/api/technician/inventory/baseline")
        .set("Content-Type", "application/json")
        .send({ items: [{ productId: pid, quantityOnHand: 3, unit: "fl oz" }] });
      expect(baselineRes.status).toBe(201);

      // Fully deduct it via a treatment log, leaving the balance at exactly zero.
      const logRes = await request(app)
        .post(`/api/inspections/${inspectionId}/treatment-logs`)
        .set("Content-Type", "application/json")
        .send({
          productId: pid,
          targetPest: "cockroach",
          siteClassification: "residential_interior",
          environmentalWarningAcknowledged: false,
          totalProductOz: 3,
        });
      expect(logRes.status).toBe(201);
      expect(await getTechQty(companyAId, TECH_A, pid)).toBe(0);

      // Even though the balance is now zero, the still-undeleted treatment
      // log's deduction assumed a fl-oz-family unit — switching away must be
      // rejected, or deleting that log later would silently fail to restore
      // stock and skip its reversal ledger row.
      const switchAttempt = await request(app)
        .patch(`/api/technician/inventory/${pid}`)
        .set("Content-Type", "application/json")
        .send({ quantityOnHand: 5, unit: "gallon" });
      expect(switchAttempt.status).toBe(409);
      expect(await getTechQty(companyAId, TECH_A, pid)).toBe(0);

      // Delete the log — this both reverses the deduction and clears the
      // "outstanding deduction" condition.
      const deleteRes = await request(app).delete(
        `/api/inspections/${inspectionId}/treatment-logs/${logRes.body.id}`,
      );
      expect(deleteRes.status).toBe(204);
      expect(await getTechQty(companyAId, TECH_A, pid)).toBe(3);

      // Now zero the balance out via baseline (no outstanding deduction remains)
      // and confirm the unit switch is permitted.
      const rezero = await request(app)
        .post("/api/technician/inventory/baseline")
        .set("Content-Type", "application/json")
        .send({ items: [{ productId: pid, quantityOnHand: 0, unit: "fl oz" }] });
      expect(rezero.status).toBe(201);

      const switchAllowed = await request(app)
        .patch(`/api/technician/inventory/${pid}`)
        .set("Content-Type", "application/json")
        .send({ quantityOnHand: 5, unit: "gallon" });
      expect(switchAllowed.status).toBe(200);
      expect(await getTechQty(companyAId, TECH_A, pid)).toBe(5);
    } finally {
      await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.productId, pid));
      await withLedgerMutationBypass((tx) =>
        tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.productId, pid)),
      );
      await db.delete(techInventoryTable).where(eq(techInventoryTable.productId, pid));
      await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, pid));
      await db.delete(productsTable).where(eq(productsTable.id, pid));
    }
  });
});

describe("GET /manager/inventory-transactions", () => {
  it("returns only the caller's company's transactions, filterable by technicianId", async () => {
    asUser(OWNER_A);
    const res = await request(app).get("/api/manager/inventory-transactions");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      // No leakage: every movement type observed belongs to a movement we created for company A.
      expect([
        "warehouse_receipt",
        "warehouse_to_truck_transfer",
        "truck_receipt",
        "truck_deduction",
        "truck_deduction_reversal",
        "truck_adjustment",
      ]).toContain(row.movementType);
    }

    const filtered = await request(app).get(
      `/api/manager/inventory-transactions?technicianId=${encodeURIComponent(TECH_A)}`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.every((r: { technicianId: string | null }) => r.technicianId === TECH_A)).toBe(true);
  });

  it("company B sees no transactions from company A", async () => {
    asUser(OWNER_B);
    const res = await request(app).get("/api/manager/inventory-transactions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("Replenishment targets — technician+product combined override", () => {
  it("upserts and clears the most-specific override, and GET reports it in combinedOverrides only", async () => {
    asUser(OWNER_A);

    const putRes = await request(app)
      .put(`/api/manager/replenishment-targets/technician/${encodeURIComponent(TECH_A)}/product/${productId}`)
      .set("Content-Type", "application/json")
      .send({ daysOfSupply: 4.5 });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({ technicianId: TECH_A, productId, daysOfSupply: 4.5 });

    const getRes = await request(app).get("/api/manager/replenishment-targets");
    expect(getRes.status).toBe(200);
    const combined = getRes.body.combinedOverrides.find(
      (r: { technicianId: string; productId: number }) => r.technicianId === TECH_A && r.productId === productId,
    );
    expect(combined).toBeDefined();
    expect(combined.daysOfSupply).toBe(4.5);
    // Must not also appear as a technician-only or product-only override.
    expect(
      getRes.body.technicianOverrides.some((r: { technicianId: string }) => r.technicianId === TECH_A),
    ).toBe(false);
    expect(getRes.body.productOverrides.some((r: { productId: number }) => r.productId === productId)).toBe(
      false,
    );

    const deleteRes = await request(app).delete(
      `/api/manager/replenishment-targets/technician/${encodeURIComponent(TECH_A)}/product/${productId}`,
    );
    expect(deleteRes.status).toBe(200);

    const getAfter = await request(app).get("/api/manager/replenishment-targets");
    expect(
      getAfter.body.combinedOverrides.some(
        (r: { technicianId: string; productId: number }) => r.technicianId === TECH_A && r.productId === productId,
      ),
    ).toBe(false);
  });

  it("rejects a combined override for a technician or product outside the caller's company", async () => {
    asUser(OWNER_A);
    const res = await request(app)
      .put(`/api/manager/replenishment-targets/technician/${encodeURIComponent(TECH_B)}/product/${productId}`)
      .set("Content-Type", "application/json")
      .send({ daysOfSupply: 2 });
    expect(res.status).toBe(404);
  });
});

describe("Concurrency — no first-row race between opposite-unit writers", () => {
  // Each test in this block uses its own throwaway product so a losing
  // request's rejection can be asserted precisely against a known starting
  // state, independent of the other tests' timing.

  async function makeProduct(epa: string) {
    const [p] = await db
      .insert(productsTable)
      .values({
        name: `Concurrency Test Product ${epa}`,
        epaRegistrationNumber: epa,
        productType: "general-use",
        activeIngredients: "Test ingredient 1%",
        isActive: true,
      })
      .returning();
    // Treatment-log creation requires a label-rules row to exist for the
    // product (used for rate/pest/site validation), even when this test only
    // exercises the inventory-deduction side effect.
    await db.insert(productLabelRulesTable).values({
      productId: p!.id,
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
    return p!.id;
  }

  async function cleanupProduct(id: number) {
    await withLedgerMutationBypass((tx) =>
      tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.productId, id)),
    );
    await db.delete(techRestockEventsTable).where(eq(techRestockEventsTable.productId, id));
    await db.delete(warehouseInventoryTable).where(eq(warehouseInventoryTable.productId, id));
    await db.delete(techInventoryTable).where(eq(techInventoryTable.productId, id));
    await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, id));
    await db.delete(productsTable).where(eq(productsTable.id, id));
  }

  it("two simultaneous first receipts in different units: exactly one succeeds, balance never mixes units", async () => {
    asUser(OWNER_A);
    const pid = await makeProduct("WH-CONC-001");
    try {
      const [resA, resB] = await Promise.all([
        request(app)
          .post("/api/manager/warehouse/receive")
          .set("Content-Type", "application/json")
          .send({ productId: pid, quantity: 10, unit: "gallon" }),
        request(app)
          .post("/api/manager/warehouse/receive")
          .set("Content-Type", "application/json")
          .send({ productId: pid, quantity: 100, unit: "fl oz" }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const [row] = await db
        .select()
        .from(warehouseInventoryTable)
        .where(and(eq(warehouseInventoryTable.companyId, companyAId), eq(warehouseInventoryTable.productId, pid)));
      expect(row).toBeDefined();
      // Whichever request won, its own quantity was applied cleanly — never a
      // mix of the two (e.g. never 110, which would mean both writers' raw
      // quantities landed on a single unit).
      expect(row!.quantityOnHand === 10 || row!.quantityOnHand === 100).toBe(true);
      expect(row!.unit === "gallon" || row!.unit === "fl oz").toBe(true);

      const ledgerRows = await getLedgerRows(companyAId, "warehouse_receipt");
      const forThisProduct = ledgerRows.filter((r) => r.productId === pid);
      expect(forThisProduct).toHaveLength(1);
    } finally {
      await cleanupProduct(pid);
    }
  });

  it("two simultaneous first restock-events for the same tech in different units: exactly one succeeds", async () => {
    asUser(TECH_A);
    const pid = await makeProduct("WH-CONC-002");
    try {
      const [resA, resB] = await Promise.all([
        request(app)
          .post("/api/technician/inventory/restock-events")
          .set("Content-Type", "application/json")
          .send({ productId: pid, quantityReceived: 1, unit: "gallon", source: "manual" }),
        request(app)
          .post("/api/technician/inventory/restock-events")
          .set("Content-Type", "application/json")
          .send({ productId: pid, quantityReceived: 128, unit: "fl oz", source: "manual" }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const qty = await getTechQty(companyAId, TECH_A, pid);
      expect(qty === 1 || qty === 128).toBe(true);
    } finally {
      await cleanupProduct(pid);
    }
  });

  it("races a treatment-log deduction against a PATCH absolute-set without a lost update or a mismatched ledger delta", async () => {
    const pid = await makeProduct("WH-CONC-004");
    try {
      const INITIAL = 20;
      asUser(TECH_A);
      await request(app)
        .patch(`/api/technician/inventory/${pid}`)
        .set("Content-Type", "application/json")
        .send({ quantityOnHand: INITIAL, unit: "fl oz" });

      // Clear the ledger row from that setup PATCH so the replay below starts
      // from a clean slate at INITIAL.
      await withLedgerMutationBypass((tx) =>
        tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.productId, pid)),
      );

      const [treatmentRes, patchRes] = await Promise.all([
        request(app)
          .post(`/api/inspections/${inspectionId}/treatment-logs`)
          .set("Content-Type", "application/json")
          .send({
            productId: pid,
            targetPest: "cockroach",
            siteClassification: "residential_interior",
            environmentalWarningAcknowledged: false,
            totalProductOz: 5,
          }),
        request(app)
          .patch(`/api/technician/inventory/${pid}`)
          .set("Content-Type", "application/json")
          .send({ quantityOnHand: 100 }),
      ]);

      expect(treatmentRes.status).toBe(201);
      expect(patchRes.status).toBe(200);

      const finalQty = (await getTechQty(companyAId, TECH_A, pid))!;
      const ledgerRows = (await getLedgerRows(companyAId))
        .filter((r) => r.productId === pid)
        .sort((a, b) => a.id - b.id);

      // Regardless of which request's transaction won the shared advisory
      // lock first, replaying the ledger rows in commit order from INITIAL
      // must land exactly on the final balance. Before the fix, PATCH could
      // read a stale "before" quantity concurrently with the deduction and
      // record a delta that didn't match what was actually applied.
      const replayed = ledgerRows.reduce((balance, row) => {
        if (row.movementType === "truck_deduction") return balance - row.quantity;
        if (row.movementType === "truck_adjustment") {
          return row.destination === `truck:${TECH_A}` ? balance + row.quantity : balance - row.quantity;
        }
        throw new Error(`unexpected movement type in this test: ${row.movementType}`);
      }, INITIAL);

      expect(replayed).toBe(finalQty);
    } finally {
      await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.productId, pid));
      await db
        .delete(techInventoryTable)
        .where(and(eq(techInventoryTable.companyId, companyAId), eq(techInventoryTable.productId, pid)));
      await cleanupProduct(pid);
    }
  });

  it("two simultaneous transfers for the same warehouse balance can't both succeed past what's on hand", async () => {
    asUser(OWNER_A);
    const pid = await makeProduct("WH-CONC-003");
    try {
      await request(app)
        .post("/api/manager/warehouse/receive")
        .set("Content-Type", "application/json")
        .send({ productId: pid, quantity: 10, unit: "fl oz" });

      const [resA, resB] = await Promise.all([
        request(app)
          .post("/api/manager/warehouse/transfer")
          .set("Content-Type", "application/json")
          .send({ technicianId: TECH_A, productId: pid, quantity: 8 }),
        request(app)
          .post("/api/manager/warehouse/transfer")
          .set("Content-Type", "application/json")
          .send({ technicianId: TECH_A, productId: pid, quantity: 8 }),
      ]);

      // 10 on hand, two requests for 8 each: at most one can succeed.
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const warehouseQty = await getWarehouseQty(companyAId, pid);
      expect(warehouseQty).toBe(2);
      const truckQty = await getTechQty(companyAId, TECH_A, pid);
      expect(truckQty).toBe(8);
    } finally {
      await db
        .delete(techInventoryTable)
        .where(and(eq(techInventoryTable.companyId, companyAId), eq(techInventoryTable.productId, pid)));
      await cleanupProduct(pid);
    }
  });
});
