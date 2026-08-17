import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the opportunity synthesis retry + logging behaviour in
 * runOpportunitySynthesis / callAiWithRetry.
 *
 * Coverage:
 *  - When the AI throws on the first attempt it retries and, on success,
 *    writes the opportunity row.
 *  - When both attempts throw the error is logged via logger.error with
 *    inspectionId and companyId in the structured context, and no
 *    opportunity row is inserted.
 */

// ── OpenAI mock ───────────────────────────────────────────────────────────────
// vi.hoisted keeps the shared state accessible both inside the vi.mock factory
// (which is hoisted to the top of the module by vitest) and in the test body.

const { openaiMock } = vi.hoisted(() => ({
  openaiMock: {
    callCount: 0,
    failCount: 0, // throw on the first `failCount` calls
    successContent: JSON.stringify({
      opportunities: [
        {
          category: "conducive_condition",
          title: "Active moisture harborage under sink",
          rationale: "Moisture finding confirms conducive condition for pest ingress.",
          evidenceFindingIds: [9001],
          estimatedValueTier: "medium",
          confidence: 0.85,
        },
      ],
    }),
  },
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(async () => {
          openaiMock.callCount += 1;
          if (openaiMock.callCount <= openaiMock.failCount) {
            throw new Error("AI service temporarily unavailable");
          }
          return {
            choices: [{ message: { content: openaiMock.successContent } }],
          };
        }),
      },
    },
  },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
// Capture structured error objects so tests can assert on context fields.

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    warnCalls: [] as Array<[Record<string, unknown>, string]>,
    errorCalls: [] as Array<[Record<string, unknown>, string]>,
  },
}));

vi.mock("../logger", () => ({
  logger: {
    warn: vi.fn((ctx: Record<string, unknown>, msg: string) => {
      loggerMock.warnCalls.push([ctx, msg]);
    }),
    error: vi.fn((ctx: Record<string, unknown>, msg: string) => {
      loggerMock.errorCalls.push([ctx, msg]);
    }),
    info: vi.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import {
  db,
  companiesTable,
  inspectionsTable,
  opportunitiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { runOpportunitySynthesis, runOpportunitySynthesisCore } from "../opportunity-ai";
import type { Finding } from "@workspace/db";

// ── Fixture constants ─────────────────────────────────────────────────────────
const COMPANY_SLUG = "opp-synthesis-retry-test-co";
const SITE_ADDRESS = "99 Synthesis Retry Lane";
const FINDING_ID = 9001;

const STUB_FINDING: Finding = {
  id: FINDING_ID,
  category: "moisture",
  description: "Active moisture under sink unit",
  confidence: 0.9,
  severity: "high",
  location: "Kitchen",
  imageUrl: null,
  treatment: null,
  exclusionOpportunity: false,
  species: null,
  lifeStage: null,
  conduciveCondition: "moisture",
  harborage: null,
  moisture: "active",
  structuralIssue: null,
  zone: "kitchen",
};

let companyId: number;
let inspectionId: number;

// ── Shared DB setup ───────────────────────────────────────────────────────────

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
          .values({ name: "Opp Synthesis Retry Test Co", slug: COMPANY_SLUG })
          .returning()
      )[0].id;
});

beforeEach(async () => {
  // Reset mock state.
  openaiMock.callCount = 0;
  openaiMock.failCount = 0;
  loggerMock.warnCalls = [];
  loggerMock.errorCalls = [];

  // Fresh inspection for every test.
  await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Test Tech",
      clientName: "Test Client",
      pestTypes: ["moisture"],
    })
    .returning();
  inspectionId = insp.id;
});


// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runOpportunitySynthesis — retry behaviour", () => {
  it("retries after a first-attempt AI failure and writes the opportunity on success", async () => {
    // First call throws; second call succeeds with a valid opportunity.
    openaiMock.failCount = 1;

    await runOpportunitySynthesis({
      companyId,
      inspectionId,
      findings: [STUB_FINDING],
    });

    // Both attempts should have been made.
    expect(openaiMock.callCount).toBe(2);

    // The warn log for the first-attempt failure must have fired.
    expect(loggerMock.warnCalls.length).toBeGreaterThanOrEqual(1);
    const warnCtx = loggerMock.warnCalls[0][0];
    expect(warnCtx).toHaveProperty("retryDelayMs");

    // The opportunity row should have been written by the successful second attempt.
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Active moisture harborage under sink");
    expect(rows[0].inspectionId).toBe(inspectionId);
    expect(rows[0].companyId).toBe(companyId);
  });
});

describe("runOpportunitySynthesis — total AI failure logging", () => {
  it("logs the error with inspectionId and companyId when both attempts fail", async () => {
    // Both attempts throw.
    openaiMock.failCount = 2;

    await runOpportunitySynthesis({
      companyId,
      inspectionId,
      findings: [STUB_FINDING],
    });

    // Both AI calls should have been attempted.
    expect(openaiMock.callCount).toBe(2);

    // logger.error must have been called at least once.
    expect(loggerMock.errorCalls.length).toBeGreaterThanOrEqual(1);

    // The structured context must include inspectionId and companyId so ops
    // can triage the failure without a stack-trace hunt.
    const [errorCtx, errorMsg] = loggerMock.errorCalls[0];
    expect(errorCtx).toHaveProperty("inspectionId", inspectionId);
    expect(errorCtx).toHaveProperty("companyId", companyId);
    expect(errorCtx).toHaveProperty("err");
    expect(typeof errorMsg).toBe("string");
    expect(errorMsg).toContain("synthesis failed");

    // No opportunity row should have been inserted.
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(rows).toHaveLength(0);
  });

  it("does not propagate the error to the caller (fire-and-forget contract)", async () => {
    openaiMock.failCount = 2;

    // runOpportunitySynthesis must resolve (not reject) even when the AI fails.
    await expect(
      runOpportunitySynthesis({
        companyId,
        inspectionId,
        findings: [STUB_FINDING],
      }),
    ).resolves.toBeUndefined();
  });
});

// ── Batch catch-up simulation ─────────────────────────────────────────────────
//
// These tests exercise `runOpportunitySynthesisCore` directly — the throwing
// variant — to confirm that:
//   (a) every AI failure surfaces as a thrown error a batch loop can count, and
//   (b) a mixed batch (some succeed, some fail) produces exactly the right split.
//
// The 1500 ms retry sleep is real here; a future task will inject fake timers
// to keep the suite fast.

describe("runOpportunitySynthesisCore — all-failure batch", () => {
  it("throws for every inspection when AI always fails, so the batch loop counts failures accurately", async () => {
    // AI fails on every attempt — no successful run possible.
    openaiMock.failCount = 100;

    // Second inspection alongside the one created by beforeEach.
    const [insp2] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: SITE_ADDRESS,
        technicianName: "Test Tech",
        clientName: "Test Client",
        pestTypes: ["moisture"],
      })
      .returning();

    const batch = [
      { companyId, inspectionId, findings: [STUB_FINDING] },
      { companyId, inspectionId: insp2.id, findings: [STUB_FINDING] },
    ];

    // Simulate what a batch catch-up endpoint does: call Core for each item,
    // catch thrown errors, and accumulate the counts.
    let successes = 0;
    let failures = 0;
    for (const item of batch) {
      try {
        await runOpportunitySynthesisCore(item);
        successes++;
      } catch {
        failures++;
      }
    }

    // Every item in the batch must have been counted as a failure.
    expect(failures).toBe(2);
    expect(successes).toBe(0);

    // No opportunity rows should have been written.
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  });
});

describe("runOpportunitySynthesisCore — mixed batch", () => {
  it("produces the correct success/failure split when only some inspections fail", async () => {
    // The first two AI calls fail (exhausting both attempts for inspection 1),
    // so inspection 1 throws.  Calls 3+ succeed, so inspections 2 and 3 write
    // opportunities.  Expected split: 1 failure, 2 successes.
    openaiMock.failCount = 2;

    // Use distinct addresses so opportunities get their own fingerprints and
    // the success count (rows written) is unambiguous.
    const [insp2] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: SITE_ADDRESS + " Unit B",
        technicianName: "Test Tech",
        clientName: "Test Client",
        pestTypes: ["moisture"],
      })
      .returning();

    const [insp3] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: SITE_ADDRESS + " Unit C",
        technicianName: "Test Tech",
        clientName: "Test Client",
        pestTypes: ["moisture"],
      })
      .returning();

    const batch = [
      { companyId, inspectionId, findings: [STUB_FINDING] },
      { companyId, inspectionId: insp2.id, findings: [STUB_FINDING] },
      { companyId, inspectionId: insp3.id, findings: [STUB_FINDING] },
    ];

    let successes = 0;
    let failures = 0;
    for (const item of batch) {
      try {
        await runOpportunitySynthesisCore(item);
        successes++;
      } catch {
        failures++;
      }
    }

    // Counts must reflect the exact split driven by failCount.
    expect(failures).toBe(1);
    expect(successes).toBe(2);

    // Each successful inspection wrote one opportunity at its distinct address,
    // so the total row count must be 2.
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));
    expect(rows).toHaveLength(2);

    // The two written rows belong to the inspections that succeeded.
    const writtenInspectionIds = rows.map((r) => r.inspectionId).sort();
    expect(writtenInspectionIds).toEqual([insp2.id, insp3.id].sort());
  });
});
