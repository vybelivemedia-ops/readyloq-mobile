import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

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
  usersTable,
  type Finding,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { objectPathCompanyScope } from "../lib/objectStorage";
import { analyzePhoto } from "../lib/intelligence-ai";
import { FindingSchema } from "@workspace/api-zod";

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

async function cleanRows() {
  if (!companyId) return;
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
