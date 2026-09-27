/**
 * Tech Activity — placed-order visibility tests — Task #894
 *
 * Coverage:
 *  1. A supplier order placed via supplier_orders (no receipt yet) shows up
 *     in the "ordered" stream of GET /manager/tech-activity/:userId, tagged
 *     source="supplier_api" so the portal can render a live status badge.
 *  2. Once a matching tech_restock_events row (source="csv_import") exists
 *     for that order_ref, the synthetic "placed" entry disappears — only the
 *     real receipt entry is shown, so the order never appears twice.
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
  supplierOrdersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG    = "tech-activity-order-test-co";
const TECH_ID = "tech_activity_order_tech_001";
const MGR_ID  = "tech_activity_order_mgr_001";

let companyId: number;
let productId: number;

function asMgr() {
  authState.userId = MGR_ID;
}

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row!.id;
}

beforeAll(async () => {
  companyId = await findOrCreateCompany("Tech Activity Order Test Co", SLUG);

  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, companyId));
  await db.delete(techRestockEventsTable).where(eq(techRestockEventsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));

  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID, role: "technician", companyId },
    { clerkUserId: MGR_ID, role: "manager", companyId },
  ]);

  const [prod] = await db
    .insert(productsTable)
    .values({
      name: "Tech Activity Order Test Product",
      epaRegistrationNumber: "TAOT-TST-001",
      productType: "general-use",
      activeIngredients: "Test 1%",
      isActive: true,
    })
    .returning();
  productId = prod!.id;
});

afterAll(async () => {
  await db.delete(supplierOrdersTable).where(eq(supplierOrdersTable.companyId, companyId));
  await db.delete(techRestockEventsTable).where(eq(techRestockEventsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(companiesTable).where(eq(companiesTable.slug, SLUG));
});

describe("GET /manager/tech-activity/:userId — placed orders", () => {
  it("1. shows a placed-but-unreceived order as a supplier_api ordered entry", async () => {
    const orderRef = "VSR-ACTIVITY-PLACED-0001";
    await db.insert(supplierOrdersTable).values({
      companyId,
      alertId: Math.floor(Math.random() * 1_000_000_000),
      technicianId: TECH_ID,
      productId,
      supplierName: "veseris",
      orderRef,
      quantityOrdered: 8,
      unit: "fl oz",
    });

    asMgr();
    const res = await request(app).get(`/api/manager/tech-activity/${TECH_ID}`);

    expect(res.status).toBe(200);
    const allOrdered = res.body.days.flatMap((d: { ordered: unknown[] }) => d.ordered);
    const entry = allOrdered.find(
      (e: { supplierOrderRef: string }) => e.supplierOrderRef === orderRef,
    );
    expect(entry).toBeDefined();
    expect(entry.source).toBe("supplier_api");
    expect(entry.quantityReceived).toBe(8);
    expect(String(entry.id)).toMatch(/^order-/);
  });

  it("2. drops the synthetic placed entry once a matching csv_import receipt exists", async () => {
    const orderRef = "VSR-ACTIVITY-DELIVERED-0002";
    await db.insert(supplierOrdersTable).values({
      companyId,
      alertId: Math.floor(Math.random() * 1_000_000_000),
      technicianId: TECH_ID,
      productId,
      supplierName: "veseris",
      orderRef,
      quantityOrdered: 3,
      unit: "fl oz",
    });
    await db.insert(techRestockEventsTable).values({
      companyId,
      technicianId: TECH_ID,
      productId,
      quantityReceived: 3,
      unit: "fl oz",
      source: "csv_import",
      supplierOrderRef: orderRef,
      receivedAt: new Date(),
    });

    asMgr();
    const res = await request(app).get(`/api/manager/tech-activity/${TECH_ID}`);

    expect(res.status).toBe(200);
    const allOrdered = res.body.days.flatMap((d: { ordered: unknown[] }) => d.ordered);
    const matches = allOrdered.filter(
      (e: { supplierOrderRef: string }) => e.supplierOrderRef === orderRef,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe("csv_import");
  });
});
