import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Schedule calendar isolation tests (Task #402).
 *
 * The GET /api/schedule endpoint is gated by requireAuth + requireCompany, but
 * this suite explicitly confirms that a manager from company A cannot see
 * company B's inspections by manipulating the date range query, and that
 * PATCH /api/schedule/:id returns 404 for a cross-company reassignment attempt.
 */

// ─── Clerk mock (same pattern as isolation.test.ts) ───────────────────────────

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

// ─── Object storage stub ──────────────────────────────────────────────────────

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
      return new Response("file-bytes", {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
  }
  return { ...actual, ObjectStorageService };
});

// ─── App + DB imports (after all mocks are in place) ─────────────────────────

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Test actors ──────────────────────────────────────────────────────────────

const SCH_OWNER_A = "sch_owner_a_clerk";
const SCH_OWNER_B = "sch_owner_b_clerk";

let companyAId: number;
let companyBId: number;

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

async function seedActiveBranding(companyId: number, companyName: string) {
  const [existing] = await db
    .select()
    .from(brandingProfilesTable)
    .where(
      and(
        eq(brandingProfilesTable.companyId, companyId),
        eq(brandingProfilesTable.isActive, true),
      ),
    );
  if (existing) return;
  await db.insert(brandingProfilesTable).values({
    ...READYLOQ_DEFAULT_PROFILE,
    companyName,
    companyId,
    isDefault: true,
    isActive: true,
  });
}

/** Create an inspection via the API and return the body. */
async function createInspection(
  ownerId: string,
  siteAddress: string,
  scheduledDate?: string,
) {
  asUser(ownerId);
  const body: Record<string, unknown> = {
    siteAddress,
    technicianName: "Tech",
    clientName: "Client",
    pestTypes: ["ants"],
  };
  if (scheduledDate) body.scheduledDate = scheduledDate;
  const res = await request(app).post("/api/inspections").send(body);
  asUser(null);
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Schedule Co A", "sch-co-a");
  companyBId = await findOrCreateCompany("Schedule Co B", "sch-co-b");

  await seedActiveBranding(companyAId, "Schedule Company A");
  await seedActiveBranding(companyBId, "Schedule Company B");

  // Clean up any leftover users from prior runs so inserts don't collide.
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, SCH_OWNER_A));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, SCH_OWNER_B));

  await db.insert(usersTable).values([
    { clerkUserId: SCH_OWNER_A, role: "owner", companyId: companyAId },
    { clerkUserId: SCH_OWNER_B, role: "owner", companyId: companyBId },
  ]);
});

beforeEach(() => {
  asUser(null);
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/schedule — date-range query must never return another company's rows
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/schedule — tenant isolation", () => {
  let inspAId: number;
  let inspBId: number;

  beforeAll(async () => {
    // Both inspections fall on the same date so a maximally permissive date
    // range cannot be used as an excuse to include company B's row.
    const inspA = await createInspection(SCH_OWNER_A, "10 Schedule Ave A");
    const inspB = await createInspection(SCH_OWNER_B, "10 Schedule Ave B");
    inspAId = inspA.id;
    inspBId = inspB.id;

    // Set explicit scheduledDates on both rows so the calendar date is
    // deterministic and the date-range filter is not the only guard.
    await db
      .update(inspectionsTable)
      .set({ scheduledDate: new Date("2030-06-15T10:00:00.000Z") })
      .where(eq(inspectionsTable.id, inspAId));

    await db
      .update(inspectionsTable)
      .set({ scheduledDate: new Date("2030-06-15T10:00:00.000Z") })
      .where(eq(inspectionsTable.id, inspBId));
  });

  it("returns company A's inspection and excludes company B's", async () => {
    asUser(SCH_OWNER_A);
    const res = await request(app)
      .get("/api/schedule")
      .query({ start: "2030-06-01", end: "2030-06-30" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ids: number[] = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(inspAId);
    expect(ids).not.toContain(inspBId);
  });

  it("returns company B's inspection and excludes company A's", async () => {
    asUser(SCH_OWNER_B);
    const res = await request(app)
      .get("/api/schedule")
      .query({ start: "2030-06-01", end: "2030-06-30" });

    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(inspBId);
    expect(ids).not.toContain(inspAId);
  });

  it("rejects unauthenticated requests with 401", async () => {
    asUser(null);
    const res = await request(app)
      .get("/api/schedule")
      .query({ start: "2030-06-01", end: "2030-06-30" });
    expect(res.status).toBe(401);
  });

  it("company B cannot see company A's inspection by widening the date range", async () => {
    // An adversary might try a very wide range hoping to sweep up more rows.
    asUser(SCH_OWNER_B);
    const res = await request(app)
      .get("/api/schedule")
      .query({ start: "2000-01-01", end: "2099-12-31" });

    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((e: { id: number }) => e.id);
    expect(ids).not.toContain(inspAId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /api/schedule/:id — cross-company reassignment must be blocked (404)
// ═════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/schedule/:id — cross-company reassignment is blocked", () => {
  let inspAId: number;

  beforeAll(async () => {
    const inspA = await createInspection(SCH_OWNER_A, "20 Patch Street A");
    inspAId = inspA.id;
  });

  it("returns 404 when company B tries to reassign company A's inspection", async () => {
    asUser(SCH_OWNER_B);
    const res = await request(app)
      .patch(`/api/schedule/${inspAId}`)
      .send({ technicianName: "Hijacked Tech" });

    expect(res.status).toBe(404);
  });

  it("company A's inspection is unchanged after the blocked reassignment attempt", async () => {
    asUser(SCH_OWNER_A);
    const res = await request(app)
      .get("/api/schedule")
      .query({ start: "2000-01-01", end: "2099-12-31" });

    expect(res.status).toBe(200);
    const entry = res.body.find((e: { id: number }) => e.id === inspAId);
    expect(entry).toBeDefined();
    // The technician name must still be the original "Tech", not "Hijacked Tech".
    expect(entry.technicianName).toBe("Tech");
  });

  it("returns 404 when company B tries to reschedule company A's inspection", async () => {
    asUser(SCH_OWNER_B);
    const res = await request(app)
      .patch(`/api/schedule/${inspAId}`)
      .send({ scheduledDate: "2030-07-01T09:00:00.000Z" });

    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated PATCH with 401", async () => {
    asUser(null);
    const res = await request(app)
      .patch(`/api/schedule/${inspAId}`)
      .send({ technicianName: "Anonymous" });

    expect(res.status).toBe(401);
  });

  it("allows company A to reassign its own inspection (sanity check)", async () => {
    asUser(SCH_OWNER_A);
    const res = await request(app)
      .patch(`/api/schedule/${inspAId}`)
      .send({ technicianName: "Updated Tech" });

    expect(res.status).toBe(200);
    expect(res.body.technicianName).toBe("Updated Tech");
    expect(res.body.id).toBe(inspAId);
  });
});
