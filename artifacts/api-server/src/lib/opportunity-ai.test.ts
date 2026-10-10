import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateEstimatedAnnualValue } from "./pricing";

/**
 * Unit + integration tests for opportunity-ai helpers.
 *
 * Focus: the "medium" tier fallback in parseCandidates ensures that a missing
 * or unrecognised estimatedValueTier from the AI model never produces a
 * null / zero estimatedAnnualValue in the DB — which would silently corrupt
 * pipeline totals on the Leads/Reports screen.
 */

// ── OpenAI mock (must be hoisted so it is in place before the module loads) ──

const { aiState } = vi.hoisted(() => ({
  aiState: {
    response: null as string | null,
    /** 0-based call indices that should throw instead of returning a response. */
    errorCalls: [] as number[],
    /** Tracks how many times `create` has been called; reset in beforeEach. */
    callCount: 0,
  },
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const idx = aiState.callCount++;
          if (aiState.errorCalls.includes(idx)) {
            throw new Error("AI timeout (simulated)");
          }
          return { choices: [{ message: { content: aiState.response } }] };
        }),
      },
    },
  },
}));

// ── Clerk mock (required by the DB layer imported transitively) ───────────────

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => ({ userId: null }),
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { getSettings, parseCandidates, runOpportunitySynthesis, runOpportunitySynthesisCore } from "./opportunity-ai";
import {
  db,
  companiesTable,
  usersTable,
  inspectionsTable,
  opportunitiesTable,
  opportunityEventsTable,
  opportunitySettingsTable,
  type Finding,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal Finding that satisfies the type and passes the grounding gate. */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    category: "structural",
    description: "Foundation crack at north wall",
    confidence: 0.9,
    severity: "medium",
    location: "North wall",
    imageUrl: null,
    treatment: "Seal crack",
    exclusionOpportunity: null,
    ...overrides,
  };
}

/** Raw JSON string the "AI model" returns for a single structural candidate. */
function aiResponse(tier: string | undefined): string {
  const item: Record<string, unknown> = {
    category: "structural",
    title: "Foundation crack remediation",
    rationale: "A verified structural finding documents a foundation crack at the north wall.",
    evidenceFindingIds: [1],
    confidence: 0.85,
  };
  if (tier !== undefined) {
    item.estimatedValueTier = tier;
  }
  return JSON.stringify({ opportunities: [item] });
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — parseCandidates (pure function, no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCandidates — estimatedValueTier fallback", () => {
  const validIds = new Set([1]);

  it("preserves a valid tier when the AI provides one", () => {
    const candidates = parseCandidates(aiResponse("high"), validIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].estimatedValueTier).toBe("high");
  });

  it("falls back to 'medium' when estimatedValueTier is missing", () => {
    // The AI omitted the field entirely.
    const candidates = parseCandidates(aiResponse(undefined), validIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].estimatedValueTier).toBe("medium");
  });

  it("falls back to 'medium' when estimatedValueTier is an unrecognised string", () => {
    const candidates = parseCandidates(aiResponse("extreme"), validIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].estimatedValueTier).toBe("medium");
  });

  it("falls back to 'medium' when estimatedValueTier is null", () => {
    const raw = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Foundation crack remediation",
          rationale: "A verified structural finding documents a foundation crack.",
          evidenceFindingIds: [1],
          estimatedValueTier: null,
          confidence: 0.8,
        },
      ],
    });
    const candidates = parseCandidates(raw, validIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].estimatedValueTier).toBe("medium");
  });

  it("falls back to 'medium' when estimatedValueTier is a number (type confusion)", () => {
    const raw = JSON.stringify({
      opportunities: [
        {
          category: "structural",
          title: "Foundation crack remediation",
          rationale: "A verified structural finding documents a foundation crack.",
          evidenceFindingIds: [1],
          estimatedValueTier: 2,
          confidence: 0.8,
        },
      ],
    });
    const candidates = parseCandidates(raw, validIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].estimatedValueTier).toBe("medium");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests — runOpportunitySynthesis writes non-null, non-zero value
// ─────────────────────────────────────────────────────────────────────────────

const CLERK_OWNER = "opp_ai_test_owner_clerk_id";

let companyId: number;
let inspectionId: number;

const findings: Finding[] = [makeFinding({ id: 1 })];

beforeAll(async () => {
  // Idempotent company creation — other test files use different slugs.
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, "opp-ai-unit-test-co"));
  companyId = existing
    ? existing.id
    : (await db.insert(companiesTable).values({ name: "Opp AI Unit Test Co", slug: "opp-ai-unit-test-co" }).returning())[0].id;

  // Ensure a user exists for the inspection FK chain.
  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, CLERK_OWNER));
  if (!existingUser) {
    await db.insert(usersTable).values({ clerkUserId: CLERK_OWNER, role: "owner", companyId });
  }
});

beforeEach(async () => {
  aiState.response = null;
  aiState.callCount = 0;
  aiState.errorCalls = [];

  // Scope all cleanup strictly to this fixture company to avoid cross-test
  // coupling with other suites that share the same test DB.
  await db
    .delete(opportunitySettingsTable)
    .where(eq(opportunitySettingsTable.companyId, companyId));
  await db
    .delete(opportunityEventsTable)
    .where(eq(opportunityEventsTable.companyId, companyId));
  await db
    .delete(opportunitiesTable)
    .where(eq(opportunitiesTable.companyId, companyId));
  await db
    .delete(inspectionsTable)
    .where(eq(inspectionsTable.companyId, companyId));

  // Fresh inspection for each test so FK constraints are satisfied.
  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: "500 Opp AI Test Avenue",
      technicianName: "Tester",
      clientName: "Client",
      pestTypes: ["rodents"],
    })
    .returning();
  inspectionId = insp.id;
});

describe("runOpportunitySynthesis — estimatedAnnualValue is populated", () => {
  it("inserts a row with non-null, non-zero estimatedAnnualValue when tier is absent from the AI response", async () => {
    // The AI model deliberately omits estimatedValueTier.
    aiState.response = aiResponse(undefined);

    await runOpportunitySynthesis({ companyId, inspectionId, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(rows).toHaveLength(1);
    // Tier fallback: parseCandidates must have applied "medium".
    expect(rows[0].estimatedValueTier).toBe("medium");
    // Value must be a positive whole-dollar figure (the pricing engine rounds
    // to the nearest $100, so the smallest realistic output is $600).
    expect(rows[0].estimatedAnnualValue).not.toBeNull();
    expect(rows[0].estimatedAnnualValue).toBeGreaterThan(0);
  });

  it("inserts a row with non-null, non-zero estimatedAnnualValue when tier is an unrecognised string", async () => {
    aiState.response = aiResponse("unknown_tier");

    await runOpportunitySynthesis({ companyId, inspectionId, findings });

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(rows).toHaveLength(1);
    expect(rows[0].estimatedValueTier).toBe("medium");
    expect(rows[0].estimatedAnnualValue).not.toBeNull();
    expect(rows[0].estimatedAnnualValue).toBeGreaterThan(0);
  });

  it("also produces non-null, non-zero value for explicit valid tiers (low / high)", async () => {
    for (const tier of ["low", "high"] as const) {
      // Reset between sub-cases.
      await db.delete(opportunityEventsTable).where(eq(opportunityEventsTable.companyId, companyId));
      await db.delete(opportunitiesTable).where(eq(opportunitiesTable.companyId, companyId));
      const [freshInsp] = await db
        .insert(inspectionsTable)
        .values({
          companyId,
          siteAddress: "500 Opp AI Test Avenue",
          technicianName: "Tester",
          clientName: "Client",
          pestTypes: ["rodents"],
        })
        .returning();

      aiState.response = aiResponse(tier);
      await runOpportunitySynthesis({ companyId, inspectionId: freshInsp.id, findings });

      const rows = await db
        .select()
        .from(opportunitiesTable)
        .where(eq(opportunitiesTable.companyId, companyId));

      expect(rows).toHaveLength(1);
      expect(rows[0].estimatedValueTier).toBe(tier);
      expect(rows[0].estimatedAnnualValue).not.toBeNull();
      expect(rows[0].estimatedAnnualValue).toBeGreaterThan(0);
    }
  });

  it("estimatedAnnualValue matches the pricing engine output for the resolved tier", async () => {
    // Verify the stored value is exactly what calculateEstimatedAnnualValue
    // would produce — not a truncated/null variant — so pipeline SUM queries
    // are accurate from day one.
    aiState.response = aiResponse("high");

    await runOpportunitySynthesis({ companyId, inspectionId, findings });

    const [row] = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(row.estimatedAnnualValue).not.toBeNull();
    // The pricing engine is deterministic; any positive whole-dollar value
    // confirms the full pipeline ran (tier → risk → price). We also confirm
    // it matches the engine's own output for the same inputs.
    const expected = calculateEstimatedAnnualValue({
      propertyType: "500 Opp AI Test Avenue",
      tier: "high",
      riskLevel: row.riskLevel ?? "medium",
    });
    expect(row.estimatedAnnualValue).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent synthesis — pipeline totals stay accurate under race conditions
// ─────────────────────────────────────────────────────────────────────────────

describe("runOpportunitySynthesis — concurrent analysis runs", () => {
  it("produces exactly one opportunity row when two synthesis runs fire simultaneously for the same property", async () => {
    // Both runs see the same findings and will propose the same fingerprint.
    // The second INSERT hits the unique partial index (23505) and the catch
    // block falls back to strengthen the winner — total rows must stay at 1.
    aiState.response = aiResponse("medium");

    await Promise.all([
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
    ]);

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    // No duplicates: exactly one open opportunity for this fingerprint.
    expect(rows).toHaveLength(1);

    // The surviving row must carry a non-null, non-zero value so the pipeline
    // total (SUM of estimatedAnnualValue) is accurate.
    expect(rows[0].estimatedAnnualValue).not.toBeNull();
    expect(rows[0].estimatedAnnualValue).toBeGreaterThan(0);
    expect(rows[0].estimatedValueTier).toBe("medium");
  });

  it("pipeline total (sum of estimatedAnnualValue) equals the single opportunity's value after concurrent inserts", async () => {
    aiState.response = aiResponse("high");

    // Three concurrent runs for the same property/fingerprint.
    await Promise.all([
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
    ]);

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    // Still exactly one row — no phantom duplicates inflating the pipeline.
    expect(rows).toHaveLength(1);

    const singleValue = rows[0].estimatedAnnualValue ?? 0;
    expect(singleValue).toBeGreaterThan(0);

    // The pipeline total equals the single opportunity's value — no inflation
    // from duplicate rows that would corrupt the SUM on the Leads screen.
    const pipelineTotal = rows.reduce((sum, r) => sum + (r.estimatedAnnualValue ?? 0), 0);
    expect(pipelineTotal).toBe(singleValue);
  });

  it("concurrent runs with a missing tier still produce exactly one row with a non-zero value", async () => {
    // Worst case: tier is absent (AI omitted it) AND two runs race.
    aiState.response = aiResponse(undefined);

    await Promise.all([
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
    ]);

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(rows).toHaveLength(1);
    expect(rows[0].estimatedValueTier).toBe("medium"); // fallback applied
    expect(rows[0].estimatedAnnualValue).not.toBeNull();
    expect(rows[0].estimatedAnnualValue).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry and failure-count tests
// Verifies that a transient AI error triggers exactly one retry, and that
// exhausting both retries causes runOpportunitySynthesisCore to throw (so
// catch-up endpoints can count real failures) while the fire-and-forget wrapper
// swallows the error silently.
// ─────────────────────────────────────────────────────────────────────────────

describe("runOpportunitySynthesisCore — retry and failure behavior", () => {
  it("retries once on a transient AI failure and writes the opportunity on success", async () => {
    // Call 0 throws (transient), call 1 succeeds.
    aiState.errorCalls = [0];
    aiState.response = aiResponse("medium");

    await expect(
      runOpportunitySynthesisCore({ companyId, inspectionId, findings }),
    ).resolves.toBeUndefined();

    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    expect(rows).toHaveLength(1);
    expect(rows[0].estimatedAnnualValue).not.toBeNull();
    expect(rows[0].estimatedAnnualValue).toBeGreaterThan(0);
    // Two AI calls: the failed one plus the retry.
    expect(aiState.callCount).toBe(2);
  }, 10_000);

  it("throws when both AI attempts fail so catch-up endpoints can count real failures", async () => {
    // Both retries throw — synthesis cannot recover.
    aiState.errorCalls = [0, 1];

    await expect(
      runOpportunitySynthesisCore({ companyId, inspectionId, findings }),
    ).rejects.toThrow("AI timeout (simulated)");

    // No opportunity row written when both attempts fail.
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));
    expect(rows).toHaveLength(0);

    // Both calls were attempted (initial + retry).
    expect(aiState.callCount).toBe(2);
  }, 10_000);

  it("fire-and-forget wrapper resolves (never throws) even when both retries fail", async () => {
    // Verify the fire-and-forget contract: a synthesis failure must never
    // propagate to the inspection path that called void runOpportunitySynthesis().
    aiState.errorCalls = [0, 1];

    await expect(
      runOpportunitySynthesis({ companyId, inspectionId, findings }),
    ).resolves.toBeUndefined();

    // Failure was swallowed — no row written, no unhandled rejection.
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));
    expect(rows).toHaveLength(0);
  }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure counter — synthesisFailuresSinceLastSuccess
//
// runOpportunitySynthesis (fire-and-forget wrapper) must:
//   - increment synthesisFailuresSinceLastSuccess in opportunity_settings on
//     every total AI failure (both retries exhausted)
//   - reset it to 0 after any successful synthesis run, including when the
//     first attempt failed but the retry succeeded
//
// resetSynthesisFailures / incrementSynthesisFailures are called with `void`
// inside the wrapper, so they complete asynchronously after the wrapper
// resolves. We poll the DB until the expected value lands (up to 2 s) rather
// than relying on a fixed sleep, so the tests are both deterministic and fast.
// ─────────────────────────────────────────────────────────────────────────────

/** Read synthesisFailuresSinceLastSuccess from the DB for a given company. */
async function readFailureCounter(cId: number): Promise<number> {
  const [row] = await db
    .select({ synthesisFailuresSinceLastSuccess: opportunitySettingsTable.synthesisFailuresSinceLastSuccess })
    .from(opportunitySettingsTable)
    .where(eq(opportunitySettingsTable.companyId, cId))
    .limit(1);
  // If no settings row exists yet the counter is implicitly 0.
  return row?.synthesisFailuresSinceLastSuccess ?? 0;
}

/**
 * Poll until the counter equals `expected` or 2 000 ms elapses.
 * Throws the vitest assertion on timeout so the failure message is clear.
 */
async function waitForCounter(cId: number, expected: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = await readFailureCounter(cId);
    if (value === expected) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  // Final read — let vitest format the mismatch.
  expect(await readFailureCounter(cId)).toBe(expected);
}

/** One-tick flush to drain void writes left over from a previous test. */
function flushPendingWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe("runOpportunitySynthesis — synthesisFailuresSinceLastSuccess counter", () => {
  // The outer beforeEach cleans opportunitySettingsTable, but void DB writes
  // from the preceding test suite may land asynchronously AFTER that cleanup.
  // This inner beforeEach flushes those stale writes and re-cleans so each
  // counter test starts from a known-zero baseline.
  beforeEach(async () => {
    await flushPendingWrites();
    await db
      .delete(opportunitySettingsTable)
      .where(eq(opportunitySettingsTable.companyId, companyId));
  });

  it("increments the counter to 1 when both AI attempts fail", async () => {
    // Both retries throw → wrapper calls incrementSynthesisFailures.
    aiState.errorCalls = [0, 1];

    await runOpportunitySynthesis({ companyId, inspectionId, findings });

    // Poll until the void DB write lands — deterministic, no fixed sleep.
    await waitForCounter(companyId, 1);
  }, 10_000);

  it("increments the counter to 2 after two consecutive total failures", async () => {
    // First failure.
    aiState.errorCalls = [0, 1];
    await runOpportunitySynthesis({ companyId, inspectionId, findings });
    await waitForCounter(companyId, 1);

    // Reset AI call index so the second run also uses indices 0 and 1.
    aiState.callCount = 0;
    aiState.errorCalls = [0, 1];

    // A second fresh inspection is needed so the inspection FK is valid.
    const [insp2] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: "500 Opp AI Test Avenue",
        technicianName: "Tester",
        clientName: "Client",
        pestTypes: ["rodents"],
      })
      .returning();

    await runOpportunitySynthesis({ companyId, inspectionId: insp2.id, findings });
    await waitForCounter(companyId, 2);
  }, 15_000);

  it("resets the counter to 0 after a retry-success (first attempt fails, second succeeds)", async () => {
    // Seed the counter at 1 via a total failure so there is a non-zero value
    // to reset — this mirrors the real "catch-up after outage" scenario.
    aiState.errorCalls = [0, 1];
    await runOpportunitySynthesis({ companyId, inspectionId, findings });
    await waitForCounter(companyId, 1);

    // Now re-run synthesis on a fresh inspection where the FIRST AI attempt
    // fails but the SECOND (retry) succeeds.  This is the exact scenario the
    // task title describes: "a successful retry" must reset the counter.
    aiState.callCount = 0;
    aiState.errorCalls = [0]; // index 0 throws; index 1 returns successContent
    aiState.response = aiResponse("medium");

    const [insp2] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: "500 Opp AI Test Avenue",
        technicianName: "Tester",
        clientName: "Client",
        pestTypes: ["rodents"],
      })
      .returning();

    await runOpportunitySynthesis({ companyId, inspectionId: insp2.id, findings });

    // The wrapper called resetSynthesisFailures (void); poll until it lands.
    await waitForCounter(companyId, 0);

    // Confirm the retry also made two AI calls (first-fail + retry-succeed).
    expect(aiState.callCount).toBe(2);
  }, 15_000);

  it("counter stays at 0 when synthesis succeeds on the first attempt", async () => {
    aiState.errorCalls = [];
    aiState.response = aiResponse("low");

    await runOpportunitySynthesis({ companyId, inspectionId, findings });
    await waitForCounter(companyId, 0);
  }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// getSettings default — synthesisFailuresSinceLastSuccess must be 0 for a
// brand-new company that has never had an opportunity_settings row.
//
// This pins the fallback value so that removing the hard-coded `0` in
// getSettings (opportunity-ai.ts) immediately breaks this test, preventing a
// phantom failure banner from appearing for companies with no synthesis history.
// ─────────────────────────────────────────────────────────────────────────────

describe("getSettings — default settings for a company with no opportunity_settings row", () => {
  it("returns synthesisFailuresSinceLastSuccess: 0 when no row exists", async () => {
    // Guarantee the fixture company has no settings row before calling getSettings.
    await db
      .delete(opportunitySettingsTable)
      .where(eq(opportunitySettingsTable.companyId, companyId));

    const settings = await getSettings(companyId);

    expect(settings.synthesisFailuresSinceLastSuccess).toBe(0);
  });

  it("returns enabled: true and minConfidence: 0.5 in the default settings object", async () => {
    await db
      .delete(opportunitySettingsTable)
      .where(eq(opportunitySettingsTable.companyId, companyId));

    const settings = await getSettings(companyId);

    // Belt-and-braces: confirm the full default shape so no single field
    // can silently flip without a test failure.
    expect(settings.enabled).toBe(true);
    expect(settings.minConfidence).toBe(0.5);
    expect(settings.enabledCategories).toBeNull();
    expect(settings.synthesisFailuresSinceLastSuccess).toBe(0);
    expect(settings.companyId).toBe(companyId);
  });
});
