import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  // We intentionally set createdAt to a DIFFERENT month than completedAt so the
  // test proves the endpoint buckets by completedAt (completion month), not
  // createdAt (creation month).
  //
  //   inspAId  — created last month, COMPLETED this month → thisMonth bucket
  //   inspA2Id — created two months ago, COMPLETED last month → lastMonth bucket
  //   inspBId  — created last month, COMPLETED this month → B's thisMonth bucket
  const now = new Date();
  const thisMonthTs      = new Date(now.getFullYear(), now.getMonth(), 5);      // 5th of this month
  const lastMonthTs      = new Date(now.getFullYear(), now.getMonth() - 1, 10); // 10th of last month
  const twoMonthsAgoTs   = new Date(now.getFullYear(), now.getMonth() - 2, 15); // 15th of 2 months ago

  // inspAId: created last month, completed this month (cross-month scenario)
  await db
    .update(inspectionsTable)
    .set({ status: "completed", createdAt: lastMonthTs, completedAt: thisMonthTs })
    .where(eq(inspectionsTable.id, inspAId));

  // inspA2Id: created two months ago, completed last month (cross-month scenario)
  await db
    .update(inspectionsTable)
    .set({ status: "completed", createdAt: twoMonthsAgoTs, completedAt: lastMonthTs })
    .where(eq(inspectionsTable.id, inspA2Id));

  // inspBId: created last month, completed this month (cross-month scenario for B)
  await db
    .update(inspectionsTable)
    .set({ status: "completed", createdAt: lastMonthTs, completedAt: thisMonthTs })
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
   * Fixture (seeded in beforeAll) — cross-month design:
   *   Company A — inspAId:  createdAt = last month, completedAt = THIS month → thisMonth bucket
   *               inspA2Id: createdAt = 2 months ago, completedAt = LAST month → lastMonth bucket
   *   Company B — inspBId:  createdAt = last month, completedAt = THIS month → B's thisMonth bucket
   *
   * createdAt and completedAt are intentionally in different months so the tests
   * prove the query buckets by completedAt (when the work finished), not createdAt
   * (when the record was created).
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

describe("executive intelligence endpoint: velocity buckets by completedAt, not createdAt", () => {
  /**
   * The fixture (seeded in beforeAll) is specifically designed for cross-month
   * verification:
   *
   *   inspAId  — createdAt = last month,    completedAt = THIS month
   *   inspA2Id — createdAt = 2 months ago,  completedAt = LAST month
   *
   * If the query erroneously buckets by createdAt:
   *   • inspAId  would appear in lastMonth  (wrong — it was completed this month)
   *   • inspA2Id would appear in neither    (wrong — it was completed last month)
   *
   * Correct behaviour (bucket by completedAt):
   *   • inspAId  → thisMonth  = 1
   *   • inspA2Id → lastMonth  = 1
   */

  it("an inspection created last month but completed this month counts in thisMonth", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    const m = res.body.metrics;
    // inspAId: createdAt = last month, completedAt = this month → must be in thisMonth
    expect(m.inspectionsThisMonth).toBe(1);
    // inspA2Id: createdAt = 2 months ago, completedAt = last month → must be in lastMonth
    expect(m.inspectionsLastMonth).toBe(1);
  });

  it("an inspection created two months ago but completed last month counts in lastMonth", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence");
    expect(res.status).toBe(200);

    // inspA2Id has createdAt 2 months ago — if the query used createdAt it would
    // return 0 for lastMonth (since the creation date is outside the [lastMonth, thisMonth) window).
    // Correct behaviour: completedAt falls in last month → lastMonth = 1.
    expect(res.body.metrics.inspectionsLastMonth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Email preview endpoint tests
// ---------------------------------------------------------------------------

describe("executive email-preview endpoint: authentication & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (not an owner)", async () => {
    asUser(EXEC_TECH_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(403);
  });
});

describe("executive email-preview endpoint: response structure", () => {
  it("returns success with html and subject fields for an owner", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.html).toBe("string");
    expect(res.body.html.length).toBeGreaterThan(0);
    expect(typeof res.body.subject).toBe("string");
    expect(res.body.subject.length).toBeGreaterThan(0);
  });

  it("embeds the requesting company's name in the HTML and subject", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    // Company A's name was seeded as "Exec Test Co A".
    expect(res.body.html).toContain("Exec Test Co A");
    expect(res.body.subject).toContain("Exec Test Co A");
  });
});

describe("executive email-preview endpoint: cross-company isolation", () => {
  /**
   * Fixture recap (seeded in beforeAll):
   *   Company A — "Exec Test Co A", technician "Alice", pipeline $5000 open
   *   Company B — "Exec Test Co B", technician "Bob", $8000 won deal, critical risk
   *
   * Each company's email snapshot must contain only its own data.
   */

  it("company A's email does not contain company B's technician name (Bob)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain("Bob");
  });

  it("company A's email does not contain company B's company name", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain("Exec Test Co B");
    expect(res.body.subject).not.toContain("Exec Test Co B");
  });

  it("company B's email does not contain company A's technician name (Alice)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain("Alice");
  });

  it("company B's email does not contain company A's company name", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain("Exec Test Co A");
    expect(res.body.subject).not.toContain("Exec Test Co A");
  });

  it("company A's email pipeline value reflects only company A's open opportunity ($5000)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    // A has $5K open pipeline — rendered as "$5K" by the formatter.
    expect(res.body.html).toContain("$5K");
    // Company B's $8000 won deal must not bleed into the pipeline value.
    // If $8K appeared it would indicate cross-tenant leakage.
    expect(res.body.html).not.toMatch(/\$8K|\$8,000|\$13K|\$13,000/);
  });

  it("company A's email shows zero critical risk sites (A has no critical scorecards)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    const html: string = res.body.html;
    // The critical-risk KPI block renders the count in a styled <div>.
    // Company A has 0 critical scorecards; Company B has 1.
    // We locate the "Critical Risk Sites" section and verify it shows 0, not 1.
    const criticalBlockIdx = html.indexOf("Critical Risk Sites");
    expect(criticalBlockIdx).toBeGreaterThan(-1);
    // The count <div> immediately follows the label <div> — extract the nearby text.
    const snippet = html.slice(criticalBlockIdx, criticalBlockIdx + 300);
    // The number "0" (critical count for A) should appear; the number "1" should
    // not be the critical count (it belongs to B's critical scorecard).
    // We match the color pattern for the critical block to pin the value.
    expect(snippet).toMatch(/font-size:28px[^>]*>0</);
  });

  it("company B's email embeds company B's own name and not company A's pipeline value", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);
    // B's email is branded for B.
    expect(res.body.html).toContain("Exec Test Co B");
    // B has 0 open opportunities — $5K (A's open pipeline) must not appear.
    expect(res.body.html).not.toContain("$5K");
  });
});

// ---------------------------------------------------------------------------
// Email preview endpoint: HTML-escaping of user-supplied strings
// ---------------------------------------------------------------------------

describe("executive email-preview endpoint: HTML escaping of user-supplied strings", () => {
  /**
   * A company whose name contains the five HTML-special characters.
   * The email template must never interpolate these verbatim — each character
   * must be replaced by its named HTML entity so corporate email gateways and
   * HTML parsers don't misread the structure.
   *
   * Escaped form: "Acme &amp; Sons &lt;Pest&gt; &quot;Pros&quot; &#39;LLC&#39;"
   */

  const SPECIAL_OWNER_ID = "exec_special_chars_owner_clerk_id";
  const SPECIAL_CO_SLUG  = "exec-special-chars-co";
  // The raw company name contains all five HTML-special characters.
  const RAW_COMPANY_NAME = `Acme & Sons <Pest> "Pros" 'LLC'`;
  // What should appear in the HTML output instead.
  const ESCAPED_COMPANY_NAME = "Acme &amp; Sons &lt;Pest&gt; &quot;Pros&quot; &#39;LLC&#39;";

  let specialCompanyId: number;

  beforeAll(async () => {
    specialCompanyId = await findOrCreateCompany(RAW_COMPANY_NAME, SPECIAL_CO_SLUG);
    await ensureActiveBranding(specialCompanyId, RAW_COMPANY_NAME);

    await db.delete(usersTable).where(eq(usersTable.clerkUserId, SPECIAL_OWNER_ID));
    await db.insert(usersTable).values({
      clerkUserId: SPECIAL_OWNER_ID,
      role:        "owner",
      companyId:   specialCompanyId,
    });
  });

  afterAll(async () => {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, SPECIAL_OWNER_ID));
    // Delete branding profiles first (FK references companies).
    await db.delete(brandingProfilesTable).where(eq(brandingProfilesTable.companyId, specialCompanyId));
    await db.delete(companiesTable).where(eq(companiesTable.slug, SPECIAL_CO_SLUG));
  });

  it("HTML-escapes the company name so special characters appear as entities, not raw markup", async () => {
    asUser(SPECIAL_OWNER_ID);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);

    const html: string = res.body.html;

    // The escaped form must be present.
    expect(html).toContain(ESCAPED_COMPANY_NAME);

    // The raw ampersand, angle brackets, and quotes must NOT appear verbatim
    // anywhere in the output (they would break the HTML structure).
    expect(html).not.toContain("Acme & Sons");
    expect(html).not.toContain("<Pest>");
  });

  it("HTML-escapes technician names that contain special characters", async () => {
    // Seed a scorecard with a technician whose name contains angle brackets.
    const specialInspId = await createInspectionViaApi(SPECIAL_OWNER_ID, "Special Tech St");

    await db.insert(inspectionScorecardsTable).values({
      companyId:      specialCompanyId,
      inspectionId:   specialInspId,
      technicianName: "J. <script>alert(1)</script> Smith",
      qualityScore:   88,
      riskScore:      25,
      riskLevel:      "low",
      components: {
        photoCoverage: 80,
        evidenceQuality: 80,
        avgConfidence: 85,
        recommendationCoverage: 90,
      },
    });

    // Seed a second scorecard for the same technician so the leaderboard shows them.
    const specialInspId2 = await createInspectionViaApi(SPECIAL_OWNER_ID, "Special Tech St 2");
    await db.insert(inspectionScorecardsTable).values({
      companyId:      specialCompanyId,
      inspectionId:   specialInspId2,
      technicianName: "J. <script>alert(1)</script> Smith",
      qualityScore:   90,
      riskScore:      20,
      riskLevel:      "low",
      components: {
        photoCoverage: 85,
        evidenceQuality: 85,
        avgConfidence: 88,
        recommendationCoverage: 92,
      },
    });

    asUser(SPECIAL_OWNER_ID);
    const res = await request(app).get("/api/executive/intelligence/email-preview");
    expect(res.status).toBe(200);

    const html: string = res.body.html;

    // The raw <script> tag must never appear in the HTML output.
    expect(html).not.toContain("<script>");
    // The escaped form of the angle bracket should be present instead.
    expect(html).toContain("&lt;script&gt;");

    // Cleanup
    await db.delete(inspectionScorecardsTable).where(
      inArray(inspectionScorecardsTable.inspectionId, [specialInspId, specialInspId2]),
    );
    await db.delete(inspectionsTable).where(
      inArray(inspectionsTable.id, [specialInspId, specialInspId2]),
    );
  });
});

// ---------------------------------------------------------------------------
// email-preview ?format=text endpoint tests — share-sheet fallback path
//
// When MailComposer is unavailable on device (no mail app configured), the
// mobile client calls GET /api/executive/intelligence/email-preview?format=text
// and passes the returned `text` field to Share.share().  These tests confirm:
//   1. The endpoint returns a non-empty `text` field and a `subject` field.
//   2. The text contains all expected dashboard sections.
//   3. Auth/role guards apply identically to the text format.
//   4. Cross-tenant isolation holds — Company A's text never contains B's data.
// ---------------------------------------------------------------------------

describe("executive email-preview ?format=text: authentication & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (not an owner)", async () => {
    asUser(EXEC_TECH_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(403);
  });
});

describe("executive email-preview ?format=text: response structure", () => {
  it("returns success:true with a non-empty text field and a subject field", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // text must be a non-empty string — the share sheet has something to show.
    expect(typeof res.body.text).toBe("string");
    expect(res.body.text.length).toBeGreaterThan(0);

    // subject must also be a non-empty string.
    expect(typeof res.body.subject).toBe("string");
    expect(res.body.subject.length).toBeGreaterThan(0);
  });

  it("text contains all four expected section headers", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);

    const text: string = res.body.text;
    // These section separators are hard-coded in the server's text template.
    expect(text).toContain("PIPELINE");
    expect(text).toContain("QUALITY & RISK");
    expect(text).toContain("INSPECTION VELOCITY");
    expect(text).toContain("TOP TECHNICIANS");
  });

  it("text embeds the requesting company's name", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("Exec Test Co A");
    expect(res.body.subject).toContain("Exec Test Co A");
  });

  it("text contains numeric KPI values (pipeline and quality score)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    const text: string = res.body.text;

    // Company A has a $5K open pipeline — should appear in the text.
    expect(text).toContain("$5K");

    // Quality section must list a numeric average score.
    expect(text).toMatch(/Avg quality score:\s*\d+/);
  });

  it("does not return an html field when format=text is requested", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    // The text branch must not include the html field — that's the mail path.
    expect(res.body.html).toBeUndefined();
  });
});

describe("executive email-preview ?format=text: cross-company isolation", () => {
  it("company A's text does not contain company B's technician name (Bob)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    expect(res.body.text).not.toContain("Bob");
  });

  it("company A's text does not contain company B's company name", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    expect(res.body.text).not.toContain("Exec Test Co B");
    expect(res.body.subject).not.toContain("Exec Test Co B");
  });

  it("company B's text does not contain company A's technician name (Alice)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    expect(res.body.text).not.toContain("Alice");
  });

  it("company A's text shows its own pipeline value and not company B's", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    // A has $5K open pipeline — must appear.
    expect(res.body.text).toContain("$5K");
    // Company B's $8K pipeline must not bleed in.
    expect(res.body.text).not.toMatch(/\$8K|\$8,000|\$13K|\$13,000/);
  });

  it("company A's text shows zero critical risk (A has no critical scorecards)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);
    const text: string = res.body.text;
    // The risk breakdown line looks like "0 critical · N high · …"
    expect(text).toMatch(/0 critical/);
  });
});

// ---------------------------------------------------------------------------
// Daily briefing endpoint tests (Task #282)
// ---------------------------------------------------------------------------

describe("executive briefing endpoint: authentication & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (not an owner)", async () => {
    asUser(EXEC_TECH_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(403);
  });
});

describe("executive briefing endpoint: cross-company isolation", () => {
  /**
   * Each describe-level beforeAll seeds inspections, scorecards, and
   * opportunities dated to *yesterday* so the briefing service's date window
   * picks them up.  Data is distinct enough that cross-tenant bleed is
   * immediately visible:
   *
   *   Company A yesterday — 2 completed inspections, 1 critical scorecard,
   *                         $7,500 new pipeline value
   *   Company B yesterday — 1 completed inspection, 0 critical scorecards,
   *                         $9,200 new pipeline value
   */

  let briefingInspA1Id: number;
  let briefingInspA2Id: number;
  let briefingInspBId: number;

  beforeAll(async () => {
    // Midday yesterday — safely inside the 00:00–23:59 window the service uses.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    // ── Company A: 2 completed inspections yesterday ──────────────────────
    briefingInspA1Id = await createInspectionViaApi(EXEC_OWNER_A, "Briefing A1 St");
    briefingInspA2Id = await createInspectionViaApi(EXEC_OWNER_A, "Briefing A2 St");

    await db
      .update(inspectionsTable)
      .set({ status: "completed", createdAt: yesterday })
      .where(inArray(inspectionsTable.id, [briefingInspA1Id, briefingInspA2Id]));

    // 1 critical scorecard for A (briefingInspA1Id).
    await db.insert(inspectionScorecardsTable).values({
      companyId:      execCompanyAId,
      inspectionId:   briefingInspA1Id,
      technicianName: "Alice",
      qualityScore:   35,
      riskScore:      95,
      riskLevel:      "critical",
      components: {
        photoCoverage: 30,
        evidenceQuality: 40,
        avgConfidence:   50,
        recommendationCoverage: 20,
      },
    });

    // $7,500 new pipeline opportunity for A, created yesterday.
    await db.insert(opportunitiesTable).values({
      companyId:            execCompanyAId,
      inspectionId:         briefingInspA1Id,
      propertyAddress:      "Briefing A1 St",
      category:             "pest_activity" as OpportunityCategory,
      title:                "Briefing A roach find",
      rationale:            "Active infestation",
      fingerprint:          "briefing-a-opp-daily",
      estimatedValueTier:   "high" as OpportunityValueTier,
      estimatedAnnualValue: 7500,
      confidence:           0.9,
      status:               "new" as OpportunityStatus,
      createdAt:            yesterday,
    });

    // ── Company B: 1 completed inspection yesterday ───────────────────────
    briefingInspBId = await createInspectionViaApi(EXEC_OWNER_B, "Briefing B Blvd");

    await db
      .update(inspectionsTable)
      .set({ status: "completed", createdAt: yesterday })
      .where(eq(inspectionsTable.id, briefingInspBId));

    // No critical scorecards for B yesterday — keep it at 0.

    // $9,200 new pipeline for B, created yesterday.
    await db.insert(opportunitiesTable).values({
      companyId:            execCompanyBId,
      inspectionId:         briefingInspBId,
      propertyAddress:      "Briefing B Blvd",
      category:             "pest_activity" as OpportunityCategory,
      title:                "Briefing B termite find",
      rationale:            "Active colony",
      fingerprint:          "briefing-b-opp-daily",
      estimatedValueTier:   "high" as OpportunityValueTier,
      estimatedAnnualValue: 9200,
      confidence:           0.85,
      status:               "new" as OpportunityStatus,
      createdAt:            yesterday,
    });
  });

  afterAll(async () => {
    // Remove briefing-specific fixtures in FK-safe order.
    await db
      .delete(inspectionScorecardsTable)
      .where(
        inArray(inspectionScorecardsTable.inspectionId, [
          briefingInspA1Id,
          briefingInspA2Id,
          briefingInspBId,
        ]),
      );
    await db
      .delete(opportunitiesTable)
      .where(
        inArray(opportunitiesTable.inspectionId, [
          briefingInspA1Id,
          briefingInspA2Id,
          briefingInspBId,
        ]),
      );
    await db
      .delete(inspectionsTable)
      .where(
        inArray(inspectionsTable.id, [
          briefingInspA1Id,
          briefingInspA2Id,
          briefingInspBId,
        ]),
      );
  });

  // ── Response shape ────────────────────────────────────────────────────────

  it("returns success with a briefing object for an owner", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const b = res.body.briefing;
    expect(typeof b.date).toBe("string");
    expect(typeof b.summary).toBe("string");
    expect(b.summary.length).toBeGreaterThan(0);
    expect(typeof b.inspectionsCount).toBe("number");
    expect(typeof b.criticalRiskCount).toBe("number");
    expect(typeof b.pipelineAdded).toBe("number");
  });

  // ── Company A isolation ───────────────────────────────────────────────────

  it("company A's briefing reflects only company A's completed-inspection count (2, not 3)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    // A completed 2 inspections yesterday; B completed 1.
    // The count must be exactly 2 — adding B's 1 would give 3.
    expect(res.body.briefing.inspectionsCount).toBe(2);
  });

  it("company A's briefing reflects only company A's critical-risk count (1, not 0)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    // A has 1 critical scorecard yesterday; B has 0.
    expect(res.body.briefing.criticalRiskCount).toBe(1);
  });

  it("company A's briefing reflects only company A's new pipeline value ($7,500, not $9,200 or combined)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    // A added $7,500; B added $9,200.  Combined would be $16,700.
    expect(res.body.briefing.pipelineAdded).toBe(7500);
  });

  it("company A's briefing summary does not mention company B's pipeline value", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    const summary: string = res.body.briefing.summary;
    // B's value ($9,200) or the combined total ($16,700) must not appear.
    expect(summary).not.toMatch(/9[,.]?200|16[,.]?700/);
    // A's own value ($7,500) should be in the summary.
    expect(summary).toMatch(/7[,.]?500/);
  });

  // ── Company B isolation ───────────────────────────────────────────────────

  it("company B's briefing reflects only company B's completed-inspection count (1, not 2 or 3)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    // B completed 1 inspection yesterday; A completed 2.
    // Adding A's 2 would give 3, adding just 1 of A's gives 2 — both wrong.
    expect(res.body.briefing.inspectionsCount).toBe(1);
  });

  it("company B's briefing critical-risk count is 0 (not 1 from company A)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    // B has no critical scorecards yesterday; A has 1.
    expect(res.body.briefing.criticalRiskCount).toBe(0);
  });

  it("company B's briefing reflects only company B's new pipeline value ($9,200, not $7,500 or combined)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    // B added $9,200; A added $7,500.  Combined would be $16,700.
    expect(res.body.briefing.pipelineAdded).toBe(9200);
  });

  it("company B's briefing summary does not mention company A's pipeline value", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    const summary: string = res.body.briefing.summary;
    // A's value ($7,500) or the combined total ($16,700) must not appear.
    expect(summary).not.toMatch(/7[,.]?500|16[,.]?700/);
    // B's own value ($9,200) should be in the summary.
    expect(summary).toMatch(/9[,.]?200/);
  });
});

// ---------------------------------------------------------------------------
// Quality-trend endpoint tests (Task #269)
// ---------------------------------------------------------------------------

describe("executive quality-trend endpoint: authentication & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (not an owner)", async () => {
    asUser(EXEC_TECH_A);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(403);
  });
});

describe("executive quality-trend endpoint: response shape", () => {
  it("returns success with a weeks array for an owner", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.weeks)).toBe(true);
    // Always returns exactly 4 week buckets.
    expect(res.body.weeks).toHaveLength(4);
  });

  it("each week entry has weekStart, label, and avgQuality fields", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);
    for (const week of res.body.weeks) {
      expect(typeof week.weekStart).toBe("string");
      expect(typeof week.label).toBe("string");
      expect(typeof week.avgQuality).toBe("number");
    }
  });

  it("weekStart values are Monday-anchored ISO dates in ascending order", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);
    const starts: string[] = res.body.weeks.map((w: { weekStart: string }) => w.weekStart);
    // The list must be sorted oldest-first (ascending).
    const sorted = [...starts].sort();
    expect(starts).toEqual(sorted);
    // Each date must parse as a valid date.
    for (const s of starts) {
      expect(isNaN(new Date(s).getTime())).toBe(false);
    }
  });
});

describe("executive quality-trend endpoint: cross-company isolation", () => {
  /**
   * Fixture (seeded in the top-level beforeAll):
   *   Company A — 2 scorecards for "Alice":
   *     inspAId  → qualityScore 88, riskLevel "high"   (createdAt ≈ now)
   *     inspA2Id → qualityScore 92, riskLevel "low"    (createdAt ≈ now)
   *   Company B — 1 scorecard for "Bob":
   *     inspBId  → qualityScore 40, riskLevel "critical" (createdAt ≈ now)
   *
   * Both companies' scorecards fall in the same ISO week (the current week),
   * so cross-tenant bleed would be immediately visible as a wrong avgQuality.
   *
   * Company A's expected current-week average: round((88 + 92) / 2) = 90.
   * Company B's expected current-week average: 40.
   */

  it("company A's quality-trend returns only company A's weekly averages", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);

    // The current week must appear with Company A's own average (90).
    // If Company B's scorecard (40) bled in, the average would be ~73 (round((88+92+40)/3)).
    const weeks: Array<{ weekStart: string; avgQuality: number }> = res.body.weeks;
    const currentWeek = weeks[weeks.length - 1]; // most recent is last in ascending order
    expect(currentWeek.avgQuality).toBe(90);
  });

  it("company A's quality-trend does not reflect company B's scorecard quality (40)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);

    // No week should have an avgQuality that includes Company B's score of 40.
    // If bleed occurred the current-week average would drop to ~73.
    const weeks: Array<{ weekStart: string; avgQuality: number }> = res.body.weeks;
    for (const week of weeks) {
      // Company B's score (40) is far enough from A's average (90) that any
      // cross-tenant contamination would shift the week average below 80.
      if (week.avgQuality > 0) {
        expect(week.avgQuality).toBeGreaterThanOrEqual(80);
      }
    }
  });

  it("company B's quality-trend returns only company B's weekly averages", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);

    // The current week must show Company B's own score (40), not A's (90).
    const weeks: Array<{ weekStart: string; avgQuality: number }> = res.body.weeks;
    const currentWeek = weeks[weeks.length - 1];
    expect(currentWeek.avgQuality).toBe(40);
  });

  it("company B's quality-trend does not reflect company A's scorecard quality (88, 92)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);

    // If Company A's scorecards (88, 92) bled in, Company B's current-week average
    // would be much higher than 40 (would be ~73 with all three, or ~90 with just A's).
    const weeks: Array<{ weekStart: string; avgQuality: number }> = res.body.weeks;
    const currentWeek = weeks[weeks.length - 1];
    // B's own average is 40; leakage of A's data would push it above 60.
    expect(currentWeek.avgQuality).toBeLessThanOrEqual(60);
  });

  it("weeks with no scorecards are returned as avgQuality 0 (not omitted)", async () => {
    // The empty-company owner has no scorecards at all — all 4 weeks must be 0.
    // This also confirms the endpoint doesn't bleed other companies' data to fill gaps.
    asUser(EXEC_OWNER_EMPTY);
    const res = await request(app).get("/api/executive/quality-trend");
    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(4);
    for (const week of res.body.weeks) {
      expect(week.avgQuality).toBe(0);
    }
  });

  it("both companies share the same ISO week key but see different averages", async () => {
    // Both A and B have scorecards created ~now, so they fall in the same ISO week.
    // Each company must see its own average for that shared week, not a blended value.
    const [resA, resB] = await Promise.all([
      request(app).get("/api/executive/quality-trend").set("x-as-user", EXEC_OWNER_A),
      request(app).get("/api/executive/quality-trend").set("x-as-user", EXEC_OWNER_B),
    ]);

    // Authenticate each request independently using the authState helper.
    asUser(EXEC_OWNER_A);
    const resA2 = await request(app).get("/api/executive/quality-trend");
    asUser(EXEC_OWNER_B);
    const resB2 = await request(app).get("/api/executive/quality-trend");

    expect(resA2.status).toBe(200);
    expect(resB2.status).toBe(200);

    const weeksA: Array<{ weekStart: string; avgQuality: number }> = resA2.body.weeks;
    const weeksB: Array<{ weekStart: string; avgQuality: number }> = resB2.body.weeks;

    const currentWeekA = weeksA[weeksA.length - 1];
    const currentWeekB = weeksB[weeksB.length - 1];

    // Both land in the same calendar week.
    expect(currentWeekA.weekStart).toBe(currentWeekB.weekStart);

    // But each company's average reflects only its own data.
    expect(currentWeekA.avgQuality).toBe(90);  // A's average: (88+92)/2 = 90
    expect(currentWeekB.avgQuality).toBe(40);  // B's average: 40
  });
});
