/**
 * Daily briefing scheduler tests.
 *
 * Covers:
 * - runDailyBriefingJob() skips opted-out owners (db filter — no Clerk call)
 * - runDailyBriefingJob() calls sendMail and counts delivered:true as sent
 * - runDailyBriefingJob() counts delivered:false/no_transport separately from sent
 * - runDailyBriefingJob() skips owners when Clerk returns no email
 * - runDailyBriefingJob() never emails non-owner roles
 * - PATCH /me/briefing-email validates input and persists the preference
 * - GET /me includes briefingEmailOptOut in the user object
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// Control sendMail delivery outcome per-test. sendMail is in a different module
// so the vi.mock interception works correctly across module boundaries.
type MailResult = { delivered: boolean; reason?: string };
let sendMailImpl: (opts: unknown) => Promise<MailResult> = async () => ({ delivered: true });
const mockSendMail = vi.fn((opts: unknown) => sendMailImpl(opts));
vi.mock("./mailer", () => ({
  sendMail: (opts: unknown) => mockSendMail(opts),
}));

// Helpers to build a minimal Clerk user response fixture.
function clerkResponse(email: string | null) {
  if (!email) {
    return { primary_email_address_id: null, email_addresses: [] };
  }
  return {
    primary_email_address_id: "ea_1",
    email_addresses: [{ id: "ea_1", email_address: email }],
  };
}

// Stub global fetch so getClerkUserEmail doesn't make real HTTP calls.
// We set this per-test in beforeEach.
let fetchStub: (url: string | URL | Request, opts?: unknown) => Promise<Response>;
vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => fetchStub(...args));

import app from "../app";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runDailyBriefingJob } from "./briefing-scheduler";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_CLERK = "sched_owner_clerk_id";
const OPTOUT_CLERK = "sched_optout_clerk_id";
const MANAGER_CLERK = "sched_manager_clerk_id";

let companyId: number;
let ownerUserId: number;
let optOutUserId: number;

async function findOrCreateCompany(): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, "briefing-sched-test"));
  if (existing) return existing.id;
  const [row] = await db
    .insert(companiesTable)
    .values({ name: "BriefingSched Co", slug: "briefing-sched-test" })
    .returning();
  return row.id;
}

async function upsertUser(params: {
  clerkUserId: string;
  companyId: number;
  role: "owner" | "manager" | "technician";
  briefingEmailOptOut?: boolean;
}): Promise<number> {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, params.clerkUserId));
  if (existing) {
    await db
      .update(usersTable)
      .set({ companyId: params.companyId, role: params.role, briefingEmailOptOut: params.briefingEmailOptOut ?? false })
      .where(eq(usersTable.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(usersTable)
    .values({ clerkUserId: params.clerkUserId, companyId: params.companyId, role: params.role, briefingEmailOptOut: params.briefingEmailOptOut ?? false })
    .returning();
  return row.id;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId = await findOrCreateCompany();
  ownerUserId = await upsertUser({ clerkUserId: OWNER_CLERK, companyId, role: "owner", briefingEmailOptOut: false });
  optOutUserId = await upsertUser({ clerkUserId: OPTOUT_CLERK, companyId, role: "owner", briefingEmailOptOut: true });
  await upsertUser({ clerkUserId: MANAGER_CLERK, companyId, role: "manager", briefingEmailOptOut: false });
});

afterAll(async () => {
  await db
    .delete(usersTable)
    .where(inArray(usersTable.clerkUserId, [OWNER_CLERK, OPTOUT_CLERK, MANAGER_CLERK]));
});

beforeEach(() => {
  mockSendMail.mockClear();
  sendMailImpl = async () => ({ delivered: true });
  // Default fetch stub: Clerk returns a valid email for any user
  fetchStub = async (url) => {
    if (typeof url === "string" && url.includes("clerk.com")) {
      return new Response(JSON.stringify(clerkResponse("owner@example.com")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Passthrough for non-Clerk URLs (e.g. Resend, SMTP) — should not be called in tests
    throw new Error(`Unexpected fetch: ${String(url)}`);
  };
  authState.userId = null;
});

// ── Scheduler job tests ───────────────────────────────────────────────────────

describe("runDailyBriefingJob", () => {
  it("does NOT call sendMail when all owners in a company are opted out", async () => {
    // Opt out ownerUserId so both owners in the test company are opted out
    await db.update(usersTable).set({ briefingEmailOptOut: true }).where(eq(usersTable.id, ownerUserId));

    // Track whether Clerk was called for the opted-out users
    const clerkCalledFor: string[] = [];
    fetchStub = async (url) => {
      const match = /\/users\/(.+)$/.exec(String(url));
      if (match) clerkCalledFor.push(match[1]);
      return new Response(JSON.stringify(clerkResponse("owner@example.com")), { status: 200 });
    };

    await runDailyBriefingJob();

    // The DB filter should have excluded OPTOUT_CLERK entirely — no Clerk call for it
    expect(clerkCalledFor).not.toContain(OPTOUT_CLERK);
    expect(mockSendMail).not.toHaveBeenCalled();

    // Restore
    await db.update(usersTable).set({ briefingEmailOptOut: false }).where(eq(usersTable.id, ownerUserId));
  });

  it("calls sendMail for an opted-in owner and counts delivery as sent", async () => {
    await db.update(usersTable).set({ briefingEmailOptOut: false }).where(eq(usersTable.id, ownerUserId));
    await db.update(usersTable).set({ briefingEmailOptOut: true }).where(eq(usersTable.id, optOutUserId));

    sendMailImpl = async () => ({ delivered: true });

    const result = await runDailyBriefingJob();

    expect(mockSendMail).toHaveBeenCalled();
    // Verify the call included an HTML body and a subject
    const callArgs = mockSendMail.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(callArgs.to).toBe("owner@example.com");
    expect(callArgs.subject).toMatch(/Daily Briefing/);
    expect(callArgs.html).toContain("ReadyLoq");

    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result.noTransport).toBe(0);
  });

  it("increments noTransport (not sent) when transport is unavailable", async () => {
    await db.update(usersTable).set({ briefingEmailOptOut: false }).where(eq(usersTable.id, ownerUserId));

    sendMailImpl = async () => ({ delivered: false, reason: "no_transport" });

    const result = await runDailyBriefingJob();

    expect(result.noTransport).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBe(0);
  });

  it("skips an owner and increments skipped when Clerk returns no email", async () => {
    await db.update(usersTable).set({ briefingEmailOptOut: false }).where(eq(usersTable.id, ownerUserId));

    // All Clerk lookups return null (no email address)
    fetchStub = async () =>
      new Response(JSON.stringify(clerkResponse(null)), { status: 200 });

    const result = await runDailyBriefingJob();

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("never emails manager-role users even when briefingEmailOptOut is false", async () => {
    // Manager is inserted with briefingEmailOptOut=false — they still must not receive email
    // because the scheduler filters by role='owner' in the DB query.
    const calledAddresses: string[] = [];
    sendMailImpl = async (opts) => {
      calledAddresses.push((opts as { to: string }).to);
      return { delivered: true };
    };
    fetchStub = async (url) => {
      const match = /\/users\/(.+)$/.exec(String(url));
      const id = match?.[1] ?? "";
      const email = id === MANAGER_CLERK ? "manager@example.com" : "owner@example.com";
      return new Response(JSON.stringify(clerkResponse(email)), { status: 200 });
    };

    await runDailyBriefingJob();

    expect(calledAddresses).not.toContain("manager@example.com");
  });
});

// ── Opt-out preference endpoint tests ────────────────────────────────────────

describe("PATCH /auth/me/briefing-email", () => {
  it("returns 401 when not authenticated", async () => {
    authState.userId = null;
    const res = await request(app).patch("/api/auth/me/briefing-email").send({ optOut: true });
    expect(res.status).toBe(401);
  });

  it("returns 400 when optOut is not a boolean", async () => {
    authState.userId = OWNER_CLERK;
    const res = await request(app).patch("/api/auth/me/briefing-email").send({ optOut: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it("sets briefingEmailOptOut to true and persists it in the DB", async () => {
    authState.userId = OWNER_CLERK;
    const res = await request(app).patch("/api/auth/me/briefing-email").send({ optOut: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.briefingEmailOptOut).toBe(true);

    const [row] = await db
      .select({ briefingEmailOptOut: usersTable.briefingEmailOptOut })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OWNER_CLERK));
    expect(row?.briefingEmailOptOut).toBe(true);
  });

  it("sets briefingEmailOptOut back to false", async () => {
    authState.userId = OWNER_CLERK;
    const res = await request(app).patch("/api/auth/me/briefing-email").send({ optOut: false });
    expect(res.status).toBe(200);
    expect(res.body.briefingEmailOptOut).toBe(false);
  });
});

describe("GET /auth/me includes briefingEmailOptOut", () => {
  it("returns briefingEmailOptOut as a boolean", async () => {
    authState.userId = OWNER_CLERK;
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(typeof res.body.briefingEmailOptOut).toBe("boolean");
  });
});
