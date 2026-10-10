/**
 * Dual-Level Route Readiness — endpoint permission & scoping tests.
 *
 * Coverage:
 *  1. GET /technician/daily-rig/route-readiness — self lookup always allowed.
 *  2. GET /technician/daily-rig/route-readiness?technicianId=<other> — 403 for
 *     a plain technician, 200 for a manager.
 *  3. GET /technician/daily-rig/team-route-readiness — manager-only (403 for
 *     technician, 200 for manager), scoped to the caller's own company.
 *  4. GET /technician/inventory/stock-health — self lookup always allowed.
 *  5. GET /manager/team-stock-health — manager-only (403 for technician).
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
import { db, companiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

function asUser(id: string | null) {
  authState.userId = id;
}

const SLUG_A = "rr-endpoint-test-co-a";
const SLUG_B = "rr-endpoint-test-co-b";
const TECH_A1 = "rr_ep_tech_a1";
const TECH_A2 = "rr_ep_tech_a2";
const MANAGER_A = "rr_ep_manager_a";
const TECH_B = "rr_ep_tech_b";

let companyAId: number;
let companyBId: number;

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row!.id;
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("RR Endpoint Test Co A", SLUG_A);
  companyBId = await findOrCreateCompany("RR Endpoint Test Co B", SLUG_B);

  await Promise.all([
    db.insert(usersTable).values({ clerkUserId: TECH_A1, companyId: companyAId, role: "technician" }).onConflictDoNothing(),
    db.insert(usersTable).values({ clerkUserId: TECH_A2, companyId: companyAId, role: "technician" }).onConflictDoNothing(),
    db.insert(usersTable).values({ clerkUserId: MANAGER_A, companyId: companyAId, role: "manager" }).onConflictDoNothing(),
    db.insert(usersTable).values({ clerkUserId: TECH_B, companyId: companyBId, role: "technician" }).onConflictDoNothing(),
  ]);
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.companyId, companyAId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));
});

describe("GET /technician/daily-rig/route-readiness", () => {
  it("allows a technician to look up their own readiness", async () => {
    asUser(TECH_A1);
    const res = await request(app).get("/api/technician/daily-rig/route-readiness");
    expect(res.status).toBe(200);
    expect(res.body.technicianId).toBe(TECH_A1);
  });

  it("denies a plain technician looking up another technician", async () => {
    asUser(TECH_A1);
    const res = await request(app)
      .get("/api/technician/daily-rig/route-readiness")
      .query({ technicianId: TECH_A2 });
    expect(res.status).toBe(403);
  });

  it("allows a manager to look up another technician in their company", async () => {
    asUser(MANAGER_A);
    const res = await request(app)
      .get("/api/technician/daily-rig/route-readiness")
      .query({ technicianId: TECH_A1 });
    expect(res.status).toBe(200);
    expect(res.body.technicianId).toBe(TECH_A1);
  });
});

describe("GET /technician/daily-rig/team-route-readiness", () => {
  it("denies a plain technician", async () => {
    asUser(TECH_A1);
    const res = await request(app).get("/api/technician/daily-rig/team-route-readiness");
    expect(res.status).toBe(403);
  });

  it("allows a manager and scopes results to their own company's technicians", async () => {
    asUser(MANAGER_A);
    const res = await request(app).get("/api/technician/daily-rig/team-route-readiness");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ technicianId: string }>).map((r) => r.technicianId);
    expect(ids.sort()).toEqual([TECH_A1, TECH_A2].sort());
    expect(ids).not.toContain(TECH_B);
  });
});

describe("GET /technician/inventory/stock-health", () => {
  it("allows a technician to look up their own stock health", async () => {
    asUser(TECH_A1);
    const res = await request(app).get("/api/technician/inventory/stock-health");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe("GET /manager/team-stock-health", () => {
  it("denies a plain technician", async () => {
    asUser(TECH_A1);
    const res = await request(app).get("/api/manager/team-stock-health");
    expect(res.status).toBe(403);
  });

  it("allows a manager", async () => {
    asUser(MANAGER_A);
    const res = await request(app).get("/api/manager/team-stock-health");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
