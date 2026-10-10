import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Pagination tests for GET /api/executive/inspections (Task #313).
 *
 * Verifies:
 *  - total count matches real row count (not capped at PAGE_SIZE)
 *  - offset advances through pages without duplicates or gaps
 *  - hasMore flips to false on the final page
 *  - technicianName and since filters are applied to BOTH the data query
 *    and the parallel count query
 *  - cross-tenant isolation: a second company's scorecards never appear
 *    in the count or results
 *
 * Uses dedicated company slugs ("pag-co-a" / "pag-co-b") so this file
 * never interferes with the fixtures in executive.test.ts.
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
  inspectionScorecardsTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Fixture constants ──────────────────────────────────────────────────────────

const PAG_OWNER_A   = "pag_owner_a_clerk_id";
const PAG_OWNER_B   = "pag_owner_b_clerk_id";
const PAG_TECH_A    = "pag_tech_a_clerk_id";   // role=technician → 403 on owner routes

const PAG_CO_A_SLUG = "pag-co-a";
const PAG_CO_B_SLUG = "pag-co-b";

/** PAGE_SIZE must match the constant in executive.ts (currently 100). */
const PAGE_SIZE = 100;

/**
 * Fixture design for Co A "high" risk scorecards (total = 105):
 *  - 60 scored by "Alice":  50 with OLD updatedAt, 10 with NOW updatedAt
 *  - 45 scored by "Bob":   all with NOW updatedAt
 *
 * Additional scorecards for Co A:
 *  - 10 "low" risk (Alice) — must never appear when riskLevel=high
 *
 * Scorecards for Co B:
 *  - 10 "high" risk (Charlie) — must never appear in Co A's results
 *
 * The OLD_DATE is used to test the `since` filter boundary:
 *  - since >= SINCE_CUTOFF returns only the NOW batch (10 Alice + 45 Bob = 55)
 *  - since >= FUTURE_DATE returns nothing
 */
const OLD_DATE        = new Date("2024-01-01T00:00:00.000Z");
const SINCE_CUTOFF    = "2025-01-01";   // only NOW-dated rows pass this
const FUTURE_CUTOFF   = "2030-01-01";  // nothing passes this

const COMPONENTS = {
  photoCoverage: 60,
  evidenceQuality: 60,
  avgConfidence: 60,
  recommendationCoverage: 60,
};

let pagCompanyAId: number;
let pagCompanyBId: number;

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

beforeAll(async () => {
  pagCompanyAId = await findOrCreateCompany("Pag Test Co A", PAG_CO_A_SLUG);
  pagCompanyBId = await findOrCreateCompany("Pag Test Co B", PAG_CO_B_SLUG);

  await ensureActiveBranding(pagCompanyAId, "Pag Co A");
  await ensureActiveBranding(pagCompanyBId, "Pag Co B");

  // ── Full idempotent teardown ─────────────────────────────────────────────────
  const companyIds = [pagCompanyAId, pagCompanyBId];
  await db
    .delete(inspectionScorecardsTable)
    .where(inArray(inspectionScorecardsTable.companyId, companyIds));
  await db
    .delete(inspectionsTable)
    .where(inArray(inspectionsTable.companyId, companyIds));

  for (const clerkId of [PAG_OWNER_A, PAG_OWNER_B, PAG_TECH_A]) {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, clerkId));
  }

  await db.insert(usersTable).values([
    { clerkUserId: PAG_OWNER_A, role: "owner",      companyId: pagCompanyAId },
    { clerkUserId: PAG_OWNER_B, role: "owner",      companyId: pagCompanyBId },
    { clerkUserId: PAG_TECH_A,  role: "technician", companyId: pagCompanyAId },
  ]);

  // ── Seed Co A inspections (115 = 60 Alice-high + 45 Bob-high + 10 Alice-low) ─
  const coAInspValues = Array.from({ length: 115 }, (_, i) => ({
    companyId: pagCompanyAId,
    siteAddress: `${i + 1} Pagination Ave`,
    technicianName: i < 60 ? "Alice" : i < 105 ? "Bob" : "Alice",
    clientName: "Pag Client",
    pestTypes: [] as string[],
  }));
  const coAInsps = await db
    .insert(inspectionsTable)
    .values(coAInspValues)
    .returning({ id: inspectionsTable.id });

  // Indices:
  //   coAInsps[0..49]   → Alice, high, OLD updatedAt   (50 rows)
  //   coAInsps[50..59]  → Alice, high, NOW updatedAt   (10 rows)
  //   coAInsps[60..104] → Bob,   high, NOW updatedAt   (45 rows)
  //   coAInsps[105..114]→ Alice, low,  NOW updatedAt   (10 rows)

  const highScorecards = [
    // Alice — OLD updatedAt (50)
    ...coAInsps.slice(0, 50).map((r) => ({
      companyId: pagCompanyAId,
      inspectionId: r.id,
      technicianName: "Alice",
      qualityScore: 55,
      riskScore: 70,
      riskLevel: "high" as const,
      components: COMPONENTS,
      updatedAt: OLD_DATE,
    })),
    // Alice — NOW updatedAt (10)
    ...coAInsps.slice(50, 60).map((r) => ({
      companyId: pagCompanyAId,
      inspectionId: r.id,
      technicianName: "Alice",
      qualityScore: 55,
      riskScore: 70,
      riskLevel: "high" as const,
      components: COMPONENTS,
    })),
    // Bob — NOW updatedAt (45)
    ...coAInsps.slice(60, 105).map((r) => ({
      companyId: pagCompanyAId,
      inspectionId: r.id,
      technicianName: "Bob",
      qualityScore: 55,
      riskScore: 65,
      riskLevel: "high" as const,
      components: COMPONENTS,
    })),
  ];

  const lowScorecards = coAInsps.slice(105, 115).map((r) => ({
    companyId: pagCompanyAId,
    inspectionId: r.id,
    technicianName: "Alice",
    qualityScore: 90,
    riskScore: 20,
    riskLevel: "low" as const,
    components: COMPONENTS,
  }));

  await db.insert(inspectionScorecardsTable).values([...highScorecards, ...lowScorecards]);

  // ── Seed Co B inspections (10 high, Charlie) ─────────────────────────────────
  const coBInspValues = Array.from({ length: 10 }, (_, i) => ({
    companyId: pagCompanyBId,
    siteAddress: `${i + 1} Other St`,
    technicianName: "Charlie",
    clientName: "B Client",
    pestTypes: [] as string[],
  }));
  const coBInsps = await db
    .insert(inspectionsTable)
    .values(coBInspValues)
    .returning({ id: inspectionsTable.id });

  await db.insert(inspectionScorecardsTable).values(
    coBInsps.map((r) => ({
      companyId: pagCompanyBId,
      inspectionId: r.id,
      technicianName: "Charlie",
      qualityScore: 50,
      riskScore: 75,
      riskLevel: "high" as const,
      components: COMPONENTS,
    })),
  );
});

beforeEach(() => {
  asUser(null);
});

// ── Auth & role guards ─────────────────────────────────────────────────────────

describe("GET /executive/inspections — auth & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician", async () => {
    asUser(PAG_TECH_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when riskLevel is missing", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app).get("/api/executive/inspections");
    expect(res.status).toBe(400);
  });

  it("returns 400 when riskLevel is invalid", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "extreme" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when since is not a valid date", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", since: "not-a-date" });
    expect(res.status).toBe(400);
  });
});

// ── Pagination correctness ─────────────────────────────────────────────────────

describe("GET /executive/inspections — pagination: total, hasMore, page contents", () => {
  /**
   * Co A has 105 "high" risk scorecards.
   * PAGE_SIZE = 100.
   *
   * Page 1 (offset=0):  100 rows, hasMore=true,  total=105
   * Page 2 (offset=100): 5 rows, hasMore=false, total=105
   * Pages 1 and 2 together cover all 105 unique inspectionIds with no duplicates.
   */

  it("page 1 returns exactly PAGE_SIZE rows with hasMore=true and correct total", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { inspections, total, hasMore, pagination } = res.body;

    expect(inspections).toHaveLength(PAGE_SIZE);
    expect(total).toBe(105);
    expect(hasMore).toBe(true);

    // Pagination sub-object must agree with top-level aliases
    expect(pagination.total).toBe(105);
    expect(pagination.hasMore).toBe(true);
    expect(pagination.offset).toBe(0);
    expect(pagination.limit).toBe(PAGE_SIZE);
  });

  it("page 2 returns the remaining 5 rows with hasMore=false and the same total", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", offset: PAGE_SIZE });

    expect(res.status).toBe(200);

    const { inspections, total, hasMore } = res.body;

    expect(inspections).toHaveLength(5);
    expect(total).toBe(105);
    expect(hasMore).toBe(false);
  });

  it("pages 1 and 2 together cover all 105 unique inspectionIds with no duplicates", async () => {
    asUser(PAG_OWNER_A);

    const [res1, res2] = await Promise.all([
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "high", offset: 0 }),
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "high", offset: PAGE_SIZE }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1: number[] = res1.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    const ids2: number[] = res2.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);

    // No overlap between pages
    const set1 = new Set(ids1);
    for (const id of ids2) {
      expect(set1.has(id)).toBe(false);
    }

    // Together they cover all 105
    const allIds = new Set([...ids1, ...ids2]);
    expect(allIds.size).toBe(105);
  });

  it("offset beyond total returns empty results with hasMore=false and correct total", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", offset: 200 });

    expect(res.status).toBe(200);

    const { inspections, total, hasMore } = res.body;
    expect(inspections).toHaveLength(0);
    expect(total).toBe(105);
    expect(hasMore).toBe(false);
  });

  it("riskLevel filter excludes different risk levels from both count and results", async () => {
    // Co A has 10 "low" scorecards — they must NOT appear in the "high" count or results.
    asUser(PAG_OWNER_A);
    const [highRes, lowRes] = await Promise.all([
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "high" }),
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "low" }),
    ]);

    expect(highRes.status).toBe(200);
    expect(lowRes.status).toBe(200);

    expect(highRes.body.total).toBe(105);
    expect(lowRes.body.total).toBe(10);

    // No "low" riskLevel rows in the "high" response
    for (const row of highRes.body.inspections) {
      expect(row.riskLevel).toBe("high");
    }
  });
});

// ── Filter correctness: technicianName ─────────────────────────────────────────

describe("GET /executive/inspections — technicianName filter applied to count and data", () => {
  /**
   * Co A "high" breakdown:
   *   Alice: 60 total (50 old + 10 new)
   *   Bob:   45 total (all new)
   */

  it("technicianName=Alice: total=60, all returned rows belong to Alice", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Alice", offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(60);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(60);

    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Alice");
    }
  });

  it("technicianName=Bob: total=45, all returned rows belong to Bob", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Bob", offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(45);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(45);

    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Bob");
    }
  });

  it("technicianName filter count agrees with data length across all pages", async () => {
    // Alice has 60 rows — a single page fits them all (60 < 100).
    // Verify count in the response equals the actual number of items returned
    // so we know the count and data queries share the same filter predicate.
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Alice" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.inspections.length);
  });

  it("technicianName for a non-existent technician returns total=0 and empty list", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Nobody" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(0);
  });
});

// ── Filter correctness: since ──────────────────────────────────────────────────

describe("GET /executive/inspections — since filter applied to count and data", () => {
  /**
   * updatedAt breakdown for Co A "high":
   *   Alice, OLD (2024-01-01): 50 rows
   *   Alice, NOW (default):    10 rows
   *   Bob,   NOW (default):    45 rows
   *
   * since=SINCE_CUTOFF (2025-01-01) → 55 rows (10 Alice + 45 Bob)
   * since=FUTURE_CUTOFF (2030-01-01) → 0 rows
   */

  it("since=2025-01-01 excludes old scorecards from both count and results", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", since: SINCE_CUTOFF });

    expect(res.status).toBe(200);
    // Only the 10 recent Alice + 45 Bob = 55 pass the cutoff
    expect(res.body.total).toBe(55);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(55);
  });

  it("since=future returns total=0 and no rows", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", since: FUTURE_CUTOFF });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(0);
  });

  it("since filter count agrees with data length (count and data share the same predicate)", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", since: SINCE_CUTOFF });

    expect(res.status).toBe(200);
    // The parallel count and data queries must return consistent numbers
    expect(res.body.total).toBe(res.body.inspections.length);
  });
});

// ── Combined filter: technicianName + since ────────────────────────────────────

describe("GET /executive/inspections — combined technicianName + since filter", () => {
  /**
   * Alice + since=SINCE_CUTOFF → only the 10 recent Alice rows
   * Bob   + since=SINCE_CUTOFF → all 45 Bob rows (all are recent)
   */

  it("technicianName=Alice + since=2025-01-01 → exactly 10 recent Alice rows", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Alice", since: SINCE_CUTOFF });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(10);

    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Alice");
    }
  });

  it("technicianName=Bob + since=2025-01-01 → all 45 Bob rows (all are recent)", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Bob", since: SINCE_CUTOFF });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(45);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(45);
  });

  it("technicianName=Alice + since=future → 0 rows, count=0", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Alice", since: FUTURE_CUTOFF });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.inspections).toHaveLength(0);
  });
});

// ── Cross-tenant isolation ─────────────────────────────────────────────────────

describe("GET /executive/inspections — cross-tenant isolation", () => {
  /**
   * Co A: 105 "high" scorecards (Alice 60, Bob 45)
   * Co B: 10  "high" scorecards (Charlie 10)
   *
   * Each owner must see only their own company's data.
   * "Charlie" must never appear in Co A's results; "Alice"/"Bob" must never
   * appear in Co B's results.
   */

  it("Co A owner sees only Co A's 105 high-risk scorecards", async () => {
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(105);

    const techNames = new Set<string>(
      res.body.inspections.map((r: { technicianName: string }) => r.technicianName),
    );
    expect(techNames.has("Charlie")).toBe(false);
  });

  it("Co B owner sees only Co B's 10 high-risk scorecards", async () => {
    asUser(PAG_OWNER_B);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.inspections).toHaveLength(10);

    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Charlie");
    }
  });

  it("Co A's total count does not include Co B's 10 scorecards", async () => {
    // If there were cross-tenant leakage the total would be 115, not 105.
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high" });

    expect(res.status).toBe(200);
    expect(res.body.total).not.toBe(115);
    expect(res.body.total).toBe(105);
  });

  it("Co B's total count does not include Co A's 105 scorecards", async () => {
    asUser(PAG_OWNER_B);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high" });

    expect(res.status).toBe(200);
    expect(res.body.total).not.toBe(115);
    expect(res.body.total).toBe(10);
  });

  it("Co A cannot see Co B's results even with a matching technicianName filter", async () => {
    // "Charlie" works for Co B only. Co A querying with technicianName=Charlie
    // must get total=0 (because the companyId filter ensures no co-mingling).
    asUser(PAG_OWNER_A);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "high", technicianName: "Charlie" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.inspections).toHaveLength(0);
  });
});
