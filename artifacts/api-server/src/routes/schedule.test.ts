/**
 * Integration tests for GET /api/schedule and PATCH /api/schedule/:id.
 *
 * Push-notification scenarios covered:
 *  1. Manager reschedules → assigned technician is notified.
 *  2. Manager reassigns → old tech AND new tech are both notified.
 *  3. Technician calling PATCH → 403 (route is manager-only); no push sent.
 *
 * Authorization and input-validation scenarios covered:
 *  - Unauthenticated → 401 on both GET and PATCH.
 *  - Technician → 403 on PATCH (and on GET via requireRole guard).
 *  - Cross-company inspection → 404.
 *  - No fields in body → 400 ("Nothing to update").
 *  - Invalid scheduledDate format → 400.
 *
 * The Expo push HTTP call is captured via a stubbed global fetch so no real
 * network traffic leaves the process.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Controllable Clerk auth state. vi.hoisted guarantees the object is available
// before the (hoisted) vi.mock factory below references it.
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

import app from "../app";
import { db, usersTable, companiesTable, inspectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const MANAGER_CLERK_ID  = "sched_test_manager_clerk";
const TECH_A_CLERK_ID   = "sched_test_tech_a_clerk";
const TECH_B_CLERK_ID   = "sched_test_tech_b_clerk";
const OTHER_MGR_CLERK_ID = "sched_test_other_mgr_clerk"; // belongs to companyB

const TECH_A_TOKEN = "ExponentPushToken[tech_a_device_token]";
const TECH_B_TOKEN = "ExponentPushToken[tech_b_device_token]";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

let companyId: number;
let companyBId: number;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Seed an inspection for companyId with an optional technician assignment. */
async function seedInspection(opts: {
  companyId?: number;
  technicianName: string;
  technicianId?: string | null;
  scheduledDate?: Date | null;
}) {
  const cId = opts.companyId ?? companyId;
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId: cId,
      siteAddress: "123 Test Street, Springfield",
      technicianName: opts.technicianName,
      technicianId: opts.technicianId ?? null,
      scheduledDate: opts.scheduledDate ?? null,
      status: "pending",
      findingsCount: 0,
      pestTypes: [],
    })
    .returning();
  return row;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId  = await findOrCreateCompany("Schedule Push Test Co",  "sched-push-test-co");
  companyBId = await findOrCreateCompany("Schedule Push Test Co B", "sched-push-test-co-b");

  // Remove any leftover users from a previous run.
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));

  await db.insert(usersTable).values([
    {
      clerkUserId: MANAGER_CLERK_ID,
      role: "manager",
      companyId,
      pushNotificationsEnabled: true,
    },
    {
      clerkUserId: TECH_A_CLERK_ID,
      role: "technician",
      companyId,
      pushToken: TECH_A_TOKEN,
      pushNotificationsEnabled: true,
    },
    {
      clerkUserId: TECH_B_CLERK_ID,
      role: "technician",
      companyId,
      pushToken: TECH_B_TOKEN,
      pushNotificationsEnabled: true,
    },
    {
      clerkUserId: OTHER_MGR_CLERK_ID,
      role: "manager",
      companyId: companyBId,
      pushNotificationsEnabled: true,
    },
  ]);
});

afterAll(async () => {
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyBId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyBId));
});

beforeEach(() => {
  asUser(null);
  vi.restoreAllMocks();
});

// ── Fetch-capture utility ─────────────────────────────────────────────────────

/**
 * Replace global fetch with a spy that records every body sent to the Expo
 * push endpoint and returns a successful 200 response. All other fetch calls
 * are forwarded to the real implementation.
 *
 * Returns a getter that retrieves the list of captured message arrays
 * (one per batch call to the Expo endpoint).
 */
function interceptExpoPush(): () => { to: string; body: string }[][] {
  const captured: { to: string; body: string }[][] = [];
  const realFetch = globalThis.fetch.bind(globalThis);

  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr === EXPO_PUSH_URL) {
      const payload = JSON.parse((init?.body as string) ?? "[]") as {
        to: string;
        body: string;
      }[];
      captured.push(payload);
      return new Response(
        JSON.stringify({
          data: payload.map(() => ({ status: "ok", id: "test-ticket-id" })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(url as string, init);
  });

  return () => captured;
}

// ── Authorization and input-validation tests ──────────────────────────────────

describe("Authorization — GET /api/schedule", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (manager-only route)", async () => {
    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );
    expect(res.status).toBe(403);
  });
});

describe("Authorization — PATCH /api/schedule/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const insp = await seedInspection({ technicianName: "Tech A" });
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });
    expect(res.status).toBe(401);
  });

  /**
   * Scenario 3 (self-update): the route is guarded by requireRole("manager"),
   * so a technician can never submit a route update for their own inspection.
   * The 403 response means the notification path is never reached.
   */
  it("returns 403 when called by a technician — no push notification is ever sent", async () => {
    const getCaptures = interceptExpoPush();

    const insp = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-17T08:00:00.000Z"),
    });

    // Tech A tries to reschedule their own inspection.
    asUser(TECH_A_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });

    expect(res.status).toBe(403);

    // Allow time for any unexpected async push to fire.
    await new Promise((r) => setTimeout(r, 50));

    // Route-level guard blocks the request before the handler runs,
    // so the Expo push endpoint must never be called.
    expect(getCaptures().length).toBe(0);
  });

  it("returns 404 when a manager patches an inspection belonging to another company", async () => {
    // Seed an inspection under companyB.
    const insp = await seedInspection({
      companyId: companyBId,
      technicianName: "Other Tech",
    });

    // Manager from companyA tries to patch it.
    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when the request body contains no updatable fields", async () => {
    const insp = await seedInspection({ technicianName: "Tech A" });
    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Nothing to update/i);
  });

  it("returns 400 when scheduledDate is not a valid ISO datetime", async () => {
    const insp = await seedInspection({ technicianName: "Tech A" });
    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "not-a-date" });
    expect(res.status).toBe(400);
  });
});

// ── Push notification scenarios ───────────────────────────────────────────────

describe("PATCH /api/schedule/:id — push notification behaviour", () => {
  it("Scenario 1: manager reschedules → assigned technician receives a push notification", async () => {
    const getCaptures = interceptExpoPush();

    const insp = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-17T08:00:00.000Z"),
    });

    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(res.body.scheduledDate).toContain("2026-08-20");

    // Allow the fire-and-forget push to complete.
    await new Promise((r) => setTimeout(r, 50));

    const batches = getCaptures();
    expect(batches.length).toBe(1);

    const messages = batches[0];
    expect(messages.length).toBe(1);
    expect(messages[0].to).toBe(TECH_A_TOKEN);
    // Body should mention the updated date and site address.
    expect(messages[0].body).toMatch(/Thu,? Aug 20/);
    expect(messages[0].body).toMatch(/123 Test Street/);
    expect(messages[0].body).toContain("updated by your manager");
  });

  it("Scenario 2: manager reassigns → old tech AND new tech both receive push notifications", async () => {
    const getCaptures = interceptExpoPush();

    // Seed a prior inspection for Tech B so resolveTechnicianClerkId can find them.
    const [priorB] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: "Prior Inspection for Tech B",
        technicianName: "Tech B",
        technicianId: TECH_B_CLERK_ID,
        status: "completed",
        findingsCount: 0,
        pestTypes: [],
      })
      .returning();

    const insp = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-17T08:00:00.000Z"),
    });

    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ technicianName: "Tech B" });

    expect(res.status).toBe(200);
    expect(res.body.technicianName).toBe("Tech B");

    // Allow the fire-and-forget push to complete.
    await new Promise((r) => setTimeout(r, 50));

    const batches = getCaptures();
    expect(batches.length).toBe(1);

    const sentTokens = batches[0].map((m) => m.to);
    // Both old and new technician should be notified.
    expect(sentTokens).toContain(TECH_A_TOKEN);
    expect(sentTokens).toContain(TECH_B_TOKEN);
    // Exactly two notifications — no duplicates.
    expect(sentTokens.length).toBe(2);

    // Cleanup the prior B inspection.
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, priorB.id));
  });
});
