import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Cross-tenant isolation tests for
 * GET /api/executive/quality-trend/inspections?weekStart=YYYY-MM-DD (Task #360).
 *
 * Verifies:
 *  - Company A owner only sees Company A's inspections for the test week
 *  - Company B owner only sees Company B's inspections for the same week
 *  - Neither company's results ever include the other's inspectionIds
 *  - Auth / role guards reject unauthenticated and non-owner callers
 *  - The weekStart filter is respected (scorecards outside the window are excluded)
 *
 * Uses dedicated company slugs ("qti-co-a" / "qti-co-b") so this file
 * never interferes with the fixtures in executive.test.ts or
 * executive-pagination.test.ts.
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

const QTI_OWNER_A  = "qti_owner_a_clerk_id";
const QTI_OWNER_B  = "qti_owner_b_clerk_id";
const QTI_TECH_A   = "qti_tech_a_clerk_id";   // role=technician → 403 on owner routes

const QTI_CO_A_SLUG = "qti-co-a";
const QTI_CO_B_SLUG = "qti-co-b";

/**
 * A fixed ISO week that falls well within the past so there is no ambiguity
 * about which real-time "now" the server would use. The Monday of the week
 * 2025-06-02 is used as weekStart; scorecards are created with createdAt
 * falling inside and outside this window to validate filtering.
 */
const WEEK_START     = "2025-06-02"; // Monday
const WEEK_END_TS    = new Date("2025-06-09T00:00:00.000Z"); // exclusive upper bound
const IN_WINDOW_TS   = new Date("2025-06-04T12:00:00.000Z"); // Wednesday — inside window
const OUT_WINDOW_TS  = new Date("2025-05-26T12:00:00.000Z"); // prior week — outside window

const COMPONENTS = {
  photoCoverage: 70,
  evidenceQuality: 70,
  avgConfidence: 70,
  recommendationCoverage: 70,
};

let qtiCompanyAId: number;
let qtiCompanyBId: number;

// IDs of inspections seeded for each company so we can assert on them.
let coAInspectionIds: number[] = [];
let coBInspectionIds: number[] = [];

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
  qtiCompanyAId = await findOrCreateCompany("QTI Test Co A", QTI_CO_A_SLUG);
  qtiCompanyBId = await findOrCreateCompany("QTI Test Co B", QTI_CO_B_SLUG);

  await ensureActiveBranding(qtiCompanyAId, "QTI Co A");
  await ensureActiveBranding(qtiCompanyBId, "QTI Co B");

  // ── Full idempotent teardown ─────────────────────────────────────────────────
  const companyIds = [qtiCompanyAId, qtiCompanyBId];
  await db
    .delete(inspectionScorecardsTable)
    .where(inArray(inspectionScorecardsTable.companyId, companyIds));
  await db
    .delete(inspectionsTable)
    .where(inArray(inspectionsTable.companyId, companyIds));

  for (const clerkId of [QTI_OWNER_A, QTI_OWNER_B, QTI_TECH_A]) {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, clerkId));
  }

  await db.insert(usersTable).values([
    { clerkUserId: QTI_OWNER_A, role: "owner",      companyId: qtiCompanyAId },
    { clerkUserId: QTI_OWNER_B, role: "owner",      companyId: qtiCompanyBId },
    { clerkUserId: QTI_TECH_A,  role: "technician", companyId: qtiCompanyAId },
  ]);

  // ── Seed Company A: 5 inspections in-window, 2 out-of-window ────────────────
  const coAInspValues = Array.from({ length: 7 }, (_, i) => ({
    companyId: qtiCompanyAId,
    siteAddress: `${i + 1} Alpha Street`,
    technicianName: "Alice",
    clientName: "QTI Client A",
    pestTypes: [] as string[],
  }));
  const coAInsps = await db
    .insert(inspectionsTable)
    .values(coAInspValues)
    .returning({ id: inspectionsTable.id });

  coAInspectionIds = coAInsps.map((r) => r.id);

  // Scorecards: first 5 inside the week window, last 2 outside.
  await db.insert(inspectionScorecardsTable).values([
    // In-window (indices 0-4) — createdAt = IN_WINDOW_TS
    ...coAInsps.slice(0, 5).map((r) => ({
      companyId: qtiCompanyAId,
      inspectionId: r.id,
      technicianName: "Alice",
      qualityScore: 80,
      riskScore: 30,
      riskLevel: "low" as const,
      components: COMPONENTS,
      createdAt: IN_WINDOW_TS,
    })),
    // Out-of-window (indices 5-6) — createdAt = OUT_WINDOW_TS
    ...coAInsps.slice(5, 7).map((r) => ({
      companyId: qtiCompanyAId,
      inspectionId: r.id,
      technicianName: "Alice",
      qualityScore: 75,
      riskScore: 35,
      riskLevel: "low" as const,
      components: COMPONENTS,
      createdAt: OUT_WINDOW_TS,
    })),
  ]);

  // ── Seed Company B: 3 inspections, all in the SAME week window ───────────────
  const coBInspValues = Array.from({ length: 3 }, (_, i) => ({
    companyId: qtiCompanyBId,
    siteAddress: `${i + 1} Beta Avenue`,
    technicianName: "Charlie",
    clientName: "QTI Client B",
    pestTypes: [] as string[],
  }));
  const coBInsps = await db
    .insert(inspectionsTable)
    .values(coBInspValues)
    .returning({ id: inspectionsTable.id });

  coBInspectionIds = coBInsps.map((r) => r.id);

  await db.insert(inspectionScorecardsTable).values(
    coBInsps.map((r) => ({
      companyId: qtiCompanyBId,
      inspectionId: r.id,
      technicianName: "Charlie",
      qualityScore: 65,
      riskScore: 50,
      riskLevel: "medium" as const,
      components: COMPONENTS,
      createdAt: IN_WINDOW_TS,
    })),
  );
});

beforeEach(() => {
  asUser(null);
});

// ── Auth & role guards ─────────────────────────────────────────────────────────

describe("GET /executive/quality-trend/inspections — auth & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician", async () => {
    asUser(QTI_TECH_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });
    expect(res.status).toBe(403);
  });

  it("returns 400 when weekStart is missing", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend/inspections");
    expect(res.status).toBe(400);
  });

  it("returns 400 when weekStart is not a valid date", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: "not-a-date" });
    expect(res.status).toBe(400);
  });
});

// ── Cross-tenant isolation ─────────────────────────────────────────────────────

describe("GET /executive/quality-trend/inspections — cross-tenant isolation", () => {
  /**
   * Fixture summary:
   *   Co A (Alice): 5 scorecards inside the week, 2 outside
   *   Co B (Charlie): 3 scorecards inside the same week
   *
   * For weekStart=WEEK_START:
   *   Co A owner must see exactly 5 inspections (all Alice's, none Charlie's)
   *   Co B owner must see exactly 3 inspections (all Charlie's, none Alice's)
   */

  it("Co A owner sees exactly 5 in-window scorecards and none from Co B", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(5);
    expect(res.body.inspections).toHaveLength(5);

    const returnedIds = new Set<number>(
      res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId),
    );

    // All returned IDs must belong to Co A
    for (const id of returnedIds) {
      expect(coAInspectionIds).toContain(id);
    }

    // No Co B inspection ID must appear
    for (const id of coBInspectionIds) {
      expect(returnedIds.has(id)).toBe(false);
    }
  });

  it("Co B owner sees exactly 3 in-window scorecards and none from Co A", async () => {
    asUser(QTI_OWNER_B);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);
    expect(res.body.inspections).toHaveLength(3);

    const returnedIds = new Set<number>(
      res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId),
    );

    // All returned IDs must belong to Co B
    for (const id of returnedIds) {
      expect(coBInspectionIds).toContain(id);
    }

    // No Co A inspection ID must appear
    for (const id of coAInspectionIds) {
      expect(returnedIds.has(id)).toBe(false);
    }
  });

  it("Co A's technician names never include Charlie (Co B's technician)", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);
    const techNames = new Set<string>(
      res.body.inspections.map((r: { technicianName: string }) => r.technicianName),
    );
    expect(techNames.has("Charlie")).toBe(false);
  });

  it("Co B's technician names never include Alice (Co A's technician)", async () => {
    asUser(QTI_OWNER_B);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);
    const techNames = new Set<string>(
      res.body.inspections.map((r: { technicianName: string }) => r.technicianName),
    );
    expect(techNames.has("Alice")).toBe(false);
  });

  it("Co A count does not include Co B's 3 scorecards (would be 8, not 5)", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);
    // If there were leakage the count would be 5 + 3 = 8
    expect(res.body.count).not.toBe(8);
    expect(res.body.count).toBe(5);
  });

  it("Co B count does not include Co A's 5 scorecards (would be 8, not 3)", async () => {
    asUser(QTI_OWNER_B);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);
    // If there were leakage the count would be 3 + 5 = 8
    expect(res.body.count).not.toBe(8);
    expect(res.body.count).toBe(3);
  });
});

// ── Week window filtering ──────────────────────────────────────────────────────

describe("GET /executive/quality-trend/inspections — week window filtering", () => {
  /**
   * Co A has 2 scorecards with createdAt = OUT_WINDOW_TS (2025-05-26),
   * which is in the prior ISO week. Querying with weekStart=WEEK_START
   * (2025-06-02) must not return those 2 rows.
   */

  it("excludes Co A's 2 out-of-window scorecards from the result", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: WEEK_START });

    expect(res.status).toBe(200);

    // Only the 5 in-window scorecards should appear; the 2 old ones must not.
    expect(res.body.count).toBe(5);
    expect(res.body.inspections).toHaveLength(5);

    // The 2 out-of-window inspection IDs (indices 5 and 6) must not appear.
    const outOfWindowIds = new Set(coAInspectionIds.slice(5, 7));
    const returnedIds = res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    for (const id of returnedIds) {
      expect(outOfWindowIds.has(id)).toBe(false);
    }
  });

  it("querying the prior week returns the 2 out-of-window Co A scorecards", async () => {
    // The prior week starts on 2025-05-26 (the Monday containing OUT_WINDOW_TS).
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: "2025-05-26" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.inspections).toHaveLength(2);
  });

  it("returns an empty list for a week that has no scorecards", async () => {
    asUser(QTI_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections")
      .query({ weekStart: "2020-01-06" });  // far in the past, no fixtures

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.inspections).toHaveLength(0);
  });
});
