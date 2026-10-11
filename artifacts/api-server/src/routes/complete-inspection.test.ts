import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

/**
 * Inspection lifecycle tests: explicit "Complete Inspection".
 *
 * Pins the redesigned lifecycle guarantees:
 *   1. `draft: true` on /analysis/analyze DEFERS Opportunity Intelligence and
 *      scorecard computation (live-capture mode); default behavior unchanged.
 *   2. POST /inspections/:id/complete is the ONLY finalization trigger: it
 *      marks the inspection completed, guarantees a report, and kicks off the
 *      narrative + customer-summary-draft + opportunities + scorecard pipeline.
 *   3. Completion is idempotent — a retry/double-tap never re-runs the pipeline.
 *   4. Cross-tenant completion is impossible (404).
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
    async getObjectEntityMetadata(_path: string) {
      return { size: 123, contentType: "image/jpeg", md5Hash: null };
    }
    async downloadObject() {
      return new Response("file-bytes");
    }
  }
  return { ...actual, ObjectStorageService };
});

const { analyzePhotoMock } = vi.hoisted(() => ({ analyzePhotoMock: vi.fn() }));
vi.mock("../lib/intelligence-ai", () => {
  const empty = {
    category: null,
    subcategory: null,
    confidence: 0,
    tags: [] as string[],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: null,
  };
  return {
    analyzePhoto: analyzePhotoMock,
    generateAiPrediction: vi.fn(async () => ({ ...empty })),
    fallbackPrediction: () => ({ ...empty }),
  };
});

// The intelligence outputs the lifecycle gates. Mocked so tests can assert
// exactly WHEN each one runs without paying for a model call.
const { opportunityMock, scorecardMock, narrativeMock, summaryMock } = vi.hoisted(() => ({
  opportunityMock: vi.fn(async () => {}),
  scorecardMock: vi.fn(async () => {}),
  narrativeMock: vi.fn(async () => "AI narrative body generated at completion."),
  summaryMock: vi.fn(
    async () =>
      "Thank you for having us inspect your property. Our technician documented the findings below.",
  ),
}));
vi.mock("../lib/opportunity-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/opportunity-ai")>();
  return { ...actual, runOpportunitySynthesis: opportunityMock };
});
vi.mock("../lib/scorecard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/scorecard")>();
  return { ...actual, runScorecardComputation: scorecardMock };
});
vi.mock("../lib/report-narrative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/report-narrative-ai")>();
  return { ...actual, generateReportNarrative: narrativeMock };
});
vi.mock("../lib/customer-summary-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/customer-summary-ai")>();
  return { ...actual, generateCustomerSummaryBody: summaryMock };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  reportsTable,
  customerSummariesTable,
  analysisResultsTable,
  inspectionUploadIntentsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { migrateInspectionUploadIntents } from "../lib/migrate-inspection-upload-intents";

const OWNER_ID = "complete_owner_clerk_id";
const OUTSIDER_ID = "complete_outsider_clerk_id";
let companyId: number;
let otherCompanyId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

function pestPrediction() {
  return {
    category: "pest",
    subcategory: "cockroach",
    confidence: 0.82,
    tags: ["roach", "kitchen"],
    possiblePest: "German cockroach",
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: "Apply gel bait near harborage",
    rationale: "Visible roach near harborage",
  };
}

async function createInspectionWithPhoto(suffix: string) {
  asUser(OWNER_ID);
  const created = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: `${suffix} Complete St`, technicianName: "Tech", clientName: "Client" });
  expect(created.status).toBe(201);
  const inspectionId = created.body.id as number;

  const imageUrl = `/api/storage/objects/companies/${companyId}/uploads/photo-${suffix}-${randomUUID()}`;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, OWNER_ID));
  if (!user) throw new Error("Completion test owner is missing");
  const objectPath = imageUrl.replace(/^\/api\/storage/, "");
  const [uploadIntent] = await db
    .insert(inspectionUploadIntentsTable)
    .values({
      userId: user.id,
      companyId,
      inspectionId,
      clientKey: randomUUID(),
      mediaType: "photo",
      contentType: "image/jpeg",
      expectedSize: 123,
      objectPath,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning({ id: inspectionUploadIntentsTable.id });
  const media = await request(app)
    .post(`/api/inspections/${inspectionId}/media`)
    .send({ mediaType: "photo", url: imageUrl, uploadIntentId: uploadIntent.id });
  expect(media.status).toBe(201);

  asUser(null);
  return { inspectionId, imageUrl };
}

beforeAll(async () => {
  await migrateInspectionUploadIntents();
  for (const [slug, name] of [
    ["complete-co", "Complete Co"],
    ["complete-other-co", "Complete Other Co"],
  ] as const) {
    const [existing] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.slug, slug));
    const id = existing
      ? existing.id
      : (await db.insert(companiesTable).values({ name, slug }).returning())[0].id;
    if (slug === "complete-co") companyId = id;
    else otherCompanyId = id;
  }

  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_ID));
  await db.insert(usersTable).values({ clerkUserId: OWNER_ID, role: "owner", companyId });
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OUTSIDER_ID));
  await db
    .insert(usersTable)
    .values({ clerkUserId: OUTSIDER_ID, role: "owner", companyId: otherCompanyId });
});

beforeEach(() => {
  asUser(null);
  analyzePhotoMock.mockReset();
  opportunityMock.mockClear();
  scorecardMock.mockClear();
  narrativeMock.mockClear();
  summaryMock.mockClear();
});

describe("POST /inspections clientKey idempotency (offline-first retries)", () => {
  it("returns the SAME inspection when a create is retried with the same clientKey", async () => {
    asUser(OWNER_ID);
    const clientKey = `offline-uuid-retry-${randomUUID()}`;
    const body = {
      siteAddress: "77 Retry Rd",
      technicianName: "Tech",
      clientKey,
    };
    const first = await request(app).post("/api/inspections").send(body);
    expect(first.status).toBe(201);

    // Network dropped after the server committed — the client retries.
    const retry = await request(app).post("/api/inspections").send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.clientKey, clientKey),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("scopes clientKey per company — another tenant's identical key creates a new row", async () => {
    asUser(OWNER_ID);
    const clientKey = `offline-uuid-shared-${randomUUID()}`;
    const body = {
      siteAddress: "88 Tenant Key St",
      technicianName: "Tech",
      clientKey,
    };
    const mine = await request(app).post("/api/inspections").send(body);
    expect(mine.status).toBe(201);

    asUser(OUTSIDER_ID);
    const theirs = await request(app).post("/api/inspections").send(body);
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(mine.body.id);
  });

  it("creates without a clientKey exactly as before (web app unchanged)", async () => {
    asUser(OWNER_ID);
    const a = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "99 No Key Ave", technicianName: "Tech" });
    const b = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "99 No Key Ave", technicianName: "Tech" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });
});

describe("draft analysis defers intelligence outputs", () => {
  it("skips opportunity synthesis and scorecard when draft: true", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("draftmode");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }], draft: true });

    expect(res.status).toBe(201);
    expect(res.body.findings).toHaveLength(1);
    expect(opportunityMock).not.toHaveBeenCalled();
    expect(scorecardMock).not.toHaveBeenCalled();
  });

  it("keeps the original behavior when the flag is absent (web app unchanged)", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("nodraft");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res.status).toBe(201);
    await vi.waitFor(() => {
      expect(opportunityMock).toHaveBeenCalledTimes(1);
      expect(scorecardMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("POST /inspections/:id/complete", () => {
  it("completes the inspection and triggers the full finalization pipeline", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("finalize");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    const analyzed = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }], draft: true });
    expect(analyzed.status).toBe(201);
    expect(opportunityMock).not.toHaveBeenCalled();

    const res = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(res.status).toBe(200);
    expect(res.body.alreadyCompleted).toBe(false);
    expect(res.body.finalization).toBe("started");
    expect(res.body.inspection.status).toBe("completed");
    expect(res.body.inspection.completedAt).toBeTruthy();
    expect(res.body.reportId).toBeTypeOf("number");

    // Report snapshot exists with the verified findings.
    const [report] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, res.body.reportId), eq(reportsTable.companyId, companyId)));
    expect(report).toBeTruthy();
    expect(report.inspectionId).toBe(inspectionId);

    // Background pipeline: narrative, customer summary draft, opportunities,
    // scorecard all fire exactly once from the explicit completion.
    await vi.waitFor(() => {
      expect(narrativeMock).toHaveBeenCalledTimes(1);
      expect(summaryMock).toHaveBeenCalledTimes(1);
      expect(opportunityMock).toHaveBeenCalledTimes(1);
      expect(scorecardMock).toHaveBeenCalledTimes(1);
    });
    expect(opportunityMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, inspectionId }),
    );
    expect(scorecardMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, inspectionId }),
    );

    await vi.waitFor(async () => {
      const [summary] = await db
        .select()
        .from(customerSummariesTable)
        .where(
          and(
            eq(customerSummariesTable.inspectionId, inspectionId),
            eq(customerSummariesTable.companyId, companyId),
          ),
        );
      expect(summary).toBeTruthy();
      expect(summary.status).toBe("draft");

      const [finalReport] = await db
        .select()
        .from(reportsTable)
        .where(eq(reportsTable.id, res.body.reportId));
      expect(finalReport.aiNarrative).toBeTruthy();
    });
  });

  it("is idempotent — a second complete is a safe no-op that never re-runs the pipeline", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("idem");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }], draft: true });

    const first = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(first.status).toBe(200);
    expect(first.body.alreadyCompleted).toBe(false);

    await vi.waitFor(() => expect(opportunityMock).toHaveBeenCalledTimes(1));

    const second = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(second.status).toBe(200);
    expect(second.body.alreadyCompleted).toBe(true);
    expect(second.body.finalization).toBe("skipped");
    expect(second.body.reportId).toBe(first.body.reportId);

    // Give any (wrongly) re-triggered pipeline a beat, then confirm it never ran.
    await new Promise((r) => setTimeout(r, 150));
    expect(opportunityMock).toHaveBeenCalledTimes(1);
    expect(scorecardMock).toHaveBeenCalledTimes(1);
    expect(narrativeMock).toHaveBeenCalledTimes(1);
  });

  it("completes an inspection with no analysis (all-clear) — report yes, summary no", async () => {
    asUser(OWNER_ID);
    const created = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "No Analysis Ave", technicianName: "Tech" });
    expect(created.status).toBe(201);
    const inspectionId = created.body.id as number;

    const res = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(res.status).toBe(200);
    expect(res.body.inspection.status).toBe("completed");
    expect(res.body.reportId).toBeTypeOf("number");

    await vi.waitFor(() => {
      // Opportunities/scorecard still run (with empty findings)…
      expect(opportunityMock).toHaveBeenCalledTimes(1);
      expect(scorecardMock).toHaveBeenCalledTimes(1);
    });
    // …but a customer summary is NEVER generated without a verified analysis.
    expect(summaryMock).not.toHaveBeenCalled();
    const [summary] = await db
      .select()
      .from(customerSummariesTable)
      .where(eq(customerSummariesTable.inspectionId, inspectionId));
    expect(summary).toBeUndefined();
  });

  it("cannot complete another company's inspection (404, no state change)", async () => {
    const { inspectionId } = await createInspectionWithPhoto("tenant");

    asUser(OUTSIDER_ID);
    const res = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(res.status).toBe(404);

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspectionId));
    expect(row.status).toBe("pending");
    expect(opportunityMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated completion", async () => {
    const { inspectionId } = await createInspectionWithPhoto("anon");
    asUser(null);
    const res = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(res.status).toBe(401);
  });

  it("strips malformed findings before writing the report snapshot — validateFindings fires on the finalization path", async () => {
    // Create an inspection (no media needed — we seed analysisResultsTable directly).
    asUser(OWNER_ID);
    const created = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "Malformed Guard Ln", technicianName: "Tech", clientName: "Client" });
    expect(created.status).toBe(201);
    const inspectionId = created.body.id as number;

    // Seed an analysisResultsTable row that contains a mix of valid and invalid
    // findings. This simulates data that bypassed an earlier write guard or was
    // corrupted in-place — the finalization path must strip the bad entries.
    //
    // findingSchema requires: id (number), category, description, confidence,
    // severity, location (nullable), imageUrl (nullable), treatment (nullable),
    // exclusionOpportunity (boolean|null).
    const validFinding = {
      id: 1,
      category: "pest",
      description: "Cockroach activity near sink",
      confidence: 0.88,
      severity: "high",
      location: "kitchen",
      imageUrl: null,
      treatment: "Apply gel bait",
      exclusionOpportunity: false,
      possiblePest: "German cockroach",
      zone: "kitchen",
    };
    const invalidFindings = [
      // Missing all required fields — schema parse fails
      { confidence: 0.5, subcategory: "rodent" },
      // id is the wrong type (string instead of number) — fails z.number()
      { id: "not-a-number", category: "pest", description: "Mouse", confidence: 0.7,
        severity: "medium", location: null, imageUrl: null, treatment: null,
        exclusionOpportunity: false },
    ];

    await db.insert(analysisResultsTable).values({
      companyId,
      inspectionId,
      // Deliberately seed malformed legacy JSON below the typed API boundary.
      findings: sql`${JSON.stringify([validFinding, ...invalidFindings])}::jsonb`,
      recommendations: ["Apply gel bait"],
      overallConfidence: 0.88,
    });

    // Complete the inspection — this triggers ensureReportForInspection which
    // reads the seeded findings and must run validateFindings before writing.
    const res = await request(app).post(`/api/inspections/${inspectionId}/complete`).send();
    expect(res.status).toBe(200);
    expect(res.body.reportId).toBeTypeOf("number");

    // The report snapshot must only contain the single valid finding; both
    // invalid entries must have been stripped by validateFindings.
    const [report] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, res.body.reportId), eq(reportsTable.companyId, companyId)));
    expect(report).toBeTruthy();
    const storedFindings = report.findings as unknown[];
    expect(storedFindings).toHaveLength(1);
    expect((storedFindings[0] as { category: string }).category).toBe("pest");
  });
});
