/**
 * Integration tests for PATCH /api/schedule/:id — push notification behaviour.
 *
 * Scenarios covered:
 *  1. Manager reschedules (date changes) → technician is notified
 *  2. Manager reassigns (name change, ID resolvable) → old + new tech both notified
 *  3. Technician name changes but resolves to the same Clerk ID → no notification
 *  4. No meaningful change (same date re-submitted) → no notification
 *  5. Technician tries to PATCH → 403 (route is manager-only, so no notification)
 *  6. Cross-company PATCH → 404, no notification
 *  7. Manager explicitly supplies technicianId in the payload → notified
 */

import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Clerk auth mock ───────────────────────────────────────────────────────────

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

// ── Push notification mock ────────────────────────────────────────────────────

vi.mock("../lib/push-notifications", () => ({
  notifyTechnicianRouteUpdated: vi.fn(async () => undefined),
  notifyCriticalInspection: vi.fn(async () => undefined),
}));

// ── Imports (after mocks are registered) ─────────────────────────────────────

import app from "../app";
import { db, usersTable, companiesTable, inspectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as pushLib from "../lib/push-notifications";

// ── Test constants ────────────────────────────────────────────────────────────

const MANAGER_ID = "sched_test_manager_clerk";
const TECH_A_ID  = "sched_test_tech_a_clerk";
const TECH_B_ID  = "sched_test_tech_b_clerk";

function asUser(id: string | null) {
  authState.userId = id;
}

// Typed reference to the mocked function so we can use .mock.calls.
const mockNotify = () =>
  vi.mocked(pushLib.notifyTechnicianRouteUpdated);

// ── DB setup ──────────────────────────────────────────────────────────────────

let companyId: number;
let otherCompanyId: number;

beforeAll(async () => {
  async function findOrCreate(name: string, slug: string) {
    const [ex] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
    if (ex) return ex.id;
    const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
    return row.id;
  }

  companyId = await findOrCreate("Schedule Test Co", "schedule-test-co");
  otherCompanyId = await findOrCreate("Schedule Other Co", "schedule-other-co");

  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, otherCompanyId));

  await db.insert(usersTable).values([
    {
      clerkUserId: MANAGER_ID,
      role: "manager",
      companyId,
      pushNotificationsEnabled: true,
      pushToken: null,
    },
    {
      clerkUserId: TECH_A_ID,
      role: "technician",
      companyId,
      pushNotificationsEnabled: true,
      pushToken: "ExponentPushToken[tech_a_token]",
    },
    {
      clerkUserId: TECH_B_ID,
      role: "technician",
      companyId,
      pushNotificationsEnabled: true,
      pushToken: "ExponentPushToken[tech_b_token]",
    },
  ]);
});

beforeEach(async () => {
  asUser(null);
  mockNotify().mockClear();
  // Delete all inspections so resolution queries start from a clean slate.
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, otherCompanyId));
});

afterAll(() => {
  asUser(null);
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function createInspection(opts: {
  technicianName: string;
  technicianId: string | null;
  scheduledDate?: string;
  cid?: number; // override company
}): Promise<number> {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId: opts.cid ?? companyId,
      siteAddress: "123 Test St, Anytown, CA",
      technicianName: opts.technicianName,
      technicianId: opts.technicianId,
      status: "pending",
      scheduledDate: opts.scheduledDate ? new Date(opts.scheduledDate) : null,
    })
    .returning({ id: inspectionsTable.id });
  return row.id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/schedule/:id — push notifications", () => {
  it("notifies the technician when a manager reschedules (date changes)", async () => {
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ scheduledDate: "2026-08-21T00:00:00.000Z" });

    expect(res.status).toBe(200);

    expect(mockNotify()).toHaveBeenCalledOnce();
    const [callArg] = mockNotify().mock.calls[0];
    expect(callArg.technicianClerkIds).toContain(TECH_A_ID);
    expect(callArg.technicianClerkIds).not.toContain(MANAGER_ID);
  });

  it("notifies old and new tech when a manager reassigns by name (technicianId resolved)", async () => {
    // Seed an existing inspection for Tech B so the server can resolve TECH_B_ID
    // from the name "Tech B".
    await createInspection({ technicianName: "Tech B", technicianId: TECH_B_ID });

    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Portal sends only technicianName — no technicianId.
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech B" });

    expect(res.status).toBe(200);

    expect(mockNotify()).toHaveBeenCalledOnce();
    const [callArg] = mockNotify().mock.calls[0];
    expect(callArg.technicianClerkIds).toContain(TECH_A_ID); // old tech
    expect(callArg.technicianClerkIds).toContain(TECH_B_ID); // new tech
    expect(callArg.technicianClerkIds).not.toContain(MANAGER_ID);
  });

  it("sends no notification when the name resolves to the same Clerk ID (display-name fix)", async () => {
    // "Tech-A" and "Tech A" both map to TECH_A_ID — no real reassignment.
    await createInspection({ technicianName: "Tech A", technicianId: TECH_A_ID });

    const inspId = await createInspection({
      technicianName: "Tech-A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech A" }); // resolves to TECH_A_ID (same as prev)

    expect(res.status).toBe(200);
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("sends no notification when nothing meaningful changed (same date re-submitted)", async () => {
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ scheduledDate: "2026-08-20T00:00:00.000Z" }); // same date, no real change

    expect(res.status).toBe(200);
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("blocks technicians from patching the schedule (route is manager-only)", async () => {
    // requireRole("manager") prevents technicians from reaching the handler,
    // so a self-reassignment is impossible through this endpoint.
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(TECH_A_ID);
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ scheduledDate: "2026-08-22T00:00:00.000Z" });

    expect(res.status).toBe(403);
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("returns 404 and sends no notification for an inspection from another company", async () => {
    const foreignId = await createInspection({
      technicianName: "Other Tech",
      technicianId: "other_tech_clerk_id",
      cid: otherCompanyId,
    });

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/schedule/${foreignId}`)
      .send({ scheduledDate: "2026-08-22T00:00:00.000Z" });

    expect(res.status).toBe(404);
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("notifies when technicianId is explicitly supplied in the payload", async () => {
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech B", technicianId: TECH_B_ID });

    expect(res.status).toBe(200);

    expect(mockNotify()).toHaveBeenCalledOnce();
    const [callArg] = mockNotify().mock.calls[0];
    expect(callArg.technicianClerkIds).toContain(TECH_A_ID);
    expect(callArg.technicianClerkIds).toContain(TECH_B_ID);
  });

  it("persists the resolved technicianId and notifies only the new tech on a follow-up reschedule", async () => {
    // Seed so resolution can find Tech B's Clerk ID.
    await createInspection({ technicianName: "Tech B", technicianId: TECH_B_ID });

    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Step 1: name-only reassignment from A → B.
    const r1 = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech B" });
    expect(r1.status).toBe(200);

    // Verify the resolved ID was persisted.
    const [after1] = await db
      .select({ technicianId: inspectionsTable.technicianId })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspId));
    expect(after1.technicianId).toBe(TECH_B_ID);

    mockNotify().mockClear();

    // Step 2: manager reschedules the same inspection (now owned by Tech B).
    const r2 = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ scheduledDate: "2026-08-21T00:00:00.000Z" });
    expect(r2.status).toBe(200);

    expect(mockNotify()).toHaveBeenCalledOnce();
    const [callArg] = mockNotify().mock.calls[0];
    expect(callArg.technicianClerkIds).toContain(TECH_B_ID);   // new owner notified
    expect(callArg.technicianClerkIds).not.toContain(TECH_A_ID); // former tech NOT notified
  });

  it("notifies new tech when portal sends explicit technicianId (portal-created inspection, no historical record)", async () => {
    // Simulates a portal-created inspection where technicianId was never set
    // because no mobile-app history exists for this technician yet.
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: null,          // ← portal-created: no ID stored
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Portal resolves Tech B's Clerk ID from the schedule entries map and sends it.
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech B", technicianId: TECH_B_ID });

    expect(res.status).toBe(200);
    expect(res.body.technicianId).toBe(TECH_B_ID); // ID persisted in response

    expect(mockNotify()).toHaveBeenCalledOnce();
    const [callArg] = mockNotify().mock.calls[0];
    expect(callArg.technicianClerkIds).toContain(TECH_B_ID);   // new tech notified
    expect(callArg.technicianClerkIds).not.toContain(TECH_A_ID); // old row had null ID → not in set
  });

  it("notifies only the old tech when the new tech is completely unknown (pure name-only, no history)", async () => {
    // Old tech (A) had a known ID; new tech has no history in the system and
    // the portal sends no ID. We still notify A that their route changed.
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });
    // No seed row for "Newbie Tech" — resolution will return null.

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Newbie Tech" }); // name-only, no history

    expect(res.status).toBe(200);
    // The stored technicianId must be cleared to null so that future reschedules
    // do not falsely notify the former technician (Tech A).
    const [after] = await db
      .select({ technicianId: inspectionsTable.technicianId })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspId));
    expect(after.technicianId).toBeNull(); // cleared, not the old ID

    // Old tech should still be notified (their route was taken away).
    expect(mockNotify()).toHaveBeenCalledOnce();
    const [callArg] = mockNotify().mock.calls[0];
    expect(callArg.technicianClerkIds).toContain(TECH_A_ID);
    expect(callArg.technicianClerkIds).not.toContain(MANAGER_ID);
  });

  it("does not send a second notification to the old tech after reassigning to an unresolvable name (regression)", async () => {
    // Regression: after Tech A is reassigned to "Newbie Tech" (unresolvable),
    // a follow-up date reschedule should NOT notify Tech A again — their route
    // is gone and the cleared technicianId must not re-surface them.
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Step 1: reassign to unknown tech — Tech A is notified, technicianId cleared.
    const r1 = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Newbie Tech" });
    expect(r1.status).toBe(200);

    mockNotify().mockClear();

    // Step 2: reschedule the same inspection (now unowned — technicianId = null).
    const r2 = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ scheduledDate: "2026-08-21T00:00:00.000Z" });
    expect(r2.status).toBe(200);

    // Tech A must NOT receive a second notification.
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("clears technicianId and prevents false future notification when name changes with an invalid explicit ID", async () => {
    // Regression: if a manager sends a changed technicianName alongside an invalid
    // technicianId (e.g., a stale or wrong-role Clerk ID), the handler must clear
    // the stored technicianId rather than retaining the former tech's ID, which
    // would cause a false notification on the next date-only reschedule.
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Step 1: rename to "Tech B" but supply MANAGER_ID as technicianId (invalid role).
    const r1 = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech B", technicianId: MANAGER_ID });
    expect(r1.status).toBe(200);

    // The invalid ID must NOT be stored; the field should be cleared.
    const [after1] = await db
      .select({ technicianId: inspectionsTable.technicianId })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspId));
    expect(after1.technicianId).toBeNull(); // cleared, not TECH_A_ID and not MANAGER_ID

    mockNotify().mockClear();

    // Step 2: date-only reschedule on the now-unowned inspection.
    const r2 = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ scheduledDate: "2026-08-21T00:00:00.000Z" });
    expect(r2.status).toBe(200);

    // Tech A must NOT receive a false notification — they no longer own this route.
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("rejects a manager Clerk ID supplied as technicianId — not persisted, no notification", async () => {
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Attempt to assign the manager's own Clerk ID as the technician.
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech A", technicianId: MANAGER_ID });

    // Request succeeds (not a validation error at HTTP level), but the invalid ID
    // is silently rejected.
    expect(res.status).toBe(200);
    // The stored technicianId must NOT be updated to the manager's Clerk ID.
    const [after] = await db
      .select({ technicianId: inspectionsTable.technicianId })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspId));
    expect(after.technicianId).toBe(TECH_A_ID); // unchanged

    // No notification should have been sent.
    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("rejects a cross-company technicianId — not persisted, no notification", async () => {
    const inspId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
    });

    asUser(MANAGER_ID);
    // Attempt to assign a Clerk ID that belongs to a different company's technician.
    const res = await request(app)
      .patch(`/api/schedule/${inspId}`)
      .send({ technicianName: "Tech A", technicianId: "cross_company_tech_id" });

    expect(res.status).toBe(200);
    const [after] = await db
      .select({ technicianId: inspectionsTable.technicianId })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspId));
    expect(after.technicianId).toBe(TECH_A_ID); // unchanged

    expect(mockNotify()).not.toHaveBeenCalled();
  });

  it("cannot update another company's inspection (tenant isolation)", async () => {
    const foreignId = await createInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_ID,
      scheduledDate: "2026-08-20T00:00:00.000Z",
      cid: otherCompanyId,
    });

    asUser(MANAGER_ID); // MANAGER_ID belongs to companyId, NOT otherCompanyId
    const res = await request(app)
      .patch(`/api/schedule/${foreignId}`)
      .send({ scheduledDate: "2026-08-25T00:00:00.000Z" });

    expect(res.status).toBe(404);

    // Confirm the DB row was NOT modified.
    const [unchanged] = await db
      .select({ scheduledDate: inspectionsTable.scheduledDate })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, foreignId));
    expect(unchanged.scheduledDate?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });
});

// ── GET /api/schedule date-filter tests ───────────────────────────────────────

describe("GET /api/schedule — DB-level date filter", () => {
  it("returns only inspections within the date window (scheduledDate)", async () => {
    // One inspection inside the window, one outside.
    await createInspection({ technicianName: "Tech A", technicianId: TECH_A_ID, scheduledDate: "2026-09-10T00:00:00.000Z" });
    await createInspection({ technicianName: "Tech A", technicianId: TECH_A_ID, scheduledDate: "2026-09-20T00:00:00.000Z" });

    asUser(MANAGER_ID);
    const res = await request(app).get("/api/schedule?start=2026-09-10&end=2026-09-10");

    expect(res.status).toBe(200);
    const dates: string[] = res.body.map((e: { calendarDate: string }) => e.calendarDate);
    expect(dates.every((d) => d === "2026-09-10")).toBe(true);
    expect(dates).toHaveLength(1);
  });

  it("returns inspections using createdAt as fallback when scheduledDate is null", async () => {
    // Insert a row without scheduledDate — the DB query must fall back to createdAt.
    // We can't control the exact createdAt timestamp, so we query a wide window.
    const id = await createInspection({ technicianName: "Tech A", technicianId: TECH_A_ID });

    // Fetch the actual createdAt from the DB so we can build a precise window.
    const [row] = await db
      .select({ createdAt: inspectionsTable.createdAt })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, id));
    const dateStr = row.createdAt.toISOString().slice(0, 10);

    asUser(MANAGER_ID);
    const res = await request(app).get(`/api/schedule?start=${dateStr}&end=${dateStr}`);

    expect(res.status).toBe(200);
    // The inspection without a scheduledDate must appear in the result.
    const ids: number[] = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(id);
  });

  it("excludes inspections outside the requested window entirely", async () => {
    // Insert one inspection far in the past (scheduledDate in 2020).
    await createInspection({ technicianName: "Tech A", technicianId: TECH_A_ID, scheduledDate: "2020-01-01T00:00:00.000Z" });

    asUser(MANAGER_ID);
    // Query only the current week — 2020 row must NOT appear.
    const res = await request(app).get("/api/schedule?start=2026-09-01&end=2026-09-07");

    expect(res.status).toBe(200);
    const dates: string[] = res.body.map((e: { calendarDate: string }) => e.calendarDate);
    expect(dates.some((d) => d.startsWith("2020"))).toBe(false);
  });

  it("never returns inspections from another company (tenant isolation)", async () => {
    const otherId = await createInspection({
      technicianName: "Other Tech",
      technicianId: null,
      scheduledDate: "2026-09-15T00:00:00.000Z",
      cid: otherCompanyId,
    });

    asUser(MANAGER_ID);
    const res = await request(app).get("/api/schedule?start=2026-09-01&end=2026-09-30");

    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((e: { id: number }) => e.id);
    expect(ids).not.toContain(otherId);
  });

  it("returns 400 when start or end params are missing", async () => {
    asUser(MANAGER_ID);
    const r1 = await request(app).get("/api/schedule?start=2026-09-01");
    expect(r1.status).toBe(400);

    const r2 = await request(app).get("/api/schedule?end=2026-09-07");
    expect(r2.status).toBe(400);
  });
});

// ── POST /api/inspections → GET /api/schedule: immediate availability ─────────
//
// These tests confirm the end-to-end "book from calendar → card appears
// immediately" behaviour: once the server responds 201 to the create request,
// a subsequent GET /schedule for the same week must include the new entry in
// the correct calendarDate cell — no server restart or cache warm-up required.
//
// This mirrors what the portal does: `useCreateInspection.onSuccess` calls
// `queryClient.invalidateQueries({ queryKey: ['schedule'] })`, which triggers
// a refetch of the active `['schedule', start, end]` query. The test verifies
// the server side of that round-trip is immediately consistent.

describe("POST /api/inspections → GET /api/schedule — immediate availability", () => {
  it("new inspection appears in the schedule grid cell immediately after creation", async () => {
    asUser(MANAGER_ID);

    const scheduledDate = "2026-10-15T00:00:00.000Z"; // Wednesday; well within the query window
    const start = "2026-10-13";
    const end   = "2026-10-19";

    // Create the inspection (mirrors the portal's useCreateInspection mutation).
    const createRes = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "42 Calendar Lane, Anytown, CA",
        clientName: "Instant Show Corp",
        technicianName: "Tech A",
        technicianId: TECH_A_ID,
        scheduledDate,
      });

    expect(createRes.status).toBe(201);
    const newId: number = createRes.body.id;

    // Immediately query the schedule — no delay, no server restart.
    const schedRes = await request(app)
      .get(`/api/schedule?start=${start}&end=${end}`);

    expect(schedRes.status).toBe(200);
    const ids: number[] = schedRes.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(newId);

    // Confirm the entry lands in the correct calendar cell.
    const entry = schedRes.body.find((e: { id: number }) => e.id === newId);
    expect(entry).toBeDefined();
    expect(entry.calendarDate).toBe("2026-10-15");
    expect(entry.siteAddress).toBe("42 Calendar Lane, Anytown, CA");
    expect(entry.technicianName).toBe("Tech A");
    expect(entry.status).toBe("pending");
  });

  it("new inspection does NOT appear in a different week's schedule", async () => {
    asUser(MANAGER_ID);

    const scheduledDate = "2026-11-05T00:00:00.000Z"; // Wednesday of week 1
    const differentWeekStart = "2026-11-09"; // Following Monday
    const differentWeekEnd   = "2026-11-15"; // Following Sunday

    const createRes = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "99 Wrong Week Rd",
        technicianName: "Tech A",
        technicianId: TECH_A_ID,
        scheduledDate,
      });

    expect(createRes.status).toBe(201);
    const newId: number = createRes.body.id;

    // Schedule query for a different (later) week must NOT include this entry.
    const schedRes = await request(app)
      .get(`/api/schedule?start=${differentWeekStart}&end=${differentWeekEnd}`);

    expect(schedRes.status).toBe(200);
    const ids: number[] = schedRes.body.map((e: { id: number }) => e.id);
    expect(ids).not.toContain(newId);
  });

  it("new inspection without a scheduledDate appears on the day it was created", async () => {
    asUser(MANAGER_ID);

    // No scheduledDate — server falls back to createdAt for the calendar date.
    const createRes = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "1 Now St, Anytown, CA",
        technicianName: "Tech A",
        technicianId: TECH_A_ID,
        // scheduledDate omitted intentionally
      });

    expect(createRes.status).toBe(201);
    const newId: number = createRes.body.id;

    // Derive the expected calendar date from the returned createdAt.
    const createdAt: string = createRes.body.createdAt;
    const expectedDate = createdAt.slice(0, 10); // YYYY-MM-DD in UTC

    // Schedule query centred on today must include the new entry.
    const schedRes = await request(app)
      .get(`/api/schedule?start=${expectedDate}&end=${expectedDate}`);

    expect(schedRes.status).toBe(200);
    const ids: number[] = schedRes.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(newId);

    // calendarDate must equal the UTC date of createdAt.
    const entry = schedRes.body.find((e: { id: number }) => e.id === newId);
    expect(entry?.calendarDate).toBe(expectedDate);
  });
});
