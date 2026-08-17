import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Cross-tenant isolation test for GET /api/executive/velocity-detail (Task #365).
 *
 * Verifies that a token from Company A cannot see Company B's completed
 * inspections through the velocity-detail endpoint, and vice versa.
 *
 * Uses dedicated company slugs ("vel-co-a" / "vel-co-b") so this file
 * never interferes with fixtures in other executive test files.
 */

// ── Clerk mock (same pattern as every other executive test) ────────────────────

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

vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) { return url; }
    async getObjectEntityFile(_path: string) { return {} as never; }
    async downloadObject() {
      return new Response("file-bytes", {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
  }
  return { ...actual, ObjectStorageService };
});

vi.mock("../lib/intelligence-ai", () => ({
  generateAiPrediction: vi.fn(async () => ({
    category: "pest",
    subcategory: "cockroach",
    confidence: 0.8,
    tags: [],
    possiblePest: "German cockroach",
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: "Apply gel bait",
    rationale: "Visible roach near harborage",
  })),
  fallbackPrediction: () => ({
    category: null,
    subcategory: null,
    confidence: 0,
    tags: [],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: null,
  }),
}));

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Fixture constants ──────────────────────────────────────────────────────────

const VEL_OWNER_A   = "vel_owner_a_clerk_id";
const VEL_OWNER_B   = "vel_owner_b_clerk_id";
const VEL_TECH_A    = "vel_tech_a_clerk_id";

const VEL_CO_A_SLUG = "vel-co-a";
const VEL_CO_B_SLUG = "vel-co-b";

/** A completedAt timestamp firmly inside the current calendar month (UTC). */
function thisMonthDate(): Date {
  const now = new Date();
  // Use the 2nd of the current month to stay safely within bounds
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 10, 0, 0));
}

/** A completedAt timestamp firmly inside the previous calendar month (UTC). */
function lastMonthDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 2, 10, 0, 0));
}

let velCompanyAId: number;
let velCompanyBId: number;

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

async function ensureActiveBranding(companyId: number, companyName: string) {
  const [existing] = await db
    .select()
    .from(brandingProfilesTable)
    .where(eq(brandingProfilesTable.companyId, companyId));
  if (!existing) {
    await db.insert(brandingProfilesTable).values({
      ...READYLOQ_DEFAULT_PROFILE,
      companyName,
      companyId,
      isDefault: true,
      isActive: true,
    });
  }
}

// ── One-time setup ─────────────────────────────────────────────────────────────

/**
 * Fixture layout:
 *
 * Co A — 3 inspections completed this month, 1 completed last month, 1 pending
 * Co B — 2 inspections completed this month
 *
 * With month=current:
 *   Co A owner should see exactly 3 rows (all from Co A)
 *   Co B owner should see exactly 2 rows (all from Co B)
 *   Zero rows from the other company must appear in either result.
 */
beforeAll(async () => {
  velCompanyAId = await findOrCreateCompany("Vel Test Co A", VEL_CO_A_SLUG);
  velCompanyBId = await findOrCreateCompany("Vel Test Co B", VEL_CO_B_SLUG);

  await ensureActiveBranding(velCompanyAId, "Vel Co A");
  await ensureActiveBranding(velCompanyBId, "Vel Co B");

  // Full idempotent teardown
  const companyIds = [velCompanyAId, velCompanyBId];
  await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, companyIds));
  for (const clerkId of [VEL_OWNER_A, VEL_OWNER_B, VEL_TECH_A]) {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, clerkId));
  }

  await db.insert(usersTable).values([
    { clerkUserId: VEL_OWNER_A, role: "owner",      companyId: velCompanyAId },
    { clerkUserId: VEL_OWNER_B, role: "owner",      companyId: velCompanyBId },
    { clerkUserId: VEL_TECH_A,  role: "technician", companyId: velCompanyAId },
  ]);

  const thisMonth  = thisMonthDate();
  const lastMonth  = lastMonthDate();

  // Co A: 3 completed this month + 1 completed last month + 1 pending this month
  await db.insert(inspectionsTable).values([
    {
      companyId:      velCompanyAId,
      siteAddress:    "1 Alpha St",
      technicianName: "Alice",
      clientName:     "Client A1",
      pestTypes:      [] as string[],
      status:         "completed",
      completedAt:    thisMonth,
    },
    {
      companyId:      velCompanyAId,
      siteAddress:    "2 Alpha St",
      technicianName: "Alice",
      clientName:     "Client A2",
      pestTypes:      [] as string[],
      status:         "completed",
      completedAt:    thisMonth,
    },
    {
      companyId:      velCompanyAId,
      siteAddress:    "3 Alpha St",
      technicianName: "Bob",
      clientName:     "Client A3",
      pestTypes:      [] as string[],
      status:         "completed",
      completedAt:    thisMonth,
    },
    // Completed last month — must NOT appear in month=current results
    {
      companyId:      velCompanyAId,
      siteAddress:    "4 Alpha St",
      technicianName: "Alice",
      clientName:     "Client A4",
      pestTypes:      [] as string[],
      status:         "completed",
      completedAt:    lastMonth,
    },
    // Pending (no completedAt) — must NOT appear regardless
    {
      companyId:      velCompanyAId,
      siteAddress:    "5 Alpha St",
      technicianName: "Bob",
      clientName:     "Client A5",
      pestTypes:      [] as string[],
      status:         "pending",
      completedAt:    null,
    },
  ]);

  // Co B: 2 completed this month
  await db.insert(inspectionsTable).values([
    {
      companyId:      velCompanyBId,
      siteAddress:    "1 Beta Rd",
      technicianName: "Charlie",
      clientName:     "Client B1",
      pestTypes:      [] as string[],
      status:         "completed",
      completedAt:    thisMonth,
    },
    {
      companyId:      velCompanyBId,
      siteAddress:    "2 Beta Rd",
      technicianName: "Charlie",
      clientName:     "Client B2",
      pestTypes:      [] as string[],
      status:         "completed",
      completedAt:    thisMonth,
    },
  ]);
});

beforeEach(() => {
  asUser(null);
});

// ── Auth & role guards ─────────────────────────────────────────────────────────

describe("GET /executive/velocity-detail — auth & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician", async () => {
    asUser(VEL_TECH_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when month param is invalid", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "next" });
    expect(res.status).toBe(400);
  });
});

// ── Cross-tenant isolation ─────────────────────────────────────────────────────

describe("GET /executive/velocity-detail — cross-tenant isolation", () => {
  /**
   * Co A: 3 completed this month (Alice ×2, Bob ×1)
   * Co B: 2 completed this month (Charlie ×2)
   *
   * Each owner must see only their own company's data.
   * "Charlie" must never appear in Co A's results.
   * "Alice" / "Bob" must never appear in Co B's results.
   */

  it("Co A owner sees exactly 3 inspections for the current month", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);
    expect(res.body.inspections).toHaveLength(3);
  });

  it("Co A owner sees zero rows from Co B (no Charlie)", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);

    const techNames = new Set<string>(
      res.body.inspections.map((r: { technicianName: string }) => r.technicianName),
    );
    expect(techNames.has("Charlie")).toBe(false);
  });

  it("Co B owner sees exactly 2 inspections for the current month", async () => {
    asUser(VEL_OWNER_B);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.inspections).toHaveLength(2);
  });

  it("Co B owner sees zero rows from Co A (no Alice or Bob)", async () => {
    asUser(VEL_OWNER_B);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);

    const techNames = new Set<string>(
      res.body.inspections.map((r: { technicianName: string }) => r.technicianName),
    );
    expect(techNames.has("Alice")).toBe(false);
    expect(techNames.has("Bob")).toBe(false);
  });

  it("all returned inspections for Co A belong to Co A addresses", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);

    for (const row of res.body.inspections) {
      expect(row.siteAddress).toMatch(/Alpha St/);
    }
  });

  it("all returned inspections for Co B belong to Co B addresses", async () => {
    asUser(VEL_OWNER_B);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);

    for (const row of res.body.inspections) {
      expect(row.siteAddress).toMatch(/Beta Rd/);
    }
  });
});

// ── Month filter correctness ───────────────────────────────────────────────────

describe("GET /executive/velocity-detail — month filter correctness", () => {
  /**
   * Co A has:
   *   3 completed this month
   *   1 completed last month
   *   1 pending (no completedAt)
   *
   * month=current → 3 rows
   * month=last    → 1 row
   */

  it("month=current returns only this-month completions (3 for Co A)", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.inspections).toHaveLength(3);
  });

  it("month=last returns only last-month completions (1 for Co A)", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "last" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.inspections).toHaveLength(1);
  });

  it("pending inspections are never included in velocity-detail results", async () => {
    asUser(VEL_OWNER_A);
    const [resCurrent, resLast] = await Promise.all([
      request(app).get("/api/executive/velocity-detail").query({ month: "current" }),
      request(app).get("/api/executive/velocity-detail").query({ month: "last" }),
    ]);

    expect(resCurrent.status).toBe(200);
    expect(resLast.status).toBe(200);

    // The pending inspection at "5 Alpha St" must never appear
    const allRows = [...resCurrent.body.inspections, ...resLast.body.inspections];
    for (const row of allRows) {
      expect(row.siteAddress).not.toBe("5 Alpha St");
    }
  });

  it("response shape includes success, month, label, count, and inspections array", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("month", "current");
    expect(res.body).toHaveProperty("label");
    expect(typeof res.body.label).toBe("string");
    expect(res.body).toHaveProperty("count");
    expect(Array.isArray(res.body.inspections)).toBe(true);
  });

  it("each inspection row contains inspectionId, siteAddress, technicianName, completedAt", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);
    expect(res.body.inspections.length).toBeGreaterThan(0);

    for (const row of res.body.inspections) {
      expect(row).toHaveProperty("inspectionId");
      expect(row).toHaveProperty("siteAddress");
      expect(row).toHaveProperty("technicianName");
      expect(row).toHaveProperty("completedAt");
    }
  });

  it("response includes a top-level technicians array", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.technicians)).toBe(true);
  });
});

// ── Technician filter ──────────────────────────────────────────────────────────

describe("GET /executive/velocity-detail — technician filter", () => {
  /**
   * Co A fixture (current month):
   *   Alice — 2 inspections ("1 Alpha St", "2 Alpha St")
   *   Bob   — 1 inspection  ("3 Alpha St")
   *
   * The filter must be case-insensitive and support partial substring matches.
   * The `technicians` array must always reflect the full unfiltered set for the
   * month, regardless of which filter is applied.
   */

  it("exact name match (Alice) returns only Alice's inspections", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "Alice" });

    expect(res.status).toBe(200);
    expect(res.body.inspections).toHaveLength(2);
    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Alice");
    }
  });

  it("filter is case-insensitive — 'alice' matches 'Alice'", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "alice" });

    expect(res.status).toBe(200);
    expect(res.body.inspections).toHaveLength(2);
    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Alice");
    }
  });

  it("partial name match — 'Al' matches 'Alice'", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "Al" });

    expect(res.status).toBe(200);
    expect(res.body.inspections.length).toBeGreaterThan(0);
    for (const row of res.body.inspections) {
      expect(row.technicianName.toLowerCase()).toContain("al");
    }
  });

  it("filter for Bob returns only Bob's inspection", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "Bob" });

    expect(res.status).toBe(200);
    expect(res.body.inspections).toHaveLength(1);
    expect(res.body.inspections[0].technicianName).toBe("Bob");
  });

  it("filter with no match returns an empty inspections array", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "Nobody" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inspections).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  it("technicians array is always the full unfiltered set — even when a filter is active", async () => {
    asUser(VEL_OWNER_A);

    // Fetch with filter applied
    const filtered = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "Alice" });

    expect(filtered.status).toBe(200);
    // Inspections are filtered to Alice only
    expect(filtered.body.inspections.every(
      (r: { technicianName: string }) => r.technicianName === "Alice"
    )).toBe(true);

    // But technicians[] still includes both Alice and Bob
    const techSet = new Set<string>(filtered.body.technicians);
    expect(techSet.has("Alice")).toBe(true);
    expect(techSet.has("Bob")).toBe(true);
  });

  it("filter is scoped to the requesting company — Co A owner cannot see Co B technicians", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "Charlie" });

    expect(res.status).toBe(200);
    // Charlie belongs to Co B — result must be empty
    expect(res.body.inspections).toHaveLength(0);
  });

  it("empty technicianName param is treated as no filter", async () => {
    asUser(VEL_OWNER_A);
    const res = await request(app)
      .get("/api/executive/velocity-detail")
      .query({ month: "current", technicianName: "   " });

    expect(res.status).toBe(200);
    // All 3 Co A this-month completions are returned
    expect(res.body.inspections).toHaveLength(3);
  });
});
