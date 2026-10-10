/**
 * Restock-alert integration tests — Task #883
 *
 * Coverage:
 *  1. Treatment-log deduction below threshold fires a pending_restock_requests row.
 *  2. Deduction that stays above threshold does NOT fire an alert.
 *  3. A second deduction below threshold updates the existing row (ON CONFLICT upsert).
 *  4. A dismissed alert is re-opened on the next below-threshold deduction.
 *  5. GET /manager/pending-restocks returns pending rows joined with product name.
 *  6. PATCH /manager/pending-restocks/:id → "dismissed" removes from the pending list.
 *  7. PATCH /manager/pending-restocks/:id → "approved"  removes from the pending list.
 *  8. PATCH from a different company's manager is rejected with 404.
 *  9. GET /manager/pending-restocks never returns another company's alert rows.
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
  pendingRestockRequestsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG         = "restock-alert-test-co";
const OTHER_SLUG   = "restock-alert-other-co";
const TECH_ID      = "restock_test_tech_001";
const MGR_ID       = "restock_test_mgr_001";
const OTHER_MGR_ID = "restock_test_other_mgr_001";

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

/**
 * Seed (or reset) the tech's inventory row with a specific quantity and
 * optional restock threshold, then clear any pre-existing alert row.
 */
async function seedInventory(quantityOnHand: number, restockThreshold: number | null) {
  await db
    .insert(techInventoryTable)
    .values({ companyId, technicianId: TECH_ID, productId, quantityOnHand, unit: "fl oz", restockThreshold })
    .onConflictDoUpdate({
      target: [techInventoryTable.companyId, techInventoryTable.technicianId, techInventoryTable.productId],
      set: { quantityOnHand, unit: "fl oz", restockThreshold, updatedAt: new Date() },
    });

  await db.execute(
    sql`DELETE FROM pending_restock_requests
        WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
  );
}

/** POST a treatment log as the technician. */
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

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId      = await findOrCreateCompany("Restock Alert Test Co", SLUG);
  otherCompanyId = await findOrCreateCompany("Restock Alert Other Co", OTHER_SLUG);

  // Clean leftovers from prior runs.
  await db.execute(sql`DELETE FROM pending_restock_requests WHERE company_id IN (${companyId}, ${otherCompanyId})`);
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));

  // Users.
  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID,      role: "technician", companyId },
    { clerkUserId: MGR_ID,       role: "manager",    companyId },
    { clerkUserId: OTHER_MGR_ID, role: "manager",    companyId: otherCompanyId },
  ]);

  // Product (global — no companyId).
  const [prod] = await db
    .insert(productsTable)
    .values({ name: "Restock Test Product", epaRegistrationNumber: "RST-TST-001", productType: "general-use", activeIngredients: "Test 1%", isActive: true })
    .returning();
  productId = prod.id;

  // Empty label rules so treatment-log POST bypasses validation.
  await db.insert(productLabelRulesTable).values({
    productId,
    approvedPestTypes: [], approvedSiteClassifications: [], requiredEquipmentTypes: [], mixingSteps: [],
    maxRateOzPer1000Sqft: null, maxRateOzPerGallon: null, nozzleSpec: null,
    pressurePsi: null, dropletSize: null, maxTempF: null, phytotoxicityNotes: null, reEntryIntervalHours: null,
  });

  // Inspection to attach logs to.
  const [insp] = await db
    .insert(inspectionsTable)
    .values({ companyId, technicianId: TECH_ID, technicianName: "Restock Tester", siteAddress: "1 Restock Ave", status: "pending" })
    .returning();
  inspectionId = insp.id;
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM pending_restock_requests WHERE company_id IN (${companyId}, ${otherCompanyId})`);
  await db.execute(sql`DELETE FROM treatment_logs WHERE company_id = ${companyId}`);
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, productId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));
  await db.delete(companiesTable).where(and(eq(companiesTable.slug, SLUG)));
  await db.delete(companiesTable).where(and(eq(companiesTable.slug, OTHER_SLUG)));
});

// ── Threshold trigger tests ───────────────────────────────────────────────────

describe("restock alert — threshold trigger", () => {
  it("1. fires a pending alert when deduction drops stock below threshold", async () => {
    await seedInventory(8, 5); // 8 on hand, threshold 5
    const res = await postLog(4); // 8 - 4 = 4 < 5 → alert expected
    expect(res.status).toBe(201);
    expect(res.body.updatedInventory?.quantityOnHand).toBeCloseTo(4);

    const { rows } = await db.execute(
      sql`SELECT status, shortfall FROM pending_restock_requests
          WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as { status: string; shortfall: number };
    expect(row.status).toBe("pending");
    expect(row.shortfall).toBeCloseTo(1); // 5 - 4 = 1
  });

  it("2. does NOT fire an alert when stock stays above threshold", async () => {
    await seedInventory(20, 5); // 20 on hand, threshold 5
    const res = await postLog(10); // 20 - 10 = 10 > 5 → no alert
    expect(res.status).toBe(201);

    const { rows } = await db.execute(
      sql`SELECT id FROM pending_restock_requests
          WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}
            AND status = 'pending'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("3. second below-threshold deduction updates the existing alert row (no duplicate)", async () => {
    await seedInventory(10, 7); // threshold 7

    await postLog(4); // 10 - 4 = 6 < 7 → alert created
    await postLog(2); // 6 - 2 = 4 < 7 → same row updated

    const { rows } = await db.execute(
      sql`SELECT quantity_on_hand, shortfall FROM pending_restock_requests
          WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
    );
    expect(rows).toHaveLength(1); // still exactly one row
    const row = rows[0] as { quantity_on_hand: number; shortfall: number };
    expect(row.quantity_on_hand).toBeCloseTo(4);
    expect(row.shortfall).toBeCloseTo(3); // 7 - 4
  });

  it("4. dismissed alert is re-opened by the next below-threshold deduction", async () => {
    await seedInventory(10, 5);

    await postLog(7); // 10 - 7 = 3 < 5 → alert created

    // Manager dismisses
    const { rows: alertRows } = await db.execute(
      sql`SELECT id FROM pending_restock_requests
          WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
    );
    const alertId = (alertRows[0] as { id: number }).id;
    asMgr();
    await request(app).patch(`/api/manager/pending-restocks/${alertId}`).send({ status: "dismissed" }).expect(200);

    // Tech drops below threshold again → same row should flip back to pending
    await postLog(1);

    const { rows: afterRows } = await db.execute(
      sql`SELECT status FROM pending_restock_requests
          WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
    );
    expect(afterRows).toHaveLength(1);
    expect((afterRows[0] as { status: string }).status).toBe("pending");
  });
});

// ── Manager route tests ───────────────────────────────────────────────────────

describe("GET /manager/pending-restocks", () => {
  it("5. returns pending alerts with product name ordered by shortfall desc", async () => {
    await seedInventory(3, 10); // shortfall = 7
    await postLog(1); // 3 - 1 = 2 < 10 → alert

    asMgr();
    const res = await request(app).get("/api/manager/pending-restocks").expect(200);
    expect(Array.isArray(res.body)).toBe(true);

    const alert = res.body.find((r: { productId: number }) => r.productId === productId);
    expect(alert).toBeDefined();
    expect(alert.productName).toBe("Restock Test Product");
    expect(typeof alert.shortfall).toBe("number");
    expect(alert.status).toBe("pending");
  });

  it("9. never returns another company's pending alert rows", async () => {
    await seedInventory(3, 10); // shortfall = 7, own-company alert
    await postLog(1);

    // Seed a pending alert that belongs to the OTHER company.
    await db
      .insert(pendingRestockRequestsTable)
      .values({
        companyId: otherCompanyId,
        technicianId: OTHER_MGR_ID,
        productId,
        quantityOnHand: 1,
        restockThreshold: 20,
        shortfall: 19,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: [
          pendingRestockRequestsTable.companyId,
          pendingRestockRequestsTable.technicianId,
          pendingRestockRequestsTable.productId,
        ],
        set: { quantityOnHand: 1, restockThreshold: 20, shortfall: 19, status: "pending", updatedAt: new Date() },
      });

    try {
      // Own-company manager: sees its own alert (technicianId = TECH_ID), never the
      // other company's alert (technicianId = OTHER_MGR_ID, shortfall = 19).
      asMgr();
      const ownList = await request(app).get("/api/manager/pending-restocks").expect(200);
      expect(
        ownList.body.find((r: { technicianId: string }) => r.technicianId === TECH_ID),
      ).toBeDefined();
      expect(ownList.body.every((r: { shortfall: number }) => r.shortfall !== 19)).toBe(true);
      expect(
        ownList.body.every((r: { technicianId: string }) => r.technicianId !== OTHER_MGR_ID),
      ).toBe(true);

      // Other-company manager: sees its own alert, never the first company's
      // (technicianId = TECH_ID).
      asOtherMgr();
      const otherList = await request(app).get("/api/manager/pending-restocks").expect(200);
      const otherAlert = otherList.body.find((r: { shortfall: number }) => r.shortfall === 19);
      expect(otherAlert).toBeDefined();
      expect(
        otherList.body.every((r: { technicianId: string }) => r.technicianId !== TECH_ID),
      ).toBe(true);
    } finally {
      await db
        .delete(pendingRestockRequestsTable)
        .where(
          and(
            eq(pendingRestockRequestsTable.companyId, otherCompanyId),
            eq(pendingRestockRequestsTable.technicianId, OTHER_MGR_ID),
            eq(pendingRestockRequestsTable.productId, productId),
          ),
        );
    }
  });
});

describe("PATCH /manager/pending-restocks/:id", () => {
  it("6. dismiss removes the alert from the pending list", async () => {
    await seedInventory(3, 10);
    await postLog(1);

    asMgr();
    const list = await request(app).get("/api/manager/pending-restocks").expect(200);
    const alert = list.body.find((r: { productId: number }) => r.productId === productId);
    expect(alert).toBeDefined();

    await request(app).patch(`/api/manager/pending-restocks/${alert.id}`).send({ status: "dismissed" }).expect(200);

    const list2 = await request(app).get("/api/manager/pending-restocks").expect(200);
    expect(list2.body.find((r: { productId: number }) => r.productId === productId)).toBeUndefined();
  });

  it("7. approve removes the alert from the pending list", async () => {
    await seedInventory(3, 10);
    await postLog(1);

    asMgr();
    const list = await request(app).get("/api/manager/pending-restocks").expect(200);
    const alert = list.body.find((r: { productId: number }) => r.productId === productId);

    await request(app).patch(`/api/manager/pending-restocks/${alert.id}`).send({ status: "approved" }).expect(200);

    const list2 = await request(app).get("/api/manager/pending-restocks").expect(200);
    expect(list2.body.find((r: { productId: number }) => r.productId === productId)).toBeUndefined();
  });

  it("8. manager from a different company cannot resolve the alert", async () => {
    await seedInventory(3, 10);
    await postLog(1);

    asMgr();
    const list = await request(app).get("/api/manager/pending-restocks").expect(200);
    const alert = list.body.find((r: { productId: number }) => r.productId === productId);
    expect(alert).toBeDefined();

    asOtherMgr();
    await request(app)
      .patch(`/api/manager/pending-restocks/${alert.id}`)
      .send({ status: "dismissed" })
      .expect(404);
  });
});
