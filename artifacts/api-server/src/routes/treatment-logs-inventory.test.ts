/**
 * Treatment-log inventory deduction tests.
 *
 * Coverage:
 *  1. POST with totalProductOz deducts from tech_inventory; response carries updatedInventory
 *  2. Deduction is capped at 0 — stock never goes negative
 *  3. POST without totalProductOz returns updatedInventory: null (no deduction)
 *  4. POST when no inventory row exists for the tech returns updatedInventory: null (graceful)
 *  5. DELETE restores the deducted totalProductOz back onto tech_inventory
 *  6. DELETE of a log with null totalProductOz leaves stock unchanged
 */

import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
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
  usersTable,
  companiesTable,
  inspectionsTable,
  treatmentLogsTable,
  productsTable,
  productLabelRulesTable,
  techInventoryTable,
  inventoryTransactionsTable,
  errorEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { withLedgerMutationBypass } from "../test/ledger-bypass";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TECH_ID  = "inv_deduct_tech_clerk_id";
const TECH2_ID = "inv_deduct_tech2_clerk_id";  // no inventory row
const OWNER_ID = "inv_deduct_owner_clerk_id";
const SLUG     = "inv-deduct-test-co";

const START_QTY = 10; // fl oz in the baseline row

let companyId: number;
let inspectionId: number;
let testProductId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

beforeAll(async () => {
  companyId = await findOrCreateCompany("Inv Deduct Test Co", SLUG);

  // Clean prior runs.
  await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_ID, role: "owner",      companyId },
    { clerkUserId: TECH_ID,  role: "technician", companyId },
    { clerkUserId: TECH2_ID, role: "technician", companyId },
  ]);

  // Product with no validation constraints so POST flows straight through.
  // Products are global (no companyId column).
  const [product] = await db
    .insert(productsTable)
    .values({
      name:                  "Inv-Test Product",
      epaRegistrationNumber: "TEST-INV-001",
      productType:           "general-use",
      activeIngredients:     "Test ingredient 1%",
      isActive:              true,
    })
    .returning();
  testProductId = product.id;

  // Empty constraint arrays so the POST handler bypasses all label validations.
  await db.insert(productLabelRulesTable).values({
    productId:                   testProductId,
    approvedPestTypes:           [],
    approvedSiteClassifications: [],
    requiredEquipmentTypes:      [],
    mixingSteps:                 [],
    maxRateOzPer1000Sqft:        null,
    maxRateOzPerGallon:          null,
    nozzleSpec:                  null,
    pressurePsi:                 null,
    dropletSize:                 null,
    maxTempF:                    null,
    phytotoxicityNotes:          null,
    reEntryIntervalHours:        null,
  });

  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      technicianId:   TECH_ID,
      technicianName: "Inv Test Tech",
      siteAddress:    "1 Inv Test St",
      status:         "pending",
    })
    .returning();
  inspectionId = insp.id;
});

// Reset TECH_ID inventory to START_QTY before each test so deduction tests
// never bleed into each other.
beforeEach(async () => {
  await db
    .insert(techInventoryTable)
    .values({
      companyId,
      technicianId:    TECH_ID,
      productId:       testProductId,
      quantityOnHand:  START_QTY,
      unit:            "fl oz",
    })
    .onConflictDoUpdate({
      target: [
        techInventoryTable.companyId,
        techInventoryTable.technicianId,
        techInventoryTable.productId,
      ],
      set: { quantityOnHand: START_QTY, unit: "fl oz" },
    });

  // Make sure TECH2 has NO inventory row for this product.
  await db
    .delete(techInventoryTable)
    .where(
      and(
        eq(techInventoryTable.companyId,   companyId),
        eq(techInventoryTable.technicianId, TECH2_ID),
        eq(techInventoryTable.productId,   testProductId),
      ),
    );

  // Clear treatment logs written by previous tests.
  await db
    .delete(treatmentLogsTable)
    .where(eq(treatmentLogsTable.companyId, companyId));
});

afterAll(async () => {
  await db.delete(errorEventsTable).where(eq(errorEventsTable.companyId, companyId));
  await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  // Ledger rows written by the deduction/reversal wiring reference this
  // suite's product — clear them before the product itself. The ledger is
  // DB-enforced append-only (see migrate-ledger-immutability.ts), so this can
  // only happen via the sanctioned test-only bypass.
  await withLedgerMutationBypass((tx) =>
    tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.companyId, companyId)),
  );
  // Products are global; only delete the one this suite created.
  await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, testProductId));
  await db.delete(productsTable).where(eq(productsTable.id, testProductId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postLog(userId: string, body: Record<string, unknown>) {
  asUser(userId);
  return request(app)
    .post(`/api/inspections/${inspectionId}/treatment-logs`)
    .set("Content-Type", "application/json")
    .send(body);
}

function deleteLog(userId: string, logId: number) {
  asUser(userId);
  return request(app).delete(`/api/inspections/${inspectionId}/treatment-logs/${logId}`);
}

async function getInventoryQty(technicianId: string): Promise<number | undefined> {
  const [row] = await db
    .select()
    .from(techInventoryTable)
    .where(
      and(
        eq(techInventoryTable.companyId,    companyId),
        eq(techInventoryTable.technicianId, technicianId),
        eq(techInventoryTable.productId,    testProductId),
      ),
    );
  return row?.quantityOnHand;
}

const BASE_BODY = {
  productId:       0, // overridden in each test
  targetPest:      "cockroach",
  siteClassification: "residential_interior",
  environmentalWarningAcknowledged: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST treatment-log → inventory deduction", () => {
  it("deducts totalProductOz from tech_inventory and returns updatedInventory", async () => {
    const applyOz = 3;
    const res = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId:     testProductId,
      totalProductOz: applyOz,
    });

    expect(res.status).toBe(201);
    expect(res.body.updatedInventory).toMatchObject({
      productId:     testProductId,
      quantityOnHand: START_QTY - applyOz,   // 10 - 3 = 7
      unit:           "fl oz",
    });

    // Verify the DB row was actually updated.
    const [row] = await db
      .select()
      .from(techInventoryTable)
      .where(
        and(
          eq(techInventoryTable.companyId,   companyId),
          eq(techInventoryTable.technicianId, TECH_ID),
          eq(techInventoryTable.productId,   testProductId),
        ),
      );
    expect(row?.quantityOnHand).toBe(START_QTY - applyOz);
  });

  it("caps stock at 0 when applied oz exceed on-hand quantity", async () => {
    const applyOz = START_QTY + 5; // 15 oz — more than the 10 oz baseline
    const res = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId:      testProductId,
      totalProductOz: applyOz,
    });

    expect(res.status).toBe(201);
    expect(res.body.updatedInventory).toMatchObject({
      productId:      testProductId,
      quantityOnHand: 0,   // GREATEST(0, 10 - 15) = 0
      unit:           "fl oz",
    });

    const [row] = await db
      .select()
      .from(techInventoryTable)
      .where(
        and(
          eq(techInventoryTable.companyId,   companyId),
          eq(techInventoryTable.technicianId, TECH_ID),
          eq(techInventoryTable.productId,   testProductId),
        ),
      );
    expect(row?.quantityOnHand).toBe(0);
  });

  it("returns updatedInventory: null when totalProductOz is not provided", async () => {
    const res = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      // no totalProductOz
    });

    expect(res.status).toBe(201);
    expect(res.body.updatedInventory).toBeNull();

    // Stock should be unchanged.
    const [row] = await db
      .select()
      .from(techInventoryTable)
      .where(
        and(
          eq(techInventoryTable.companyId,   companyId),
          eq(techInventoryTable.technicianId, TECH_ID),
          eq(techInventoryTable.productId,   testProductId),
        ),
      );
    expect(row?.quantityOnHand).toBe(START_QTY);
  });

  it("returns updatedInventory: null when the technician has no inventory row for the product", async () => {
    const res = await postLog(TECH2_ID, {
      ...BASE_BODY,
      productId:      testProductId,
      totalProductOz: 3,
    });

    // The treatment log itself must still be created successfully.
    expect(res.status).toBe(201);
    expect(res.body.updatedInventory).toBeNull();
  });

  it("skips deduction and returns updatedInventory: null when inventory is tracked in a non-oz unit", async () => {
    // Override TECH_ID's inventory to use gallons instead of fl oz.
    // 1 gallon = 128 fl oz, so applying 3 fl oz should NOT reduce the gallon count.
    await db
      .insert(techInventoryTable)
      .values({
        companyId,
        technicianId:   TECH_ID,
        productId:      testProductId,
        quantityOnHand: 1,    // 1 gallon
        unit:           "gallon",
      })
      .onConflictDoUpdate({
        target: [
          techInventoryTable.companyId,
          techInventoryTable.technicianId,
          techInventoryTable.productId,
        ],
        set: { quantityOnHand: 1, unit: "gallon" },
      });

    const res = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId:      testProductId,
      totalProductOz: 3,  // would drop gallon count to 0 if units were ignored
    });

    expect(res.status).toBe(201);
    // No deduction — incompatible units must never silently corrupt the row.
    expect(res.body.updatedInventory).toBeNull();

    // Gallon count must be unchanged in the database.
    const [row] = await db
      .select()
      .from(techInventoryTable)
      .where(
        and(
          eq(techInventoryTable.companyId,    companyId),
          eq(techInventoryTable.technicianId, TECH_ID),
          eq(techInventoryTable.productId,    testProductId),
        ),
      );
    expect(row?.quantityOnHand).toBe(1);
    expect(row?.unit).toBe("gallon");
  });

  it("decrements inventory correctly across two sequential applications of the same product in one inspection", async () => {
    // Simulates a technician re-opening the wizard for a second application
    // of the same product in the same inspection. Each POST must read the
    // CURRENT on-hand balance (post first-deduction), not the original
    // baseline — this is the race the wizard's on-open inventory fetch is
    // vulnerable to under a slow network.
    const firstOz = 4;
    const first = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      totalProductOz: firstOz,
    });
    expect(first.status).toBe(201);
    expect(first.body.updatedInventory).toMatchObject({
      productId: testProductId,
      quantityOnHand: START_QTY - firstOz, // 10 - 4 = 6
      unit: "fl oz",
    });
    expect(await getInventoryQty(TECH_ID)).toBe(START_QTY - firstOz);

    const secondOz = 5;
    const second = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      totalProductOz: secondOz,
    });
    expect(second.status).toBe(201);
    const expectedAfterSecond = START_QTY - firstOz - secondOz; // 10 - 4 - 5 = 1
    expect(second.body.updatedInventory).toMatchObject({
      productId: testProductId,
      quantityOnHand: expectedAfterSecond, // must NOT be reset to START_QTY - secondOz
      unit: "fl oz",
    });
    expect(await getInventoryQty(TECH_ID)).toBe(expectedAfterSecond);

    // A third application whose cumulative usage would exceed on-hand stock
    // must floor at 0 — never dip negative — even after two prior deductions.
    const thirdOz = 10;
    const third = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      totalProductOz: thirdOz,
    });
    expect(third.status).toBe(201);
    expect(third.body.updatedInventory).toMatchObject({
      productId: testProductId,
      quantityOnHand: 0,
      unit: "fl oz",
    });
    expect(await getInventoryQty(TECH_ID)).toBe(0);
  });
});

describe("POST treatment-log → clamp warning event", () => {
  // The warning is logged via a fire-and-forget `void logErrorEvent(...)`
  // call after the transaction commits, so give it a brief window to land
  // before asserting on the error_events table.
  async function findClampEvent(): Promise<{ message: string } | undefined> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [row] = await db
        .select()
        .from(errorEventsTable)
        .where(
          and(
            eq(errorEventsTable.companyId, companyId),
            eq(errorEventsTable.category, "inventory"),
          ),
        )
        .orderBy(errorEventsTable.id)
        .limit(1);
      if (row) return row;
      await new Promise((r) => setTimeout(r, 25));
    }
    return undefined;
  }

  beforeEach(async () => {
    await db.delete(errorEventsTable).where(eq(errorEventsTable.companyId, companyId));
  });

  it("emits an inventory warning event (not an error) when applied oz exceeds on-hand stock", async () => {
    const applyOz = START_QTY + 5; // exceeds the 10 oz baseline — triggers the clamp
    const res = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      totalProductOz: applyOz,
    });

    // The treatment log must still succeed — this is a warning, not a
    // request-blocking error.
    expect(res.status).toBe(201);
    expect(res.body.updatedInventory).toMatchObject({ quantityOnHand: 0 });

    const event = await findClampEvent();
    expect(event).toBeDefined();
    expect(event!.message).toMatch(/Inv-Test Product/);
    expect(event!.message).toMatch(new RegExp(`${applyOz} fl oz`));
    expect(event!.message).toMatch(new RegExp(`${START_QTY} fl oz`));
  });

  it("does not emit a warning event when applied oz stays within on-hand stock", async () => {
    const res = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      totalProductOz: 3, // well under the 10 oz baseline
    });

    expect(res.status).toBe(201);

    // Give any (unexpected) fire-and-forget write a moment, then confirm none landed.
    await new Promise((r) => setTimeout(r, 100));
    const [row] = await db
      .select()
      .from(errorEventsTable)
      .where(
        and(
          eq(errorEventsTable.companyId, companyId),
          eq(errorEventsTable.category, "inventory"),
        ),
      );
    expect(row).toBeUndefined();
  });
});

describe("DELETE treatment-log → inventory restoration", () => {
  it("restores totalProductOz to tech_inventory after deleting the log", async () => {
    const applyOz = 3;
    const created = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId:      testProductId,
      totalProductOz: applyOz,
    });
    expect(created.status).toBe(201);
    expect(created.body.inventoryDeductedOz).toBe(applyOz);
    expect(await getInventoryQty(TECH_ID)).toBe(START_QTY - applyOz);

    const res = await deleteLog(TECH_ID, created.body.id);
    expect(res.status).toBe(204);

    expect(await getInventoryQty(TECH_ID)).toBe(START_QTY);
  });

  it("restores only the actually-deducted amount when the original deduction was capped at zero", async () => {
    // Apply more oz than the technician has on hand (START_QTY = 10) so the
    // POST handler's GREATEST(0, ...) floor kicks in and the actual deduction
    // (10) is smaller than the requested totalProductOz (15). Deleting the
    // log must restore exactly 10 — restoring 15 would inflate stock above
    // the technician's true pre-log balance.
    const applyOz = START_QTY + 5; // 15 oz requested, only 10 actually deducted
    const created = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId:      testProductId,
      totalProductOz: applyOz,
    });
    expect(created.status).toBe(201);
    expect(created.body.updatedInventory).toMatchObject({ quantityOnHand: 0 });
    expect(created.body.inventoryDeductedOz).toBe(START_QTY); // capped, not 15
    expect(await getInventoryQty(TECH_ID)).toBe(0);

    const res = await deleteLog(TECH_ID, created.body.id);
    expect(res.status).toBe(204);

    // Must return to the true pre-log balance (10), not 15.
    expect(await getInventoryQty(TECH_ID)).toBe(START_QTY);
  });

  it("leaves stock unchanged when deleting a log with null totalProductOz", async () => {
    const created = await postLog(TECH_ID, {
      ...BASE_BODY,
      productId: testProductId,
      // no totalProductOz
    });
    expect(created.status).toBe(201);
    expect(await getInventoryQty(TECH_ID)).toBe(START_QTY);

    const res = await deleteLog(TECH_ID, created.body.id);
    expect(res.status).toBe(204);

    expect(await getInventoryQty(TECH_ID)).toBe(START_QTY);
  });

  it("is a no-op when the technician has no inventory row for the product", async () => {
    const created = await postLog(TECH2_ID, {
      ...BASE_BODY,
      productId:      testProductId,
      totalProductOz: 3,
    });
    expect(created.status).toBe(201);
    expect(await getInventoryQty(TECH2_ID)).toBeUndefined();

    const res = await deleteLog(TECH2_ID, created.body.id);
    expect(res.status).toBe(204);

    // Still no inventory row — the UPDATE was a harmless no-op.
    expect(await getInventoryQty(TECH2_ID)).toBeUndefined();
  });

  it("returns 404 when the log does not exist", async () => {
    const res = await deleteLog(TECH_ID, 9_999_999);
    expect(res.status).toBe(404);
  });
});
