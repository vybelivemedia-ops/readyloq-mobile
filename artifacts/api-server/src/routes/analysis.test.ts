import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";

/**
 * Write-boundary finding validation tests for POST /analysis and POST /analysis/analyze.
 *
 * Client finding arrays are strict all-or-nothing requests, while malformed AI
 * output remains tolerant and is sanitized at the DB write boundary.
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

// Stub the vision AI so POST /analysis/analyze never makes real network calls
// by default. Individual tests may override via vi.mocked(analyzePhoto).mockResolvedValueOnce().
vi.mock("../lib/intelligence-ai", () => ({
  analyzePhoto: vi.fn(async () => null),
}));

// Stub opportunity AI (sometimes imported transitively).
vi.mock("../lib/opportunity-ai", () => ({
  runOpportunitySynthesis: vi.fn(async () => []),
}));

// Stub object storage — no real blobs in unit tests.
vi.mock("../lib/objectStorage", () => ({
  objectPathCompanyScope: vi.fn(() => -1), // never matches — no images pass the guard
  ObjectStorageService: class {
    getObjectEntityFile = vi.fn();
    downloadObject = vi.fn();
    uploadObjectBuffer = vi.fn();
  },
}));

import app from "../app";
import {
  db,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  analysisResultsTable,
  analysisProviderAttemptsTable,
  analysisProviderDailyBudgetsTable,
  missionControlInspectionEventsTable,
  usersTable,
  type Finding,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { objectPathCompanyScope } from "../lib/objectStorage";
import { analyzePhoto } from "../lib/intelligence-ai";
import { FindingSchema } from "@workspace/api-zod";
import { migrateAnalysisProviderGuard } from "../lib/migrate-analysis-provider-guard";

// ---------------------------------------------------------------------------
// Test fixture identifiers — prefixed to avoid collisions with other suites.
// ---------------------------------------------------------------------------

const OWNER_ID = "analysis_validate_owner_clerk";

let companyId: number;
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

async function createInspection(address: string): Promise<number> {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: address,
      technicianName: "Budget Test Tech",
      status: "pending",
    })
    .returning({ id: inspectionsTable.id });
  return row.id;
}

async function cleanRows() {
  if (!companyId) return;
  await db
    .delete(analysisProviderAttemptsTable)
    .where(eq(analysisProviderAttemptsTable.companyId, companyId));
  await db
    .delete(analysisProviderDailyBudgetsTable)
    .where(eq(analysisProviderDailyBudgetsTable.scopeId, companyId));
  await db
    .delete(analysisProviderDailyBudgetsTable)
    .where(eq(analysisProviderDailyBudgetsTable.scopeId, 0));
  await db
    .delete(analysisResultsTable)
    .where(eq(analysisResultsTable.companyId, companyId));
  await db
    .delete(inspectionMediaTable)
    .where(eq(inspectionMediaTable.companyId, companyId));
  await db
    .delete(inspectionsTable)
    .where(eq(inspectionsTable.companyId, companyId));
}

beforeAll(async () => {
  await migrateAnalysisProviderGuard();
  companyId = await findOrCreateCompany("Analysis Validate Co", "analysis-validate-co");

  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, [OWNER_ID]));
  await db
    .insert(usersTable)
    .values({ clerkUserId: OWNER_ID, role: "owner", companyId });

  // Create a single inspection that all tests below share.
  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: "1 Validation Way",
      technicianName: "Test Tech",
      status: "pending",
    })
    .returning();
  inspectionId = insp.id;
});

beforeEach(async () => {
  asUser(null);
  // Remove analysis and media rows between tests so each one starts clean.
  await db
    .delete(analysisProviderAttemptsTable)
    .where(eq(analysisProviderAttemptsTable.companyId, companyId));
  await db
    .delete(analysisProviderDailyBudgetsTable)
    .where(eq(analysisProviderDailyBudgetsTable.scopeId, companyId));
  await db
    .delete(analysisProviderDailyBudgetsTable)
    .where(eq(analysisProviderDailyBudgetsTable.scopeId, 0));
  await db
    .delete(analysisResultsTable)
    .where(eq(analysisResultsTable.companyId, companyId));
  await db
    .delete(inspectionMediaTable)
    .where(eq(inspectionMediaTable.companyId, companyId));
  // Reset per-test mock overrides so the next test gets the module-level defaults.
  vi.mocked(analyzePhoto).mockReset();
  vi.mocked(analyzePhoto).mockResolvedValue(null);
  vi.mocked(objectPathCompanyScope).mockReset();
  vi.mocked(objectPathCompanyScope).mockReturnValue(-1);
});

afterAll(async () => {
  await cleanRows();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A structurally valid finding ready for DB insert. */
function validFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    category: "Rodent Activity",
    description: "Mouse droppings observed near entry point.",
    confidence: 0.85,
    severity: "high",
    location: "Kitchen",
    imageUrl: null,
    treatment: "Bait station placement",
    exclusionOpportunity: true,
    ...overrides,
  };
}

/**
 * A structurally INVALID finding — missing the required `category` field.
 * validateFindings() must strip this before the DB insert.
 */
function invalidFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    // category is intentionally omitted — required by findingSchema
    description: "Malformed finding with no category.",
    confidence: 0.5,
    severity: "medium",
    location: null,
    imageUrl: null,
    treatment: null,
    exclusionOpportunity: null,
    ...overrides,
  };
}

function validPhotoPrediction() {
  return {
    category: "Rodent Activity",
    subcategory: null,
    tags: [],
    confidence: 0.91,
    rationale: "Rodent evidence visible near the baseboard.",
    possiblePest: "Mouse",
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: "Seal the entry point.",
    possibleLifeStage: null,
    possibleHarborage: null,
    possibleMoistureIssue: null,
    possibleStructuralIssue: null,
    zone: "kitchen",
    pestCandidates: [{ species: "Mouse", confidence: 0.91 }],
  };
}

describe("Finding OpenAPI/generated-schema agreement", () => {
  it("parses representative persisted metadata through generated Zod", () => {
    const result = FindingSchema.safeParse({
      ...validFinding(),
      evidenceQuality: "excellent",
      possiblePest: "Mouse",
      species: "Mus musculus",
      lifeStage: "adult",
      conduciveCondition: "food source",
      harborage: "wall void",
      moisture: null,
      structuralIssue: "foundation gap",
      measurementEstimate: {
        linearFt: 2.5,
        gapWidthIn: 0.25,
        heightFt: null,
        confidence: 0.8,
        source: "ai_vision_estimate",
      },
      zone: "kitchen",
      candidates: [{ species: "Mouse", confidence: 0.8 }],
      confidenceLabel: "identified",
      reviewStatus: "pending",
      technicianSpecies: null,
      technicianCorrectionNotes: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects omissions of published-required core fields", () => {
    const { severity: _severity, ...missingRequired } = validFinding();
    const result = FindingSchema.safeParse(missingRequired);
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level metadata fields", () => {
    const result = FindingSchema.safeParse(
      validFinding({ technicianCorrecionNotes: "misspelled field" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unknown measurement and candidate fields", () => {
    const measurementResult = FindingSchema.safeParse({
      ...validFinding(),
      measurementEstimate: {
        confidence: 0.8,
        source: "ai_vision_estimate",
        widthMm: 4,
      },
    });
    const candidateResult = FindingSchema.safeParse({
      ...validFinding(),
      candidates: [{ species: "Mouse", confidence: 0.8, scorePct: 80 }],
    });
    expect(measurementResult.success).toBe(false);
    expect(candidateResult.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /analysis — client-submitted findings
// ---------------------------------------------------------------------------

describe("POST /analysis — write-boundary finding validation", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post("/api/analysis").send({ inspectionId });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-array findings payload before DB work", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: { category: "not-an-array" } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Invalid findings",
      code: "INVALID_FINDINGS",
      issues: [{ index: 0, path: [], message: "Expected an array" }],
    });
    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });

  it("rejects the request when any client finding is invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({
        inspectionId,
        findings: [validFinding(), invalidFinding()],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Invalid findings",
      code: "INVALID_FINDINGS",
    });
    expect(res.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 1, path: ["category"] }),
      ]),
    );
  });

  it("does not persist any findings when a client finding is invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({
        inspectionId,
        findings: [validFinding(), invalidFinding()],
      });
    expect(res.status).toBe(400);

    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));

    expect(rows).toHaveLength(0);
  });

  it("accepts a payload with only valid findings unchanged", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({
        inspectionId,
        findings: [validFinding({ id: 1 }), validFinding({ id: 2, category: "Conducive Condition" })],
      });

    expect(res.status).toBe(201);
    expect(res.body.findings).toHaveLength(2);
  });

  it("returns 400 when ALL submitted findings are invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({
        inspectionId,
        findings: [invalidFinding({ id: 1 }), invalidFinding({ id: 2 })],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FINDINGS");
  });

  it("returns 400 for a finding with a non-string category", async () => {
    asUser(OWNER_ID);

    // category must be a string; passing a number makes it structurally invalid.
    const badTypeFinding = validFinding({ id: 3, category: 42 });

    const res = await request(app)
      .post("/api/analysis")
      .send({
        inspectionId,
        findings: [validFinding({ id: 1 }), badTypeFinding],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FINDINGS");
  });
});

// ---------------------------------------------------------------------------
// POST /analysis/analyze — AI-run analysis (no real AI in these tests)
//
// technicianFindings are validated before any inspection lookup/provider work;
// malformed AI output still runs through validateFindings() after the merge.
// ---------------------------------------------------------------------------

describe("POST /analysis/analyze — write-boundary finding validation", () => {
  it("returns 400 when inspectionId is missing", async () => {
    asUser(OWNER_ID);
    const res = await request(app).post("/api/analysis/analyze").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-array technicianFindings payload before provider work", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, technicianFindings: { category: "not-an-array" } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Invalid technician findings",
      code: "INVALID_FINDINGS",
      issues: [{ index: 0, path: [], message: "Expected an array" }],
    });
    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });

  it("rejects the request when any technician finding is invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        technicianFindings: [validFinding({ id: 1 }), invalidFinding({ id: 2 })],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Invalid technician findings",
      code: "INVALID_FINDINGS",
    });
  });

  it("rejects unknown technician metadata before provider or DB work", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        technicianFindings: [
          validFinding({ technicianCorrecionNotes: "misspelled field" }),
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Invalid technician findings",
      code: "INVALID_FINDINGS",
    });
    expect(res.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, path: ["technicianCorrecionNotes"] }),
      ]),
    );
    expect(analyzePhoto).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });

  it("rejects unknown nested metadata before provider or DB work", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        technicianFindings: [
          validFinding({
            measurementEstimate: {
              confidence: 0.8,
              source: "ai_vision_estimate",
              widthMm: 4,
            },
            candidates: [{ species: "Mouse", confidence: 0.8, scorePct: 80 }],
          }),
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Invalid technician findings",
      code: "INVALID_FINDINGS",
    });
    expect(res.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          path: ["measurementEstimate", "widthMm"],
        }),
        expect.objectContaining({
          index: 0,
          path: ["candidates", 0, "scorePct"],
        }),
      ]),
    );
    expect(analyzePhoto).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });

  it("does not persist any findings when a technician finding is invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        technicianFindings: [validFinding({ id: 1 }), invalidFinding({ id: 2 })],
      });
    expect(res.status).toBe(400);

    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));

    expect(rows).toHaveLength(0);
  });

  it("returns 400 when ALL technicianFindings are invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        technicianFindings: [invalidFinding({ id: 1 }), invalidFinding({ id: 2 })],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FINDINGS");
  });

  it("persists all valid technicianFindings unchanged when none are invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        technicianFindings: [
          validFinding({ id: 1 }),
          validFinding({ id: 2, category: "Conducive Condition" }),
        ],
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.findings).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // AI photo branch — exercises the code path where analyzePhoto() returns a
  // prediction and the route constructs a finding from it before passing it
  // through validateFindings(). A malformed confidence (non-number) is used
  // because the route copies prediction.confidence directly into the finding
  // object, so z.number() in findingSchema will reject it.
  // ---------------------------------------------------------------------------

  it("strips a malformed AI-produced finding before persisting it", async () => {
    asUser(OWNER_ID);

    // Seed a media row so the image passes the savedPaths guard.
    const testPath = `/objects/${companyId}/validate-ai-photo.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      url: testPath,
      mediaType: "photo",
    });

    // Allow this specific path through the tenant guard.
    vi.mocked(objectPathCompanyScope).mockImplementation((p: string) =>
      p === testPath ? companyId : -1,
    );

    // Return a prediction whose confidence is a non-number string — the route
    // copies it verbatim, so the constructed finding will fail z.number().
    vi.mocked(analyzePhoto).mockResolvedValueOnce({
      category: "Rodent Activity",
      subcategory: null,
      tags: [],
      confidence: "very-high" as unknown as number,
      rationale: "Droppings near wall.",
      possiblePest: "Mouse",
      possibleConduciveCondition: null,
      possibleEntryPoint: null,
      suggestedCorrectiveAction: null,
      possibleLifeStage: null,
      possibleHarborage: null,
      possibleMoistureIssue: null,
      possibleStructuralIssue: null,
      zone: null,
      pestCandidates: [],
    });

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [],
      });

    expect([200, 201]).toContain(res.status);
    // The malformed AI finding must be stripped — response contains no findings.
    expect(res.body.findings).toHaveLength(0);

    // Confirm the DB row also has no findings persisted.
    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    expect(rows).toHaveLength(1);
    const stored = (rows[0].findings as unknown) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(0);
  });

  it("durably caps repeated independent retries for one canonical media path", async () => {
    asUser(OWNER_ID);
    const testPath = `/objects/${companyId}/durable-retry-cap.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      url: testPath,
      mediaType: "photo",
    });
    vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
      path === testPath ? companyId : -1,
    );
    vi.mocked(analyzePhoto).mockResolvedValue(null);

    // Different legitimate technician evidence creates independent requests,
    // rather than exercising the exact-payload in-process single-flight path.
    for (let retry = 0; retry < 4; retry++) {
      const response = await request(app)
        .post("/api/analysis/analyze")
        .send({
          inspectionId,
          images: [{ imageUrl: testPath }],
          technicianFindings: [
            validFinding({ id: 1, description: `Technician evidence ${retry}` }),
          ],
        });
      expect([200, 201]).toContain(response.status);
    }

    expect(analyzePhoto).toHaveBeenCalledTimes(3);
    const [guard] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(guard).toMatchObject({
      inspectionId,
      mediaPath: testPath,
      attemptCount: 3,
      state: "failed",
    });
    const allAttemptEvents = await db.select().from(missionControlInspectionEventsTable)
      .where(and(eq(missionControlInspectionEventsTable.inspectionId, inspectionId),
        eq(missionControlInspectionEventsTable.sourceRecordType, "analysis_provider_attempts")));
    const sourcePrefix = `${inspectionId}:${createHash("sha256").update(testPath).digest("hex")}:`;
    const events = allAttemptEvents.filter((event) => event.sourceRecordId.startsWith(sourcePrefix));
    expect(events.filter((event) => event.eventType === "analysis.attempt_started")).toHaveLength(3);
    expect(events.filter((event) => event.eventType === "analysis.attempt_failed")).toHaveLength(3);
    for (const event of events.filter((event) => event.eventType === "analysis.attempt_failed")) {
      const started = events.find((entry) => entry.sourceRecordId === event.sourceRecordId
        && entry.eventType === "analysis.attempt_started");
      expect(started).toBeDefined();
      expect(started!.occurredAt!.getTime()).toBeLessThanOrEqual(event.occurredAt!.getTime());
    }
    expect(JSON.stringify(events)).not.toContain(testPath);
  });

  it("caps new paths across changed inspection/request identities using persistent company usage", async () => {
    asUser(OWNER_ID);
    const companyLimitName = "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PER_COMPANY";
    const platformLimitName = "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PLATFORM";
    const oldCompanyLimit = process.env[companyLimitName];
    const oldPlatformLimit = process.env[platformLimitName];
    process.env[companyLimitName] = "2";
    process.env[platformLimitName] = "1000";

    try {
      const captures = await Promise.all(
        ["first", "second", "third"].map(async (name) => ({
          inspectionId: await createInspection(`${name} budget inspection`),
          path: `/objects/${companyId}/budget-${name}.jpg`,
        })),
      );
      await db.insert(inspectionMediaTable).values(
        captures.map(({ inspectionId: id, path }) => ({
          companyId,
          inspectionId: id,
          url: path,
          mediaType: "photo",
        })),
      );
      const ownedPaths = new Set(captures.map(({ path }) => path));
      vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
        ownedPaths.has(path) ? companyId : -1,
      );
      vi.mocked(analyzePhoto).mockResolvedValue(null);

      // Each new inspection, path and evidence note defeats request-local
      // single-flight/deduplication; the persisted company window is the gate.
      for (const [index, capture] of captures.entries()) {
        const response = await request(app)
          .post("/api/analysis/analyze")
          .send({
            inspectionId: capture.inspectionId,
            images: [{ imageUrl: capture.path }],
            requestId: `mutable-client-request-${index}`,
            technicianFindings: [validFinding({ description: `Independent request ${index}` })],
          });
        expect([200, 201]).toContain(response.status);
      }

      expect(analyzePhoto).toHaveBeenCalledTimes(2);
      const [companyBudget] = await db
        .select()
        .from(analysisProviderDailyBudgetsTable)
        .where(eq(analysisProviderDailyBudgetsTable.scopeId, companyId));
      const [platformBudget] = await db
        .select()
        .from(analysisProviderDailyBudgetsTable)
        .where(eq(analysisProviderDailyBudgetsTable.scopeId, 0));
      expect(companyBudget).toMatchObject({ consumedCalls: 2, dailyLimit: 2 });
      expect(platformBudget.dailyLimit).toBe(1000);
      expect(platformBudget.consumedCalls).toBeGreaterThanOrEqual(2);
      const [blockedAttempt] = await db
        .select()
        .from(analysisProviderAttemptsTable)
        .where(
          and(
            eq(analysisProviderAttemptsTable.companyId, companyId),
            eq(analysisProviderAttemptsTable.inspectionId, captures[2].inspectionId),
          ),
        );
      expect(blockedAttempt).toBeUndefined();
    } finally {
      if (oldCompanyLimit === undefined) delete process.env[companyLimitName];
      else process.env[companyLimitName] = oldCompanyLimit;
      if (oldPlatformLimit === undefined) delete process.env[platformLimitName];
      else process.env[platformLimitName] = oldPlatformLimit;
    }
  });

  it("serializes concurrent different-inspection work at the durable company quota", async () => {
    asUser(OWNER_ID);
    const companyLimitName = "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PER_COMPANY";
    const platformLimitName = "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PLATFORM";
    const oldCompanyLimit = process.env[companyLimitName];
    const oldPlatformLimit = process.env[platformLimitName];
    process.env[companyLimitName] = "1";
    process.env[platformLimitName] = "1000";

    try {
      const captures = await Promise.all(
        ["concurrent-a", "concurrent-b"].map(async (name) => ({
          inspectionId: await createInspection(`${name} budget inspection`),
          path: `/objects/${companyId}/${name}.jpg`,
        })),
      );
      await db.insert(inspectionMediaTable).values(
        captures.map(({ inspectionId: id, path }) => ({
          companyId,
          inspectionId: id,
          url: path,
          mediaType: "photo",
        })),
      );
      const ownedPaths = new Set(captures.map(({ path }) => path));
      vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
        ownedPaths.has(path) ? companyId : -1,
      );
      vi.mocked(analyzePhoto).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return null;
      });

      const responses = await Promise.all(
        captures.map((capture, index) =>
          request(app)
            .post("/api/analysis/analyze")
            .send({
              inspectionId: capture.inspectionId,
              images: [{ imageUrl: capture.path }],
              technicianFindings: [validFinding({ description: `Concurrent request ${index}` })],
            }),
        ),
      );

      expect(responses.every((response) => [200, 201].includes(response.status))).toBe(true);
      expect(analyzePhoto).toHaveBeenCalledTimes(1);
      const [companyBudget] = await db
        .select()
        .from(analysisProviderDailyBudgetsTable)
        .where(eq(analysisProviderDailyBudgetsTable.scopeId, companyId));
      const [platformBudget] = await db
        .select()
        .from(analysisProviderDailyBudgetsTable)
        .where(eq(analysisProviderDailyBudgetsTable.scopeId, 0));
      expect(companyBudget).toMatchObject({ consumedCalls: 1, dailyLimit: 1 });
      expect(platformBudget.dailyLimit).toBe(1000);
      expect(platformBudget.consumedCalls).toBeGreaterThanOrEqual(1);
      expect(
        await db
          .select()
          .from(analysisProviderAttemptsTable)
          .where(eq(analysisProviderAttemptsTable.companyId, companyId)),
      ).toHaveLength(1);
    } finally {
      if (oldCompanyLimit === undefined) delete process.env[companyLimitName];
      else process.env[companyLimitName] = oldCompanyLimit;
      if (oldPlatformLimit === undefined) delete process.env[platformLimitName];
      else process.env[platformLimitName] = oldPlatformLimit;
    }
  });

  it("fails closed at a zero platform budget and rolls back the partial company reservation", async () => {
    asUser(OWNER_ID);
    const companyLimitName = "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PER_COMPANY";
    const platformLimitName = "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PLATFORM";
    const oldCompanyLimit = process.env[companyLimitName];
    const oldPlatformLimit = process.env[platformLimitName];
    process.env[companyLimitName] = "100";
    process.env[platformLimitName] = "0";

    try {
      const path = `/objects/${companyId}/platform-budget-disabled.jpg`;
      await db.insert(inspectionMediaTable).values({
        companyId,
        inspectionId,
        url: path,
        mediaType: "photo",
      });
      vi.mocked(objectPathCompanyScope).mockImplementation((candidate: string) =>
        candidate === path ? companyId : -1,
      );

      const response = await request(app)
        .post("/api/analysis/analyze")
        .send({
          inspectionId,
          images: [{ imageUrl: path }],
          technicianFindings: [validFinding({ description: "Disabled budget request" })],
        });

      expect([200, 201]).toContain(response.status);
      expect(analyzePhoto).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(analysisProviderAttemptsTable)
          .where(eq(analysisProviderAttemptsTable.companyId, companyId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(analysisProviderDailyBudgetsTable)
          .where(eq(analysisProviderDailyBudgetsTable.scopeId, companyId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(analysisProviderDailyBudgetsTable)
          .where(eq(analysisProviderDailyBudgetsTable.scopeId, 0)),
      ).toHaveLength(0);
    } finally {
      if (oldCompanyLimit === undefined) delete process.env[companyLimitName];
      else process.env[companyLimitName] = oldCompanyLimit;
      if (oldPlatformLimit === undefined) delete process.env[platformLimitName];
      else process.env[platformLimitName] = oldPlatformLimit;
    }
  });

  it("recovers a provider success after analysis-result persistence fails", async () => {
    asUser(OWNER_ID);
    const testPath = `/objects/${companyId}/recover-provider-result.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      url: testPath,
      mediaType: "photo",
    });
    vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
      path === testPath ? companyId : -1,
    );
    vi.mocked(analyzePhoto).mockResolvedValue(validPhotoPrediction());

    // The route has persisted provider_result before entering the atomic
    // analysis-row/final-guard transaction. Reject that transaction to model a
    // process/database failure in the gap that previously stranded the result.
    const originalTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(((
      ...args: unknown[]
    ) => {
      // Target the source write, not the number of transactions: provider
      // attempt events now commit transactionally before result persistence.
      return originalTransaction(async (tx) => {
        const originalInsert = tx.insert.bind(tx);
        const insertSpy = vi.spyOn(tx, "insert").mockImplementation(((table: unknown) => {
          if (table === analysisResultsTable) throw new Error("simulated analysis persistence failure");
          return originalInsert(table as never);
        }) as typeof tx.insert);
        try {
          return await (args[0] as (executor: typeof tx) => Promise<unknown>)(tx);
        } finally {
          insertSpy.mockRestore();
        }
      });
    }) as typeof db.transaction);
    const failedResponse = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [validFinding({ description: "First evidence edit" })],
      });
    transactionSpy.mockRestore();

    expect(failedResponse.status).toBe(500);
    const [recoverable] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(recoverable).toMatchObject({
      mediaPath: testPath,
      attemptCount: 1,
      state: "provider_succeeded",
      providerResult: validPhotoPrediction(),
    });
    expect(
      await db
        .select()
        .from(analysisResultsTable)
        .where(eq(analysisResultsTable.companyId, companyId)),
    ).toHaveLength(0);

    // A different request payload proves recovery comes from durable DB state,
    // not this process's full-payload in-flight sharing map.
    const recoveredResponse = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [validFinding({ description: "Second evidence edit" })],
      });

    expect(recoveredResponse.status).toBe(201);
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
    expect(recoveredResponse.body.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ species: "Mouse", imageUrl: testPath }),
        expect.objectContaining({ description: "Second evidence edit" }),
      ]),
    );
    const [completed] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(completed).toMatchObject({ attemptCount: 1, state: "completed" });
    expect(
      await db
        .select()
        .from(analysisResultsTable)
        .where(eq(analysisResultsTable.companyId, companyId)),
    ).toHaveLength(1);
  });

  it("uses the durable lease to prevent concurrent independent requests duplicating provider work", async () => {
    asUser(OWNER_ID);
    const testPath = `/objects/${companyId}/durable-concurrency.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      url: testPath,
      mediaType: "photo",
    });
    vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
      path === testPath ? companyId : -1,
    );

    let started!: () => void;
    let release!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(analyzePhoto).mockImplementation(async () => {
      started();
      await providerGate;
      return validPhotoPrediction();
    });

    const firstRequest = request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [validFinding({ description: "First distinct evidence" })],
      });
    const firstResponsePromise = firstRequest.then((response) => response);
    await providerStarted;
    const secondRequest = request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [validFinding({ description: "Second distinct evidence" })],
      });
    const secondResponsePromise = secondRequest.then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const [firstResponse, secondResponse] = await Promise.all([
      firstResponsePromise,
      secondResponsePromise,
    ]);

    expect([200, 201]).toContain(firstResponse.status);
    expect([200, 201]).toContain(secondResponse.status);
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
    expect(firstResponse.body.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "First distinct evidence" }),
      ]),
    );
    expect(secondResponse.body.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "Second distinct evidence" }),
        expect.objectContaining({ species: "Mouse", imageUrl: testPath }),
      ]),
    );
    expect(firstResponse.body.photoOutcomes).toEqual(
      expect.arrayContaining([expect.objectContaining({ imagePath: testPath, status: "completed" })]),
    );
    expect(secondResponse.body.photoOutcomes).toEqual(
      expect.arrayContaining([expect.objectContaining({ imagePath: testPath, status: "completed" })]),
    );
    const [guard] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(guard).toMatchObject({ attemptCount: 1, state: "completed" });
  });

  it("serializes distinct-photo result commits and preserves both on a later retry", async () => {
    asUser(OWNER_ID);
    const firstPath = `/objects/${companyId}/concurrent-photo-one.jpg`;
    const secondPath = `/objects/${companyId}/concurrent-photo-two.jpg`;
    await db.insert(inspectionMediaTable).values([
      { companyId, inspectionId, url: firstPath, mediaType: "photo" },
      { companyId, inspectionId, url: secondPath, mediaType: "photo" },
    ]);
    vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
      path === firstPath || path === secondPath ? companyId : -1,
    );

    let bothProvidersStarted!: () => void;
    let releaseProviders!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      bothProvidersStarted = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProviders = resolve;
    });
    const startedPaths = new Set<string>();
    vi.mocked(analyzePhoto).mockImplementation(async (path: string) => {
      startedPaths.add(path);
      if (startedPaths.size === 2) bothProvidersStarted();
      await providerGate;
      return {
        ...validPhotoPrediction(),
        zone: path === firstPath ? "kitchen" : "living_room",
      };
    });

    const firstRequest = request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: firstPath, label: "Kitchen" }],
        technicianFindings: [validFinding({ description: "First photo technician note" })],
      });
    const firstResponsePromise = firstRequest.then((response) => response);
    const secondRequest = request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: secondPath, label: "Living room" }],
        technicianFindings: [validFinding({ description: "Second photo technician note" })],
      });
    const secondResponsePromise = secondRequest.then((response) => response);

    await allStarted;
    releaseProviders();
    const [firstResponse, secondResponse] = await Promise.all([
      firstResponsePromise,
      secondResponsePromise,
    ]);
    expect([200, 201]).toContain(firstResponse.status);
    expect([200, 201]).toContain(secondResponse.status);
    expect(analyzePhoto).toHaveBeenCalledTimes(2);

    const [latest] = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId))
      .orderBy(desc(analysisResultsTable.createdAt))
      .limit(1);
    expect(latest.analyzedImagePaths).toEqual(expect.arrayContaining([firstPath, secondPath]));
    expect(latest.photoOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ imagePath: firstPath, status: "completed" }),
        expect.objectContaining({ imagePath: secondPath, status: "completed" }),
      ]),
    );
    expect(latest.photoZones).toMatchObject({
      [firstPath]: "kitchen",
      [secondPath]: "living_room",
    });
    expect(latest.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ imageUrl: firstPath }),
        expect.objectContaining({ imageUrl: secondPath }),
        expect.objectContaining({ description: "First photo technician note" }),
        expect.objectContaining({ description: "Second photo technician note" }),
      ]),
    );

    const retryResponse = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: firstPath }, { imageUrl: secondPath }],
        technicianFindings: [],
      });
    expect(retryResponse.status).toBe(201);
    expect(analyzePhoto).toHaveBeenCalledTimes(2);
    expect(retryResponse.body.analyzedImagePaths).toEqual(
      expect.arrayContaining([firstPath, secondPath]),
    );
    expect(retryResponse.body.photoOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ imagePath: firstPath, status: "completed" }),
        expect.objectContaining({ imagePath: secondPath, status: "completed" }),
      ]),
    );
  });

  it("does not let an expired lease holder complete or fail a newer claim", async () => {
    asUser(OWNER_ID);
    const testPath = `/objects/${companyId}/stale-provider-lease.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      url: testPath,
      mediaType: "photo",
    });
    vi.mocked(objectPathCompanyScope).mockImplementation((path: string) =>
      path === testPath ? companyId : -1,
    );

    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstProviderStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondProviderStarted = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const firstProviderGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondProviderGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let providerCalls = 0;
    vi.mocked(analyzePhoto).mockImplementation(async () => {
      providerCalls++;
      if (providerCalls === 1) {
        firstStarted();
        await firstProviderGate;
        return validPhotoPrediction();
      }
      secondStarted();
      await secondProviderGate;
      return null;
    });

    const firstRequest = request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [validFinding({ description: "Old worker evidence" })],
      });
    const firstResponsePromise = firstRequest.then((response) => response);
    await firstProviderStarted;
    const [oldLease] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(oldLease.leaseToken).toBeTruthy();

    // Simulate a process that outlived its lease. The second request claims a
    // fresh token while the original provider call is still unresolved.
    await db
      .update(analysisProviderAttemptsTable)
      .set({ leaseUntil: new Date(Date.now() - 1) })
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    const secondRequest = request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        technicianFindings: [validFinding({ description: "New worker evidence" })],
      });
    const secondResponsePromise = secondRequest.then((response) => response);
    await secondProviderStarted;
    const [newLease] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(newLease.leaseToken).toBeTruthy();
    expect(newLease.leaseToken).not.toBe(oldLease.leaseToken);

    releaseFirst();
    const firstResponse = await firstResponsePromise;
    const [stillOwned] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(stillOwned.state).toBe("leased");
    expect(stillOwned.leaseToken).toBe(newLease.leaseToken);

    releaseSecond();
    const secondResponse = await secondResponsePromise;
    expect([200, 201]).toContain(firstResponse.status);
    expect([200, 201]).toContain(secondResponse.status);
    const [settled] = await db
      .select()
      .from(analysisProviderAttemptsTable)
      .where(eq(analysisProviderAttemptsTable.companyId, companyId));
    expect(settled).toMatchObject({ attemptCount: 2, state: "failed" });
  });

  it("rejects malformed technician findings before provider work", async () => {
    asUser(OWNER_ID);

    // Seed a media row for the AI photo.
    const testPath = `/objects/${companyId}/validate-mixed-photo.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      url: testPath,
      mediaType: "photo",
    });

    vi.mocked(objectPathCompanyScope).mockImplementation((p: string) =>
      p === testPath ? companyId : -1,
    );

    // AI returns a structurally VALID prediction (confidence is a real number).
    vi.mocked(analyzePhoto).mockResolvedValueOnce({
      category: "Conducive Condition",
      subcategory: null,
      tags: [],
      confidence: 0.75,
      rationale: "Moisture accumulation on wall.",
      possiblePest: null,
      possibleConduciveCondition: "moisture",
      possibleEntryPoint: null,
      suggestedCorrectiveAction: null,
      possibleLifeStage: null,
      possibleHarborage: null,
      possibleMoistureIssue: "moisture",
      possibleStructuralIssue: null,
      zone: null,
      pestCandidates: [],
    });

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl: testPath }],
        // A malformed client finding submitted alongside the valid AI finding.
        technicianFindings: [invalidFinding({ id: 99 })],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FINDINGS");
    expect(analyzePhoto).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PATCH /analysis/:id/findings/correct — correction write-boundary validation
//
// validateFindings() must run on the full updated findings array before the
// DB write so that:
//   (a) pre-existing invalid findings (stored before the guard was added) are
//       stripped on every correction re-write, and
//   (b) any structurally invalid data that somehow reaches the handler cannot
//       enter the database through the correction path.
// ---------------------------------------------------------------------------

describe("PATCH /analysis/:id/findings/correct — write-boundary finding validation", () => {
  it("returns 400 when findingId is missing", async () => {
    asUser(OWNER_ID);

    // Seed a valid row so the route has something to look up.
    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [validFinding({ id: 1 })] });
    expect(res.status).toBe(201);
    const analysisId: number = res.body.id;

    const patch = await request(app)
      .patch(`/api/analysis/${analysisId}/findings/correct`)
      .send({ action: "accept" }); // findingId intentionally omitted
    expect(patch.status).toBe(400);
  });

  it("returns 400 when action is missing", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [validFinding({ id: 1 })] });
    expect(res.status).toBe(201);
    const analysisId: number = res.body.id;

    const patch = await request(app)
      .patch(`/api/analysis/${analysisId}/findings/correct`)
      .send({ findingId: 1 }); // action intentionally omitted
    expect(patch.status).toBe(400);
  });

  it("returns 400 when action is invalid", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [validFinding({ id: 1 })] });
    expect(res.status).toBe(201);
    const analysisId: number = res.body.id;

    const patch = await request(app)
      .patch(`/api/analysis/${analysisId}/findings/correct`)
      .send({ findingId: 1, action: "hack" });
    expect(patch.status).toBe(400);
  });

  it("accepts a valid finding and persists the reviewStatus update", async () => {
    asUser(OWNER_ID);

    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [validFinding({ id: 1 })] });
    expect(res.status).toBe(201);
    const analysisId: number = res.body.id;

    const patch = await request(app)
      .patch(`/api/analysis/${analysisId}/findings/correct`)
      .send({ findingId: 1, action: "accept" });
    expect(patch.status).toBe(200);

    const findings = patch.body.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0].reviewStatus).toBe("accepted");
  });

  it("persists technician context without overwriting the original AI confidence", async () => {
    asUser(OWNER_ID);
    const original = validFinding({ id: 1, confidence: 0.42, description: "Small insect evidence near sink." });
    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [original] });
    expect(res.status).toBe(201);

    const patch = await request(app)
      .patch(`/api/analysis/${res.body.id}/findings/correct`)
      .send({
        findingId: 1,
        action: "correct",
        technicianSpecies: "German Cockroach",
        updateStrategy: "keep_existing",
        notes: "Observed live adults in the cabinet hinge.",
      });
    expect(patch.status).toBe(200);

    const finding = (patch.body.findings as Array<Record<string, unknown>>)[0];
    expect(finding.reviewStatus).toBe("corrected");
    expect(finding.technicianSpecies).toBe("German Cockroach");
    expect(finding.technicianCorrectionNotes).toBe(
      "Observed live adults in the cabinet hinge.",
    );
    expect(finding.confidence).toBe(0.42);
    expect(finding.description).toBe("Small insect evidence near sink.");
  });

  it("rejects AI regeneration when the finding is not being corrected", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [validFinding({ id: 1 })] });
    expect(res.status).toBe(201);

    const patch = await request(app)
      .patch(`/api/analysis/${res.body.id}/findings/correct`)
      .send({ findingId: 1, action: "accept", updateStrategy: "ai_regenerate" });
    expect(patch.status).toBe(400);
    expect(patch.body.error).toBe("updateStrategy only applies when action is correct");
  });

  it("strips a pre-existing invalid finding when the valid finding is corrected", async () => {
    asUser(OWNER_ID);

    // POST a valid finding through the normal route so a row is created.
    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId, findings: [validFinding({ id: 1 })] });
    expect(res.status).toBe(201);
    const analysisId: number = res.body.id;

    // Directly inject an invalid finding into the DB row, simulating legacy
    // data stored before validateFindings() was added to the POST route.
    const rowsBefore = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.id, analysisId));
    expect(rowsBefore).toHaveLength(1);

    // Cast through unknown to bypass the Finding type — intentional: this test
    // simulates legacy DB rows that were stored before validateFindings() was
    // added, so the injection must slip past the type system deliberately.
    const poisoned = [
      ...(rowsBefore[0].findings as unknown[]),
      invalidFinding({ id: 99 }), // injected directly — bypasses the POST guard
    ] as unknown as Finding[];
    await db
      .update(analysisResultsTable)
      .set({ findings: poisoned })
      .where(eq(analysisResultsTable.id, analysisId));

    // Confirm the poisoned row has two findings before the PATCH.
    const rowsMid = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.id, analysisId));
    expect((rowsMid[0].findings as unknown[]).length).toBe(2);

    // Now correct the valid finding. validateFindings() must strip the invalid
    // one from the array before the DB re-write.
    const patch = await request(app)
      .patch(`/api/analysis/${analysisId}/findings/correct`)
      .send({ findingId: 1, action: "accept" });
    expect(patch.status).toBe(200);

    // Response must contain only the valid corrected finding.
    const findings = patch.body.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(1);
    expect(findings[0].reviewStatus).toBe("accepted");

    // DB must also contain only the valid finding.
    const rowsAfter = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.id, analysisId));
    const stored = (rowsAfter[0].findings as unknown) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(1);
    const hasInvalid = stored.some((f) => !("category" in f) || f.category === undefined);
    expect(hasInvalid).toBe(false);
  });

  it("does not persist a structurally invalid finding injected alongside a valid correction", async () => {
    asUser(OWNER_ID);

    // Seed two findings: one valid (id 1) and one already-invalid (id 99, no category).
    // We bypass POST validation by writing directly to the DB — intentional:
    // this test simulates legacy rows stored before validateFindings() was added.
    // Cast through unknown to satisfy the typed findings column while keeping
    // the structurally invalid entry intact.
    const [seedRow] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        findings: [validFinding({ id: 1 }), invalidFinding({ id: 99 })] as unknown as Finding[],
      })
      .returning();
    const analysisId = seedRow.id;

    // Correct the valid finding — the invalid one must be stripped on re-write.
    const patch = await request(app)
      .patch(`/api/analysis/${analysisId}/findings/correct`)
      .send({ findingId: 1, action: "dismiss" });
    expect(patch.status).toBe(200);

    const findings = patch.body.findings as Array<Record<string, unknown>>;
    // Only the valid finding remains, with its updated reviewStatus.
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(1);
    expect(findings[0].reviewStatus).toBe("dismissed");

    // Verify the DB row is clean.
    const [dbRow] = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.id, analysisId));
    const stored = (dbRow.findings as unknown) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored.some((f) => !("category" in f))).toBe(false);
  });
});
