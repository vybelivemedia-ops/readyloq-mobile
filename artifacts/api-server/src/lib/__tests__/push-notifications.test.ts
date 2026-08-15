import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Integration tests for the critical-risk push notification pipeline.
 *
 * Coverage:
 *  - notifyCriticalInspection sends correctly shaped payloads to opted-in owners
 *  - Owners with pushNotificationsEnabled = false are excluded
 *  - Owners with no token are excluded
 *  - The Expo API is never called when there are no eligible tokens
 *  - POST /auth/me/push-token validates the ExponentPushToken[ format
 */

// ── Clerk mock ─────────────────────────────────────────────────────────────────
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

// ── fetch mock (Expo push API) ─────────────────────────────────────────────────
// Captures every call made to the Expo push endpoint so we can assert on
// the payload without ever hitting the real Expo service.
const { fetchState } = vi.hoisted(() => ({
  fetchState: {
    calls: [] as { url: string; body: unknown }[],
    responseStatus: 200,
    responseBody: { data: [{ status: "ok", id: "ticket-1" }] } as unknown,
  },
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, options?: RequestInit) => {
    const body =
      options?.body != null ? JSON.parse(options.body as string) : null;
    fetchState.calls.push({ url, body });
    const ok =
      fetchState.responseStatus >= 200 && fetchState.responseStatus < 300;
    return {
      ok,
      status: fetchState.responseStatus,
      json: async () => fetchState.responseBody,
      text: async () => JSON.stringify(fetchState.responseBody),
    } as Response;
  }),
);

// ── AI / pipeline mocks — keep the heavy steps inert so tests that call
// runInspectionFinalization can pre-seed their own scorecard and have it
// survive to step 5 without the real computation overwriting it.  Only
// push-notifications is left unblocked; that's the unit under test.
vi.mock("../scorecard", () => ({
  runScorecardComputation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../opportunity-ai", () => ({
  runOpportunitySynthesis: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../report-narrative-ai", () => ({
  generateReportNarrative: vi.fn().mockResolvedValue("mocked narrative"),
  derivePropertyType: vi.fn().mockReturnValue("residential"),
}));
vi.mock("../customer-summary-ai", () => ({
  generateCustomerSummaryBody: vi.fn().mockResolvedValue("mocked summary"),
  SummaryFidelityError: class SummaryFidelityError extends Error {},
}));
vi.mock("../property-memory-writer", () => ({
  writePropertyMemory: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks are wired) ───────────────────────────────────────────
import app from "../../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionScorecardsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { notifyCriticalInspection, notifyTechnicianRouteUpdated } from "../push-notifications";
import { runInspectionFinalization } from "../inspection-complete";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture identifiers — unique slugs avoid cross-suite collisions in the
// shared test DB.
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_A_CLERK = "pn_test_owner_a";
const OWNER_B_CLERK = "pn_test_owner_b";
const TECH_CLERK = "pn_test_tech";
const COMPANY_SLUG = "push-notif-test-co";

const VALID_TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaa]";
const VALID_TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbb]";
const SITE_ADDRESS = "42 Push Test Boulevard";

let companyId: number;
let inspectionId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

/** Expo push calls captured during this test. */
function expoCalls() {
  return fetchState.calls.filter((c) =>
    typeof c.url === "string" && c.url.includes("exp.host"),
  );
}

// ── Shared setup ──────────────────────────────────────────────────────────────

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
          .values({ name: "Push Notif Test Co", slug: COMPANY_SLUG })
          .returning()
      )[0].id;
});

beforeEach(async () => {
  asUser(null);

  // Reset fetch spy state.
  fetchState.calls = [];
  fetchState.responseStatus = 200;
  fetchState.responseBody = { data: [{ status: "ok", id: "ticket-1" }] };

  // Scope cleanup strictly to the fixture company so other suites are unaffected.
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

  // Fresh inspection satisfying FK constraints for every test.
  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
      clientName: "Test Client",
      pestTypes: ["rodents"],
    })
    .returning();
  inspectionId = insp.id;
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyCriticalInspection — delivery to opted-in owners
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyCriticalInspection — sends to opted-in owners", () => {
  it("calls the Expo API with a correctly shaped payload for a single opted-in owner", async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);
    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);

    const msg = messages[0];
    expect(msg.to).toBe(VALID_TOKEN_A);
    expect(typeof msg.title).toBe("string");
    expect((msg.title as string).toLowerCase()).toContain("critical");
    expect(msg.body).toContain(SITE_ADDRESS);
    expect(msg.body).toContain("Alice");
    expect(msg.sound).toBe("default");
    expect(msg.channelId).toBe("critical-alerts");

    const data = msg.data as Record<string, unknown>;
    expect(data.inspectionId).toBe(inspectionId);
    expect(data.companyId).toBe(companyId);
    expect(data.screen).toBe("inspection");
  });

  it("batches a single Expo request for multiple opted-in owners", async () => {
    await db.insert(usersTable).values([
      {
        clerkUserId: OWNER_A_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_A,
        pushNotificationsEnabled: true,
      },
      {
        clerkUserId: OWNER_B_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_B,
        pushNotificationsEnabled: true,
      },
    ]);

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: null,
    });

    const calls = expoCalls();
    // Expo batch: one HTTP request, two messages inside it.
    expect(calls).toHaveLength(1);
    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    const tokens = messages.map((m) => m.to);
    expect(tokens).toContain(VALID_TOKEN_A);
    expect(tokens).toContain(VALID_TOKEN_B);
  });

  it("omits the technician name clause when technicianName is null", async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: null,
    });

    const messages = expoCalls()[0].body as Array<Record<string, unknown>>;
    // " by <name>" should be absent when no technician is provided.
    expect(messages[0].body as string).not.toContain(" by ");
  });

  it("truncates addresses longer than 60 characters to keep the notification compact", async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });

    const longAddress = "A".repeat(65) + " Boulevard";
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: longAddress,
      technicianName: null,
    });

    const messages = expoCalls()[0].body as Array<Record<string, unknown>>;
    const body = messages[0].body as string;
    // The raw address is 75 chars — must be truncated and end with ellipsis.
    expect(body).toContain("…");
    // The truncated address portion must be ≤ 60 chars (57 + "…" = 58 chars).
    const addressPortion = body.split(" — ")[0];
    expect(addressPortion.length).toBeLessThanOrEqual(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyCriticalInspection — exclusion rules
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyCriticalInspection — opted-out and tokenless owners are excluded", () => {
  it("skips owners with pushNotificationsEnabled = false", async () => {
    await db.insert(usersTable).values([
      {
        clerkUserId: OWNER_A_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_A,
        pushNotificationsEnabled: false, // opted out
      },
      {
        clerkUserId: OWNER_B_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_B,
        pushNotificationsEnabled: true,
      },
    ]);

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Bob",
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);
    const messages = calls[0].body as Array<Record<string, unknown>>;
    // Only the opted-in owner receives the notification.
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe(VALID_TOKEN_B);
  });

  it("skips owners with no push token on file", async () => {
    await db.insert(usersTable).values([
      {
        clerkUserId: OWNER_A_CLERK,
        role: "owner",
        companyId,
        pushToken: null, // no token registered
        pushNotificationsEnabled: true,
      },
      {
        clerkUserId: OWNER_B_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_B,
        pushNotificationsEnabled: true,
      },
    ]);

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Bob",
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);
    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe(VALID_TOKEN_B);
  });

  it("skips non-ExponentPushToken values even when the token column is populated", async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: "fcm:invalidToken", // wrong format
      pushNotificationsEnabled: true,
    });

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: null,
    });

    // No eligible token — Expo must not be called.
    expect(expoCalls()).toHaveLength(0);
  });

  it("does not call the Expo API at all when all owners are opted out", async () => {
    await db.insert(usersTable).values([
      {
        clerkUserId: OWNER_A_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_A,
        pushNotificationsEnabled: false,
      },
      {
        clerkUserId: OWNER_B_CLERK,
        role: "owner",
        companyId,
        pushToken: VALID_TOKEN_B,
        pushNotificationsEnabled: false,
      },
    ]);

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: null,
    });

    expect(expoCalls()).toHaveLength(0);
  });

  it("does not call the Expo API when the company has no owners (only technicians)", async () => {
    await db.insert(usersTable).values({
      clerkUserId: TECH_CLERK,
      role: "technician",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Carol",
    });

    // Technician tokens must never be targeted — no Expo call.
    expect(expoCalls()).toHaveLength(0);
  });

  it("does not call the Expo API when the company has no users at all", async () => {
    // No users inserted for this company.
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: null,
    });

    expect(expoCalls()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyCriticalInspection — multi-tenant isolation
//
// Two companies (A = the fixture company, B = a second company) each have an
// owner with a valid push token.  A critical inspection belonging to company A
// must ONLY reach company A's owner.  Company B's owner must never receive it,
// and the payload must carry the correct inspectionId / companyId.
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyCriticalInspection — cross-tenant isolation", () => {
  const COMPANY_B_SLUG = "push-notif-test-co-b";
  const OWNER_B2_CLERK = "pn_test_owner_b2";
  const VALID_TOKEN_B2 = "ExponentPushToken[bbbbbbbbbbbbbbbbbbb2]";

  let companyBId: number;
  let inspectionAId: number;

  beforeAll(async () => {
    // Ensure company B exists (idempotent).
    const [existing] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.slug, COMPANY_B_SLUG));
    companyBId = existing
      ? existing.id
      : (
          await db
            .insert(companiesTable)
            .values({ name: "Push Notif Test Co B", slug: COMPANY_B_SLUG })
            .returning()
        )[0].id;
  });

  beforeEach(async () => {
    // Clean up both companies' users and company B's inspections.
    await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyBId));

    // Owner for company A (the triggering company).
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });

    // Owner for company B (the other tenant — must never be notified).
    await db.insert(usersTable).values({
      clerkUserId: OWNER_B2_CLERK,
      role: "owner",
      companyId: companyBId,
      pushToken: VALID_TOKEN_B2,
      pushNotificationsEnabled: true,
    });

    // Inspection owned by company A.
    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: SITE_ADDRESS,
        technicianName: "Alice",
        clientName: "Test Client",
        pestTypes: ["rodents"],
      })
      .returning();
    inspectionAId = insp.id;
  });

  it("sends only to company A's owner token when a company-A inspection fires", async () => {
    await notifyCriticalInspection({
      companyId,
      inspectionId: inspectionAId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);

    const messages = calls[0].body as Array<Record<string, unknown>>;

    // Only one message — company A's owner.
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe(VALID_TOKEN_A);

    // Company B's token must be completely absent from the batch.
    const allTokens = messages.map((m) => m.to);
    expect(allTokens).not.toContain(VALID_TOKEN_B2);
  });

  it("embeds the correct inspectionId and companyId in the push payload", async () => {
    await notifyCriticalInspection({
      companyId,
      inspectionId: inspectionAId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);

    const messages = calls[0].body as Array<Record<string, unknown>>;
    const data = messages[0].data as Record<string, unknown>;

    expect(data.inspectionId).toBe(inspectionAId);
    expect(data.companyId).toBe(companyId);
    // Must NOT carry company B's id in the payload.
    expect(data.companyId).not.toBe(companyBId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/me/push-token — token format validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/me/push-token — token format validation", () => {
  beforeEach(async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
    });
    asUser(OWNER_A_CLERK);
  });

  it("accepts a valid ExponentPushToken and persists it", async () => {
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: VALID_TOKEN_A });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [user] = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushToken).toBe(VALID_TOKEN_A);
  });

  it("rejects a token that does not start with ExponentPushToken[", async () => {
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: "fcm:some-gcm-token" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid push token/i);
  });

  it("rejects an empty string token", async () => {
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid push token/i);
  });

  it("rejects a missing token field", async () => {
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid push token/i);
  });

  it("rejects a numeric token value", async () => {
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid push token/i);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    asUser(null);
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: VALID_TOKEN_A });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runInspectionFinalization — exactly-once critical-push under concurrent retries
//
// The finalization pipeline uses an atomic UPDATE … WHERE critical_alert_sent =
// FALSE (step 5) to guarantee exactly-once Expo delivery even when two calls
// race or when the same inspection is retried after a crash.
//
// The AI / scorecard / opportunity steps are mocked at the top of this file so
// the pre-seeded critical scorecard (criticalAlertSent = false) is never
// overwritten before step 5 runs.  push-notifications itself is the real
// implementation so the Expo fetch call is observable via the global stub.
// ─────────────────────────────────────────────────────────────────────────────

describe("runInspectionFinalization — exactly-once critical-push under concurrent retries", () => {
  const OWNER_CLAIM_CLERK = "pn_test_owner_claim";
  const VALID_TOKEN_CLAIM = "ExponentPushToken[ccccccccccccccccccc]";
  const CLAIM_SITE = "1 Claim Test Lane";

  let claimInspectionId: number;

  beforeEach(async () => {
    // Seed an owner with a valid push token so notifyCriticalInspection has a
    // real target — the Expo HTTP call is only attempted when the claim wins.
    await db.insert(usersTable).values({
      clerkUserId: OWNER_CLAIM_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_CLAIM,
      pushNotificationsEnabled: true,
    });

    // Dedicated inspection for this suite.
    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: CLAIM_SITE,
        technicianName: "Dave",
        clientName: "Claim Client",
        pestTypes: ["rodents"],
      })
      .returning();
    claimInspectionId = insp.id;

    // Pre-seed a critical scorecard with criticalAlertSent = false.
    // runScorecardComputation is mocked as a no-op (see top of file) so this
    // row survives to step 5 unchanged, giving the atomic claim something to
    // race over.
    await db.insert(inspectionScorecardsTable).values({
      companyId,
      inspectionId: claimInspectionId,
      technicianName: "Dave",
      qualityScore: 42,
      riskScore: 90,
      riskLevel: "critical",
      findingsCount: 3,
      photosAnalyzed: 5,
      components: {} as never,
      missedOpportunities: [],
      criticalAlertSent: false,
    });
  });

  it("sends the critical push exactly once when two runInspectionFinalization calls race concurrently", async () => {
    // Both paths are launched together — the atomic claim ensures only one wins.
    await Promise.all([
      runInspectionFinalization({ companyId, inspectionId: claimInspectionId, reportId: null }),
      runInspectionFinalization({ companyId, inspectionId: claimInspectionId, reportId: null }),
    ]);

    // Expo must have been called exactly once across both concurrent calls.
    const calls = expoCalls();
    expect(calls).toHaveLength(1);

    // The single winning call must target the opted-in owner.
    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe(VALID_TOKEN_CLAIM);
  });

  it("persists criticalAlertSent = true in the DB after both concurrent finalization calls settle", async () => {
    await Promise.all([
      runInspectionFinalization({ companyId, inspectionId: claimInspectionId, reportId: null }),
      runInspectionFinalization({ companyId, inspectionId: claimInspectionId, reportId: null }),
    ]);

    const [scorecard] = await db
      .select({ criticalAlertSent: inspectionScorecardsTable.criticalAlertSent })
      .from(inspectionScorecardsTable)
      .where(eq(inspectionScorecardsTable.inspectionId, claimInspectionId));

    expect(scorecard.criticalAlertSent).toBe(true);
  });

  it("does not send any push when criticalAlertSent is already true before finalization runs", async () => {
    // Simulate a prior successful delivery having already claimed the send.
    await db
      .update(inspectionScorecardsTable)
      .set({ criticalAlertSent: true })
      .where(eq(inspectionScorecardsTable.inspectionId, claimInspectionId));

    await runInspectionFinalization({ companyId, inspectionId: claimInspectionId, reportId: null });

    // The idempotency guard must prevent a second delivery — Expo must not be called.
    expect(expoCalls()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /auth/me/push-notifications — toggle notification preference
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /auth/me/push-notifications — toggle preference", () => {
  beforeEach(async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });
    asUser(OWNER_A_CLERK);
  });

  it("sets pushNotificationsEnabled = false in the DB when toggled off", async () => {
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pushNotificationsEnabled).toBe(false);

    const [user] = await db
      .select({ pushNotificationsEnabled: usersTable.pushNotificationsEnabled })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushNotificationsEnabled).toBe(false);
  });

  it("sets pushNotificationsEnabled = true in the DB when re-enabled", async () => {
    // First opt out.
    await db
      .update(usersTable)
      .set({ pushNotificationsEnabled: false })
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));

    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pushNotificationsEnabled).toBe(true);

    const [user] = await db
      .select({ pushNotificationsEnabled: usersTable.pushNotificationsEnabled })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushNotificationsEnabled).toBe(true);
  });

  it("stops future critical-alert pushes immediately after the flag is toggled off, even though the token is still in the DB", async () => {
    // ── Before toggle: owner is opted in ──────────────────────────────────────
    // Confirm the Expo API IS called when pushNotificationsEnabled = true.
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    expect(expoCalls()).toHaveLength(1);
    expect((expoCalls()[0].body as Array<Record<string, unknown>>)[0].to).toBe(VALID_TOKEN_A);

    // Clear the captured calls so the post-toggle assertion starts clean.
    fetchState.calls = [];

    // ── Toggle off via the PATCH route ────────────────────────────────────────
    const toggleRes = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: false });

    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.pushNotificationsEnabled).toBe(false);

    // Verify the token column is still populated (opt-out must not clear it).
    const [user] = await db
      .select({ pushToken: usersTable.pushToken, pushNotificationsEnabled: usersTable.pushNotificationsEnabled })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushToken).toBe(VALID_TOKEN_A); // token intact
    expect(user.pushNotificationsEnabled).toBe(false); // flag flipped

    // ── After toggle: Expo must NOT be called even with a valid token on file ──
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    expect(expoCalls()).toHaveLength(0);
  });

  it("rejects a string value for enabled with 400", async () => {
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: "false" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it("rejects a numeric value for enabled with 400", async () => {
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it("rejects a missing enabled field with 400", async () => {
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    asUser(null);
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: false });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /auth/me/push-token — remove push token (opt out)
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /auth/me/push-token — clear device token", () => {
  beforeEach(async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });
    asUser(OWNER_A_CLERK);
  });

  it("clears the push token to null in the DB", async () => {
    const res = await request(app).delete("/api/auth/me/push-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [user] = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushToken).toBeNull();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    asUser(null);
    const res = await request(app).delete("/api/auth/me/push-token");

    expect(res.status).toBe(401);
  });

  it("sends nothing to the deleted token when a critical inspection fires after opt-out", async () => {
    // Delete the push token via the route.
    await request(app).delete("/api/auth/me/push-token");

    // Verify the token is gone.
    const [user] = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushToken).toBeNull();

    // Now fire a critical push for this company — should reach nobody.
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    // The Expo API must not be called because the only owner has no token.
    expect(expoCalls()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Push-failure banner — end-to-end flow
//
// Task 300 adds a push-failure banner to the owner dashboard that surfaces
// Expo push ticket errors.  These tests verify the full lifecycle:
//   1. A DeviceNotRegistered ticket sets push_last_failed_at in the DB.
//   2. GET /me returns pushLastFailedAt as a non-null ISO string.
//   3. DELETE /me/push-failure clears the flag (/me then returns null).
//   4. POST /me/push-token (re-registration) also clears push_last_failed_at.
// ─────────────────────────────────────────────────────────────────────────────

describe("push-failure banner — DeviceNotRegistered sets push_last_failed_at", () => {
  beforeEach(async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });
    asUser(OWNER_A_CLERK);

    // Expo returns a DeviceNotRegistered error for the owner's token.
    fetchState.responseBody = {
      data: [{ status: "error", message: "InvalidCredentials", details: { error: "DeviceNotRegistered" } }],
    };
  });

  it("sets push_last_failed_at and clears push_token after a DeviceNotRegistered ticket", async () => {
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    // Give the fire-and-forget DB update a moment to settle.
    await new Promise((r) => setTimeout(r, 100));

    const [user] = await db
      .select({ pushToken: usersTable.pushToken, pushLastFailedAt: usersTable.pushLastFailedAt })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));

    // DeviceNotRegistered → token cleared, failure timestamp recorded.
    expect(user.pushToken).toBeNull();
    expect(user.pushLastFailedAt).not.toBeNull();
    expect(user.pushLastFailedAt).toBeInstanceOf(Date);
  });

  it("GET /me returns pushLastFailedAt as a non-null ISO string after a DeviceNotRegistered failure", async () => {
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    await new Promise((r) => setTimeout(r, 100));

    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(typeof res.body.pushLastFailedAt).toBe("string");
    // Must parse as a valid ISO date string.
    expect(Number.isNaN(Date.parse(res.body.pushLastFailedAt as string))).toBe(false);
  });
});

describe("push-failure banner — non-DeviceNotRegistered error sets push_last_failed_at", () => {
  beforeEach(async () => {
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
    });
    asUser(OWNER_A_CLERK);

    // Expo returns a generic (non-DeviceNotRegistered) error ticket.
    fetchState.responseBody = {
      data: [{ status: "error", message: "MessageRateExceeded", details: { error: "MessageRateExceeded" } }],
    };
  });

  it("sets push_last_failed_at but keeps the push_token for non-DeviceNotRegistered errors", async () => {
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE_ADDRESS,
      technicianName: "Alice",
    });

    await new Promise((r) => setTimeout(r, 100));

    const [user] = await db
      .select({ pushToken: usersTable.pushToken, pushLastFailedAt: usersTable.pushLastFailedAt })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));

    // Token should remain (it may still be valid); only the failure flag is set.
    expect(user.pushToken).toBe(VALID_TOKEN_A);
    expect(user.pushLastFailedAt).not.toBeNull();
  });
});

describe("DELETE /me/push-failure — dismiss the push-failure banner", () => {
  beforeEach(async () => {
    // Seed an owner whose push_last_failed_at is already set (simulating a prior failure).
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: VALID_TOKEN_A,
      pushNotificationsEnabled: true,
      pushLastFailedAt: new Date(),
    });
    asUser(OWNER_A_CLERK);
  });

  it("clears push_last_failed_at in the DB", async () => {
    const res = await request(app).delete("/api/auth/me/push-failure");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [user] = await db
      .select({ pushLastFailedAt: usersTable.pushLastFailedAt })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));
    expect(user.pushLastFailedAt).toBeNull();
  });

  it("GET /me returns pushLastFailedAt: null after the dismiss route is called", async () => {
    // Confirm it is set before dismissal.
    const before = await request(app).get("/api/auth/me");
    expect(typeof before.body.pushLastFailedAt).toBe("string");

    // Dismiss.
    await request(app).delete("/api/auth/me/push-failure");

    // Verify /me now reports null.
    const after = await request(app).get("/api/auth/me");
    expect(after.status).toBe(200);
    expect(after.body.pushLastFailedAt).toBeNull();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    asUser(null);
    const res = await request(app).delete("/api/auth/me/push-failure");
    expect(res.status).toBe(401);
  });

  it("is idempotent — a second call when the flag is already null still returns 200", async () => {
    // First call clears the flag.
    await request(app).delete("/api/auth/me/push-failure");
    // Second call on an already-null flag must still succeed.
    const res = await request(app).delete("/api/auth/me/push-failure");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /me/push-token — re-registration clears push_last_failed_at", () => {
  beforeEach(async () => {
    // Seed an owner whose push_last_failed_at is set (prior delivery failure).
    await db.insert(usersTable).values({
      clerkUserId: OWNER_A_CLERK,
      role: "owner",
      companyId,
      pushToken: null,
      pushNotificationsEnabled: true,
      pushLastFailedAt: new Date(),
    });
    asUser(OWNER_A_CLERK);
  });

  it("clears push_last_failed_at when a new push token is registered", async () => {
    const res = await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: VALID_TOKEN_A });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [user] = await db
      .select({ pushToken: usersTable.pushToken, pushLastFailedAt: usersTable.pushLastFailedAt })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_A_CLERK));

    // New token persisted and failure flag cleared.
    expect(user.pushToken).toBe(VALID_TOKEN_A);
    expect(user.pushLastFailedAt).toBeNull();
  });

  it("GET /me returns pushLastFailedAt: null after re-registration", async () => {
    await request(app)
      .post("/api/auth/me/push-token")
      .send({ token: VALID_TOKEN_A });

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.pushLastFailedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyTechnicianRouteUpdated — route-reassignment notification delivery
//
// The schedule PATCH handler calls this function to push a "Route Updated"
// notification to old and new technicians when a route is reassigned. These
// tests verify the real Expo delivery path — not via mocked schedule tests —
// covering:
//   1. Correct payload sent to a technician with a valid push token
//   2. Expo API skipped when the technician has no push token on file
//   3. Expo API skipped when pushNotificationsEnabled = false for the tech
//   4. Only the requested technician Clerk ID is notified (not other techs)
//   5. Non-technician users (managers, owners) are silently excluded even
//      if their Clerk IDs are passed (defense-in-depth role check)
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyTechnicianRouteUpdated — sends to technician with a valid token", () => {
  const TECH_ROUTE_CLERK_A = "pn_route_tech_a";
  const TECH_ROUTE_CLERK_B = "pn_route_tech_b";
  const MANAGER_ROUTE_CLERK = "pn_route_manager";
  const TOKEN_TECH_A = "ExponentPushToken[route_tech_a_token]";
  const TOKEN_TECH_B = "ExponentPushToken[route_tech_b_token]";
  const ROUTE_SITE = "99 Route Test Ave";

  let routeInspectionId: number;

  beforeEach(async () => {
    await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

    // Two technicians and one manager for this suite.
    await db.insert(usersTable).values([
      {
        clerkUserId: TECH_ROUTE_CLERK_A,
        role: "technician",
        companyId,
        pushToken: TOKEN_TECH_A,
        pushNotificationsEnabled: true,
      },
      {
        clerkUserId: TECH_ROUTE_CLERK_B,
        role: "technician",
        companyId,
        pushToken: TOKEN_TECH_B,
        pushNotificationsEnabled: true,
      },
      {
        clerkUserId: MANAGER_ROUTE_CLERK,
        role: "manager",
        companyId,
        pushToken: "ExponentPushToken[manager_token]",
        pushNotificationsEnabled: true,
      },
    ]);

    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: ROUTE_SITE,
        technicianName: "Route Tech A",
        pestTypes: [],
        scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      })
      .returning();
    routeInspectionId = insp.id;
  });

  it("sends a correctly shaped Route Updated payload to the technician's push token", async () => {
    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [TECH_ROUTE_CLERK_A],
      scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      siteAddress: ROUTE_SITE,
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);

    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);

    const msg = messages[0];
    expect(msg.to).toBe(TOKEN_TECH_A);
    expect(typeof msg.title).toBe("string");
    expect((msg.title as string).toLowerCase()).toContain("route");
    expect(msg.body).toContain(ROUTE_SITE);
    expect(msg.sound).toBe("default");
    expect(msg.channelId).toBe("route-updates");

    const data = msg.data as Record<string, unknown>;
    expect(data.inspectionId).toBe(routeInspectionId);
    expect(data.companyId).toBe(companyId);
    expect(data.screen).toBe("inspection");
  });

  it("sends to both old and new technicians when two Clerk IDs are provided", async () => {
    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [TECH_ROUTE_CLERK_A, TECH_ROUTE_CLERK_B],
      scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      siteAddress: ROUTE_SITE,
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1); // single batched Expo request

    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);

    const tokens = messages.map((m) => m.to);
    expect(tokens).toContain(TOKEN_TECH_A);
    expect(tokens).toContain(TOKEN_TECH_B);
  });
});

describe("notifyTechnicianRouteUpdated — skips when technician has no push token", () => {
  const TECH_NO_TOKEN_CLERK = "pn_route_tech_no_token";
  const TECH_WITH_TOKEN_CLERK = "pn_route_tech_with_token";
  const TOKEN_WITH = "ExponentPushToken[route_with_token]";
  const ROUTE_SITE = "88 No Token Lane";

  let routeInspectionId: number;

  beforeEach(async () => {
    await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: ROUTE_SITE,
        technicianName: "No Token Tech",
        pestTypes: [],
      })
      .returning();
    routeInspectionId = insp.id;
  });

  it("does not call the Expo API when the only targeted technician has no push token", async () => {
    await db.insert(usersTable).values({
      clerkUserId: TECH_NO_TOKEN_CLERK,
      role: "technician",
      companyId,
      pushToken: null, // no token registered
      pushNotificationsEnabled: true,
    });

    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [TECH_NO_TOKEN_CLERK],
      scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      siteAddress: ROUTE_SITE,
    });

    // No token → Expo must not be called.
    expect(expoCalls()).toHaveLength(0);
  });

  it("does not call the Expo API when the technician's token is not a valid ExponentPushToken", async () => {
    await db.insert(usersTable).values({
      clerkUserId: TECH_NO_TOKEN_CLERK,
      role: "technician",
      companyId,
      pushToken: "fcm:invalid-format", // wrong format
      pushNotificationsEnabled: true,
    });

    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [TECH_NO_TOKEN_CLERK],
      scheduledDate: null,
      siteAddress: ROUTE_SITE,
    });

    expect(expoCalls()).toHaveLength(0);
  });

  it("notifies only the tech with a token when one has a token and one does not", async () => {
    await db.insert(usersTable).values([
      {
        clerkUserId: TECH_NO_TOKEN_CLERK,
        role: "technician",
        companyId,
        pushToken: null, // no token
        pushNotificationsEnabled: true,
      },
      {
        clerkUserId: TECH_WITH_TOKEN_CLERK,
        role: "technician",
        companyId,
        pushToken: TOKEN_WITH,
        pushNotificationsEnabled: true,
      },
    ]);

    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [TECH_NO_TOKEN_CLERK, TECH_WITH_TOKEN_CLERK],
      scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      siteAddress: ROUTE_SITE,
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);

    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1); // only the tech with a token
    expect(messages[0].to).toBe(TOKEN_WITH);
  });

  it("does not call the Expo API when technicianClerkIds is empty", async () => {
    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [],
      scheduledDate: null,
      siteAddress: ROUTE_SITE,
    });

    expect(expoCalls()).toHaveLength(0);
  });
});

describe("notifyTechnicianRouteUpdated — skips opted-out technicians", () => {
  const TECH_OPTED_OUT_CLERK = "pn_route_tech_opted_out";
  const ROUTE_SITE = "77 Opted Out Street";

  let routeInspectionId: number;

  beforeEach(async () => {
    await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

    await db.insert(usersTable).values({
      clerkUserId: TECH_OPTED_OUT_CLERK,
      role: "technician",
      companyId,
      pushToken: "ExponentPushToken[opted_out_token]",
      pushNotificationsEnabled: false, // opted out
    });

    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: ROUTE_SITE,
        technicianName: "Opted Out Tech",
        pestTypes: [],
      })
      .returning();
    routeInspectionId = insp.id;
  });

  it("does not call the Expo API when the technician has pushNotificationsEnabled = false", async () => {
    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [TECH_OPTED_OUT_CLERK],
      scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      siteAddress: ROUTE_SITE,
    });

    // Opted-out technician must not receive any push — Expo must not be called.
    expect(expoCalls()).toHaveLength(0);
  });
});

describe("notifyTechnicianRouteUpdated — manager/owner Clerk IDs are excluded (role guard)", () => {
  const MANAGER_CLERK = "pn_route_role_guard_manager";
  const OWNER_CLERK = "pn_route_role_guard_owner";
  const ROUTE_SITE = "66 Role Guard Boulevard";

  let routeInspectionId: number;

  beforeEach(async () => {
    await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

    // Seed a manager and an owner, both with valid tokens and notifications on.
    await db.insert(usersTable).values([
      {
        clerkUserId: MANAGER_CLERK,
        role: "manager",
        companyId,
        pushToken: "ExponentPushToken[manager_role_guard]",
        pushNotificationsEnabled: true,
      },
      {
        clerkUserId: OWNER_CLERK,
        role: "owner",
        companyId,
        pushToken: "ExponentPushToken[owner_role_guard]",
        pushNotificationsEnabled: true,
      },
    ]);

    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: ROUTE_SITE,
        technicianName: "Some Tech",
        pestTypes: [],
      })
      .returning();
    routeInspectionId = insp.id;
  });

  it("does not notify a manager whose Clerk ID is passed — role check restricts to technicians only", async () => {
    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [MANAGER_CLERK],
      scheduledDate: new Date("2026-08-25T00:00:00.000Z"),
      siteAddress: ROUTE_SITE,
    });

    // The function filters to role = technician, so the manager is excluded.
    expect(expoCalls()).toHaveLength(0);
  });

  it("does not notify an owner whose Clerk ID is passed — role check restricts to technicians only", async () => {
    await notifyTechnicianRouteUpdated({
      companyId,
      inspectionId: routeInspectionId,
      technicianClerkIds: [OWNER_CLERK],
      scheduledDate: null,
      siteAddress: ROUTE_SITE,
    });

    expect(expoCalls()).toHaveLength(0);
  });
});
