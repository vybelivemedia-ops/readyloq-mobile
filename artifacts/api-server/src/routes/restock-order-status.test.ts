/**
 * Restock-order status integration tests — Task #894
 *
 * Coverage:
 *  1. GET /manager/restock-orders/:orderRef returns "pending" for a
 *     CSV-polling order that has not yet been confirmed via CSV import.
 *  2. Once the delivery CSV import writes a matching tech_restock_events row
 *     (source="csv_import", same supplier_order_ref), the same endpoint
 *     reports "delivered".
 *  3. Unknown orderRef (or one that belongs to another company) → 404.
 *  4. No active supplier connection for the order's supplier → 404.
 *  5. Technicians cannot call the manager-only route → 403.
 *  6. Tenant isolation: another company's manager cannot read this order.
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
  techRestockEventsTable,
  supplierConnectionsTable,
  supplierOrdersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG         = "restock-order-status-test-co";
const OTHER_SLUG    = "restock-order-status-other-co";
const TECH_ID       = "restock_status_tech_001";
const MGR_ID        = "restock_status_mgr_001";
const OTHER_MGR_ID  = "restock_status_other_mgr_001";

let companyId:      number;
let otherCompanyId: number;
let productId:      number;

// ── Auth helpers ──────────────────────────────────────────────────────────────

function asTech()     { authState.userId = TECH_ID; }
function asMgr()      { authState.userId = MGR_ID; }
function asOtherMgr() { authState.userId = OTHER_MGR_ID; }

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row!.id;
}

async function seedConnection(supplierName: string, status: string): Promise<void> {
  await db
    .insert(supplierConnectionsTable)
    .values({
      companyId,
      supplierName,
      accountIdentifier: `acct-${supplierName}-status-test`,
      credentialsRef: `supplied:${Date.now()}`,
      status,
    })
    .onConflictDoUpdate({
      target: [
        supplierConnectionsTable.companyId,
        supplierConnectionsTable.supplierName,
        supplierConnectionsTable.accountIdentifier,
      ],
      set: { status, updatedAt: new Date() },
    });
}

async function seedOrder(companyIdForOrder: number, orderRef: string, supplierName: string): Promise<void> {
  await db.insert(supplierOrdersTable).values({
    companyId: companyIdForOrder,
    alertId: Math.floor(Math.random() * 1_000_000_000),
    technicianId: TECH_ID,
    productId,
    supplierName,
    orderRef,
    quantityOrdered: 5,
    unit: "fl oz",
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId = await findOrCreateCompany("Restock Order Status Test Co", SLUG);
  otherCompanyId = await findOrCreateCompany("Restock Order Status Other Co", OTHER_SLUG);

  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, companyId));
  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, otherCompanyId));
  await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
  await db.delete(techRestockEventsTable).where(eq(techRestockEventsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));

  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID, role: "technician", companyId },
    { clerkUserId: MGR_ID, role: "manager", companyId },
    { clerkUserId: OTHER_MGR_ID, role: "manager", companyId: otherCompanyId },
  ]);

  const [prod] = await db
    .insert(productsTable)
    .values({
      name: "Restock Order Status Test Product",
      epaRegistrationNumber: "ROST-TST-001",
      productType: "general-use",
      activeIngredients: "Test 1%",
      isActive: true,
    })
    .returning();
  productId = prod!.id;
});

afterAll(async () => {
  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, companyId));
  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, otherCompanyId));
  await db.delete(supplierConnectionsTable).where(eq(supplierConnectionsTable.companyId, companyId));
  await db.delete(techRestockEventsTable).where(eq(techRestockEventsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(companiesTable).where(eq(companiesTable.slug, SLUG));
  await db.delete(companiesTable).where(eq(companiesTable.slug, OTHER_SLUG));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /manager/restock-orders/:orderRef", () => {
  it("1. returns 'pending' before the delivery CSV has been imported", async () => {
    const orderRef = "VSR-STATUS-PENDING-0001";
    await seedConnection("veseris", "active");
    await seedOrder(companyId, orderRef, "veseris");

    asMgr();
    const res = await request(app).get(`/api/manager/restock-orders/${orderRef}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(res.body.orderRef).toBe(orderRef);
    expect(res.body.supplierName).toBe("veseris");
  });

  it("2. returns 'delivered' once a matching csv_import restock event exists", async () => {
    const orderRef = "VSR-STATUS-DELIVERED-0002";
    await seedConnection("veseris", "active");
    await seedOrder(companyId, orderRef, "veseris");

    await db.insert(techRestockEventsTable).values({
      companyId,
      technicianId: TECH_ID,
      productId,
      quantityReceived: 5,
      unit: "fl oz",
      source: "csv_import",
      supplierOrderRef: orderRef,
      receivedAt: new Date(),
    });

    asMgr();
    const res = await request(app).get(`/api/manager/restock-orders/${orderRef}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("delivered");
    expect(res.body.deliveredAt).toBeDefined();
  });

  it("3. returns 404 for an unknown orderRef", async () => {
    asMgr();
    const res = await request(app).get("/api/manager/restock-orders/NOPE-DOES-NOT-EXIST");
    expect(res.status).toBe(404);
  });

  it("4. returns 404 when the order's supplier has no active connection", async () => {
    const orderRef = "TSP-STATUS-NOCONN-0003";
    await db
      .delete(supplierConnectionsTable)
      .where(and(eq(supplierConnectionsTable.companyId, companyId), eq(supplierConnectionsTable.supplierName, "target_specialty")));
    await seedOrder(companyId, orderRef, "target_specialty");

    asMgr();
    const res = await request(app).get(`/api/manager/restock-orders/${orderRef}`);
    expect(res.status).toBe(404);
  });

  it("5. rejects a technician with 403 (manager-only route)", async () => {
    const orderRef = "VSR-STATUS-ROLE-0004";
    await seedConnection("veseris", "active");
    await seedOrder(companyId, orderRef, "veseris");

    asTech();
    const res = await request(app).get(`/api/manager/restock-orders/${orderRef}`);
    expect(res.status).toBe(403);
  });

  it("6. another company's manager cannot read this order (tenant isolation)", async () => {
    const orderRef = "VSR-STATUS-TENANT-0005";
    await seedConnection("veseris", "active");
    await seedOrder(companyId, orderRef, "veseris");

    asOtherMgr();
    const res = await request(app).get(`/api/manager/restock-orders/${orderRef}`);
    expect(res.status).toBe(404);
  });
});
