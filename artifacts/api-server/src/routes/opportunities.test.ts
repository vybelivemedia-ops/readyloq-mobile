import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Opportunity Intelligence tests.
 *
 * The Opportunity Log is hidden from technicians and tenant-isolated:
 * - technician → 403 on every /api/opportunities route (API-layer exclusion)
 * - sales/manager/owner → allowed, but only their own company's rows
 * - dismiss requires manager+; settings require owner
 * - synthesis grounding: candidates citing nonexistent finding IDs are
 *   rejected, and value tiers are validated (no-fabrication guarantee)
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

// Deterministic model output for synthesis tests. Each test sets `aiResponse`
// to the raw JSON string the "model" returns.
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
import { runOpportunitySynthesis } from "../lib/opportunity-ai";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  opportunitiesTable,
  opportunityEventsTable,
  opportunitySettingsTable,
  quizzesTable,
  propertyProfilesTable,
  propertyNotesTable,
  datasetImagesTable,
  intelligenceRecordsTable,
  brandingProfilesTable,
  type Finding,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const OWNER_A_ID = "opp_owner_a_clerk_id";
const MANAGER_A_ID = "opp_manager_a_clerk_id";
const SALES_A_ID = "opp_sales_a_clerk_id";
const TECH_A_ID = "opp_tech_a_clerk_id";
const OWNER_B_ID = "opp_owner_b_clerk_id";

let companyAId: number;
let companyBId: number;
let salesAUserId: number;
let ownerBUserId: number;

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
    .send({ siteAddress, technicianName: "Tech", clientName: "Client", pestTypes: ["ants"] });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

async function seedOpportunity(companyId: number, inspectionId: number, title: string) {
  const [row] = await db
    .insert(opportunitiesTable)
    .values({
      companyId,
      inspectionId,
      propertyAddress: "100 Test Street",
      category: "structural",
      title,
      rationale: "Test rationale grounded in findings.",
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
  companyAId = await findOrCreateCompany("Opp Co A", "opp-co-a");
  companyBId = await findOrCreateCompany("Opp Co B", "opp-co-b");

  await db.delete(opportunityEventsTable);
  await db.delete(opportunitiesTable);
  await db.delete(opportunitySettingsTable);
  await db.delete(inspectionsTable);
  // Order-independent cleanup: other suites (e.g. isolation tests) may leave
  // rows referencing users; clear them before users or the FK blocks the reset.
  await db.delete(quizzesTable);
  await db.delete(propertyProfilesTable);
  await db.delete(propertyNotesTable);
  await db.delete(datasetImagesTable);
  await db.delete(intelligenceRecordsTable);
  await db.delete(brandingProfilesTable);
  await db.delete(usersTable);

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
  ownerBUserId = users.find((u) => u.clerkUserId === OWNER_B_ID)!.id;
});

beforeEach(async () => {
  asUser(null);
  aiState.response = null;
  await db.delete(opportunityEventsTable);
  await db.delete(opportunitiesTable);
  await db.delete(opportunitySettingsTable);
});

describe("technician exclusion (the hidden log stays hidden)", () => {
  it("blocks technicians from every opportunities route with 403", async () => {
    asUser(TECH_A_ID);
    const list = await request(app).get("/api/opportunities");
    expect(list.status).toBe(403);
    const trends = await request(app).get("/api/opportunities/trends");
    expect(trends.status).toBe(403);
    const detail = await request(app).get("/api/opportunities/1");
    expect(detail.status).toBe(403);
    const patch = await request(app)
      .patch("/api/opportunities/1")
      .send({ status: "reviewed" });
    expect(patch.status).toBe(403);
    const settings = await request(app).get("/api/opportunities/settings");
    expect(settings.status).toBe(403);
  });

  it("allows sales, manager, and owner to list", async () => {
    for (const clerkId of [SALES_A_ID, MANAGER_A_ID, OWNER_A_ID]) {
      asUser(clerkId);
      const res = await request(app).get("/api/opportunities");
      expect(res.status).toBe(200);
    }
  });
});

describe("tenant isolation", () => {
  it("lists only the caller company's opportunities", async () => {
    const inspA = await createInspection(OWNER_A_ID, "100 A Street");
    const inspB = await createInspection(OWNER_B_ID, "200 B Street");
    const oppA = await seedOpportunity(companyAId, inspA.id, "Seal foundation gap A");
    const oppB = await seedOpportunity(companyBId, inspB.id, "Seal foundation gap B");

    asUser(SALES_A_ID);
    const res = await request(app).get("/api/opportunities");
    expect(res.status).toBe(200);
    const ids = res.body.opportunities.map((o: { id: number }) => o.id);
    expect(ids).toContain(oppA.id);
    expect(ids).not.toContain(oppB.id);
  });

  it("blocks direct-id access and updates across companies", async () => {
    const inspA = await createInspection(OWNER_A_ID, "101 A Street");
    const oppA = await seedOpportunity(companyAId, inspA.id, "Crawl space moisture fix");

    asUser(OWNER_B_ID);
    const detail = await request(app).get(`/api/opportunities/${oppA.id}`);
    expect(detail.status).toBe(404);
    const patch = await request(app)
      .patch(`/api/opportunities/${oppA.id}`)
      .send({ status: "reviewed" });
    expect(patch.status).toBe(404);
  });

  it("rejects assigning an opportunity to a user from another company", async () => {
    const inspA = await createInspection(OWNER_A_ID, "102 A Street");
    const oppA = await seedOpportunity(companyAId, inspA.id, "Rodent exclusion package");

    asUser(MANAGER_A_ID);
    const bad = await request(app)
      .patch(`/api/opportunities/${oppA.id}`)
      .send({ assignedToUserId: ownerBUserId });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .patch(`/api/opportunities/${oppA.id}`)
      .send({ assignedToUserId: salesAUserId });
    expect(good.status).toBe(200);
    expect(good.body.assignedToUserId).toBe(salesAUserId);
  });
});

describe("pipeline permissions", () => {
  it("lets sales move the pipeline but not dismiss", async () => {
    const inspA = await createInspection(OWNER_A_ID, "103 A Street");
    const opp = await seedOpportunity(companyAId, inspA.id, "Gutter moisture remediation");

    asUser(SALES_A_ID);
    const reviewed = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ status: "reviewed" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe("reviewed");

    const dismissed = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ status: "dismissed" });
    expect(dismissed.status).toBe(403);

    asUser(MANAGER_A_ID);
    const managerDismiss = await request(app)
      .patch(`/api/opportunities/${opp.id}`)
      .send({ status: "dismissed" });
    expect(managerDismiss.status).toBe(200);
    expect(managerDismiss.body.status).toBe("dismissed");
  });

  it("audits status changes and views", async () => {
    const inspA = await createInspection(OWNER_A_ID, "104 A Street");
    const opp = await seedOpportunity(companyAId, inspA.id, "Attic exclusion work");

    asUser(SALES_A_ID);
    await request(app).patch(`/api/opportunities/${opp.id}`).send({ status: "reviewed" });
    const detail = await request(app).get(`/api/opportunities/${opp.id}`);
    expect(detail.status).toBe(200);

    const actions = detail.body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("status_changed");
    expect(actions).toContain("viewed");
  });

  it("restricts settings to owners", async () => {
    for (const clerkId of [SALES_A_ID, MANAGER_A_ID]) {
      asUser(clerkId);
      const res = await request(app).get("/api/opportunities/settings");
      expect(res.status).toBe(403);
    }
    asUser(OWNER_A_ID);
    const get = await request(app).get("/api/opportunities/settings");
    expect(get.status).toBe(200);
    expect(get.body.enabled).toBe(true);

    const patch = await request(app)
      .patch("/api/opportunities/settings")
      .send({ minConfidence: 0.7, enabledCategories: ["structural", "preventative"] });
    expect(patch.status).toBe(200);
    expect(patch.body.minConfidence).toBe(0.7);
    expect(patch.body.enabledCategories).toEqual(["structural", "preventative"]);
  });
});

describe("synthesis grounding (no fabrication)", () => {
  const findings: Finding[] = [
    {
      id: 1,
      category: "structural",
      description: "Gap under garage door seal",
      confidence: 0.9,
      severity: "medium",
      location: "Garage",
      imageUrl: "/objects/companies/1/uploads/photo-1",
      treatment: "Install door sweep",
      exclusionOpportunity: true,
      structuralIssue: "Failed garage door seal",
    },
  ];

  it("persists grounded candidates and rejects ones citing nonexistent findings", async () => {
    const inspA = await createInspection(OWNER_A_ID, "300 Synth Street");
    aiState.response = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Garage door seal replacement",
          rationale: "The failed seal is a documented entry point.",
          evidenceFindingIds: [1],
          estimatedValueTier: "medium",
          confidence: 0.85,
        },
        {
          category: "revenue",
          title: "Fabricated whole-home fumigation",
          rationale: "No evidence supports this.",
          evidenceFindingIds: [999],
          estimatedValueTier: "high",
          confidence: 0.95,
        },
      ],
    });

    await runOpportunitySynthesis({ companyId: companyAId, inspectionId: inspA.id, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyAId));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Garage door seal replacement");
    expect(rows[0].evidenceFindingIds).toEqual([1]);
    expect(rows[0].evidenceImagePaths).toEqual(["/objects/companies/1/uploads/photo-1"]);
    expect(rows[0].status).toBe("new");
  });

  it("strengthens an existing open opportunity instead of duplicating it", async () => {
    const inspA = await createInspection(OWNER_A_ID, "301 Synth Street");
    aiState.response = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Garage Door Seal Replacement",
          rationale: "Seal failure confirmed again.",
          evidenceFindingIds: [1],
          estimatedValueTier: "medium",
          confidence: 0.9,
        },
      ],
    });

    await runOpportunitySynthesis({ companyId: companyAId, inspectionId: inspA.id, findings });
    await runOpportunitySynthesis({ companyId: companyAId, inspectionId: inspA.id, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyAId));
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe(0.9);

    const events = await db
      .select()
      .from(opportunityEventsTable)
      .where(eq(opportunityEventsTable.opportunityId, rows[0].id));
    const actions = events.map((e) => e.action);
    expect(actions).toContain("created");
    expect(actions).toContain("strengthened");
  });

  it("rejects candidates containing fabricated dollar figures", async () => {
    const inspA = await createInspection(OWNER_A_ID, "304 Synth Street");
    aiState.response = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Seal repair worth $2,500",
          rationale: "Estimated at $2,500 in revenue.",
          evidenceFindingIds: [1],
          estimatedValueTier: "high",
          confidence: 0.9,
        },
      ],
    });

    await runOpportunitySynthesis({ companyId: companyAId, inspectionId: inspA.id, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyAId));
    expect(rows).toHaveLength(0);
  });

  it("drops candidates below the company confidence threshold", async () => {
    const inspA = await createInspection(OWNER_A_ID, "302 Synth Street");
    await db.insert(opportunitySettingsTable).values({
      companyId: companyAId,
      enabled: true,
      minConfidence: 0.9,
    });
    aiState.response = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Low confidence idea",
          rationale: "Weak evidence.",
          evidenceFindingIds: [1],
          estimatedValueTier: "low",
          confidence: 0.5,
        },
      ],
    });

    await runOpportunitySynthesis({ companyId: companyAId, inspectionId: inspA.id, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyAId));
    expect(rows).toHaveLength(0);
  });

  it("does nothing when the subsystem is disabled", async () => {
    const inspA = await createInspection(OWNER_A_ID, "303 Synth Street");
    await db.insert(opportunitySettingsTable).values({
      companyId: companyAId,
      enabled: false,
    });
    aiState.response = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Should never persist",
          rationale: "Subsystem disabled.",
          evidenceFindingIds: [1],
          estimatedValueTier: "low",
          confidence: 0.99,
        },
      ],
    });

    await runOpportunitySynthesis({ companyId: companyAId, inspectionId: inspA.id, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyAId));
    expect(rows).toHaveLength(0);
  });
});
