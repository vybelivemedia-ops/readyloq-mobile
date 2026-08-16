import { beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";

/**
 * Reports route smoke tests — empty-findings safety.
 *
 * Verifies that:
 *   1. GET /reports always returns findings/recommendations/exclusionOpportunities
 *      as arrays (never null/undefined), even for legacy rows that have these
 *      columns stored as null in the DB.
 *   2. GET /reports/:id returns the same guarantees for a single report.
 *   3. A report whose DB row stores malformed findings (missing required fields)
 *      is served with findings: [] rather than crashing or leaking bad data.
 *   4. POST /reports with includeAiFindings=false produces an empty-findings
 *      report that serialises correctly.
 *   5. Unauthenticated requests are rejected with 401.
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

// Stub the AI narrative so POST /reports/:id/generate-narrative doesn't hit a
// real model. Returns a minimal but fully-typed AiReportNarrative object.
const STUB_NARRATIVE = {
  executiveSummary: "Stub executive summary.",
  inspectionFindings: "Stub findings.",
  evidenceObserved: "Stub evidence.",
  pestActivityAssessment: "Stub assessment.",
  structuralDeficiencies: "None observed.",
  sanitationConcerns: "None observed.",
  recommendedCorrectiveActions: ["Stub action 1"],
  monitoringRecommendations: ["Stub monitoring 1"],
  followUpSchedule: "30 days.",
  technicianNotes: "Stub notes.",
  managerReviewNotes: "Stub manager notes.",
  propertyType: "residential",
  model: "stub-model",
  generatedAt: new Date(0).toISOString(),
};

vi.mock("../lib/report-narrative-ai", () => ({
  generateReportNarrative: vi.fn(async () => STUB_NARRATIVE),
  derivePropertyType: vi.fn(() => "residential"),
}));

// Stub object storage so HTML route doesn't need GCS.
vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) { return url; }
    async getObjectEntityFile(_path: string) { return {} as never; }
    async downloadObject() {
      return new Response("file-bytes", { headers: { "Content-Type": "application/octet-stream" } });
    }
  }
  return { ...actual, ObjectStorageService };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  reportsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import * as reportNarrativeAi from "../lib/report-narrative-ai";

// ─── Stable Clerk IDs (prefixed to avoid cross-suite collisions) ──────────────

const OWNER_ID  = "rpt_smoke_owner_clerk_id";
const TECH_ID   = "rpt_smoke_tech_clerk_id";
const OWNER_B_ID = "rpt_smoke_owner_b_clerk_id";

let companyId: number;
let companyBId: number;
let inspectionId: number;

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

beforeAll(async () => {
  companyId  = await findOrCreateCompany("Reports Smoke Co A", "rpt-smoke-co-a");
  companyBId = await findOrCreateCompany("Reports Smoke Co B", "rpt-smoke-co-b");

  // Clean up any rows left by a previous run of this suite
  await db.delete(reportsTable).where(eq(reportsTable.companyId, companyId));
  await db.delete(reportsTable).where(eq(reportsTable.companyId, companyBId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_ID));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, TECH_ID));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_B_ID));

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_ID,   role: "owner",      companyId },
    { clerkUserId: TECH_ID,    role: "technician",  companyId },
    { clerkUserId: OWNER_B_ID, role: "owner",       companyId: companyBId },
  ]);

  // A real inspection to anchor reports created via the API
  asUser(TECH_ID);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: "42 Empty St", technicianName: "Smoky", clientName: "Client A", pestTypes: ["ants"] });
  asUser(null);
  if (res.status !== 201) throw new Error(`Seed inspection failed: ${JSON.stringify(res.body)}`);
  inspectionId = res.body.id;
});

beforeEach(() => {
  asUser(null);
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("auth guard", () => {
  it("rejects unauthenticated GET /reports with 401", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated GET /reports/:id with 401", async () => {
    const res = await request(app).get("/api/reports/9999999");
    expect(res.status).toBe(401);
  });
});

// ─── Empty-findings safety ────────────────────────────────────────────────────

describe("empty-findings shape guarantee", () => {
  it("POST /reports with includeAiFindings=false returns correct empty arrays", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/reports")
      .send({ inspectionId, title: "No-AI report", includeAiFindings: false });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.findings)).toBe(true);
    expect(res.body.findings).toHaveLength(0);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.recommendations).toHaveLength(0);
    expect(Array.isArray(res.body.exclusionOpportunities)).toBe(true);
    expect(res.body.exclusionOpportunities).toHaveLength(0);
    // createdAt must be an ISO string, not null/undefined
    expect(typeof res.body.createdAt).toBe("string");
  });

  it("GET /reports always returns arrays (never null/undefined)", async () => {
    // Seed a legacy row directly into the DB with null findings columns —
    // simulating a report created before the type-safety fix.
    // Use raw SQL to bypass Drizzle's type-level coercion and actually store NULLs.
    await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'Legacy null-findings report',
              '42 Empty St', 'complete', NULL, NULL, NULL, 'Smoky', CURRENT_DATE)
    `);

    asUser(OWNER_ID);
    const res = await request(app).get("/api/reports");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    for (const report of res.body) {
      expect(Array.isArray(report.findings),              `findings not array on report ${report.id}`).toBe(true);
      expect(Array.isArray(report.recommendations),       `recommendations not array on report ${report.id}`).toBe(true);
      expect(Array.isArray(report.exclusionOpportunities),`exclusionOpportunities not array on report ${report.id}`).toBe(true);
      expect(report.findings).not.toBeNull();
      expect(report.recommendations).not.toBeNull();
      expect(report.exclusionOpportunities).not.toBeNull();
    }
  });

  it("GET /reports/:id returns arrays for a legacy null-findings row", async () => {
    // Insert another legacy row and fetch it by ID.
    // Use raw SQL to actually store NULLs in the jsonb columns.
    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'Legacy single null-findings report',
              '42 Empty St', 'complete', NULL, NULL, NULL, 'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const legacy = { id: (result.rows[0] as { id: number }).id };

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${legacy.id}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.findings)).toBe(true);
    expect(res.body.findings).toHaveLength(0);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.recommendations).toHaveLength(0);
    expect(Array.isArray(res.body.exclusionOpportunities)).toBe(true);
    expect(res.body.exclusionOpportunities).toHaveLength(0);
  });

  it("GET /reports/:id drops malformed findings (missing category or description)", async () => {
    // Simulate a row with a mix of well-formed and malformed findings stored as
    // raw JSON — as might exist from a pre-fix analysis pipeline.
    const malformedFindings = [
      // Well-formed: should survive
      { category: "pest", description: "Live cockroach observed", severity: "high" },
      // Missing description: should be dropped
      { category: "structural" },
      // Missing category: should be dropped
      { description: "Water damage noted" },
      // Null entry: should be dropped
      null,
      // Empty object: should be dropped
      {},
    ];

    // Use raw SQL to insert the malformed JSONB exactly as-is, bypassing Drizzle's
    // type coercion, which would normally prevent storing structurally invalid entries.
    const malformedJson = JSON.stringify(malformedFindings);
    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'Malformed findings report',
              '42 Empty St', 'complete',
              ${malformedJson}::jsonb, NULL, NULL,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const row = { id: (result.rows[0] as { id: number }).id };

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${row.id}`);

    expect(res.status).toBe(200);
    // Only the one well-formed finding should remain
    expect(Array.isArray(res.body.findings)).toBe(true);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].category).toBe("pest");
    expect(res.body.findings[0].description).toBe("Live cockroach observed");
    // recommendations and exclusionOpportunities must still be arrays
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(Array.isArray(res.body.exclusionOpportunities)).toBe(true);
  });
});

// ─── Narrative generation — empty findings ────────────────────────────────────

describe("generate-narrative — empty findings", () => {
  it("returns 200, persists aiNarrative object, and calls generator with findings: []", async () => {
    // Reset call history so we can assert on this specific invocation
    vi.mocked(reportNarrativeAi.generateReportNarrative).mockClear();

    // Create a report with no AI findings so the findings array is empty
    asUser(OWNER_ID);
    const createRes = await request(app)
      .post("/api/reports")
      .send({ inspectionId, title: "Empty-findings narrative test", includeAiFindings: false });
    expect(createRes.status).toBe(201);
    const reportId: number = createRes.body.id;
    expect(createRes.body.findings).toHaveLength(0);

    // Call the narrative generator
    const narRes = await request(app)
      .post(`/api/reports/${reportId}/generate-narrative`)
      .send({});

    expect(narRes.status).toBe(200);

    // The stub was called exactly once, with an empty findings array — confirming
    // the route doesn't hallucinate findings or crash before reaching the generator.
    expect(reportNarrativeAi.generateReportNarrative).toHaveBeenCalledOnce();
    const callArg = vi.mocked(reportNarrativeAi.generateReportNarrative).mock.calls[0]![0];
    expect(Array.isArray(callArg.findings)).toBe(true);
    expect(callArg.findings).toHaveLength(0);

    // The returned aiNarrative must be the normalized object (not a string)
    expect(narRes.body.aiNarrative).toBeDefined();
    expect(typeof narRes.body.aiNarrative).toBe("object");
    expect(typeof narRes.body.aiNarrative.executiveSummary).toBe("string");
    expect(narRes.body.aiNarrative.executiveSummary.length).toBeGreaterThan(0);

    // The DB row must also have been updated with the AiReportNarrative object
    const [row] = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));
    expect(row).toBeDefined();
    expect(row.aiNarrative).toBeDefined();
    expect(typeof row.aiNarrative).toBe("object");
    expect(typeof row.aiNarrative!.executiveSummary).toBe("string");
    expect(row.aiNarrative!.executiveSummary.length).toBeGreaterThan(0);
  });
});

// ─── Non-empty exclusionOpportunities round-trip ─────────────────────────────

describe("exclusionOpportunities — non-empty count", () => {
  /**
   * Seeds a report row directly with a known exclusionOpportunities array so
   * we are not sensitive to the AI analysis pipeline.  The critical assertion
   * is that serializeReport passes the strings through unchanged and the
   * mobile list consumer will therefore receive the correct count.
   */
  it("GET /reports/:id returns the correct exclusionOpportunities count", async () => {
    const opportunities = [
      "structural: Gap around pipe penetration behind sink",
      "entry_point: Missing door sweep on rear access door",
    ];
    const opportunitiesJson = JSON.stringify(opportunities);

    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'Exclusion opps report',
              '42 Empty St', 'complete', NULL, NULL,
              ${opportunitiesJson}::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${reportId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.exclusionOpportunities)).toBe(true);
    // Must reflect the actual stored opportunities — not zero
    expect(res.body.exclusionOpportunities).toHaveLength(opportunities.length);
    expect(res.body.exclusionOpportunities).toEqual(opportunities);
  });

  it("GET /reports list includes the report with correct exclusionOpportunities count", async () => {
    const opportunities = ["pest: Active rodent harborage under HVAC unit"];
    const opportunitiesJson = JSON.stringify(opportunities);

    await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'List exclusion opps report',
              '42 Empty St', 'complete', NULL, NULL,
              ${opportunitiesJson}::jsonb,
              'Smoky', CURRENT_DATE)
    `);

    asUser(OWNER_ID);
    const res = await request(app).get("/api/reports");

    expect(res.status).toBe(200);
    const target = (res.body as Array<{ title: string; exclusionOpportunities: string[] }>)
      .find((r) => r.title === "List exclusion opps report");

    expect(target).toBeDefined();
    expect(Array.isArray(target!.exclusionOpportunities)).toBe(true);
    // The mobile list consumer reads .exclusionOpportunities.length — must be > 0
    expect(target!.exclusionOpportunities.length).toBeGreaterThan(0);
    expect(target!.exclusionOpportunities).toEqual(opportunities);
  });

  it("exclusionOpportunities strings survive the filter (non-strings are stripped)", async () => {
    // Simulate a corrupted DB row where one entry is not a string
    const corruptedJson = JSON.stringify([
      "valid: Seal gap at conduit entry",
      42,
      null,
      { not: "a string" },
    ]);

    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'Corrupted exclusion opps report',
              '42 Empty St', 'complete', NULL, NULL,
              ${corruptedJson}::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${reportId}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.exclusionOpportunities)).toBe(true);
    // Only the valid string must survive — mobile count must never over-report
    expect(res.body.exclusionOpportunities).toHaveLength(1);
    expect(res.body.exclusionOpportunities[0]).toBe("valid: Seal gap at conduit entry");
  });
});

// ─── Opportunities filter ─────────────────────────────────────────────────────

describe("GET /reports?opportunities=true — filter", () => {
  /**
   * Seeds one report WITH exclusion opportunities and one WITHOUT, then
   * confirms that ?opportunities=true returns only the one that has them.
   * This guards against a regression where the filter is silently ignored
   * and zero-opportunity reports leak into the "Open opportunities" list.
   */
  it("returns only reports that have at least one exclusion opportunity", async () => {
    const withOpps = ["pest: Active rodent entry at foundation gap", "structural: Unsealed conduit penetration"];
    const withOppsJson = JSON.stringify(withOpps);
    const noOppsJson = JSON.stringify([]);

    // Seed a report WITH opportunities
    const withResult = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'OppFilter — has opportunities',
              '99 Opp Ave', 'complete', NULL, NULL,
              ${withOppsJson}::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const withId = (withResult.rows[0] as { id: number }).id;

    // Seed a report WITHOUT opportunities
    await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'OppFilter — no opportunities',
              '99 Opp Ave', 'complete', NULL, NULL,
              ${noOppsJson}::jsonb,
              'Smoky', CURRENT_DATE)
    `);

    asUser(OWNER_ID);
    const res = await request(app).get("/api/reports?opportunities=true");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ids: number[] = res.body.map((r: { id: number }) => r.id);

    // The report WITH opportunities must be present
    expect(ids).toContain(withId);

    // Every returned report must have at least one opportunity
    for (const report of res.body as Array<{ id: number; exclusionOpportunities: string[] }>) {
      expect(
        Array.isArray(report.exclusionOpportunities),
        `exclusionOpportunities not an array on report ${report.id}`,
      ).toBe(true);
      expect(
        report.exclusionOpportunities.length,
        `report ${report.id} has zero opportunities but was returned by the opportunities filter`,
      ).toBeGreaterThan(0);
    }
  });

  it("count in the response matches the stored exclusionOpportunities array length", async () => {
    const opps = [
      "entry_point: Gap under exterior door",
      "structural: Crack in foundation near utility room",
      "vegetation: Overgrown shrub providing harborage along wall",
    ];
    const oppsJson = JSON.stringify(opps);

    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'OppFilter — count check',
              '77 Count Rd', 'complete', NULL, NULL,
              ${oppsJson}::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get("/api/reports?opportunities=true");

    expect(res.status).toBe(200);
    const target = (res.body as Array<{ id: number; exclusionOpportunities: string[] }>)
      .find((r) => r.id === reportId);

    expect(target).toBeDefined();
    // Count in the response must equal the number of strings seeded
    expect(target!.exclusionOpportunities).toHaveLength(opps.length);
    expect(target!.exclusionOpportunities).toEqual(opps);
  });

  it("NULL exclusion_opportunities rows are excluded (treated as empty array)", async () => {
    // Insert a legacy row with NULL exclusion_opportunities
    const nullResult = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'OppFilter — null opps legacy row',
              '55 Null St', 'complete', NULL, NULL, NULL,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const nullId = (nullResult.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get("/api/reports?opportunities=true");

    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((r: { id: number }) => r.id);
    // The NULL-opps report must NOT appear in the filtered list
    expect(ids).not.toContain(nullId);
  });
});

// ─── HTML report — measurement strip rendering ────────────────────────────────

describe("GET /reports/:id/html — laser measurement strip", () => {
  const PHOTO_URL = "https://storage.example.com/photo-with-laser.jpg";

  it("renders measurement strip for a finding whose imageUrl matches a photo with captureMetadata.laserMeasurement", async () => {
    // Seed a media record with a burst-reference laser measurement
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      mediaType: "photo",
      url: PHOTO_URL,
      filename: "laser-shot.jpg",
      captureMetadata: {
        laserMeasurement: {
          kind: "distance",
          value: 2.5,
          unit: "inches",
          signalQuality: 0.85,
          metadata: {
            method: "burst_reference",
            heightInches: 3.0,
            areaSqInches: 7.5,
            confidence: 0.82,
            warnings: [],
          },
        },
      },
    });

    // Create an approved report with a finding referencing the photo URL
    const findingsJson = JSON.stringify([
      {
        id: 1,
        category: "Gap",
        description: "Gap under door",
        confidence: 0.9,
        severity: "high",
        location: "Front door",
        imageUrl: PHOTO_URL,
        exclusionOpportunity: false,
      },
    ]);
    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'HTML Measurement Test',
              '42 Empty St', 'complete',
              ${findingsJson}::jsonb, '[]'::jsonb, '[]'::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${reportId}/html`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Laser Measurement");
    expect(res.text).toContain("W:");
    expect(res.text).toContain("H:");
    expect(res.text).toContain("Area:");
    // Should NOT show low-confidence label for confidence 0.82
    expect(res.text).not.toContain("low confidence");
  });

  it("labels measurement as low confidence when confidence < 0.5", async () => {
    const LOW_CONF_URL = "https://storage.example.com/photo-low-conf.jpg";
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      mediaType: "photo",
      url: LOW_CONF_URL,
      filename: "low-conf.jpg",
      captureMetadata: {
        laserMeasurement: {
          kind: "distance",
          value: 1.0,
          unit: "inches",
          metadata: {
            method: "burst_reference",
            heightInches: 1.2,
            areaSqInches: 1.2,
            confidence: 0.35,
            warnings: ["low_signal"],
          },
        },
      },
    });

    const findingsJson = JSON.stringify([
      {
        id: 2,
        category: "Crack",
        description: "Hairline crack",
        confidence: 0.7,
        severity: "medium",
        location: null,
        imageUrl: LOW_CONF_URL,
        exclusionOpportunity: false,
      },
    ]);
    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'HTML Low Conf Test',
              '42 Empty St', 'complete',
              ${findingsJson}::jsonb, '[]'::jsonb, '[]'::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${reportId}/html`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Laser Measurement");
    expect(res.text).toContain("low confidence");
    // Warning text should appear
    expect(res.text).toContain("low_signal");
  });

  it("renders no measurement strip when the finding has no imageUrl", async () => {
    const findingsJson = JSON.stringify([
      {
        id: 3,
        category: "Pest",
        description: "Roach sighting",
        confidence: 0.9,
        severity: "high",
        location: null,
        imageUrl: null,
        exclusionOpportunity: false,
      },
    ]);
    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'HTML No Image Test',
              '42 Empty St', 'complete',
              ${findingsJson}::jsonb, '[]'::jsonb, '[]'::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const res = await request(app).get(`/api/reports/${reportId}/html`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Laser Measurement");
  });
});

// ─── Tenant isolation (reports are company-scoped) ────────────────────────────

describe("tenant isolation", () => {
  it("owner from company B cannot see company A's reports via list", async () => {
    // Ensure company A has at least one report
    asUser(OWNER_ID);
    await request(app)
      .post("/api/reports")
      .send({ inspectionId, title: "A-only report", includeAiFindings: false });

    asUser(OWNER_B_ID);
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(200);
    // Company B sees an empty list — no company A reports leaked
    for (const r of res.body) {
      expect(r.companyId).not.toBe(companyId);
    }
  });

  it("owner from company B gets 404 fetching company A's report by ID", async () => {
    asUser(OWNER_ID);
    const create = await request(app)
      .post("/api/reports")
      .send({ inspectionId, title: "Private report", includeAiFindings: false });
    expect(create.status).toBe(201);
    const reportId = create.body.id;

    asUser(OWNER_B_ID);
    const res = await request(app).get(`/api/reports/${reportId}`);
    expect(res.status).toBe(404);
  });
});

// ─── Sync round-trip: captureMetadata survives POST → DB → HTML ───────────────
//
// The PDF report reads laserMeasurement from inspectionMediaTable.captureMetadata.
// If the sync engine (or the media POST route) drops or corrupts the blob,
// measurements silently disappear from the PDF with no error.  These tests pin
// the full path:
//   1. POST /inspections/:id/media with a rich captureMetadata payload
//      (burst variant, warnings present) → 201, captureMetadata stored verbatim.
//   2. DB read-back: the stored jsonb value deep-equals the posted payload.
//   3. GET /reports/:id/html: the measurement strip appears in the HTML with
//      the correct width, height, area, and warning text.

describe("sync round-trip: captureMetadata persists through media POST and HTML render", () => {
  /** Full burst-reference payload including nested warnings — matches what the
   *  sync engine sends when a BLE laser measurement is stamped on a photo. */
  const BURST_METADATA = {
    laserMeasurement: {
      kind: "distance",
      value: 4.75,
      unit: "inches",
      signalQuality: 0.72,
      metadata: {
        method: "burst_reference",
        heightInches: 6.25,
        areaSqInches: 29.69,
        confidence: 0.68,
        warnings: ["partial_occlusion", "edge_proximity"],
      },
    },
    deviceModel: "ReadyLoq BLE-1",
    capturedAt: "2026-08-16T10:00:00.000Z",
  };

  const SYNC_PHOTO_URL = "https://storage.example.com/sync-roundtrip-laser.jpg";

  it("POST /inspections/:id/media stores captureMetadata verbatim (deep equal)", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({
        mediaType: "photo",
        url: SYNC_PHOTO_URL,
        filename: "laser-burst.jpg",
        captureSource: "ble_laser",
        qualityScore: 87,
        captureMetadata: BURST_METADATA,
      });

    expect(res.status).toBe(201);

    // The API response must include the full captureMetadata — confirms the
    // route did not strip or truncate the nested object before returning.
    expect(res.body.captureMetadata).toBeDefined();
    expect(res.body.captureMetadata.laserMeasurement).toBeDefined();
    const laser = res.body.captureMetadata.laserMeasurement;
    expect(laser.value).toBe(BURST_METADATA.laserMeasurement.value);
    expect(laser.metadata.method).toBe("burst_reference");
    expect(laser.metadata.heightInches).toBe(BURST_METADATA.laserMeasurement.metadata.heightInches);
    expect(laser.metadata.areaSqInches).toBe(BURST_METADATA.laserMeasurement.metadata.areaSqInches);
    expect(laser.metadata.confidence).toBe(BURST_METADATA.laserMeasurement.metadata.confidence);
    // Warnings array must survive intact — both entries, in order.
    expect(Array.isArray(laser.metadata.warnings)).toBe(true);
    expect(laser.metadata.warnings).toEqual(BURST_METADATA.laserMeasurement.metadata.warnings);

    // Read the row directly from the DB to confirm the jsonb column was not
    // silently truncated after the API returned.  This guards against a
    // scenario where the route responded with the input echo but the DB write
    // stored a shorter blob (e.g. due to a missing jsonb cast or column
    // width constraint).
    const mediaRowId: number = res.body.id;
    const [dbRow] = await db
      .select({ captureMetadata: inspectionMediaTable.captureMetadata })
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.id, mediaRowId));

    expect(dbRow).toBeDefined();
    // toEqual performs a deep structural comparison — any missing key, wrong
    // type, or truncated array element will fail here.
    expect(dbRow.captureMetadata).toEqual(BURST_METADATA);
  });

  it("GET /reports/:id/html renders measurement strip with warnings after media round-trip", async () => {
    // Ensure the media row exists with the expected URL (the previous test
    // created it; this test is intentionally dependent so we test the full
    // POST → DB → HTML pipeline as one coherent flow rather than isolating
    // the HTML step behind a direct DB seed).
    const [existingMedia] = await db
      .select({ id: inspectionMediaTable.id, captureMetadata: inspectionMediaTable.captureMetadata })
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionMediaTable.inspectionId, inspectionId),
          eq(inspectionMediaTable.url, SYNC_PHOTO_URL),
        ),
      )
      .limit(1);

    expect(existingMedia).toBeDefined();
    // Guard: the captureMetadata must have survived the round-trip before
    // we test the HTML renderer — prevents a false-positive where the HTML
    // route silently falls back to "no measurement" without an error.
    expect(existingMedia.captureMetadata).toBeDefined();
    const storedLaser = (existingMedia.captureMetadata as typeof BURST_METADATA).laserMeasurement;
    expect(storedLaser.metadata.warnings).toEqual(BURST_METADATA.laserMeasurement.metadata.warnings);

    // Seed a report whose finding links to the stamped photo URL.
    const findingsJson = JSON.stringify([
      {
        id: 99,
        category: "Gap",
        description: "Stamped measurement gap",
        confidence: 0.9,
        severity: "high",
        location: "Service entry",
        imageUrl: SYNC_PHOTO_URL,
        exclusionOpportunity: false,
      },
    ]);
    const result = await db.execute(sql`
      INSERT INTO reports (company_id, inspection_id, title, site_address, status,
                           findings, recommendations, exclusion_opportunities,
                           technician_name, inspection_date)
      VALUES (${companyId}, ${inspectionId}, 'Sync Round-Trip HTML Test',
              '42 Empty St', 'complete',
              ${findingsJson}::jsonb, '[]'::jsonb, '[]'::jsonb,
              'Smoky', CURRENT_DATE)
      RETURNING id
    `);
    const reportId = (result.rows[0] as { id: number }).id;

    asUser(OWNER_ID);
    const htmlRes = await request(app).get(`/api/reports/${reportId}/html`);
    expect(htmlRes.status).toBe(200);

    // Measurement strip must appear.
    expect(htmlRes.text).toContain("Laser Measurement");

    // Width, height, and area values must all be rendered.
    // value=4.75 → "4.75 in", heightInches=6.25 → "6.25 in",
    // areaSqInches=29.69 → "29.69 sq in" (< 144).
    expect(htmlRes.text).toContain("W:");
    expect(htmlRes.text).toContain("H:");
    expect(htmlRes.text).toContain("Area:");
    expect(htmlRes.text).toContain("4.75");
    expect(htmlRes.text).toContain("6.25");
    // fmtArea uses toFixed(1) for values < 144 sq in → "29.7 sq in"
    expect(htmlRes.text).toContain("29.7");

    // Both warning strings must appear in the rendered HTML — confirms the
    // warnings array survived the full round-trip (POST → jsonb → SELECT →
    // HTML render) without being dropped or truncated.
    expect(htmlRes.text).toContain("partial_occlusion");
    expect(htmlRes.text).toContain("edge_proximity");

    // confidence=0.68 is above the 0.5 amber threshold — must NOT be flagged.
    expect(htmlRes.text).not.toContain("low confidence");
  });
});
