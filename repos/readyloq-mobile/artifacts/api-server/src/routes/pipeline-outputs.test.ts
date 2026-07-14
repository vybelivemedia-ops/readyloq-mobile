import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Multi-output pipeline tests: scorecards, customer summaries (+ public
 * share), sales proposals, and the opportunity upgrades (priority/risk,
 * human-only annual value, notes thread, "lost" status).
 *
 * Invariants under test:
 * - Role gates: scorecards + summaries are manager+; proposals sales+;
 *   technicians 403 everywhere.
 * - Determinism: scorecard math and opportunity priority are pure functions —
 *   no AI values pass through unvalidated.
 * - No fabrication: summaries with pricing language are rejected outright.
 * - Share links: token is the only key; missing/expired/revoked → uniform
 *   404; payload NEVER contains photos.
 * - Tenant isolation on every new table.
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

const { aiState } = vi.hoisted(() => ({
  aiState: { response: null as string | null },
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: aiState.response } }],
        })),
      },
    },
  },
}));

import app from "../app";
import { computeScorecard, runScorecardComputation } from "../lib/scorecard";
import { computeOpportunityPriority, computeOpportunityRisk } from "../lib/opportunity-ai";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionScorecardsTable,
  customerSummariesTable,
  salesProposalsTable,
  opportunitiesTable,
  opportunityEventsTable,
  opportunityNotesTable,
  quizzesTable,
  propertyProfilesTable,
  propertyNotesTable,
  datasetImagesTable,
  intelligenceRecordsTable,
  brandingProfilesTable,
  type Finding,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const OWNER_A_ID = "po_owner_a_clerk_id";
const MANAGER_A_ID = "po_manager_a_clerk_id";
const SALES_A_ID = "po_sales_a_clerk_id";
const TECH_A_ID = "po_tech_a_clerk_id";
const OWNER_B_ID = "po_owner_b_clerk_id";

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

async function createInspection(clerkId: string, siteAddress: string) {
  asUser(clerkId);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress, technicianName: "Tech Casey", clientName: "Client", pestTypes: ["ants"] });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

const FINDINGS: Finding[] = [
  {
    id: 1,
    category: "Structural Deficiency",
    description: "Gap under garage door seal",
    confidence: 0.9,
    severity: "high",
    location: "Garage",
    imageUrl: "/objects/companies/1/uploads/photo-1",
    treatment: "Install door sweep",
    exclusionOpportunity: true,
    structuralIssue: "Failed garage door seal",
  },
  {
    id: 2,
    category: "Moisture Condition",
    description: "Standing water near crawl space vent",
    confidence: 0.7,
    severity: "medium",
    location: "Crawl space",
    imageUrl: "/objects/companies/1/uploads/photo-2",
    treatment: null,
    exclusionOpportunity: false,
  },
];

async function seedAnalysis(companyId: number, inspectionId: number) {
  const [row] = await db
    .insert(analysisResultsTable)
    .values({
      companyId,
      inspectionId,
      status: "complete",
      findings: FINDINGS,
      recommendations: ["Install door sweep at garage entry"],
      analyzedImagePaths: ["/objects/companies/1/uploads/photo-1"],
      overallConfidence: 0.8,
      riskLevel: "high",
    })
    .returning();
  return row;
}

async function seedOpportunity(companyId: number, inspectionId: number, title: string) {
  const [row] = await db
    .insert(opportunitiesTable)
    .values({
      companyId,
      inspectionId,
      propertyAddress: "100 Pipeline Street",
      category: "structural",
      title,
      rationale: "Grounded rationale.",
      fingerprint: `structural|${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      evidenceFindingIds: [1],
      evidenceImagePaths: [],
      estimatedValueTier: "medium",
      confidence: 0.8,
      status: "new",
    })
    .returning();
  return row;
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Pipe Co A", "pipe-co-a");
  companyBId = await findOrCreateCompany("Pipe Co B", "pipe-co-b");

  await db.delete(opportunityNotesTable);
  await db.delete(opportunityEventsTable);
  await db.delete(opportunitiesTable);
  await db.delete(salesProposalsTable);
  await db.delete(customerSummariesTable);
  await db.delete(inspectionScorecardsTable);
  await db.delete(analysisResultsTable);
  await db.delete(inspectionsTable);
  // Order-independent cleanup: other suites may leave rows referencing users;
  // clear them before users or the FK blocks the reset.
  await db.delete(quizzesTable);
  await db.delete(propertyProfilesTable);
  await db.delete(propertyNotesTable);
  await db.delete(datasetImagesTable);
  await db.delete(intelligenceRecordsTable);
  await db.delete(brandingProfilesTable);
  await db.delete(usersTable);

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_A_ID, role: "owner", companyId: companyAId },
    { clerkUserId: MANAGER_A_ID, role: "manager", companyId: companyAId },
    { clerkUserId: SALES_A_ID, role: "sales", companyId: companyAId },
    { clerkUserId: TECH_A_ID, role: "technician", companyId: companyAId },
    { clerkUserId: OWNER_B_ID, role: "owner", companyId: companyBId },
  ]);
});

beforeEach(async () => {
  asUser(null);
  aiState.response = null;
  await db.delete(opportunityNotesTable);
  await db.delete(opportunityEventsTable);
  await db.delete(opportunitiesTable);
  await db.delete(salesProposalsTable);
  await db.delete(customerSummariesTable);
  await db.delete(inspectionScorecardsTable);
  await db.delete(analysisResultsTable);
});

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------

describe("scorecard engine (deterministic)", () => {
  it("computes components, missed opportunities, and risk with pure math", () => {
    const recommendations = ["Seal the gap under the garage door with a door sweep"];
    const result = computeScorecard({
      findings: FINDINGS,
      recommendations,
      photosAnalyzed: 4,
    });
    // 4 of 8 baseline photos
    expect(result.components.photoCoverage).toBe(50);
    // both findings have imageUrl
    expect(result.components.evidenceQuality).toBe(100);
    // (0.9 + 0.7) / 2 = 0.8
    expect(result.components.avgConfidence).toBe(80);
    // finding 1 maps to "exclusion" (exclusionOpportunity: true) and is
    // documented via the "seal" keyword; finding 2 (moisture) has NO matching
    // recommendation → missed.
    expect(result.missedOpportunities).toHaveLength(1);
    expect(result.missedOpportunities[0].findingId).toBe(2);
    expect(result.missedOpportunities[0].serviceType).toBe("Moisture Correction");
    expect(result.components.recommendationCoverage).toBe(50);
    // high(25) + medium(10) = 35 → "medium" band
    expect(result.riskScore).toBe(35);
    expect(result.riskLevel).toBe("medium");
    // same inputs, same outputs
    expect(
      computeScorecard({ findings: FINDINGS, recommendations, photosAnalyzed: 4 }),
    ).toEqual(result);
  });

  it("gives a clean documented inspection full credit, not a zero", () => {
    const result = computeScorecard({ findings: [], recommendations: [], photosAnalyzed: 8 });
    expect(result.qualityScore).toBe(100);
    expect(result.riskScore).toBe(0);
    expect(result.riskLevel).toBe("low");
  });

  it("upserts one scorecard per inspection", async () => {
    const insp = await createInspection(OWNER_A_ID, "10 Scorecard Way");
    await runScorecardComputation({
      companyId: companyAId,
      inspectionId: insp.id,
      findings: FINDINGS,
      recommendations: [],
      photosAnalyzed: 2,
    });
    await runScorecardComputation({
      companyId: companyAId,
      inspectionId: insp.id,
      findings: FINDINGS,
      recommendations: ["Install door sweep at garage entry"],
      photosAnalyzed: 8,
    });
    const rows = await db
      .select()
      .from(inspectionScorecardsTable)
      .where(eq(inspectionScorecardsTable.inspectionId, insp.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].photosAnalyzed).toBe(8);
    expect(rows[0].technicianName).toBe("Tech Casey");
  });

  it("is manager+ only: technician AND sales get 403", async () => {
    for (const clerkId of [TECH_A_ID, SALES_A_ID]) {
      asUser(clerkId);
      expect((await request(app).get("/api/scorecards")).status).toBe(403);
      expect((await request(app).get("/api/scorecards/summary")).status).toBe(403);
    }
    for (const clerkId of [MANAGER_A_ID, OWNER_A_ID]) {
      asUser(clerkId);
      expect((await request(app).get("/api/scorecards")).status).toBe(200);
      expect((await request(app).get("/api/scorecards/summary")).status).toBe(200);
    }
  });

  it("keeps scorecards tenant-isolated", async () => {
    const inspA = await createInspection(OWNER_A_ID, "11 Scorecard Way");
    const inspB = await createInspection(OWNER_B_ID, "12 Other Co Road");
    await runScorecardComputation({
      companyId: companyAId,
      inspectionId: inspA.id,
      findings: FINDINGS,
      recommendations: [],
      photosAnalyzed: 3,
    });
    await runScorecardComputation({
      companyId: companyBId,
      inspectionId: inspB.id,
      findings: FINDINGS,
      recommendations: [],
      photosAnalyzed: 3,
    });

    asUser(MANAGER_A_ID);
    const list = await request(app).get("/api/scorecards");
    expect(list.status).toBe(200);
    const inspectionIds = list.body.map((s: { inspectionId: number }) => s.inspectionId);
    expect(inspectionIds).toContain(inspA.id);
    expect(inspectionIds).not.toContain(inspB.id);

    const cross = await request(app).get(`/api/scorecards/inspection/${inspB.id}`);
    expect(cross.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Opportunity upgrades: priority, risk, lost, annual value, notes
// ---------------------------------------------------------------------------

describe("opportunity priority + risk (computed, never AI-set)", () => {
  it("computes the documented formula", () => {
    const cited = [FINDINGS[1]]; // medium severity
    // 0.35*0.6 + 0.25*0.85 + 0.25*(2/3) + 0.15*0 = 0.58917 → 59
    expect(
      computeOpportunityPriority({ cited, confidence: 0.85, tier: "medium", occurrences: 1 }),
    ).toBe(59);
    // recurrence kicks in at 2+ occurrences
    expect(
      computeOpportunityPriority({ cited, confidence: 0.85, tier: "medium", occurrences: 2 }),
    ).toBe(74);
  });

  it("maps cited severities to risk levels", () => {
    expect(computeOpportunityRisk([FINDINGS[1]])).toBe("medium");
    expect(computeOpportunityRisk([FINDINGS[0]])).toBe("high");
    expect(computeOpportunityRisk([FINDINGS[0], { ...FINDINGS[0], id: 3 }])).toBe("critical");
    expect(computeOpportunityRisk([])).toBe("low");
  });
});

describe("opportunity status 'lost' + annual value + notes", () => {
  it("lets sales move pipeline but requires manager+ for lost", async () => {
    const insp = await createInspection(OWNER_A_ID, "20 Opp Street");
    const opp = await seedOpportunity(companyAId, insp.id, "Crawl space encapsulation");

    asUser(SALES_A_ID);
    const salesLost = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ status: "lost" });
    expect(salesLost.status).toBe(403);

    asUser(MANAGER_A_ID);
    const managerLost = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ status: "lost" });
    expect(managerLost.status).toBe(200);
    expect(managerLost.body.status).toBe("lost");
  });

  it("accepts human-entered annual value and audits it; rejects garbage", async () => {
    const insp = await createInspection(OWNER_A_ID, "21 Opp Street");
    const opp = await seedOpportunity(companyAId, insp.id, "Quarterly exterior program");

    asUser(SALES_A_ID);
    const set = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ estimatedAnnualValue: 2400 });
    expect(set.status).toBe(200);
    expect(set.body.estimatedAnnualValue).toBe(2400);

    const bad = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ estimatedAnnualValue: -5 });
    expect(bad.status).toBe(400);
    const fractional = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ estimatedAnnualValue: 99.5 });
    expect(fractional.status).toBe(400);

    const events = await db
      .select()
      .from(opportunityEventsTable)
      .where(eq(opportunityEventsTable.opportunityId, opp.id));
    expect(events.map((e) => e.action)).toContain("value_set");
  });

  it("appends notes with author role, audits them, and isolates across tenants", async () => {
    const insp = await createInspection(OWNER_A_ID, "22 Opp Street");
    const opp = await seedOpportunity(companyAId, insp.id, "Rodent exclusion bundle");

    asUser(TECH_A_ID);
    expect(
      (await request(app).post(`/api/opportunities/${opp.id}/notes`).send({ body: "hi" }))
        .status,
    ).toBe(403);

    asUser(SALES_A_ID);
    const created = await request(app)
      .post(`/api/opportunities/${opp.id}/notes`)
      .send({ body: "Customer asked for a quote next week." });
    expect(created.status).toBe(201);
    expect(created.body.authorRole).toBe("sales");

    const list = await request(app).get(`/api/opportunities/${opp.id}/notes`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const events = await db
      .select()
      .from(opportunityEventsTable)
      .where(eq(opportunityEventsTable.opportunityId, opp.id));
    expect(events.map((e) => e.action)).toContain("note_added");

    asUser(OWNER_B_ID);
    expect((await request(app).get(`/api/opportunities/${opp.id}/notes`)).status).toBe(404);
    expect(
      (await request(app).post(`/api/opportunities/${opp.id}/notes`).send({ body: "sneaky" }))
        .status,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Customer summaries + public share
// ---------------------------------------------------------------------------

describe("customer summaries (manager-gated, AI rephrase with fidelity gate)", () => {
  const GOOD_SUMMARY =
    "Thanks for having us out. During the visit our technician found a gap under the garage door and some standing water near the crawl space vent. We recommend installing a door sweep to close the gap. We will keep an eye on the moisture at your next service.";

  it("is manager+ only", async () => {
    for (const clerkId of [TECH_A_ID, SALES_A_ID]) {
      asUser(clerkId);
      const res = await request(app).get("/api/customer-summaries/inspection/1");
      expect(res.status).toBe(403);
    }
  });

  it("generates a draft from the latest analysis and blocks pricing language", async () => {
    const insp = await createInspection(OWNER_A_ID, "30 Summary Lane");
    await seedAnalysis(companyAId, insp.id);

    asUser(MANAGER_A_ID);
    // Fidelity gate: pricing language → 422, nothing stored.
    aiState.response = JSON.stringify({
      summary: `${GOOD_SUMMARY} The repair should cost about $250 in total for you.`,
    });
    const rejected = await request(app).post(
      `/api/customer-summaries/inspection/${insp.id}/generate`,
    );
    expect(rejected.status).toBe(422);
    expect(
      await db
        .select()
        .from(customerSummariesTable)
        .where(eq(customerSummariesTable.inspectionId, insp.id)),
    ).toHaveLength(0);

    aiState.response = JSON.stringify({ summary: GOOD_SUMMARY });
    const created = await request(app).post(
      `/api/customer-summaries/inspection/${insp.id}/generate`,
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    expect(created.body.body).toBe(GOOD_SUMMARY);
    expect(created.body.shareToken).toBeNull();
  });

  it("requires an analysis before generating", async () => {
    const insp = await createInspection(OWNER_A_ID, "31 Summary Lane");
    asUser(MANAGER_A_ID);
    aiState.response = JSON.stringify({ summary: GOOD_SUMMARY });
    const res = await request(app).post(
      `/api/customer-summaries/inspection/${insp.id}/generate`,
    );
    expect(res.status).toBe(409);
  });

  it("approve freezes the body, mints a token, and revoke kills the link", async () => {
    const insp = await createInspection(OWNER_A_ID, "32 Summary Lane");
    await seedAnalysis(companyAId, insp.id);

    asUser(MANAGER_A_ID);
    aiState.response = JSON.stringify({ summary: GOOD_SUMMARY });
    const created = await request(app).post(
      `/api/customer-summaries/inspection/${insp.id}/generate`,
    );
    const summaryId = created.body.id as number;

    const edited = await request(app)
      .patch(`/api/customer-summaries/${summaryId}`)
      .send({ body: `${GOOD_SUMMARY} Call us anytime with questions.` });
    expect(edited.status).toBe(200);

    const approved = await request(app).post(`/api/customer-summaries/${summaryId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(typeof approved.body.shareToken).toBe("string");
    expect(approved.body.shareToken.length).toBeGreaterThanOrEqual(40);
    expect(new Date(approved.body.shareExpiresAt).getTime()).toBeGreaterThan(Date.now());

    // Frozen: no more edits or regeneration.
    expect(
      (
        await request(app)
          .patch(`/api/customer-summaries/${summaryId}`)
          .send({ body: "rewrite attempt" })
      ).status,
    ).toBe(409);
    expect(
      (await request(app).post(`/api/customer-summaries/inspection/${insp.id}/generate`))
        .status,
    ).toBe(409);
    expect(
      (await request(app).post(`/api/customer-summaries/${summaryId}/approve`)).status,
    ).toBe(409);

    // Public link works while active…
    const token = approved.body.shareToken as string;
    asUser(null);
    const pub = await request(app).get(`/api/share/summary/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.summary).toContain("garage door");
    expect(pub.body.companyName).toBe("Pipe Co A");
    // …and NEVER exposes photos or internals.
    const payloadKeys = Object.keys(pub.body);
    expect(payloadKeys).not.toContain("photos");
    expect(payloadKeys).not.toContain("findings");
    expect(JSON.stringify(pub.body)).not.toContain("/objects/");

    // Revoke → uniform 404.
    asUser(MANAGER_A_ID);
    const revoked = await request(app).post(`/api/customer-summaries/${summaryId}/revoke`);
    expect(revoked.status).toBe(200);
    asUser(null);
    expect((await request(app).get(`/api/share/summary/${token}`)).status).toBe(404);
  });

  it("returns uniform 404 for unknown and expired tokens", async () => {
    asUser(null);
    const unknown = await request(app).get(
      "/api/share/summary/definitely-not-a-real-token-aaaaaaaaaaaaaaa",
    );
    expect(unknown.status).toBe(404);

    const insp = await createInspection(OWNER_A_ID, "33 Summary Lane");
    await seedAnalysis(companyAId, insp.id);
    asUser(MANAGER_A_ID);
    aiState.response = JSON.stringify({
      summary:
        "Thanks for having us out. We found a small gap under the garage door and recommend a door sweep to close it up.",
    });
    const created = await request(app).post(
      `/api/customer-summaries/inspection/${insp.id}/generate`,
    );
    const approved = await request(app).post(
      `/api/customer-summaries/${created.body.id}/approve`,
    );
    const token = approved.body.shareToken as string;

    // Force-expire the link.
    await db
      .update(customerSummariesTable)
      .set({ shareExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(customerSummariesTable.id, created.body.id));

    asUser(null);
    const expired = await request(app).get(`/api/share/summary/${token}`);
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual({ error: "This link is invalid or has expired" });
  });
});

// ---------------------------------------------------------------------------
// Sales proposals
// ---------------------------------------------------------------------------

describe("sales proposals (human-assembled, sales+)", () => {
  it("blocks technicians; allows sales/manager/owner", async () => {
    asUser(TECH_A_ID);
    expect((await request(app).get("/api/proposals")).status).toBe(403);
    for (const clerkId of [SALES_A_ID, MANAGER_A_ID, OWNER_A_ID]) {
      asUser(clerkId);
      expect((await request(app).get("/api/proposals")).status).toBe(200);
    }
  });

  it("creates from same-company opportunity IDs and resolves them on detail", async () => {
    const insp = await createInspection(OWNER_A_ID, "40 Proposal Ave");
    const opp1 = await seedOpportunity(companyAId, insp.id, "Door sweep install");
    const opp2 = await seedOpportunity(companyAId, insp.id, "Moisture remediation");

    asUser(SALES_A_ID);
    const created = await request(app).post("/api/proposals").send({
      title: "Spring exclusion package",
      propertyAddress: "40 Proposal Ave",
      opportunityIds: [opp1.id, opp2.id],
      intro: "Based on our recent inspection, we recommend the following work.",
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");

    const detail = await request(app).get(`/api/proposals/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.opportunities).toHaveLength(2);

    // Paperwork track only — accepting never auto-wins opportunities.
    const sent = await request(app)
      .patch(`/api/proposals/${created.body.id}`)
      .send({ status: "sent" });
    expect(sent.status).toBe(200);
    const accepted = await request(app)
      .patch(`/api/proposals/${created.body.id}`)
      .send({ status: "accepted" });
    expect(accepted.status).toBe(200);
    const [opp1After] = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.id, opp1.id));
    expect(opp1After.status).toBe("new");
  });

  it("rejects cross-company and nonexistent opportunity IDs outright", async () => {
    const inspB = await createInspection(OWNER_B_ID, "41 Other Co Blvd");
    const oppB = await seedOpportunity(companyBId, inspB.id, "Foreign opportunity");

    asUser(SALES_A_ID);
    const cross = await request(app).post("/api/proposals").send({
      title: "Should fail",
      propertyAddress: "41 Other Co Blvd",
      opportunityIds: [oppB.id],
    });
    expect(cross.status).toBe(400);

    const ghost = await request(app).post("/api/proposals").send({
      title: "Should also fail",
      propertyAddress: "41 Other Co Blvd",
      opportunityIds: [999999],
    });
    expect(ghost.status).toBe(400);
  });

  it("only deletes drafts and keeps proposals tenant-isolated", async () => {
    const insp = await createInspection(OWNER_A_ID, "42 Proposal Ave");
    const opp = await seedOpportunity(companyAId, insp.id, "Vent screening");

    asUser(SALES_A_ID);
    const created = await request(app).post("/api/proposals").send({
      title: "Vent screening quote",
      propertyAddress: "42 Proposal Ave",
      opportunityIds: [opp.id],
    });

    asUser(OWNER_B_ID);
    expect((await request(app).get(`/api/proposals/${created.body.id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/proposals/${created.body.id}`)).status).toBe(404);

    asUser(SALES_A_ID);
    await request(app).patch(`/api/proposals/${created.body.id}`).send({ status: "sent" });
    expect((await request(app).delete(`/api/proposals/${created.body.id}`)).status).toBe(409);
    await request(app).patch(`/api/proposals/${created.body.id}`).send({ status: "draft" });
    expect((await request(app).delete(`/api/proposals/${created.body.id}`)).status).toBe(204);
  });
});
