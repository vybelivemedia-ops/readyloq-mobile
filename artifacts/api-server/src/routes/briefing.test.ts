import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Role Briefing tests.
 *
 * The briefing is the role-adaptive dashboard read model: one endpoint, no
 * requireRole, shape decided server-side from the DB-sourced user role.
 * - each role receives ONLY its own section (technician payload physically
 *   contains no sales/manager/owner keys, and so on)
 * - every number is company-scoped (tenant isolation)
 * - unauthenticated → 401
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

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(async () => ({ choices: [{ message: { content: null } }] })),
      },
    },
  },
}));

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  opportunitiesTable,
  salesProposalsTable,
  inspectionScorecardsTable,
  customerSummariesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const OWNER_A_ID = "brief_owner_a_clerk_id";
const MANAGER_A_ID = "brief_manager_a_clerk_id";
const SALES_A_ID = "brief_sales_a_clerk_id";
const TECH_A_ID = "brief_tech_a_clerk_id";
const OWNER_B_ID = "brief_owner_b_clerk_id";

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

let companyAId: number;
let companyBId: number;
let salesAUserId: number;

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

async function seedInspection(
  companyId: number,
  siteAddress: string,
  opts: { completed?: boolean; completedDaysAgo?: number; findingsCount?: number; pestTypes?: string[] } = {},
) {
  const completed = opts.completed ?? false;
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress,
      technicianName: "Briefing Tech",
      status: completed ? "completed" : "pending",
      completedAt: completed ? daysAgo(opts.completedDaysAgo ?? 1) : null,
      findingsCount: opts.findingsCount ?? 0,
      pestTypes: opts.pestTypes ?? [],
    })
    .returning();
  return row;
}

async function seedOpportunity(
  companyId: number,
  inspectionId: number,
  opts: {
    title: string;
    status?: "new" | "reviewed" | "quoted" | "won" | "lost" | "dismissed";
    priority?: number;
    estimatedAnnualValue?: number | null;
    updatedAt?: Date;
  },
) {
  const [row] = await db
    .insert(opportunitiesTable)
    .values({
      companyId,
      inspectionId,
      propertyAddress: "100 Briefing Street",
      category: "structural",
      title: opts.title,
      rationale: "Test rationale grounded in findings.",
      fingerprint: `structural|${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      evidenceFindingIds: [1],
      evidenceImagePaths: [],
      estimatedValueTier: "medium",
      confidence: 0.8,
      priority: opts.priority ?? 50,
      status: opts.status ?? "new",
      estimatedAnnualValue: opts.estimatedAnnualValue ?? null,
      ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
    })
    .returning();
  return row;
}

async function seedScorecard(
  companyId: number,
  inspectionId: number,
  opts: { qualityScore: number; riskLevel?: "low" | "medium" | "high" | "critical" },
) {
  const [row] = await db
    .insert(inspectionScorecardsTable)
    .values({
      companyId,
      inspectionId,
      technicianName: "Briefing Tech",
      qualityScore: opts.qualityScore,
      components: {
        photoCoverage: 80,
        evidenceQuality: 80,
        avgConfidence: 80,
        recommendationCoverage: 80,
      },
      missedOpportunities: [
        { findingId: 1, serviceType: "exclusion", description: "gap", severity: "moderate" },
      ],
      riskScore: 40,
      riskLevel: opts.riskLevel ?? "low",
    })
    .returning();
  return row;
}

async function seedSummary(
  companyId: number,
  inspectionId: number,
  opts: {
    status?: "draft" | "approved";
    createdAt?: Date;
    approvedAt?: Date;
    shareExpiresAt?: Date;
  } = {},
) {
  const [row] = await db
    .insert(customerSummariesTable)
    .values({
      companyId,
      inspectionId,
      body: "Homeowner-friendly summary body.",
      status: opts.status ?? "draft",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      ...(opts.approvedAt ? { approvedAt: opts.approvedAt } : {}),
      ...(opts.shareExpiresAt
        ? { shareToken: `brief-token-${inspectionId}`, shareExpiresAt: opts.shareExpiresAt }
        : {}),
    })
    .returning();
  return row;
}

async function cleanBriefingRows() {
  // Delete children before inspections; scoped to this suite's companies so
  // other suites' fixtures are untouched.
  const companies = [companyAId, companyBId];
  await db.delete(salesProposalsTable).where(inArray(salesProposalsTable.companyId, companies));
  await db
    .delete(customerSummariesTable)
    .where(inArray(customerSummariesTable.companyId, companies));
  await db
    .delete(inspectionScorecardsTable)
    .where(inArray(inspectionScorecardsTable.companyId, companies));
  await db.delete(opportunitiesTable).where(inArray(opportunitiesTable.companyId, companies));
  await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, companies));
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Brief Co A", "brief-co-a");
  companyBId = await findOrCreateCompany("Brief Co B", "brief-co-b");

  const clerkIds = [OWNER_A_ID, MANAGER_A_ID, SALES_A_ID, TECH_A_ID, OWNER_B_ID];
  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, clerkIds));
  const users = await db
    .insert(usersTable)
    .values([
      { clerkUserId: OWNER_A_ID, role: "owner", companyId: companyAId },
      { clerkUserId: MANAGER_A_ID, role: "manager", companyId: companyAId },
      { clerkUserId: SALES_A_ID, role: "sales", companyId: companyAId },
      { clerkUserId: TECH_A_ID, role: "technician", companyId: companyAId },
      { clerkUserId: OWNER_B_ID, role: "owner", companyId: companyBId },
    ])
    .returning();
  salesAUserId = users.find((u) => u.clerkUserId === SALES_A_ID)!.id;
});

beforeEach(async () => {
  asUser(null);
  await cleanBriefingRows();
});

afterAll(async () => {
  // Leave no rows referencing this suite's users so later suites can reset
  // the users table without FK violations.
  await cleanBriefingRows();
});

describe("auth and role shaping", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(401);
  });

  it("serves each role ONLY its own section", async () => {
    const cases: [string, string][] = [
      [TECH_A_ID, "technician"],
      [SALES_A_ID, "sales"],
      [MANAGER_A_ID, "manager"],
      [OWNER_A_ID, "owner"],
    ];
    for (const [clerkId, role] of cases) {
      asUser(clerkId);
      const res = await request(app).get("/api/briefing");
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(role);
      for (const section of ["technician", "sales", "manager", "owner"]) {
        if (section === role) {
          expect(res.body[section], `${role} should have its ${section} section`).toBeDefined();
        } else {
          expect(res.body[section], `${role} must NOT receive a ${section} section`).toBeUndefined();
        }
      }
    }
  });
});

describe("technician briefing", () => {
  it("reports inspection counts and recents only", async () => {
    await seedInspection(companyAId, "1 Open Lane");
    await seedInspection(companyAId, "2 Done Drive", { completed: true, completedDaysAgo: 2 });
    await seedInspection(companyAId, "3 Old Court", { completed: true, completedDaysAgo: 20 });

    asUser(TECH_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const t = res.body.technician;
    expect(t.totalInspections).toBe(3);
    expect(t.completedInspections).toBe(2);
    expect(t.openInspections).toBe(1);
    expect(t.completedThisWeek).toBe(1);
    expect(t.recentInspections.length).toBe(3);
  });
});

describe("building history pest-type union", () => {
  it("unions pest types across multiple visits to the same address", async () => {
    // Visit 1: rodents only
    await seedInspection(companyAId, "50 Union Ave", {
      completed: true,
      completedDaysAgo: 10,
      pestTypes: ["rodents"],
    });
    // Visit 2: cockroaches only (different finding, same address)
    await seedInspection(companyAId, "50 Union Ave", {
      completed: true,
      completedDaysAgo: 3,
      pestTypes: ["cockroaches"],
    });

    asUser(TECH_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const history = res.body.technician.siteHistory as Array<{
      siteAddress: string;
      visitCount: number;
      pestTypes: string[];
    }>;
    const entry = history.find((h) => h.siteAddress === "50 Union Ave");
    expect(entry).toBeDefined();
    expect(entry!.visitCount).toBe(2);
    // Both pest types from both visits must appear (union, sorted alphabetically by the query)
    expect(entry!.pestTypes).toContain("rodents");
    expect(entry!.pestTypes).toContain("cockroaches");
    expect(entry!.pestTypes).toHaveLength(2);
  });

  it("does not break the union when one visit has no pest types", async () => {
    // Visit 1: ants recorded
    await seedInspection(companyAId, "51 Empty Lane", {
      completed: true,
      completedDaysAgo: 8,
      pestTypes: ["ants"],
    });
    // Visit 2: no pest types recorded (empty array)
    await seedInspection(companyAId, "51 Empty Lane", {
      completed: true,
      completedDaysAgo: 2,
      pestTypes: [],
    });

    asUser(TECH_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const history = res.body.technician.siteHistory as Array<{
      siteAddress: string;
      visitCount: number;
      pestTypes: string[];
    }>;
    const entry = history.find((h) => h.siteAddress === "51 Empty Lane");
    expect(entry).toBeDefined();
    expect(entry!.visitCount).toBe(2);
    // "ants" still appears even though the second visit had no pest types
    expect(entry!.pestTypes).toEqual(["ants"]);
  });

  it("returns the correct pest types for an address with a single visit", async () => {
    await seedInspection(companyAId, "52 Solo Street", {
      completed: true,
      completedDaysAgo: 5,
      pestTypes: ["termites", "bedbugs"],
    });

    asUser(TECH_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const history = res.body.technician.siteHistory as Array<{
      siteAddress: string;
      visitCount: number;
      pestTypes: string[];
    }>;
    const entry = history.find((h) => h.siteAddress === "52 Solo Street");
    expect(entry).toBeDefined();
    expect(entry!.visitCount).toBe(1);
    expect(entry!.pestTypes).toContain("termites");
    expect(entry!.pestTypes).toContain("bedbugs");
    expect(entry!.pestTypes).toHaveLength(2);
  });

  it("returns an empty pestTypes array when all visits at an address have no pest activity", async () => {
    await seedInspection(companyAId, "53 Clean Court", {
      completed: true,
      completedDaysAgo: 4,
      pestTypes: [],
    });

    asUser(TECH_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const history = res.body.technician.siteHistory as Array<{
      siteAddress: string;
      visitCount: number;
      pestTypes: string[];
    }>;
    const entry = history.find((h) => h.siteAddress === "53 Clean Court");
    expect(entry).toBeDefined();
    expect(entry!.pestTypes).toEqual([]);
  });
});

describe("site history ordering and limit", () => {
  it("returns exactly the 8 most-recently-visited addresses and omits the oldest when 9+ distinct addresses exist", async () => {
    // Seed 9 distinct addresses.  Address 9 is the oldest and must be dropped.
    const addresses = [
      { addr: "1 Recent Rd",    daysAgo: 1  },
      { addr: "2 Second Ave",   daysAgo: 2  },
      { addr: "3 Third St",     daysAgo: 4  },
      { addr: "4 Fourth Blvd",  daysAgo: 6  },
      { addr: "5 Fifth Ln",     daysAgo: 8  },
      { addr: "6 Sixth Dr",     daysAgo: 12 },
      { addr: "7 Seventh Way",  daysAgo: 16 },
      { addr: "8 Eighth Ct",    daysAgo: 20 },
      { addr: "9 Oldest Pl",    daysAgo: 35 }, // must be absent — pushed off by the LIMIT 8
    ];

    for (const { addr, daysAgo: d } of addresses) {
      await seedInspection(companyAId, addr, {
        completed: true,
        completedDaysAgo: d,
        findingsCount: 1,
      });
    }

    asUser(TECH_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);

    const history = res.body.technician.siteHistory as Array<{
      siteAddress: string;
      lastVisitedAt: string;
    }>;

    // Exactly 8 entries must be returned.
    expect(history).toHaveLength(8);

    // The oldest address must not appear.
    const siteAddresses = history.map((h) => h.siteAddress);
    expect(siteAddresses).not.toContain("9 Oldest Pl");

    // All 8 retained addresses must be present.
    for (const { addr } of addresses.slice(0, 8)) {
      expect(siteAddresses).toContain(addr);
    }

    // Results must be ordered most-recent first (descending lastVisitedAt).
    const visitDates = history.map((h) => new Date(h.lastVisitedAt).getTime());
    for (let i = 1; i < visitDates.length; i++) {
      expect(visitDates[i]).toBeLessThanOrEqual(visitDates[i - 1]);
    }

    // The very first entry should be the address visited 1 day ago.
    expect(history[0].siteAddress).toBe("1 Recent Rd");
  });
});

describe("sales briefing", () => {
  it("aggregates pipeline, value, staleness, top opportunities, proposals", async () => {
    const insp = await seedInspection(companyAId, "10 Pipeline Pl", { completed: true });
    await seedOpportunity(companyAId, insp.id, {
      title: "Fresh high priority",
      status: "new",
      priority: 90,
      estimatedAnnualValue: 1200,
    });
    await seedOpportunity(companyAId, insp.id, {
      title: "Stale reviewed",
      status: "reviewed",
      priority: 40,
      estimatedAnnualValue: 800,
      updatedAt: daysAgo(20),
    });
    await seedOpportunity(companyAId, insp.id, {
      title: "Already won",
      status: "won",
      priority: 70,
      estimatedAnnualValue: 5000,
    });
    await db.insert(salesProposalsTable).values({
      companyId: companyAId,
      propertyAddress: "10 Pipeline Pl",
      title: "Exclusion bundle",
      status: "sent",
      opportunityIds: [],
      createdByUserId: salesAUserId,
    });

    asUser(SALES_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const s = res.body.sales;
    expect(s.pipeline).toEqual({ new: 1, reviewed: 1, quoted: 0, won: 1, lost: 0, dismissed: 0 });
    expect(s.openCount).toBe(2);
    // Only OPEN opportunities count toward pipeline value (1200 + 800).
    expect(s.pipelineValue).toBe(2000);
    expect(s.staleCount).toBe(1);
    expect(s.topOpportunities.length).toBe(2);
    expect(s.topOpportunities[0].title).toBe("Fresh high priority");
    expect(s.proposals).toEqual({ draft: 0, sent: 1, accepted: 0, declined: 0 });
  });
});

describe("manager briefing", () => {
  it("serves the approvals queue oldest-first plus team scorecard stats", async () => {
    const inspOld = await seedInspection(companyAId, "20 Oldest Ave", {
      completed: true,
      completedDaysAgo: 6,
      findingsCount: 4,
    });
    const inspNew = await seedInspection(companyAId, "21 Newest Blvd", {
      completed: true,
      completedDaysAgo: 1,
      findingsCount: 2,
    });
    await seedSummary(companyAId, inspOld.id, { status: "draft", createdAt: daysAgo(5) });
    await seedSummary(companyAId, inspNew.id, { status: "draft", createdAt: daysAgo(1) });
    await seedScorecard(companyAId, inspOld.id, { qualityScore: 80, riskLevel: "high" });
    await seedScorecard(companyAId, inspNew.id, { qualityScore: 60, riskLevel: "low" });

    asUser(MANAGER_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const m = res.body.manager;
    expect(m.pendingApprovals).toBe(2);
    expect(m.approvalsQueue[0].siteAddress).toBe("20 Oldest Ave");
    expect(m.approvalsQueue[0].ageDays).toBeGreaterThanOrEqual(4);
    expect(m.team.scorecardCount30d).toBe(2);
    expect(m.team.avgQualityScore30d).toBe(70);
    expect(m.team.highRisk30d).toBe(1);
    expect(m.team.missedOpportunities30d).toBe(2);
    expect(m.team.technicians[0].technicianName).toBe("Briefing Tech");
    expect(m.recentCompletions.length).toBe(2);
    expect(m.recentCompletions[0].siteAddress).toBe("21 Newest Blvd");
  });
});

describe("owner briefing", () => {
  it("serves KPIs and derives alerts from existing rows", async () => {
    const insp = await seedInspection(companyAId, "30 Executive Way", {
      completed: true,
      completedDaysAgo: 2,
    });
    const insp2 = await seedInspection(companyAId, "31 Boardroom Rd", {
      completed: true,
      completedDaysAgo: 10,
    });
    // Aging draft (>3d) → approvals_aging alert.
    await seedSummary(companyAId, insp.id, { status: "draft", createdAt: daysAgo(5) });
    // Approved with a share link expiring in 2 days → share_links_expiring.
    await seedSummary(companyAId, insp2.id, {
      status: "approved",
      approvedAt: daysAgo(10),
      shareExpiresAt: new Date(Date.now() + 2 * DAY_MS),
    });
    // Low quality + critical risk → quality_low AND high_risk alerts.
    await seedScorecard(companyAId, insp.id, { qualityScore: 40, riskLevel: "critical" });
    // Stale priced opportunity → stale_pipeline alert.
    await seedOpportunity(companyAId, insp.id, {
      title: "Stale priced deal",
      status: "new",
      estimatedAnnualValue: 3000,
      updatedAt: daysAgo(21),
    });

    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    const o = res.body.owner;
    expect(o.kpis.completions7d).toBe(1);
    expect(o.kpis.completions30d).toBe(2);
    expect(o.kpis.openOpportunities).toBe(1);
    expect(o.kpis.pipelineValue).toBe(3000);
    expect(o.kpis.avgQualityScore30d).toBe(40);
    expect(o.kpis.approvedSummaries30d).toBe(1);

    const types = o.alerts.map((a: { type: string }) => a.type);
    expect(types).toContain("approvals_aging");
    expect(types).toContain("quality_low");
    expect(types).toContain("high_risk");
    expect(types).toContain("stale_pipeline");
    expect(types).toContain("share_links_expiring");
  });

  it("returns no alerts when nothing needs attention", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    expect(res.body.owner.alerts).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("never counts another company's rows", async () => {
    const inspB = await seedInspection(companyBId, "99 Rival Road", { completed: true });
    await seedOpportunity(companyBId, inspB.id, {
      title: "Rival opportunity",
      status: "new",
      estimatedAnnualValue: 9999,
    });
    await seedSummary(companyBId, inspB.id, { status: "draft", createdAt: daysAgo(10) });
    await seedScorecard(companyBId, inspB.id, { qualityScore: 10, riskLevel: "critical" });

    asUser(OWNER_A_ID);
    const owner = await request(app).get("/api/briefing");
    expect(owner.body.owner.kpis.completions30d).toBe(0);
    expect(owner.body.owner.kpis.openOpportunities).toBe(0);
    expect(owner.body.owner.alerts).toEqual([]);

    asUser(SALES_A_ID);
    const sales = await request(app).get("/api/briefing");
    expect(sales.body.sales.pipelineValue).toBe(0);

    asUser(MANAGER_A_ID);
    const manager = await request(app).get("/api/briefing");
    expect(manager.body.manager.pendingApprovals).toBe(0);

    asUser(OWNER_B_ID);
    const ownerB = await request(app).get("/api/briefing");
    expect(ownerB.body.owner.kpis.openOpportunities).toBe(1);
    expect(ownerB.body.owner.kpis.pipelineValue).toBe(9999);
  });
});
