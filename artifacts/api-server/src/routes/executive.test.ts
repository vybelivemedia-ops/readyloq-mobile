import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Executive dashboard isolation tests (Task #259).
 *
 * Verifies that GET /api/executive/intelligence aggregates only the
 * authenticated company's opportunities, scorecards, and inspections — never
 * leaking another tenant's pipeline value, quality scores, or technician names.
 *
 * All fixture data is seeded once in beforeAll after a full teardown so every
 * run — including repeated local/CI runs against the same database — starts
 * from a known, deterministic state.
 */

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
  opportunitiesTable,
  inspectionScorecardsTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import type { OpportunityCategory, OpportunityStatus, OpportunityValueTier } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Stable clerk user IDs scoped to this test file.
const EXEC_OWNER_A    = "exec_owner_a_clerk_id";
const EXEC_OWNER_B    = "exec_owner_b_clerk_id";
const EXEC_TECH_A     = "exec_tech_a_clerk_id";
const EXEC_OWNER_EMPTY = "exec_owner_empty_clerk_id";

// Stable slug for the empty-company fixture (cleaned up in beforeAll).
const EMPTY_CO_SLUG = "exec-empty-co";

let execCompanyAId: number;
let execCompanyBId: number;

// IDs of inspections seeded for each company (set in beforeAll, used in assertions).
let inspAId: number;
let inspA2Id: number;
let inspBId: number;

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

/** Create an inspection via the HTTP layer and return its ID. */
async function createInspectionViaApi(ownerId: string, siteAddress: string): Promise<number> {
  asUser(ownerId);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress, technicianName: "Tech", clientName: "Client", pestTypes: ["ants"] });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

// ---------------------------------------------------------------------------
// One-time setup: idempotent teardown + deterministic fixture seed.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  execCompanyAId = await findOrCreateCompany("Exec Test Co A", "exec-co-a");
  execCompanyBId = await findOrCreateCompany("Exec Test Co B", "exec-co-b");

  await ensureActiveBranding(execCompanyAId, "Exec Co A Brand");
  await ensureActiveBranding(execCompanyBId, "Exec Co B Brand");

  // Also resolve (or create) the stable empty-company fixture so it's included
  // in the teardown below.
  const emptyCompanyId = await findOrCreateCompany("Exec Empty Co", EMPTY_CO_SLUG);

  // ── Full teardown for all test companies so reruns start clean ────────────
  // Delete in FK-safe order: child tables first.
  const companyIds = [execCompanyAId, execCompanyBId, emptyCompanyId];

  // scorecards reference inspections; opportunities reference inspections.
  await db
    .delete(inspectionScorecardsTable)
    .where(inArray(inspectionScorecardsTable.companyId, companyIds));
  await db
    .delete(opportunitiesTable)
    .where(inArray(opportunitiesTable.companyId, companyIds));
  // Deleting inspections cascades to media, analysis, reports.
  await db
    .delete(inspectionsTable)
    .where(inArray(inspectionsTable.companyId, companyIds));

  await ensureActiveBranding(emptyCompanyId, "Exec Empty Co Brand");

  // Remove stale users from previous runs.
  for (const id of [EXEC_OWNER_A, EXEC_OWNER_B, EXEC_TECH_A, EXEC_OWNER_EMPTY]) {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, id));
  }

  await db.insert(usersTable).values([
    { clerkUserId: EXEC_OWNER_A,    role: "owner",      companyId: execCompanyAId },
    { clerkUserId: EXEC_OWNER_B,    role: "owner",      companyId: execCompanyBId },
    { clerkUserId: EXEC_TECH_A,     role: "technician", companyId: execCompanyAId },
    { clerkUserId: EXEC_OWNER_EMPTY, role: "owner",     companyId: emptyCompanyId },
  ]);

  // ── Company A: 2 inspections ─────────────────────────────────────────────
  inspAId  = await createInspectionViaApi(EXEC_OWNER_A, "1 Exec Ave");
  inspA2Id = await createInspectionViaApi(EXEC_OWNER_A, "2 Exec Ave");

  // ── Company A: 1 open opportunity ($5000) ────────────────────────────────
  await db.insert(opportunitiesTable).values({
    companyId:            execCompanyAId,
    inspectionId:         inspAId,
    propertyAddress:      "1 Exec Ave",
    category:             "pest_activity" as OpportunityCategory,
    title:                "Roach infestation",
    rationale:            "Evidence found",
    fingerprint:          "exec-a-open-roach",
    estimatedValueTier:   "high" as OpportunityValueTier,
    estimatedAnnualValue: 5000,
    confidence:           0.9,
    status:               "new" as OpportunityStatus,
  });

  // ── Company A: 1 won opportunity ($2000) ─────────────────────────────────
  await db.insert(opportunitiesTable).values({
    companyId:            execCompanyAId,
    inspectionId:         inspA2Id,
    propertyAddress:      "2 Exec Ave",
    category:             "conducive_conditions" as OpportunityCategory,
    title:                "Moisture problem",
    rationale:            "Wet crawlspace",
    fingerprint:          "exec-a-won-moisture",
    estimatedValueTier:   "medium" as OpportunityValueTier,
    estimatedAnnualValue: 2000,
    confidence:           0.8,
    status:               "won" as OpportunityStatus,
  });

  // ── Company A: 2 scorecards for "Alice" (high + low risk) ────────────────
  const componentsA = {
    photoCoverage: 80,
    evidenceQuality: 75,
    avgConfidence: 85,
    recommendationCoverage: 90,
  };
  await db.insert(inspectionScorecardsTable).values([
    {
      companyId:    execCompanyAId,
      inspectionId: inspAId,
      technicianName: "Alice",
      qualityScore: 88,
      riskScore:    60,
      riskLevel:    "high",
      components:   componentsA,
    },
    {
      companyId:    execCompanyAId,
      inspectionId: inspA2Id,
      technicianName: "Alice",
      qualityScore: 92,
      riskScore:    30,
      riskLevel:    "low",
      components:   componentsA,
    },
  ]);

  // ── Company B: 1 inspection + 1 won opportunity ($8000) + 1 critical scorecard ──
  inspBId = await createInspectionViaApi(EXEC_OWNER_B, "99 B Street");

  // Company B's won opportunity — must never appear in Company A's wonOpportunities count.
  await db.insert(opportunitiesTable).values({
    companyId:            execCompanyBId,
    inspectionId:         inspBId,
    propertyAddress:      "99 B Street",
    category:             "pest_activity" as OpportunityCategory,
    title:                "Termite damage",
    rationale:            "Active termite colony",
    fingerprint:          "exec-b-won-termite",
    estimatedValueTier:   "high" as OpportunityValueTier,
    estimatedAnnualValue: 8000,
    confidence:           0.85,
    status:               "won" as OpportunityStatus,
  });

  await db.insert(inspectionScorecardsTable).values({
    companyId:    execCompanyBId,
    inspectionId: inspBId,
    technicianName: "Bob",
    qualityScore: 40,
    riskScore:    95,
    riskLevel:    "critical",
    components: {
      photoCoverage: 30,
      evidenceQuality: 40,
      avgConfidence: 50,
      recommendationCoverage: 20,
    },
  });

  // ── Velocity: mark inspections completed with controlled timestamps ────────
  // Company A: inspAId → completed this month; inspA2Id → completed last month.
  // Company B: inspBId → completed this month.
  // The velocity query filters on status="completed" + companyId, so these
  // dates let us assert per-company month counts without ambiguity.
  const now = new Date();
  const thisMonthTs  = new Date(now.getFullYear(), now.getMonth(), 5);     // 5th of current month
  const lastMonthTs  = new Date(now.getFullYear(), now.getMonth() - 1, 10); // 10th of prior month

  await db
    .update(inspectionsTable)
    .set({ status: "completed", createdAt: thisMonthTs })
    .where(eq(inspectionsTable.id, inspAId));

  await db
    .update(inspectionsTable)
    .set({ status: "completed", createdAt: lastMonthTs })
    .where(eq(inspectionsTable.id, inspA2Id));

  await db
    .update(inspectionsTable)
    .set({ status: "completed", createdAt: thisMonthTs })
    .where(eq(inspectionsTable.id, inspBId));
});

beforeEach(() => {
  asUser(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executive intelligence endpoint: authentication & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (not an owner)", async () => {
    asUser(EXEC_TECH_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(403);
  });
});

describe("executive intelligence endpoint: cross-company isolation", () => {
  it("company B cannot see company A's pipeline value or open opportunities", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const m = res.body.metrics;

    // B has no open opportunities — must not surface A's $5000 open pipeline.
    expect(m.pipelineValue).toBe(0);
    expect(m.openOpportunities).toBe(0);
    // B has exactly 1 won opportunity of its own ($8000) — not A's won deal.
    expect(m.wonOpportunities).toBe(1);
  });

  it("company B cannot see company A's quality scores or technician leaderboard", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;

    // B has 1 scorecard (Bob, critical) — not A's 2 scorecards for Alice.
    expect(m.totalScorecards).toBe(1);

    // The risk distribution must reflect ONLY B's data (1 critical, 0 high/low).
    expect(m.riskDistribution.critical).toBe(1);
    expect(m.riskDistribution.high).toBe(0);
    expect(m.riskDistribution.low).toBe(0);

    // Alice works for A — she must never appear in B's leaderboard.
    const techNames = m.topTechnicians.map((t: { name: string }) => t.name);
    expect(techNames).not.toContain("Alice");
  });

  it("company A cannot see company B's critical scorecard or Bob's data", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;

    // A has 2 scorecards (Alice: high + low) — no critical rows.
    expect(m.totalScorecards).toBe(2);
    expect(m.riskDistribution.critical).toBe(0);
    expect(m.riskDistribution.high).toBe(1);
    expect(m.riskDistribution.low).toBe(1);

    // Bob works for B — he must never appear in A's leaderboard.
    const techNames = m.topTechnicians.map((t: { name: string }) => t.name);
    expect(techNames).not.toContain("Bob");
  });

  it("company A sees its own pipeline value and won-opportunity count", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;

    // 1 open opportunity at $5000.
    expect(m.openOpportunities).toBe(1);
    expect(m.pipelineValue).toBe(5000);

    // 1 won opportunity.
    expect(m.wonOpportunities).toBe(1);
  });

  it("a company with no data at all returns zeros and an empty leaderboard", async () => {
    // Uses the stable "exec-empty-co" company seeded in beforeAll with no
    // inspections, opportunities, or scorecards — guaranteed clean on every run.
    asUser(EXEC_OWNER_EMPTY);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;
    expect(m.pipelineValue).toBe(0);
    expect(m.openOpportunities).toBe(0);
    expect(m.wonOpportunities).toBe(0);
    expect(m.totalScorecards).toBe(0);
    expect(m.avgQualityScore).toBe(0);
    expect(m.riskDistribution).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(m.topTechnicians).toHaveLength(0);
    expect(m.inspectionsThisMonth).toBe(0);
    expect(m.inspectionsLastMonth).toBe(0);
  });
});

describe("executive intelligence endpoint: won-opportunity isolation", () => {
  /**
   * Fixture (seeded in beforeAll):
   *   Company A — 1 won opportunity ($2000, exec-a-won-moisture)
   *   Company B — 1 won opportunity ($8000, exec-b-won-termite)
   *
   * Each company must count only its own won deals. Neither company should
   * see the other's won opportunity reflected in its wonOpportunities metric.
   */

  it("company A's wonOpportunities count does not include company B's won deal", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;
    // A has exactly 1 won opportunity — not 2, which would expose B's won deal.
    expect(m.wonOpportunities).toBe(1);
  });

  it("company B's wonOpportunities count does not include company A's won deal", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;
    // B has exactly 1 won opportunity — not 2, which would expose A's won deal.
    expect(m.wonOpportunities).toBe(1);
  });
});

describe("executive intelligence endpoint: inspection velocity is scoped per company", () => {
  /**
   * Fixture (seeded in beforeAll):
   *   Company A — inspAId:  status="completed", createdAt = 5th of THIS month
   *               inspA2Id: status="completed", createdAt = 10th of LAST month
   *   Company B — inspBId:  status="completed", createdAt = 5th of THIS month
   *
   * Correct isolation means A sees thisMonth=1, lastMonth=1 and B sees
   * thisMonth=1, lastMonth=0 — neither owner sees the other company's counts.
   */

  it("company A velocity counts only company A's completed inspections", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;
    // inspAId was completed this month for A.
    expect(m.inspectionsThisMonth).toBe(1);
    // inspA2Id was completed last month for A.
    expect(m.inspectionsLastMonth).toBe(1);
  });

  it("company B velocity counts only company B's completed inspections", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;
    // inspBId was completed this month for B.
    expect(m.inspectionsThisMonth).toBe(1);
    // B has no completed inspections in the prior month.
    expect(m.inspectionsLastMonth).toBe(0);
  });

  it("company A's this-month count does not include company B's completed inspection", async () => {
    // Both A (inspAId) and B (inspBId) have a completion in the current month.
    // A's thisMonth must equal exactly 1 — not 2, which would expose B's data.
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);
    expect(res.body.metrics.inspectionsThisMonth).toBe(1);
  });

  it("company B's this-month count does not include company A's completed inspection", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);
    // B's count must equal 1 (its own inspection only), not 2.
    expect(res.body.metrics.inspectionsThisMonth).toBe(1);
  });
});
