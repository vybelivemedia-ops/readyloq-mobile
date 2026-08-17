import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for malformed-finding rejection at finalization.
 *
 * Coverage:
 *  - ensureReportForInspection: malformed findings stripped from reportsTable insert
 *  - ensureReportForInspection: valid findings preserved exactly in reportsTable
 *  - ensureReportForInspection: logErrorEvent called when at least one finding stripped
 *  - runInspectionFinalization: malformed findings stripped before all downstream writes
 *    (opportunity synthesis, scorecard, customer summary, report update)
 *  - runInspectionFinalization: valid findings preserved in downstream writes
 *  - runInspectionFinalization: logErrorEvent called when at least one finding stripped
 */

// ── Heavy AI / side-effect mocks ──────────────────────────────────────────────
// All real AI calls, push notifications, property memory, and enterprise event
// bus are stubbed so the test only exercises the validation + DB paths.

vi.mock("../report-narrative-ai", () => ({
  generateReportNarrative: vi.fn().mockResolvedValue("Mock narrative"),
  derivePropertyType: vi.fn().mockReturnValue("residential"),
}));

vi.mock("../customer-summary-ai", () => ({
  generateCustomerSummaryBody: vi.fn().mockResolvedValue("Mock summary body"),
  SummaryFidelityError: class SummaryFidelityError extends Error {},
}));

vi.mock("../opportunity-ai", () => ({
  runOpportunitySynthesis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../scorecard", () => ({
  runScorecardComputation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../push-notifications", () => ({
  notifyCriticalInspection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../property-memory-writer", () => ({
  writePropertyMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../enterprise-event-bus", () => ({
  enterpriseEventBus: {
    emitInspectionFinalized: vi.fn(),
  },
}));

vi.mock("../zone-coverage", () => ({
  computeCoverage: vi.fn().mockReturnValue(null),
  zonesFromFinding: vi.fn().mockReturnValue([]),
}));

// ── logErrorEvent spy ─────────────────────────────────────────────────────────
// Capture calls so tests can assert that the error monitor was notified when
// findings were stripped.

const { errorEventMock } = vi.hoisted(() => ({
  errorEventMock: {
    calls: [] as Array<[string, Record<string, unknown>]>,
  },
}));

vi.mock("../error-events", () => ({
  logErrorEvent: vi.fn((kind: string, ctx: Record<string, unknown>) => {
    errorEventMock.calls.push([kind, ctx]);
    return Promise.resolve();
  }),
}));

// ── Logger mock (silence noise in test output) ────────────────────────────────
vi.mock("../logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import {
  db,
  companiesTable,
  inspectionsTable,
  analysisResultsTable,
  reportsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ensureReportForInspection, runInspectionFinalization } from "../inspection-complete";
import { runOpportunitySynthesis } from "../opportunity-ai";
import { runScorecardComputation } from "../scorecard";
import type { Finding } from "@workspace/db";

// ── Fixture data ──────────────────────────────────────────────────────────────

const COMPANY_SLUG = "finalization-validation-test-co";
const SITE_ADDRESS = "42 Malformed Finding Lane";

/** A fully valid finding that must pass through validateFindings unchanged. */
const VALID_FINDING_A: Finding = {
  id: 1,
  category: "rodent",
  description: "Fresh droppings under sink",
  confidence: 0.92,
  severity: "high",
  location: "Kitchen",
  imageUrl: null,
  treatment: "Snap trap placement",
  exclusionOpportunity: true,
  species: "Mus musculus",
  lifeStage: "adult",
  conduciveCondition: null,
  harborage: "under_cabinet",
  moisture: null,
  structuralIssue: null,
  zone: "kitchen",
};

const VALID_FINDING_B: Finding = {
  id: 2,
  category: "moisture",
  description: "Active water intrusion at baseboard",
  confidence: 0.78,
  severity: "medium",
  location: "Basement",
  imageUrl: null,
  treatment: null,
  exclusionOpportunity: false,
  species: null,
  lifeStage: null,
  conduciveCondition: "moisture",
  harborage: null,
  moisture: "active",
  structuralIssue: null,
  zone: "basement",
};

/**
 * A malformed finding: missing required `id` (number) and `confidence`, has a
 * wrong-typed `severity`. validateFindings must strip this entry.
 */
const MALFORMED_FINDING = {
  // id: missing entirely
  category: "insect",
  description: "Something buggy",
  // confidence: missing
  severity: 99,          // wrong type — must be string
  location: null,
  imageUrl: null,
  treatment: null,
  exclusionOpportunity: null,
};

let companyId: number;
let inspectionId: number;
let analysisId: number;

// ── DB setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, COMPANY_SLUG));

  companyId = existing
    ? existing.id
    : (
        await db
          .insert(companiesTable)
          .values({ name: "Finalization Validation Test Co", slug: COMPANY_SLUG })
          .returning()
      )[0].id;
});

beforeEach(async () => {
  // Reset spy state.
  errorEventMock.calls = [];
  vi.mocked(runOpportunitySynthesis).mockClear();
  vi.mocked(runScorecardComputation).mockClear();

  // Clean up any rows from a prior run.
  await db.delete(reportsTable).where(eq(reportsTable.companyId, companyId));
  await db.delete(analysisResultsTable).where(eq(analysisResultsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

  // Fresh inspection.
  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Test Tech",
      clientName: "Test Client",
      pestTypes: ["rodent", "moisture"],
    })
    .returning();
  inspectionId = insp.id;
});

afterEach(async () => {
  await db.delete(reportsTable).where(eq(reportsTable.companyId, companyId));
  await db.delete(analysisResultsTable).where(eq(analysisResultsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureReportForInspection
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureReportForInspection — finding validation", () => {
  async function seedAnalysis(findings: unknown[]) {
    const [row] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        status: "complete",
        findings: findings as Finding[],
        recommendations: ["Seal entry points"],
        overallConfidence: 0.85,
      })
      .returning();
    analysisId = row.id;
    return row;
  }

  it("strips malformed findings and only inserts valid ones into reportsTable", async () => {
    await seedAnalysis([VALID_FINDING_A, MALFORMED_FINDING, VALID_FINDING_B]);

    const report = await ensureReportForInspection({ companyId, inspectionId });

    expect(report).not.toBeNull();
    const savedFindings = report!.findings as Finding[];

    // Exactly the two valid findings must appear.
    expect(savedFindings).toHaveLength(2);
    expect(savedFindings.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("preserves valid findings exactly (no field mutation)", async () => {
    await seedAnalysis([VALID_FINDING_A, MALFORMED_FINDING]);

    const report = await ensureReportForInspection({ companyId, inspectionId });

    const saved = (report!.findings as Finding[])[0];
    expect(saved.category).toBe(VALID_FINDING_A.category);
    expect(saved.description).toBe(VALID_FINDING_A.description);
    expect(saved.confidence).toBe(VALID_FINDING_A.confidence);
    expect(saved.severity).toBe(VALID_FINDING_A.severity);
    expect(saved.location).toBe(VALID_FINDING_A.location);
    expect(saved.exclusionOpportunity).toBe(VALID_FINDING_A.exclusionOpportunity);
    expect(saved.species).toBe(VALID_FINDING_A.species);
  });

  it("calls logErrorEvent when at least one finding is stripped", async () => {
    await seedAnalysis([VALID_FINDING_A, MALFORMED_FINDING]);

    await ensureReportForInspection({ companyId, inspectionId });

    // At least one logErrorEvent call must have been made.
    expect(errorEventMock.calls.length).toBeGreaterThanOrEqual(1);

    // The call must reference the right inspection and stage.
    const errorCall = errorEventMock.calls.find(
      ([, ctx]) =>
        ctx.inspectionId === inspectionId &&
        (ctx.context as Record<string, unknown>)?.stage === "write_validation",
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![1].message).toMatch(/malformed finding/i);
  });

  it("does NOT call logErrorEvent when all findings are valid", async () => {
    await seedAnalysis([VALID_FINDING_A, VALID_FINDING_B]);

    await ensureReportForInspection({ companyId, inspectionId });

    // No strip-related error event must fire.
    const stripEvent = errorEventMock.calls.find(
      ([, ctx]) => (ctx.context as Record<string, unknown>)?.stage === "write_validation",
    );
    expect(stripEvent).toBeUndefined();
  });

  it("returns a report with empty findings when the analysis row has no findings", async () => {
    await seedAnalysis([]);

    const report = await ensureReportForInspection({ companyId, inspectionId });

    expect(report).not.toBeNull();
    expect((report!.findings as Finding[])).toHaveLength(0);
  });

  it("returns a report with empty findings when there is no analysis row yet", async () => {
    // No analysis row seeded.
    const report = await ensureReportForInspection({ companyId, inspectionId });

    expect(report).not.toBeNull();
    expect((report!.findings as Finding[])).toHaveLength(0);
  });

  it("does not insert a duplicate report if one already exists", async () => {
    await seedAnalysis([VALID_FINDING_A]);

    // First call creates the report.
    const first = await ensureReportForInspection({ companyId, inspectionId });
    // Second call must return the same row without inserting another.
    const second = await ensureReportForInspection({ companyId, inspectionId });

    expect(first!.id).toBe(second!.id);

    const rows = await db
      .select()
      .from(reportsTable)
      .where(
        and(eq(reportsTable.companyId, companyId), eq(reportsTable.inspectionId, inspectionId)),
      );
    expect(rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runInspectionFinalization
// ─────────────────────────────────────────────────────────────────────────────

describe("runInspectionFinalization — finding validation", () => {
  async function seedAnalysisAndReport(findings: unknown[]) {
    const [analysis] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        status: "complete",
        findings: findings as Finding[],
        recommendations: ["Seal all gaps"],
        overallConfidence: 0.8,
      })
      .returning();
    analysisId = analysis.id;

    // Create a pre-existing report so the finalization narrative update path runs.
    const [report] = await db
      .insert(reportsTable)
      .values({
        companyId,
        inspectionId,
        title: `Inspection Report — ${SITE_ADDRESS}`,
        clientName: "Test Client",
        siteAddress: SITE_ADDRESS,
        status: "complete",
        findings: findings as Finding[],
        recommendations: ["Seal all gaps"],
        treatmentNotes: null,
        exclusionOpportunities: [],
        technicianName: "Test Tech",
        inspectionDate: new Date().toISOString().split("T")[0],
        severity: null,
      })
      .returning();

    return { analysis, report };
  }

  it("strips malformed findings before passing to opportunity synthesis", async () => {
    const { report } = await seedAnalysisAndReport([
      VALID_FINDING_A,
      MALFORMED_FINDING,
      VALID_FINDING_B,
    ]);

    await runInspectionFinalization({
      companyId,
      inspectionId,
      reportId: report.id,
    });

    expect(runOpportunitySynthesis).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runOpportunitySynthesis).mock.calls[0][0];

    // Only the two valid findings must have been passed.
    expect(call.findings).toHaveLength(2);
    expect(call.findings.map((f: Finding) => f.id).sort()).toEqual([1, 2]);
  });

  it("strips malformed findings before passing to scorecard computation", async () => {
    const { report } = await seedAnalysisAndReport([VALID_FINDING_A, MALFORMED_FINDING]);

    await runInspectionFinalization({
      companyId,
      inspectionId,
      reportId: report.id,
    });

    expect(runScorecardComputation).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runScorecardComputation).mock.calls[0][0];

    expect(call.findings).toHaveLength(1);
    expect(call.findings[0].id).toBe(VALID_FINDING_A.id);
  });

  it("calls logErrorEvent when at least one finding is stripped during finalization", async () => {
    const { report } = await seedAnalysisAndReport([VALID_FINDING_A, MALFORMED_FINDING]);

    await runInspectionFinalization({
      companyId,
      inspectionId,
      reportId: report.id,
    });

    // At least one strip-related error event must have fired.
    const stripEvent = errorEventMock.calls.find(
      ([, ctx]) =>
        ctx.inspectionId === inspectionId &&
        (ctx.context as Record<string, unknown>)?.stage === "write_validation",
    );
    expect(stripEvent).toBeDefined();
    expect(stripEvent![1].message).toMatch(/malformed finding/i);
  });

  it("does NOT call the strip logErrorEvent when all findings are valid", async () => {
    const { report } = await seedAnalysisAndReport([VALID_FINDING_A, VALID_FINDING_B]);

    await runInspectionFinalization({
      companyId,
      inspectionId,
      reportId: report.id,
    });

    const stripEvent = errorEventMock.calls.find(
      ([, ctx]) => (ctx.context as Record<string, unknown>)?.stage === "write_validation",
    );
    expect(stripEvent).toBeUndefined();
  });

  it("updates the reportsTable row with only valid findings", async () => {
    const { report } = await seedAnalysisAndReport([
      VALID_FINDING_A,
      MALFORMED_FINDING,
      VALID_FINDING_B,
    ]);

    await runInspectionFinalization({
      companyId,
      inspectionId,
      reportId: report.id,
    });

    const [updated] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, report.id), eq(reportsTable.companyId, companyId)));

    const savedFindings = updated.findings as Finding[];
    expect(savedFindings).toHaveLength(2);
    expect(savedFindings.map((f) => f.id).sort()).toEqual([1, 2]);

    // Malformed entry must not be present.
    const hasMalformed = savedFindings.some((f) => typeof (f as unknown as { severity: unknown }).severity === "number");
    expect(hasMalformed).toBe(false);
  });

  it("preserves all valid findings exactly (no field mutation) during finalization", async () => {
    const { report } = await seedAnalysisAndReport([VALID_FINDING_A, VALID_FINDING_B]);

    await runInspectionFinalization({
      companyId,
      inspectionId,
      reportId: report.id,
    });

    const [updated] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, report.id), eq(reportsTable.companyId, companyId)));

    const savedFindings = (updated.findings as Finding[]).sort((a, b) => a.id - b.id);
    expect(savedFindings[0].category).toBe(VALID_FINDING_A.category);
    expect(savedFindings[0].confidence).toBe(VALID_FINDING_A.confidence);
    expect(savedFindings[1].category).toBe(VALID_FINDING_B.category);
    expect(savedFindings[1].confidence).toBe(VALID_FINDING_B.confidence);
  });

  it("completes without error when all findings in the analysis row are malformed", async () => {
    const { report } = await seedAnalysisAndReport([MALFORMED_FINDING]);

    await expect(
      runInspectionFinalization({ companyId, inspectionId, reportId: report.id }),
    ).resolves.toBeUndefined();

    // Downstream calls must have been made with an empty findings array.
    const oppCall = vi.mocked(runOpportunitySynthesis).mock.calls[0][0];
    expect(oppCall.findings).toHaveLength(0);

    const scoreCall = vi.mocked(runScorecardComputation).mock.calls[0][0];
    expect(scoreCall.findings).toHaveLength(0);
  });
});
