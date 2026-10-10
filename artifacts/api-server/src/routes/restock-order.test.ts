/**
 * Restock-order integration tests — Task #884
 *
 * Coverage:
 *  1. Approving an alert with an active Veseris connection places an order via
 *     the adapter and writes the order ref to supplier_orders (not to
 *     tech_restock_events — delivery is a separate event recorded by the CSV
 *     import route).
 *  2. The PATCH response body includes supplierOrderRef when an order is placed.
 *  3. A second PATCH /approve on the same alert (idempotent retry) returns the
 *     existing order ref without calling placeOrder() again.
 *  4. Approving when the supplier connection status is "pending" (not "active")
 *     resolves the alert without placing an order.
 *  5. Approving when no supplier connection exists resolves the alert cleanly.
 *  6. Adapter errors are logged but do not block alert resolution.
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

// ── Supplier-adapter mock ─────────────────────────────────────────────────────
//
// vi.mock factory is hoisted to the top of the file, so any variables it
// references must also be hoisted with vi.hoisted().

// Two distinct adapters (one per supplier) so a test can seed both Veseris
// and Target Specialty connections and confirm only the *winning* adapter's
// placeOrder() is invoked. createSupplierAdapter is mocked to dispatch on
// connection.supplierName, mirroring the real module's behavior.
const {
  mockPlaceOrder,
  mockVeserisPlaceOrder,
  mockTargetSpecialtyPlaceOrder,
  mockCreateSupplierAdapter,
} = vi.hoisted(() => {
  const mockVeserisPlaceOrder = vi.fn().mockResolvedValue({
    orderRef: "MOCK-VSR-20240101-ABCD1234",
    estimatedDeliveryDays: 5,
  });
  const mockTargetSpecialtyPlaceOrder = vi.fn().mockResolvedValue({
    orderRef: "MOCK-TSP-20240101-EFGH5678",
    estimatedDeliveryDays: 5,
  });
  const veserisAdapter = {
    checkStock:      vi.fn().mockResolvedValue({ available: true }),
    placeOrder:      mockVeserisPlaceOrder,
    getOrderStatus:  vi.fn().mockResolvedValue({ status: "pending" }),
    confirmDelivery: vi.fn().mockResolvedValue(undefined),
  };
  const targetSpecialtyAdapter = {
    checkStock:      vi.fn().mockResolvedValue({ available: true }),
    placeOrder:      mockTargetSpecialtyPlaceOrder,
    getOrderStatus:  vi.fn().mockResolvedValue({ status: "pending" }),
    confirmDelivery: vi.fn().mockResolvedValue(undefined),
  };
  const mockCreateSupplierAdapter = vi.fn((connection: { supplierName: string }) => {
    if (connection.supplierName === "veseris") return veserisAdapter;
    if (connection.supplierName === "target_specialty") return targetSpecialtyAdapter;
    return null;
  });
  // Back-compat alias — tests 1-5 below only ever seed a "veseris" connection
  // and refer to the adapter's placeOrder mock as `mockPlaceOrder`.
  return {
    mockPlaceOrder: mockVeserisPlaceOrder,
    mockVeserisPlaceOrder,
    mockTargetSpecialtyPlaceOrder,
    mockCreateSupplierAdapter,
  };
});

vi.mock("../lib/supplier-adapter", () => ({
  createSupplierAdapter: mockCreateSupplierAdapter,
}));

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
  supplierConnectionsTable,
  supplierOrdersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG    = "restock-order-test-co";
const TECH_ID = "restock_order_tech_001";
const MGR_ID  = "restock_order_mgr_001";

let companyId:   number;
let productId:   number;

// ── Auth helpers ──────────────────────────────────────────────────────────────

function asMgr() { authState.userId = MGR_ID; }

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

/**
 * Upsert a supplier connection and return its id. Accepts an optional explicit
 * `updatedAt` so tests can deterministically control which of several active
 * connections is "most recently updated" (the approve handler's tiebreaker).
 */
async function seedConnection(supplierName: string, status: string, updatedAt?: Date): Promise<number> {
  const ts = updatedAt ?? new Date();
  const [row] = await db
    .insert(supplierConnectionsTable)
    .values({
      companyId,
      supplierName,
      accountIdentifier: `acct-${supplierName}-test`,
      credentialsRef: `supplied:${Date.now()}`,
      status,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: [
        supplierConnectionsTable.companyId,
        supplierConnectionsTable.supplierName,
        supplierConnectionsTable.accountIdentifier,
      ],
      set: { status, updatedAt: ts },
    })
    .returning();
  return row.id;
}

/**
 * Seed an inventory row and insert a pending_restock_requests row directly.
 * Clears prior alert + supplier_orders rows for this tech+product so each test
 * starts from a clean state.
 */
async function seedAlert(quantityOnHand: number, restockThreshold: number): Promise<number> {
  // Remove any prior alert (cascades supplier_orders via the alert_id reference).
  const priorAlerts = await db.execute(
    sql`SELECT id FROM pending_restock_requests
        WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
  );
  for (const row of priorAlerts.rows) {
    const alertId = (row as { id: number }).id;
    await db.delete(supplierOrdersTable).where(
      and(eq(supplierOrdersTable.companyId, companyId), eq(supplierOrdersTable.alertId, alertId)),
    );
  }
  await db.execute(
    sql`DELETE FROM pending_restock_requests
        WHERE company_id = ${companyId} AND technician_id = ${TECH_ID} AND product_id = ${productId}`,
  );

  await db
    .insert(techInventoryTable)
    .values({ companyId, technicianId: TECH_ID, productId, quantityOnHand, unit: "fl oz", restockThreshold })
    .onConflictDoUpdate({
      target: [techInventoryTable.companyId, techInventoryTable.technicianId, techInventoryTable.productId],
      set: { quantityOnHand, unit: "fl oz", restockThreshold, updatedAt: new Date() },
    });

  const shortfall = restockThreshold - quantityOnHand;
  const [row] = await db.execute(
    sql`INSERT INTO pending_restock_requests
          (company_id, technician_id, product_id, quantity_on_hand, restock_threshold, shortfall, status)
        VALUES (${companyId}, ${TECH_ID}, ${productId}, ${quantityOnHand}, ${restockThreshold}, ${shortfall}, 'pending')
        RETURNING id`,
  ).then((r) => r.rows);
  return (row as { id: number }).id;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId = await findOrCreateCompany("Restock Order Test Co", SLUG);

  // Clean any leftover state.
  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, companyId));
  await db.execute(sql`DELETE FROM pending_restock_requests WHERE company_id = ${companyId}`);
  await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));

  // Users.
  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID, role: "technician", companyId },
    { clerkUserId: MGR_ID,  role: "manager",    companyId },
  ]);

  // Product.
  const [prod] = await db
    .insert(productsTable)
    .values({
      name: "Restock Order Test Product",
      epaRegistrationNumber: "ROT-TST-001",
      productType: "general-use",
      activeIngredients: "Test 1%",
      isActive: true,
    })
    .returning();
  productId = prod.id;

  // Empty label rules so treatment-log POST bypasses validation.
  await db.insert(productLabelRulesTable).values({
    productId,
    approvedPestTypes: [], approvedSiteClassifications: [], requiredEquipmentTypes: [],
    mixingSteps: [], maxRateOzPer1000Sqft: null, maxRateOzPerGallon: null,
    nozzleSpec: null, pressurePsi: null, dropletSize: null, maxTempF: null,
    phytotoxicityNotes: null, reEntryIntervalHours: null,
  });
});

afterAll(async () => {
  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, companyId));
  await db.execute(sql`DELETE FROM pending_restock_requests WHERE company_id = ${companyId}`);
  await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(techInventoryTable).where(eq(techInventoryTable.companyId, companyId));
  await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, productId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.slug, SLUG));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("approve restock alert — supplier order placement", () => {
  it("1. writes the order ref to supplier_orders when an active Veseris connection exists", async () => {
    mockPlaceOrder.mockResolvedValueOnce({ orderRef: "MOCK-VSR-20240101-ABCD1234" });
    await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
    await seedConnection("veseris", "active");
    const alertId = await seedAlert(3, 10); // shortfall = 7

    asMgr();
    const res = await request(app)
      .patch(`/api/manager/pending-restocks/${alertId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.supplierOrderRef).toBe("MOCK-VSR-20240101-ABCD1234");

    // Verify the supplier_orders row (order placement, not receipt).
    const [orderRow] = await db
      .select()
      .from(supplierOrdersTable)
      .where(and(eq(supplierOrdersTable.companyId, companyId), eq(supplierOrdersTable.alertId, alertId)));

    expect(orderRow).toBeDefined();
    expect(orderRow.orderRef).toBe("MOCK-VSR-20240101-ABCD1234");
    expect(orderRow.supplierName).toBe("veseris");
    expect(orderRow.quantityOrdered).toBeCloseTo(7);
    expect(orderRow.status).toBe("placed");
  });

  it("2. idempotent retry — returns existing order ref without calling placeOrder() again", async () => {
    // Use the already-approved alert from test 1.
    const priorAlerts = await db.execute(
      sql`SELECT id FROM pending_restock_requests
          WHERE company_id = ${companyId} AND status = 'approved'`,
    );
    expect(priorAlerts.rows.length).toBeGreaterThanOrEqual(1);
    const alertId = (priorAlerts.rows[0] as { id: number }).id;
    mockPlaceOrder.mockClear();

    asMgr();
    const res = await request(app)
      .patch(`/api/manager/pending-restocks/${alertId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.supplierOrderRef).toBe("MOCK-VSR-20240101-ABCD1234");
    // Must not have called placeOrder a second time.
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it("3. resolves the alert without placing an order when the connection is 'pending' (not active)", async () => {
    await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
    await seedConnection("veseris", "pending");
    const alertId = await seedAlert(2, 8);
    mockPlaceOrder.mockClear();

    asMgr();
    const res = await request(app)
      .patch(`/api/manager/pending-restocks/${alertId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.supplierOrderRef ?? null).toBeNull();
    expect(mockPlaceOrder).not.toHaveBeenCalled();

    // No supplier_orders row.
    const orders = await db
      .select()
      .from(supplierOrdersTable)
      .where(and(eq(supplierOrdersTable.companyId, companyId), eq(supplierOrdersTable.alertId, alertId)));
    expect(orders).toHaveLength(0);
  });

  it("4. resolves the alert cleanly when no supplier connection row exists", async () => {
    await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
    const alertId = await seedAlert(1, 5);
    mockPlaceOrder.mockClear();

    asMgr();
    const res = await request(app)
      .patch(`/api/manager/pending-restocks/${alertId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.supplierOrderRef ?? null).toBeNull();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it("5. adapter errors are logged but do not block alert resolution", async () => {
    await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
    await seedConnection("veseris", "active");
    const alertId = await seedAlert(4, 12);
    mockPlaceOrder.mockRejectedValueOnce(new Error("Simulated supplier API timeout"));

    asMgr();
    const res = await request(app)
      .patch(`/api/manager/pending-restocks/${alertId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    // No order ref because placement failed.
    expect(res.body.supplierOrderRef ?? null).toBeNull();
  });

  it("6. with both Veseris and Target Specialty active, orders through the most-recently-updated connection only", async () => {
    await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
    // Veseris configured first (older), Target Specialty configured second
    // (newer) — the approve handler's ORDER BY updated_at DESC should pick
    // Target Specialty.
    await seedConnection("veseris", "active", new Date(Date.now() - 60_000));
    await seedConnection("target_specialty", "active", new Date());
    const alertId = await seedAlert(2, 9); // shortfall = 7

    mockVeserisPlaceOrder.mockClear();
    mockTargetSpecialtyPlaceOrder.mockClear();

    asMgr();
    const res = await request(app)
      .patch(`/api/manager/pending-restocks/${alertId}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");

    // Exactly one adapter was invoked, and it was Target Specialty's.
    expect(mockTargetSpecialtyPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mockVeserisPlaceOrder).not.toHaveBeenCalled();

    // The winning supplier's order-ref prefix (TSP-) is what's returned...
    expect(res.body.supplierOrderRef).toBe("MOCK-TSP-20240101-EFGH5678");
    expect(res.body.supplierOrderRef).toMatch(/TSP-/);
    expect(res.body.supplierOrderRef).not.toMatch(/VSR-/);

    // ...and exactly one supplier_orders row exists for this alert, recording
    // the winning supplier and its order ref.
    const orderRows = await db
      .select()
      .from(supplierOrdersTable)
      .where(and(eq(supplierOrdersTable.companyId, companyId), eq(supplierOrdersTable.alertId, alertId)));

    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].supplierName).toBe("target_specialty");
    expect(orderRows[0].orderRef).toBe("MOCK-TSP-20240101-EFGH5678");
    expect(orderRows[0].orderRef).toMatch(/TSP-/);
  });
});
