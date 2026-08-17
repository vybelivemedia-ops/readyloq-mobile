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
import { generateDailyExecutiveBriefing, dayBoundsInTimezone } from "../services/briefing";
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

  it("plain-text format contains the raw company name (not escaped) and omits the html field", async () => {
    // The ?format=text branch produces plain text — HTML entities are not
    // appropriate there.  The raw company name must appear as-is and the
    // response must not include an html field (confirming the text branch is
    // active, not the HTML branch which would need escaping).
    asUser(SPECIAL_OWNER_ID);
    const res = await request(app).get(
      "/api/executive/intelligence/email-preview?format=text",
    );
    expect(res.status).toBe(200);

    // The text field must contain the raw company name — ampersands and angle
    // brackets are valid plain-text characters and must not be entity-encoded.
    expect(typeof res.body.text).toBe("string");
    expect(res.body.text).toContain("Acme & Sons");
    expect(res.body.text).toContain("<Pest>");

    // The html field must be absent — its presence would indicate the wrong
    // branch was taken and the output might be missing proper escaping.
    expect(res.body.html).toBeUndefined();
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
// Daily briefing: ?date=YYYY-MM-DD param — validation and isolation (Task #305)
// ---------------------------------------------------------------------------

describe("executive briefing ?date param: input validation", () => {
  /**
   * The endpoint must reject bad date strings before hitting the service so no
   * malformed value ever reaches the DB query.  These tests use EXEC_OWNER_A
   * (already seeded) just to get past auth guards.
   */

  it("returns 400 when ?date is today", async () => {
    asUser(EXEC_OWNER_A);
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app).get(`/api/executive/briefing/yesterday?date=${today}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future|today/i);
  });

  it("returns 400 when ?date is a future date", async () => {
    asUser(EXEC_OWNER_A);
    const future = new Date();
    future.setDate(future.getDate() + 7);
    const futureStr = future.toISOString().slice(0, 10);
    const res = await request(app).get(`/api/executive/briefing/yesterday?date=${futureStr}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future|today/i);
  });

  it("returns 400 when ?date is more than 90 days ago", async () => {
    asUser(EXEC_OWNER_A);
    const old = new Date();
    old.setDate(old.getDate() - 91);
    const oldStr = old.toISOString().slice(0, 10);
    const res = await request(app).get(`/api/executive/briefing/yesterday?date=${oldStr}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/90 days/i);
  });

  it("returns 400 when ?date is not in YYYY-MM-DD format", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday?date=not-a-date");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/i);
  });

  it("returns 400 when ?date is present but empty (e.g. ?date=)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday?date=");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/i);
  });

  it("returns 400 when ?date appears more than once (e.g. ?date=X&date=Y)", async () => {
    asUser(EXEC_OWNER_A);
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const dateStr = twoDaysAgo.toISOString().slice(0, 10);
    // Both values are individually valid past dates; repeated keys must still be rejected.
    const res = await request(app).get(
      `/api/executive/briefing/yesterday?date=${dateStr}&date=${dateStr}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exactly once/i);
  });

  it("returns 400 when ?date is an impossible calendar date like 2026-02-30", async () => {
    asUser(EXEC_OWNER_A);
    // JS Date normalises 2026-02-30 → 2026-03-02, which would be a valid past date.
    // The endpoint must detect and reject the roll-over.
    const res = await request(app).get("/api/executive/briefing/yesterday?date=2026-02-30");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid calendar date/i);
  });

  it("accepts a valid past date within 90 days and returns success", async () => {
    asUser(EXEC_OWNER_A);
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const dateStr = twoDaysAgo.toISOString().slice(0, 10);
    const res = await request(app).get(`/api/executive/briefing/yesterday?date=${dateStr}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The returned date must match the requested date.
    expect(res.body.briefing.date).toBe(dateStr);
  });

  it("omitting ?date still defaults to yesterday (existing behaviour preserved)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/briefing/yesterday");
    expect(res.status).toBe(200);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expectedDate = yesterday.toISOString().slice(0, 10);
    expect(res.body.briefing.date).toBe(expectedDate);
  });
});

describe("executive briefing ?date param: date-scoped queries honour companyId", () => {
  /**
   * Two companies both have an inspection on the SAME historical date (4 days ago).
   * When company A requests a briefing for that date, it must see only company A's
   * inspection — not company B's — confirming the date param does not weaken
   * the per-company isolation guarantee.
   */

  const DATE_ISO_OWNER_A  = "exec_date_iso_owner_a_clerk_id";
  const DATE_ISO_OWNER_B  = "exec_date_iso_owner_b_clerk_id";
  const DATE_ISO_CO_A_SLUG = "exec-date-iso-co-a";
  const DATE_ISO_CO_B_SLUG = "exec-date-iso-co-b";

  let dateIsoCoAId: number;
  let dateIsoCoBId: number;
  let dateIsoInspAId: number;
  let dateIsoInspBId: number;

  // Choose a stable historical date 4 days ago (safely within the 90-day window
  // and well clear of "yesterday" and "today" so fixtures don't collide).
  const historicalDate = new Date();
  historicalDate.setDate(historicalDate.getDate() - 4);
  historicalDate.setHours(0, 0, 0, 0);
  const historicalDateStr = historicalDate.toISOString().slice(0, 10);

  // Midday on the historical date — safely inside the 00:00–23:59 window.
  const historicalMidday = new Date(historicalDate);
  historicalMidday.setHours(12, 0, 0, 0);

  beforeAll(async () => {
    dateIsoCoAId = await findOrCreateCompany("Date ISO Co A", DATE_ISO_CO_A_SLUG);
    dateIsoCoBId = await findOrCreateCompany("Date ISO Co B", DATE_ISO_CO_B_SLUG);

    await ensureActiveBranding(dateIsoCoAId, "Date ISO Co A Brand");
    await ensureActiveBranding(dateIsoCoBId, "Date ISO Co B Brand");

    // Teardown any stale fixtures from previous runs.
    for (const slug of [DATE_ISO_CO_A_SLUG, DATE_ISO_CO_B_SLUG]) {
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
      if (co) {
        await db.delete(inspectionScorecardsTable).where(eq(inspectionScorecardsTable.companyId, co.id));
        await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, co.id));
        await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, co.id));
      }
    }
    await db.delete(usersTable).where(
      inArray(usersTable.clerkUserId, [DATE_ISO_OWNER_A, DATE_ISO_OWNER_B]),
    );

    await db.insert(usersTable).values([
      { clerkUserId: DATE_ISO_OWNER_A, role: "owner", companyId: dateIsoCoAId },
      { clerkUserId: DATE_ISO_OWNER_B, role: "owner", companyId: dateIsoCoBId },
    ]);

    // Seed one completed inspection per company, both timestamped to the same historical day.
    dateIsoInspAId = await createInspectionViaApi(DATE_ISO_OWNER_A, "Date ISO A Site");
    dateIsoInspBId = await createInspectionViaApi(DATE_ISO_OWNER_B, "Date ISO B Site");

    await db
      .update(inspectionsTable)
      .set({ status: "completed", createdAt: historicalMidday })
      .where(eq(inspectionsTable.id, dateIsoInspAId));

    await db
      .update(inspectionsTable)
      .set({ status: "completed", createdAt: historicalMidday })
      .where(eq(inspectionsTable.id, dateIsoInspBId));
  });

  afterAll(async () => {
    await db.delete(inspectionScorecardsTable).where(
      inArray(inspectionScorecardsTable.inspectionId, [dateIsoInspAId, dateIsoInspBId]),
    );
    await db.delete(opportunitiesTable).where(
      inArray(opportunitiesTable.companyId, [dateIsoCoAId, dateIsoCoBId]),
    );
    await db.delete(inspectionsTable).where(
      inArray(inspectionsTable.id, [dateIsoInspAId, dateIsoInspBId]),
    );
    await db.delete(usersTable).where(
      inArray(usersTable.clerkUserId, [DATE_ISO_OWNER_A, DATE_ISO_OWNER_B]),
    );
    await db.delete(brandingProfilesTable).where(
      inArray(brandingProfilesTable.companyId, [dateIsoCoAId, dateIsoCoBId]),
    );
    await db.delete(companiesTable).where(
      inArray(companiesTable.slug, [DATE_ISO_CO_A_SLUG, DATE_ISO_CO_B_SLUG]),
    );
  });

  it("company A sees only its own inspection count when requesting a shared historical date", async () => {
    asUser(DATE_ISO_OWNER_A);
    const res = await request(app).get(
      `/api/executive/briefing/yesterday?date=${historicalDateStr}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // A has exactly 1 inspection on that date; B also has 1.
    // If isolation fails the count would be 2.
    expect(res.body.briefing.inspectionsCount).toBe(1);
    expect(res.body.briefing.date).toBe(historicalDateStr);
  });

  it("company B sees only its own inspection count when requesting a shared historical date", async () => {
    asUser(DATE_ISO_OWNER_B);
    const res = await request(app).get(
      `/api/executive/briefing/yesterday?date=${historicalDateStr}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // B has exactly 1 inspection on that date; if A's data bled in the count would be 2.
    expect(res.body.briefing.inspectionsCount).toBe(1);
  });

  it("company A requesting a date with no data returns zero counts (not B's data)", async () => {
    asUser(DATE_ISO_OWNER_A);
    // Request a different historical date (3 days ago) where neither company has data.
    const otherDate = new Date();
    otherDate.setDate(otherDate.getDate() - 3);
    const otherDateStr = otherDate.toISOString().slice(0, 10);
    const res = await request(app).get(
      `/api/executive/briefing/yesterday?date=${otherDateStr}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.briefing.inspectionsCount).toBe(0);
    expect(res.body.briefing.criticalRiskCount).toBe(0);
    expect(res.body.briefing.pipelineAdded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Daily briefing: midnight boundary accuracy (Task #304)
// ---------------------------------------------------------------------------

describe("executive briefing: midnight boundary accuracy", () => {
  /**
   * A dedicated company is used so these fixtures cannot interfere with the
   * cross-company isolation tests above.
   *
   * We pick a target date 5 days in the past so it doesn't coincide with
   * "yesterday" (used by the HTTP endpoint) or "today".
   *
   * Three inspections are seeded around the midnight boundaries of targetDate:
   *   insp1 — 23:59:59 of targetDate          → inside the window (1 s before midnight)
   *   insp2 — 00:00:01 of (targetDate + 1 d)  → outside the window (1 s after midnight)
   *   insp3 — 23:59:59 of (targetDate - 1 d)  → outside the window (end of the prior day)
   *
   * The service window is [00:00:00.000, 23:59:59.999) of targetDate, so only
   * insp1 should appear in the briefing for that day.
   */

  const MIDNIGHT_OWNER_ID = "exec_midnight_owner_clerk_id";
  const MIDNIGHT_CO_SLUG  = "exec-midnight-co";

  let midnightCompanyId: number;
  let midnightInspIds: number[] = [];

  // Build boundary timestamps once, relative to a stable target date.
  // All dates and timestamps use UTC so the test is server-timezone-independent.
  const _now = new Date();
  const targetDateUTC = new Date(
    Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate() - 5),
  );
  // YYYY-MM-DD string for the target date — passed directly to the service.
  const targetDateStr = targetDateUTC.toISOString().slice(0, 10);

  // 1 second before the end of targetDate (23:59:59 UTC → inside window)
  const oneSecBeforeMidnight = new Date(
    Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate() - 5, 23, 59, 59, 0),
  );

  // 1 second after midnight of the NEXT day (00:00:01 UTC of targetDate + 1)
  const oneSecAfterMidnight = new Date(
    Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate() - 5 + 1, 0, 0, 1, 0),
  );

  // End of the day BEFORE targetDate (23:59:59 UTC of targetDate - 1)
  const endOfPreviousDay = new Date(
    Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate() - 5 - 1, 23, 59, 59, 0),
  );

  beforeAll(async () => {
    midnightCompanyId = await findOrCreateCompany("Exec Midnight Co", MIDNIGHT_CO_SLUG);
    await ensureActiveBranding(midnightCompanyId, "Exec Midnight Co Brand");

    // Full teardown so reruns start clean.
    await db.delete(inspectionScorecardsTable).where(eq(inspectionScorecardsTable.companyId, midnightCompanyId));
    await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, midnightCompanyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, midnightCompanyId));
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, MIDNIGHT_OWNER_ID));

    await db.insert(usersTable).values({
      clerkUserId: MIDNIGHT_OWNER_ID,
      role: "owner",
      companyId: midnightCompanyId,
    });

    // insp1: one second before the end of targetDate → must appear in targetDate's briefing.
    const insp1 = await createInspectionViaApi(MIDNIGHT_OWNER_ID, "Midnight Boundary 1 St");
    await db.update(inspectionsTable)
      .set({ status: "completed", createdAt: oneSecBeforeMidnight })
      .where(eq(inspectionsTable.id, insp1));

    // insp2: one second after midnight of the following day → must NOT appear.
    const insp2 = await createInspectionViaApi(MIDNIGHT_OWNER_ID, "Midnight Boundary 2 St");
    await db.update(inspectionsTable)
      .set({ status: "completed", createdAt: oneSecAfterMidnight })
      .where(eq(inspectionsTable.id, insp2));

    // insp3: end of the previous day → must NOT appear.
    const insp3 = await createInspectionViaApi(MIDNIGHT_OWNER_ID, "Midnight Boundary 3 St");
    await db.update(inspectionsTable)
      .set({ status: "completed", createdAt: endOfPreviousDay })
      .where(eq(inspectionsTable.id, insp3));

    midnightInspIds = [insp1, insp2, insp3];
  });

  afterAll(async () => {
    if (midnightInspIds.length) {
      await db.delete(inspectionScorecardsTable).where(
        inArray(inspectionScorecardsTable.inspectionId, midnightInspIds),
      );
      await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, midnightInspIds));
    }
    await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, midnightCompanyId));
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, MIDNIGHT_OWNER_ID));
    await db.delete(brandingProfilesTable).where(eq(brandingProfilesTable.companyId, midnightCompanyId));
    await db.delete(companiesTable).where(eq(companiesTable.slug, MIDNIGHT_CO_SLUG));
  });

  it("counts an inspection created one second before midnight as part of that day's briefing", async () => {
    const result = await generateDailyExecutiveBriefing(midnightCompanyId, targetDateStr);
    expect(result.success).toBe(true);
    // insp1 (23:59:59 UTC of targetDate) is inside the [00:00:00, 23:59:59.999 UTC) window.
    // insp2 and insp3 are outside — the count must be exactly 1.
    expect(result.briefing.inspectionsCount).toBe(1);
  });

  it("does not count an inspection created one second after midnight (start of the next day)", async () => {
    // Request the briefing for targetDate — insp2 belongs to targetDate + 1,
    // so it must not appear regardless of how close to midnight it was created.
    const result = await generateDailyExecutiveBriefing(midnightCompanyId, targetDateStr);
    expect(result.success).toBe(true);
    // If insp2 leaked in, the count would be 2; it must stay at 1.
    expect(result.briefing.inspectionsCount).toBe(1);
  });

  it("does not count an inspection from the day before the target date", async () => {
    // insp3 was created at end-of-day of (targetDate - 1), which is before the
    // window's lower bound (00:00:00.000 UTC of targetDate).
    const result = await generateDailyExecutiveBriefing(midnightCompanyId, targetDateStr);
    expect(result.success).toBe(true);
    // If insp3 leaked in, the count would be 2; it must stay at 1.
    expect(result.briefing.inspectionsCount).toBe(1);
  });

  it("a briefing for 'yesterday' does not include inspections from two days ago", async () => {
    // targetDateStr is 5 days ago; none of our fixtures fall in yesterday's window.
    // This confirms the date window is anchored to the requested day, not a rolling range.
    const now = new Date();
    const yesterdayStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
      .toISOString().slice(0, 10);
    const result = await generateDailyExecutiveBriefing(midnightCompanyId, yesterdayStr);
    expect(result.success).toBe(true);
    expect(result.briefing.inspectionsCount).toBe(0);
  });

  it("a briefing for 'yesterday' does not include inspections from today", async () => {
    // Same fixture company — none of our inspections are dated today.
    // Requesting today's date string should also return 0.
    const now = new Date();
    const todayStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      .toISOString().slice(0, 10);
    const result = await generateDailyExecutiveBriefing(midnightCompanyId, todayStr);
    expect(result.success).toBe(true);
    expect(result.briefing.inspectionsCount).toBe(0);
  });

  it("excludes in_progress and draft inspections — only completed ones count in the briefing total", async () => {
    /**
     * Seed two non-completed inspections timestamped inside the target day's window
     * (same createdAt as insp1, which is completed and already counted).
     *
     * The briefing service filters on status = 'completed', so adding an
     * in_progress and a draft inspection inside the same window must not raise
     * the count above 1.  If the status filter were accidentally removed or
     * widened, this test catches it immediately.
     */
    const inProgressInsp = await createInspectionViaApi(MIDNIGHT_OWNER_ID, "Status Filter In Progress St");
    const draftInsp      = await createInspectionViaApi(MIDNIGHT_OWNER_ID, "Status Filter Draft St");

    // Place both non-completed inspections inside the target day's window.
    await db
      .update(inspectionsTable)
      .set({ status: "in_progress", createdAt: oneSecBeforeMidnight })
      .where(eq(inspectionsTable.id, inProgressInsp));

    await db
      .update(inspectionsTable)
      .set({ status: "draft", createdAt: oneSecBeforeMidnight })
      .where(eq(inspectionsTable.id, draftInsp));

    try {
      const result = await generateDailyExecutiveBriefing(midnightCompanyId, targetDateStr);
      expect(result.success).toBe(true);

      // Only the already-seeded completed insp1 should be counted.
      // in_progress and draft must both be excluded by the status filter.
      expect(result.briefing.inspectionsCount).toBe(1);

      // The summary text must reference "1 inspection" — not 2 or 3, which
      // would indicate non-completed rows leaked into the aggregate.
      expect(result.briefing.summary).toMatch(/\b1\b.*inspection/i);
    } finally {
      // Inline cleanup so these fixtures don't affect sibling tests.
      await db
        .delete(inspectionsTable)
        .where(inArray(inspectionsTable.id, [inProgressInsp, draftInsp]));
    }
  });
});

// ---------------------------------------------------------------------------
// Daily briefing: timezone-aware midnight boundary (Task #411)
// ---------------------------------------------------------------------------

describe("executive briefing: timezone-aware midnight boundary", () => {
  /**
   * Regression guard for the UTC-vs-owner-timezone drift bug.
   *
   * Two inspections are seeded 2 minutes apart, straddling local midnight in
   * "America/New_York" (EDT = UTC-4 in summer):
   *
   *   inspTzA — 23:59:00 Eastern on targetDate
   *             = targetDate+1 at 03:59:00 UTC
   *             → INSIDE the Eastern day window for targetDate
   *
   *   inspTzB — 00:01:00 Eastern on targetDate+1
   *             = targetDate+1 at 04:01:00 UTC
   *             → OUTSIDE the Eastern day window for targetDate
   *
   * If the service naively uses setHours(0,0,0,0) (server UTC), it anchors
   * the window to UTC midnight.  The UTC window for targetDate ends at
   * targetDate+1 00:00:00 UTC, so inspTzA (03:59 UTC) would fall OUTSIDE it —
   * the owner would see 0 inspections when they expect 1.
   *
   * With the fixed timezone-aware boundary, inspTzA is correctly counted and
   * inspTzB is correctly excluded.
   *
   * A dedicated company is used so these fixtures cannot interfere with any
   * other describe blocks.  The target date is 7 days ago to stay clear of
   * "yesterday" and well within the 90-day HTTP guard.
   */

  const TZ_OWNER_ID  = "exec_tz_midnight_owner_clerk_id";
  const TZ_CO_SLUG   = "exec-tz-midnight-co";
  const TEST_TZ      = "America/New_York"; // EDT = UTC-4 in summer

  let tzCompanyId: number;
  let tzInspIds: number[] = [];

  // Target date: 7 days ago expressed as a YYYY-MM-DD string in UTC.
  // We use the UTC date directly — no server-local Date construction — so this
  // test is server-timezone-independent.
  const _now7 = new Date();
  const targetDateStr = new Date(
    Date.UTC(_now7.getUTCFullYear(), _now7.getUTCMonth(), _now7.getUTCDate() - 7),
  ).toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Derive the day window for targetDate in TEST_TZ using the same
  // DST-correct helper used by the service itself.  This guarantees the
  // timestamps we seed into the DB straddle the exact boundary the service
  // will compute, even on DST transition dates.
  const tzBounds = dayBoundsInTimezone(targetDateStr, TEST_TZ);
  // inspTzA: 1 minute before the end of the Eastern day window (inside)
  const ts_inspTzA = new Date(tzBounds.end.getTime() - 60 * 1000);
  // inspTzB: 1 minute after the end of the Eastern day window (outside)
  const ts_inspTzB = new Date(tzBounds.end.getTime() + 60 * 1000);

  beforeAll(async () => {
    tzCompanyId = await findOrCreateCompany("Exec TZ Midnight Co", TZ_CO_SLUG);
    await ensureActiveBranding(tzCompanyId, "Exec TZ Midnight Co Brand");

    // Full teardown so re-runs start clean.
    await db.delete(inspectionScorecardsTable).where(eq(inspectionScorecardsTable.companyId, tzCompanyId));
    await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, tzCompanyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, tzCompanyId));
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, TZ_OWNER_ID));

    await db.insert(usersTable).values({
      clerkUserId: TZ_OWNER_ID,
      role: "owner",
      companyId: tzCompanyId,
    });

    // inspTzA: 23:59 Eastern on targetDate — must appear in the briefing.
    const inspTzA = await createInspectionViaApi(TZ_OWNER_ID, "TZ Midnight A St");
    await db.update(inspectionsTable)
      .set({ status: "completed", createdAt: ts_inspTzA })
      .where(eq(inspectionsTable.id, inspTzA));

    // inspTzB: 00:01 Eastern on targetDate+1 — must NOT appear in targetDate's briefing.
    const inspTzB = await createInspectionViaApi(TZ_OWNER_ID, "TZ Midnight B St");
    await db.update(inspectionsTable)
      .set({ status: "completed", createdAt: ts_inspTzB })
      .where(eq(inspectionsTable.id, inspTzB));

    tzInspIds = [inspTzA, inspTzB];
  });

  afterAll(async () => {
    if (tzInspIds.length) {
      await db.delete(inspectionScorecardsTable).where(
        inArray(inspectionScorecardsTable.inspectionId, tzInspIds),
      );
      await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, tzInspIds));
    }
    await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, tzCompanyId));
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, TZ_OWNER_ID));
    await db.delete(brandingProfilesTable).where(eq(brandingProfilesTable.companyId, tzCompanyId));
    await db.delete(companiesTable).where(eq(companiesTable.slug, TZ_CO_SLUG));
  });

  it("counts inspTzA (59 min before end of Eastern window) inside targetDate's briefing", async () => {
    const result = await generateDailyExecutiveBriefing(tzCompanyId, targetDateStr, TEST_TZ);
    expect(result.success).toBe(true);
    // inspTzA is 1 min before end-of-day Eastern → inside the window.
    // inspTzB is 1 min after  end-of-day Eastern → outside.
    expect(result.briefing.inspectionsCount).toBe(1);
  });

  it("excludes inspTzB (1 min past end of Eastern window) from targetDate's briefing", async () => {
    const result = await generateDailyExecutiveBriefing(tzCompanyId, targetDateStr, TEST_TZ);
    expect(result.success).toBe(true);
    // Count must still be 1 (only inspTzA); if inspTzB leaked in it would be 2.
    expect(result.briefing.inspectionsCount).toBe(1);
  });

  it("WITHOUT timezone param (UTC default) misses inspTzA — confirms the bug this task fixes", async () => {
    // ts_inspTzA is positioned after UTC midnight of the target date
    // (it is near the end of the Eastern day, which is early UTC next day).
    // A UTC-bounded briefing for targetDateStr therefore sees 0 inspections —
    // exactly the pre-fix silent data loss this task corrects.
    const utcResult = await generateDailyExecutiveBriefing(tzCompanyId, targetDateStr, "UTC");
    expect(utcResult.success).toBe(true);
    expect(utcResult.briefing.inspectionsCount).toBe(0);
  });

  it("the HTTP endpoint accepts ?tz=America/New_York and applies timezone-aware bounds", async () => {
    asUser(TZ_OWNER_ID);
    const now = new Date();
    const dateParam = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7))
      .toISOString().slice(0, 10);
    const res = await request(app).get(
      `/api/executive/briefing/yesterday?date=${dateParam}&tz=${encodeURIComponent(TEST_TZ)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The timezone-corrected window counts inspTzA.
    expect(res.body.briefing.inspectionsCount).toBe(1);
  });

  it("the HTTP endpoint returns 400 for an unrecognised ?tz value", async () => {
    asUser(TZ_OWNER_ID);
    const now = new Date();
    const dateParam = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2))
      .toISOString().slice(0, 10);
    const res = await request(app).get(
      `/api/executive/briefing/yesterday?date=${dateParam}&tz=Not/ATimezone`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/IANA timezone/i);
  });

  it("includes an inspection created at exactly the last millisecond of the local day (end - 1 ms)", async () => {
    // The TZ briefing describe company has two fixtures (inspTzA, inspTzB).
    // We seed a third inspection exactly 1 ms before the exclusive end boundary
    // (tzBounds.end is nextDayStart, so end - 1 ms is the last valid instant).
    // This confirms the query uses a correct strict-less-than upper bound and
    // does not accidentally exclude the final millisecond.
    const lastMs = new Date(tzBounds.end.getTime() - 1);
    const inspTzC = await createInspectionViaApi(TZ_OWNER_ID, "TZ Midnight C St");
    await db.update(inspectionsTable)
      .set({ status: "completed", createdAt: lastMs })
      .where(eq(inspectionsTable.id, inspTzC));
    tzInspIds.push(inspTzC);

    const result = await generateDailyExecutiveBriefing(tzCompanyId, targetDateStr, TEST_TZ);
    expect(result.success).toBe(true);
    // inspTzA + inspTzC are inside; inspTzB is outside → count = 2.
    expect(result.briefing.inspectionsCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// dayBoundsInTimezone: unit tests for DST-safe boundary computation
// ---------------------------------------------------------------------------

describe("dayBoundsInTimezone: DST boundary computation", () => {
  /**
   * These are pure unit tests — no DB access, no HTTP.
   * We assert the UTC instants returned by dayBoundsInTimezone against known
   * IANA timezone offsets on specific calendar dates.
   */

  it("returns correct UTC instants for a regular summer day in America/New_York (EDT = UTC-4)", () => {
    // 2026-08-14 is a summer day — EDT throughout.
    const { start, end } = dayBoundsInTimezone("2026-08-14", "America/New_York");
    // Local midnight EDT = UTC 04:00.
    expect(start.toISOString()).toBe("2026-08-14T04:00:00.000Z");
    // Next local midnight EDT (exclusive) = UTC 04:00 next day.
    expect(end.toISOString()).toBe("2026-08-15T04:00:00.000Z");
    // Regular day: exactly 24 hours.
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
  });

  it("returns correct UTC instants for a regular winter day in America/New_York (EST = UTC-5)", () => {
    // 2026-01-15 is a winter day — EST throughout.
    const { start, end } = dayBoundsInTimezone("2026-01-15", "America/New_York");
    // Local midnight EST = UTC 05:00.
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    // Next local midnight EST (exclusive) = UTC 05:00 next day.
    expect(end.toISOString()).toBe("2026-01-16T05:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
  });

  it("returns a 23-hour day for the America/New_York spring-forward date (2025-03-09)", () => {
    // On 2025-03-09 clocks spring forward at 2 am EST → 3 am EDT.
    // Midnight is in EST (UTC-5); the next midnight is in EDT (UTC-4).
    const { start, end } = dayBoundsInTimezone("2025-03-09", "America/New_York");
    // Local midnight EST (UTC-5) = UTC 05:00.
    expect(start.toISOString()).toBe("2025-03-09T05:00:00.000Z");
    // Next local midnight EDT (UTC-4) = UTC 04:00.
    expect(end.toISOString()).toBe("2025-03-10T04:00:00.000Z");
    // Spring-forward → 23-hour day (one hour lost).
    expect(end.getTime() - start.getTime()).toBe(23 * 3600 * 1000);
  });

  it("returns a 25-hour day for the America/New_York fall-back date (2025-11-02)", () => {
    // On 2025-11-02 clocks fall back at 2 am EDT → 1 am EST.
    // Midnight is in EDT (UTC-4); the next midnight is in EST (UTC-5).
    const { start, end } = dayBoundsInTimezone("2025-11-02", "America/New_York");
    // Local midnight EDT (UTC-4) = UTC 04:00.
    expect(start.toISOString()).toBe("2025-11-02T04:00:00.000Z");
    // Next local midnight EST (UTC-5) = UTC 05:00.
    expect(end.toISOString()).toBe("2025-11-03T05:00:00.000Z");
    // Fall-back → 25-hour day (one extra hour).
    expect(end.getTime() - start.getTime()).toBe(25 * 3600 * 1000);
  });

  it("end - 1 ms is on the target local date and end is on the next local date", () => {
    // Confirms 'end' is truly the exclusive next-day boundary, not end-of-day.
    const { start, end } = dayBoundsInTimezone("2026-08-14", "America/New_York");
    const lastMs = new Date(end.getTime() - 1);

    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    expect(fmt.format(start)).toBe("2026-08-14");
    expect(fmt.format(lastMs)).toBe("2026-08-14");  // last ms is still Aug 14
    expect(fmt.format(end)).toBe("2026-08-15");     // end is already Aug 15
  });

  it("correctly handles UTC (no offset, no DST)", () => {
    const { start, end } = dayBoundsInTimezone("2026-06-01", "UTC");
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-02T00:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
  });

  it("correctly handles a positive-offset timezone (Asia/Kolkata, UTC+5:30)", () => {
    // Local midnight IST = UTC 18:30 of the PREVIOUS day.
    const { start, end } = dayBoundsInTimezone("2026-08-14", "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-08-13T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-08-14T18:30:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
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

// ---------------------------------------------------------------------------
// Quality-trend inspections drill-down endpoint tests (Task #358)
//
// GET /api/executive/quality-trend/inspections?weekStart=YYYY-MM-DD
//
// Fixture recap (seeded in beforeAll above):
//   Company A — 2 scorecards in the current ISO week:
//     inspAId  → qualityScore 88, riskLevel "high",     technicianName "Alice", siteAddress "1 Exec Ave"
//     inspA2Id → qualityScore 92, riskLevel "low",      technicianName "Alice", siteAddress "2 Exec Ave"
//   Company B — 1 scorecard in the current ISO week:
//     inspBId  → qualityScore 40, riskLevel "critical",  technicianName "Bob",   siteAddress "99 B Street"
//   Empty company — 0 scorecards
// ---------------------------------------------------------------------------

/** Returns the ISO-date string (YYYY-MM-DD) for the Monday of the current UTC week. */
function currentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday),
  );
  return monday.toISOString().slice(0, 10);
}

describe("quality-trend/inspections endpoint: authentication & role guards", () => {
  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (not an owner)", async () => {
    asUser(EXEC_TECH_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(403);
  });
});

describe("quality-trend/inspections endpoint: input validation", () => {
  it("returns 400 when weekStart is omitted", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app).get("/api/executive/quality-trend/inspections");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weekStart/i);
  });

  it("returns 400 when weekStart is not a valid date string", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections?weekStart=not-a-date");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weekStart/i);
  });
});

describe("quality-trend/inspections endpoint: response shape", () => {
  it("returns success:true with inspections array for an owner", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.inspections)).toBe(true);
    expect(typeof res.body.count).toBe("number");
    expect(typeof res.body.weekStart).toBe("string");
  });

  it("each inspection entry has the required fields", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    for (const insp of res.body.inspections) {
      expect(typeof insp.inspectionId).toBe("number");
      expect(typeof insp.siteAddress).toBe("string");
      expect(typeof insp.technicianName).toBe("string");
      expect(typeof insp.qualityScore).toBe("number");
      expect(typeof insp.riskLevel).toBe("string");
      expect(typeof insp.scoredAt).toBe("string");
    }
  });

  it("returns inspections sorted by qualityScore ascending (lowest first)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    const scores: number[] = res.body.inspections.map(
      (i: { qualityScore: number }) => i.qualityScore,
    );
    const sorted = [...scores].sort((a, b) => a - b);
    expect(scores).toEqual(sorted);
  });

  it("count field matches the length of the inspections array", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.inspections.length);
  });

  it("returns an empty inspections array for a week with no scorecards", async () => {
    asUser(EXEC_OWNER_A);
    // A week far in the past guaranteed to have no scorecards.
    const res = await request(app)
      .get("/api/executive/quality-trend/inspections?weekStart=2000-01-03");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inspections).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });
});

describe("quality-trend/inspections endpoint: cross-company isolation", () => {
  /**
   * Company A has 2 scorecards (scores 88 and 92) and Company B has 1 (score 40).
   * All three were created ~now and fall in the same ISO week. Isolation means:
   *   - Company A sees exactly its 2 inspections, not B's.
   *   - Company B sees exactly its 1 inspection, not A's.
   *   - The empty company sees 0 inspections.
   */

  it("company A owner sees exactly 2 inspections — its own scorecards only", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.inspections).toHaveLength(2);
  });

  it("company A's inspections show quality scores 88 and 92, not 40 (company B's score)", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    const scores: number[] = res.body.inspections.map(
      (i: { qualityScore: number }) => i.qualityScore,
    );
    // Sorted ascending: [88, 92]
    expect(scores).toEqual([88, 92]);
    // Company B's score must not appear.
    expect(scores).not.toContain(40);
  });

  it("company A's results reference its own site addresses, not company B's", async () => {
    asUser(EXEC_OWNER_A);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    const addresses: string[] = res.body.inspections.map(
      (i: { siteAddress: string }) => i.siteAddress,
    );
    // Must contain A's addresses.
    expect(addresses).toContain("1 Exec Ave");
    expect(addresses).toContain("2 Exec Ave");
    // Must not contain B's address.
    expect(addresses).not.toContain("99 B Street");
  });

  it("company B owner sees exactly 1 inspection — its own scorecard only", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.inspections).toHaveLength(1);
  });

  it("company B's inspection has qualityScore 40 and riskLevel critical", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    const insp = res.body.inspections[0];
    expect(insp.qualityScore).toBe(40);
    expect(insp.riskLevel).toBe("critical");
    expect(insp.siteAddress).toBe("99 B Street");
  });

  it("company B's results do not include company A's inspections (scores 88, 92)", async () => {
    asUser(EXEC_OWNER_B);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    const scores: number[] = res.body.inspections.map(
      (i: { qualityScore: number }) => i.qualityScore,
    );
    expect(scores).not.toContain(88);
    expect(scores).not.toContain(92);
  });

  it("empty-company owner sees 0 inspections even though other companies have scorecards this week", async () => {
    asUser(EXEC_OWNER_EMPTY);
    const res = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.inspections).toHaveLength(0);
  });

  it("both companies share the same ISO weekStart but see different inspection lists", async () => {
    asUser(EXEC_OWNER_A);
    const resA = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);

    asUser(EXEC_OWNER_B);
    const resB = await request(app)
      .get(`/api/executive/quality-trend/inspections?weekStart=${currentWeekStart()}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Both use the same weekStart — cross-tenant bleed would surface here.
    expect(resA.body.weekStart).toBe(resB.body.weekStart);

    // But each returns only its own data.
    expect(resA.body.count).toBe(2);
    expect(resB.body.count).toBe(1);

    const aIds: number[] = resA.body.inspections.map((i: { inspectionId: number }) => i.inspectionId);
    const bIds: number[] = resB.body.inspections.map((i: { inspectionId: number }) => i.inspectionId);

    // The inspection ID sets must be disjoint.
    const overlap = aIds.filter((id) => bIds.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
