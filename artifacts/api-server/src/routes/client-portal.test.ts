import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Client Portal isolation tests (Task #409).
 *
 * Confirms that a property manager authenticated as Company A's client cannot
 * see Company B's data — even when both companies have inspections at the same
 * siteAddress. Three attack vectors are exercised:
 *
 *   1. GET /client/buildings/:address/inspections
 *   2. GET /client/buildings/:address/reports
 *   3. GET /client/buildings/:address/trends
 *
 * Additionally confirms that the /client/invites management endpoints require
 * an authenticated portal user with the "manager" role and are blocked for
 * unauthenticated callers or callers without that role (e.g. technicians).
 */

// ─── Clerk mock ───────────────────────────────────────────────────────────────

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

// Object-storage mock — not needed for client-portal reads, but app.ts wires
// it up globally so tests fail to mount without it.
vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) {
      return url;
    }
    async getObjectEntityFile(_path: string) {
      return {} as never;
    }
    async downloadObject() {
      return new Response("file-bytes");
    }
  }
  return { ...actual, ObjectStorageService };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  reportsTable,
  clientPortalAccessTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

// ─── Stable IDs ───────────────────────────────────────────────────────────────

// Company-portal users (owner / manager / technician) for Company A.
const CP_MANAGER_A  = "cp_mgr_a_clerk_id";
const CP_TECH_A     = "cp_tech_a_clerk_id";

// Property-manager Clerk IDs (client-portal users, not in usersTable).
const PM_USER_A     = "cp_pm_user_a_clerk_id"; // granted access under Company A
const PM_USER_B     = "cp_pm_user_b_clerk_id"; // granted access under Company B

// The shared siteAddress present in both companies.
const SHARED_ADDRESS = "42 Shared Blvd, Anytown";

// ─── State ────────────────────────────────────────────────────────────────────

let companyAId: number;
let companyBId: number;
let inspectionAId: number;
let inspectionBId: number;
let reportAId: number;
let reportBId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Both companies get a *completed* inspection at SHARED_ADDRESS with distinct
 * pest types so that trends isolation can be verified by checking which pest
 * types appear (or don't) in each PM's response.
 *
 *   Company A pest type: "ants"
 *   Company B pest type: "termites"
 *
 * Inspections are inserted directly so we can control status, completedAt, and
 * pestTypes without going through the full HTTP lifecycle.
 */
beforeAll(async () => {
  companyAId = await findOrCreateCompany("CP Test Co A", "cp-test-co-a");
  companyBId = await findOrCreateCompany("CP Test Co B", "cp-test-co-b");

  // Tear down any leftover fixtures from previous runs (FK-safe order).
  await db.delete(clientPortalAccessTable).where(
    inArray(clientPortalAccessTable.companyId, [companyAId, companyBId]),
  );
  await db.delete(reportsTable).where(
    inArray(reportsTable.companyId, [companyAId, companyBId]),
  );
  await db.delete(inspectionsTable).where(
    inArray(inspectionsTable.companyId, [companyAId, companyBId]),
  );
  for (const id of [CP_MANAGER_A, CP_TECH_A]) {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, id));
  }

  // Seed Company A and B portal users.
  await db.insert(usersTable).values([
    { clerkUserId: CP_MANAGER_A, role: "manager",    companyId: companyAId },
    { clerkUserId: CP_TECH_A,    role: "technician", companyId: companyAId },
  ]);

  const completedAt = new Date(); // within the last 12 months → appears in trends

  // Company A: completed inspection with pest type "ants".
  const [inspA] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech A",
      clientName: "Client A",
      status: "completed",
      pestTypes: ["ants"],
      completedAt,
    })
    .returning();
  inspectionAId = inspA.id;

  // Company B: completed inspection with pest type "termites" (different from A).
  const [inspB] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyBId,
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech B",
      clientName: "Client B",
      status: "completed",
      pestTypes: ["termites"],
      completedAt,
    })
    .returning();
  inspectionBId = inspB.id;

  // Seed an approved report for each company at the shared address.
  const [repA] = await db
    .insert(reportsTable)
    .values({
      companyId: companyAId,
      inspectionId: inspectionAId,
      title: "Report A",
      status: "approved",
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech A",
      inspectionDate: completedAt,
    })
    .returning();
  reportAId = repA.id;

  const [repB] = await db
    .insert(reportsTable)
    .values({
      companyId: companyBId,
      inspectionId: inspectionBId,
      title: "Report B",
      status: "approved",
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech B",
      inspectionDate: completedAt,
    })
    .returning();
  reportBId = repB.id;

  // Grant PM_USER_A access to the shared address under Company A only.
  await db.insert(clientPortalAccessTable).values({
    companyId: companyAId,
    clerkUserId: PM_USER_A,
    email: "pm-a@example.com",
    label: "PM User A",
    siteAddresses: [SHARED_ADDRESS],
  });

  // Grant PM_USER_B access to the shared address under Company B.
  await db.insert(clientPortalAccessTable).values({
    companyId: companyBId,
    clerkUserId: PM_USER_B,
    email: "pm-b@example.com",
    label: "PM User B",
    siteAddresses: [SHARED_ADDRESS],
  });
});

beforeEach(() => {
  asUser(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/client/me", () => {
  it("returns 401 when no clerk user is authenticated", async () => {
    const res = await request(app).get("/api/client/me");
    expect(res.status).toBe(401);
  });

  it("returns Company A's access record for PM_USER_A", async () => {
    asUser(PM_USER_A);
    const res = await request(app).get("/api/client/me");
    expect(res.status).toBe(200);
    expect(res.body.siteAddresses).toContain(SHARED_ADDRESS);
    expect(res.body.company.id).toBe(companyAId);
  });
});


describe("GET /api/client/buildings/:address/inspections — cross-company isolation", () => {
  it("PM_USER_A can retrieve inspections at the shared address (returns Company A's data)", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/inspections`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((i: any) => i.id);
    // Must include Company A's inspection.
    expect(ids).toContain(inspectionAId);
    // Must NEVER include Company B's inspection.
    expect(ids).not.toContain(inspectionBId);
  });

  it("PM_USER_B can retrieve inspections at the shared address (returns Company B's data)", async () => {
    asUser(PM_USER_B);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/inspections`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((i: any) => i.id);
    // Must include Company B's inspection.
    expect(ids).toContain(inspectionBId);
    // Must NEVER include Company A's inspection.
    expect(ids).not.toContain(inspectionAId);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/inspections`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an address not in the PM's access list", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent("999 Unknown St")}/inspections`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/client/buildings/:address/reports — cross-company isolation", () => {
  it("PM_USER_A sees only Company A's reports for the shared address", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/reports`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((r: any) => r.id);
    expect(ids).toContain(reportAId);
    expect(ids).not.toContain(reportBId);
  });

  it("PM_USER_B sees only Company B's reports for the shared address", async () => {
    asUser(PM_USER_B);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/reports`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((r: any) => r.id);
    expect(ids).toContain(reportBId);
    expect(ids).not.toContain(reportAId);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/reports`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an address not in the PM's access list", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent("999 Unknown St")}/reports`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/client/buildings/:address/trends — cross-company isolation", () => {
  /**
   * Company A's completed inspection has pest_types=["ants"].
   * Company B's completed inspection has pest_types=["termites"].
   *
   * Both are at the SAME siteAddress so a naive (un-scoped) query would merge
   * both companies' pest types in the result. A correct, isolated query returns
   * only the calling PM's company data.
   */
  /**
   * db.execute() in Drizzle/node-postgres returns a QueryResult object.
   * The route passes it directly to res.json(), so the serialized shape is:
   *   { pestTrends: { rows: [...], rowCount: N, ... }, inspectionCounts: { rows: [...], ... } }
   *
   * We normalise with asTrendRows() to handle both shapes defensively.
   */
  function asTrendRows(raw: any): any[] {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.rows)) return raw.rows;
    return [];
  }

  it("PM_USER_A trends contain 'ants' (Company A) and never 'termites' (Company B)", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/trends`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("pestTrends");
    expect(res.body).toHaveProperty("inspectionCounts");

    const pestTypes = asTrendRows(res.body.pestTrends).map((r: any) => r.pestType);
    // Must see Company A's pest type.
    expect(pestTypes).toContain("ants");
    // Must NOT see Company B's pest type — would indicate a cross-tenant data leak.
    expect(pestTypes).not.toContain("termites");

    // inspectionCounts must reflect only Company A's inspection (count = 1).
    const totalInspections = asTrendRows(res.body.inspectionCounts).reduce(
      (sum: number, r: any) => sum + Number(r.inspections),
      0,
    );
    expect(totalInspections).toBe(1);
  });

  it("PM_USER_B trends contain 'termites' (Company B) and never 'ants' (Company A)", async () => {
    asUser(PM_USER_B);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/trends`);
    expect(res.status).toBe(200);

    const pestTypes = asTrendRows(res.body.pestTrends).map((r: any) => r.pestType);
    // Must see Company B's pest type.
    expect(pestTypes).toContain("termites");
    // Must NOT see Company A's pest type.
    expect(pestTypes).not.toContain("ants");

    const totalInspections = asTrendRows(res.body.inspectionCounts).reduce(
      (sum: number, r: any) => sum + Number(r.inspections),
      0,
    );
    expect(totalInspections).toBe(1);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/trends`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an address not in the PM's access list", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent("999 Unknown St")}/trends`);
    expect(res.status).toBe(403);
  });
});

describe("/api/client/invites — manager-only access control", () => {
  it("POST /invites is blocked without authentication (401)", async () => {
    const res = await request(app)
      .post("/api/client/invites")
      .send({
        clerkUserId: "some-clerk-id",
        siteAddresses: [SHARED_ADDRESS],
      });
    expect(res.status).toBe(401);
  });

  it("POST /invites is blocked for a technician (403)", async () => {
    asUser(CP_TECH_A);
    const res = await request(app)
      .post("/api/client/invites")
      .send({
        clerkUserId: "some-clerk-id",
        siteAddresses: [SHARED_ADDRESS],
      });
    expect(res.status).toBe(403);
  });

  it("GET /invites is blocked without authentication (401)", async () => {
    const res = await request(app).get("/api/client/invites");
    expect(res.status).toBe(401);
  });

  it("GET /invites is blocked for a technician (403)", async () => {
    asUser(CP_TECH_A);
    const res = await request(app).get("/api/client/invites");
    expect(res.status).toBe(403);
  });

  it("DELETE /invites/:id is blocked without authentication (401)", async () => {
    const res = await request(app).delete("/api/client/invites/999");
    expect(res.status).toBe(401);
  });

  it("DELETE /invites/:id is blocked for a technician (403)", async () => {
    asUser(CP_TECH_A);
    const res = await request(app).delete("/api/client/invites/999");
    expect(res.status).toBe(403);
  });

  it("GET /invites succeeds for a manager and returns only Company A's records", async () => {
    asUser(CP_MANAGER_A);
    const res = await request(app).get("/api/client/invites");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All returned records must belong to Company A.
    for (const record of res.body) {
      expect(record.companyId).toBe(companyAId);
    }
    // PM_USER_B (under Company B) must not appear in Company A's invite list.
    const clerkIds: string[] = res.body.map((r: any) => r.clerkUserId);
    expect(clerkIds).not.toContain(PM_USER_B);
  });
});
