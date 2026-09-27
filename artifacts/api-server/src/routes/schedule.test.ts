/**
 * Integration tests for GET /api/schedule, GET /api/schedule/property-profile,
 * and PATCH /api/schedule/:id.
 *
 * Authorization model (updated):
 *   GET  /api/schedule
 *     - Unauthenticated → 401
 *     - Technician      → 200, results scoped to their own technicianId
 *     - Manager / owner → 200, full team visible
 *
 *   GET  /api/schedule/property-profile
 *     - Unauthenticated                        → 401
 *     - Technician at assigned address          → 200
 *     - Technician at unassigned address        → 403
 *     - Manager at any address                  → 200
 *
 *   PATCH /api/schedule/:id  (manager-only)
 *     - Unauthenticated   → 401
 *     - Technician        → 403 (no push sent)
 *     - Cross-company     → 404
 *     - Empty body        → 400 "Nothing to update"
 *     - Bad date format   → 400
 *
 * Push-notification scenarios (PATCH):
 *   1. Manager reschedules → assigned technician notified.
 *   2. Manager reassigns  → old tech AND new tech notified.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Controllable Clerk auth state. vi.hoisted guarantees the object is available
// before the (hoisted) vi.mock factory below references it.
const { authState, pestPacHistoryMock } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  pestPacHistoryMock: vi.fn(),
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("../services/integration/pestpac-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/integration/pestpac-sync")>();
  return {
    ...actual,
    getPestPacStopHistory: pestPacHistoryMock,
  };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  treatmentLogsTable,
  productsTable,
  productLabelRulesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Constants ──────────────────────────────────────────────────────────────────

const MANAGER_CLERK_ID   = "sched_test_manager_clerk";
const TECH_A_CLERK_ID    = "sched_test_tech_a_clerk";
const TECH_B_CLERK_ID    = "sched_test_tech_b_clerk";
const SALES_CLERK_ID     = "sched_test_sales_clerk";
const OTHER_MGR_CLERK_ID = "sched_test_other_mgr_clerk"; // belongs to companyB

const TECH_A_TOKEN = "ExponentPushToken[tech_a_device_token]";
const TECH_B_TOKEN = "ExponentPushToken[tech_b_device_token]";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const ADDRESS_ASSIGNED   = "456 Assigned Ave, Shelbyville";
const ADDRESS_UNASSIGNED = "789 Other Blvd, Capital City";

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
  siteAddress?: string;
  technicianName: string;
  technicianId?: string | null;
  scheduledDate?: Date | null;
  completedAt?: Date | null;
  status?: string;
  unitNumber?: string | null;
}) {
  const cId = opts.companyId ?? companyId;
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId: cId,
      siteAddress: opts.siteAddress ?? "123 Test Street, Springfield",
      technicianName: opts.technicianName,
      technicianId: opts.technicianId ?? null,
      scheduledDate: opts.scheduledDate ?? null,
      unitNumber: opts.unitNumber ?? null,
      status: opts.status ?? "pending",
      completedAt: opts.completedAt ?? null,
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
      clerkUserId: SALES_CLERK_ID,
      role: "sales",
      companyId,
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
  pestPacHistoryMock.mockReset();
  pestPacHistoryMock.mockResolvedValue({ status: "disabled", notes: [] });
});

// ── Fetch-capture utility ─────────────────────────────────────────────────────

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

// ── GET /api/schedule — Authorization ─────────────────────────────────────────

describe("Authorization — GET /api/schedule", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 for a technician — results scoped to their own assignments", async () => {
    // Seed one stop assigned to Tech A and one to Tech B.
    const techAStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-18T09:00:00.000Z"),
    });
    const techBStop = await seedInspection({
      technicianName: "Tech B",
      technicianId: TECH_B_CLERK_ID,
      scheduledDate: new Date("2026-08-18T10:00:00.000Z"),
    });

    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );

    expect(res.status).toBe(200);
    const ids = (res.body as { id: number }[]).map((e) => e.id);
    // Tech A's own stop is visible.
    expect(ids).toContain(techAStop.id);
    // Tech B's stop must NOT leak.
    expect(ids).not.toContain(techBStop.id);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, techAStop.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, techBStop.id));
  });

  it("returns 200 for a manager — full team schedule visible", async () => {
    const stopA = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-19T08:00:00.000Z"),
    });
    const stopB = await seedInspection({
      technicianName: "Tech B",
      technicianId: TECH_B_CLERK_ID,
      scheduledDate: new Date("2026-08-19T09:00:00.000Z"),
    });

    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );

    expect(res.status).toBe(200);
    const ids = (res.body as { id: number }[]).map((e) => e.id);
    expect(ids).toContain(stopA.id);
    expect(ids).toContain(stopB.id);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stopA.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stopB.id));
  });

  it("includes the booked unit number for a technician's scheduled stop", async () => {
    const unitStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-20T09:00:00.000Z"),
      unitNumber: "4B",
    });

    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );

    expect(res.status).toBe(200);
    const entry = (res.body as { id: number; unitNumber: string | null }[]).find(
      (item) => item.id === unitStop.id,
    );
    expect(entry?.unitNumber).toBe("4B");

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, unitStop.id));
  });

  it("returns 400 when start or end param is missing", async () => {
    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get("/api/schedule?start=2026-08-01");
    expect(res.status).toBe(400);
  });

  it("returns 200 for a sales rep — full team schedule visible (not scoped to a technicianId they'll never have)", async () => {
    const stopA = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-21T08:00:00.000Z"),
    });
    const stopB = await seedInspection({
      technicianName: "Tech B",
      technicianId: TECH_B_CLERK_ID,
      scheduledDate: new Date("2026-08-21T09:00:00.000Z"),
    });

    asUser(SALES_CLERK_ID);
    const res = await request(app).get(
      "/api/schedule?start=2026-08-01&end=2026-08-31",
    );

    expect(res.status).toBe(200);
    const ids = (res.body as { id: number }[]).map((e) => e.id);
    expect(ids).toContain(stopA.id);
    expect(ids).toContain(stopB.id);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stopA.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stopB.id));
  });
});

// ── GET /api/schedule/property-profile — Authorization ───────────────────────

describe("Authorization — GET /api/schedule/property-profile", () => {
  let assignedStop: Awaited<ReturnType<typeof seedInspection>>;

  beforeAll(async () => {
    // Seed one inspection at the "assigned" address belonging to Tech A.
    assignedStop = await seedInspection({
      siteAddress: ADDRESS_ASSIGNED,
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-10T08:00:00.000Z"),
    });
  });

  afterAll(async () => {
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, assignedStop.id));
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(
      `/api/schedule/property-profile?address=${encodeURIComponent(ADDRESS_ASSIGNED)}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 for a technician at an address they are assigned to", async () => {
    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(
      `/api/schedule/property-profile?address=${encodeURIComponent(ADDRESS_ASSIGNED)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("address", ADDRESS_ASSIGNED);
    expect(Array.isArray(res.body.recentInspections)).toBe(true);
  });

  it("returns 403 for a technician at an address they are NOT assigned to", async () => {
    asUser(TECH_B_CLERK_ID);
    const res = await request(app).get(
      `/api/schedule/property-profile?address=${encodeURIComponent(ADDRESS_UNASSIGNED)}`,
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 for a manager at any address (no assignment check)", async () => {
    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get(
      `/api/schedule/property-profile?address=${encodeURIComponent(ADDRESS_UNASSIGNED)}`,
    );
    // No inspections exist at this address, but the manager is not blocked.
    expect(res.status).toBe(200);
    expect(res.body.recentInspections).toHaveLength(0);
  });

  it("returns 200 for a sales rep at any address (no assignment check)", async () => {
    asUser(SALES_CLERK_ID);
    const res = await request(app).get(
      `/api/schedule/property-profile?address=${encodeURIComponent(ADDRESS_UNASSIGNED)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.recentInspections).toHaveLength(0);
  });

  it("returns 400 when address param is missing", async () => {
    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get("/api/schedule/property-profile");
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/schedule/:id — Authorization ───────────────────────────────────

describe("Authorization — PATCH /api/schedule/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const insp = await seedInspection({ technicianName: "Tech A" });
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });
    expect(res.status).toBe(401);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
  });

  /**
   * Scenario 3 (self-update): the route is guarded by requireRole("manager"),
   * so a technician can never submit a route update.  No push is ever sent.
   */
  it("returns 403 when called by a technician — no push notification is ever sent", async () => {
    const getCaptures = interceptExpoPush();

    const insp = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      scheduledDate: new Date("2026-08-17T08:00:00.000Z"),
    });

    asUser(TECH_A_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });

    expect(res.status).toBe(403);

    await new Promise((r) => setTimeout(r, 50));
    expect(getCaptures().length).toBe(0);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
  });

  it("returns 404 when a manager patches an inspection belonging to another company", async () => {
    const insp = await seedInspection({
      companyId: companyBId,
      technicianName: "Other Tech",
    });

    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "2026-08-20T08:00:00.000Z" });

    expect(res.status).toBe(404);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
  });

  it("returns 400 when the request body contains no updatable fields", async () => {
    const insp = await seedInspection({ technicianName: "Tech A" });
    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Nothing to update/i);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
  });

  it("returns 400 when scheduledDate is not a valid ISO datetime", async () => {
    const insp = await seedInspection({ technicianName: "Tech A" });
    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .patch(`/api/schedule/${insp.id}`)
      .send({ scheduledDate: "not-a-date" });
    expect(res.status).toBe(400);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
  });
});

// ── PATCH /api/schedule/:id — Push notification scenarios ─────────────────────

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

    await new Promise((r) => setTimeout(r, 50));

    const batches = getCaptures();
    expect(batches.length).toBe(1);

    const messages = batches[0];
    expect(messages.length).toBe(1);
    expect(messages[0].to).toBe(TECH_A_TOKEN);
    expect(messages[0].body).toMatch(/Thu,? Aug 20/);
    expect(messages[0].body).toMatch(/123 Test Street/);
    expect(messages[0].body).toContain("updated by your manager");

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
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

    await new Promise((r) => setTimeout(r, 50));

    const batches = getCaptures();
    expect(batches.length).toBe(1);

    const sentTokens = batches[0].map((m) => m.to);
    expect(sentTokens).toContain(TECH_A_TOKEN);
    expect(sentTokens).toContain(TECH_B_TOKEN);
    expect(sentTokens.length).toBe(2);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, priorB.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, insp.id));
  });
});

// ── GET /api/schedule/property-visit/:inspectionId ────────────────────────────

describe("GET /api/schedule/property-visit/:inspectionId", () => {
  const VISIT_ADDRESS = "77 Ledger Lane, Shelbyville";
  let productId: number;

  beforeAll(async () => {
    const [product] = await db
      .insert(productsTable)
      .values({
        name: "Visit-Test Termiticide",
        epaRegistrationNumber: "VISITTEST-001",
        productType: "restricted-use",
        activeIngredients: "Test Ingredient 1.0%",
        signalWord: "CAUTION",
        isActive: true,
      })
      .returning();
    productId = product.id;

    await db.insert(productLabelRulesTable).values({
      productId,
      retreatmentIntervalDays: 365,
    });
  });

  afterAll(async () => {
    await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.productId, productId));
    await db.delete(productLabelRulesTable).where(eq(productLabelRulesTable.productId, productId));
    await db.delete(productsTable).where(eq(productsTable.id, productId));
  });

  it("returns 401 when unauthenticated", async () => {
    const stop = await seedInspection({ technicianName: "Tech A", siteAddress: VISIT_ADDRESS });
    const res = await request(app).get(`/api/schedule/property-visit/${stop.id}`);
    expect(res.status).toBe(401);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stop.id));
  });

  it("returns 404 for a nonexistent inspection", async () => {
    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get("/api/schedule/property-visit/999999999");
    expect(res.status).toBe(404);
  });

  it("returns 403 for a technician with no personally-assigned inspection at that address", async () => {
    const stop = await seedInspection({
      technicianName: "Tech B",
      technicianId: TECH_B_CLERK_ID,
      siteAddress: VISIT_ADDRESS,
    });
    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(`/api/schedule/property-visit/${stop.id}`);
    expect(res.status).toBe(403);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stop.id));
  });

  it("returns 200 for a sales rep with no personally-assigned inspection at that address (unrestricted, like manager/owner)", async () => {
    const stop = await seedInspection({
      technicianName: "Tech B",
      technicianId: TECH_B_CLERK_ID,
      siteAddress: VISIT_ADDRESS,
    });
    asUser(SALES_CLERK_ID);
    const res = await request(app).get(`/api/schedule/property-visit/${stop.id}`);
    expect(res.status).toBe(200);
    expect(res.body.address).toBe(VISIT_ADDRESS);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stop.id));
  });

  it("groups sibling units by same address + calendar day, and computes chemical compliance", async () => {
    const visitDate = new Date("2026-08-20T09:00:00.000Z");

    const unitA = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: VISIT_ADDRESS,
      scheduledDate: visitDate,
      unitNumber: "101",
    });
    const unitB = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: VISIT_ADDRESS,
      scheduledDate: visitDate,
      unitNumber: "102",
    });
    // A different day at the same address must NOT be pulled into this visit.
    const otherDayStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: VISIT_ADDRESS,
      scheduledDate: new Date("2026-01-01T09:00:00.000Z"),
      unitNumber: "103",
    });

    // A prior application at this address, 30 days before the visit — well
    // inside the 365-day retreatment interval, so the visit's application
    // must come back non-compliant / not yet eligible.
    const priorAppliedAt = new Date(visitDate.getTime() - 30 * 86_400_000);
    await db.insert(treatmentLogsTable).values({
      companyId,
      inspectionId: otherDayStop.id,
      productId,
      targetPest: "Termites",
      siteClassification: "residential_exterior",
      appliedAt: priorAppliedAt,
    });

    await db.insert(treatmentLogsTable).values({
      companyId,
      inspectionId: unitA.id,
      productId,
      targetPest: "Termites",
      siteClassification: "residential_exterior",
      appliedAt: visitDate,
    });

    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get(`/api/schedule/property-visit/${unitA.id}`);

    expect(res.status).toBe(200);
    expect(res.body.address).toBe(VISIT_ADDRESS);

    const unitIds = (res.body.units as { id: number }[]).map((u) => u.id);
    expect(unitIds).toContain(unitA.id);
    expect(unitIds).toContain(unitB.id);
    expect(unitIds).not.toContain(otherDayStop.id);

    const ledger = res.body.chemicalLedger as Array<{
      inspectionId: number;
      compliance: {
        retreatmentIntervalDays: number | null;
        daysSincePrior: number | null;
        isCompliant: boolean;
        eligibleNow: boolean;
        nextEligibleReapplicationDate: string | null;
      };
    }>;
    expect(ledger.length).toBe(1);
    const entry = ledger[0];
    expect(entry.inspectionId).toBe(unitA.id);
    expect(entry.compliance.retreatmentIntervalDays).toBe(365);
    expect(entry.compliance.daysSincePrior).toBe(30);
    expect(entry.compliance.isCompliant).toBe(false);
    expect(entry.compliance.eligibleNow).toBe(false);
    expect(entry.compliance.nextEligibleReapplicationDate).not.toBeNull();

    await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.inspectionId, unitA.id));
    await db.delete(treatmentLogsTable).where(eq(treatmentLogsTable.inspectionId, otherDayStop.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, unitA.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, unitB.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, otherDayStop.id));
  });

  it("merges normalized PestPac notes after the assigned stop is authorized", async () => {
    const stop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: "61 Legacy Notes Ln",
      scheduledDate: new Date("2026-09-01T09:00:00.000Z"),
    });
    pestPacHistoryMock.mockResolvedValueOnce({
      status: "available",
      notes: [
        {
          id: "legacy-note-1",
          note: "Call the loading dock before arrival.",
          category: "access",
          authorName: "PestPac Dispatcher",
          createdAt: "2026-08-20T14:00:00.000Z",
        },
      ],
    });

    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(`/api/schedule/stop-history/${stop.id}`);

    expect(res.status).toBe(200);
    expect(res.body.pestPacHistory).toEqual({
      status: "available",
      notes: [
        {
          id: "legacy-note-1",
          note: "Call the loading dock before arrival.",
          category: "access",
          authorName: "PestPac Dispatcher",
          createdAt: "2026-08-20T14:00:00.000Z",
        },
      ],
    });
    expect(pestPacHistoryMock).toHaveBeenCalledWith(
      companyId,
      stop.id,
      new Date("2026-09-01T09:00:00.000Z"),
    );

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stop.id));
  });

  it("returns a stop-scoped history payload with prior photos and materials, excluding the selected stop", async () => {
    const address = "91 Stop History Way, Shelbyville";
    const priorStops = await Promise.all([
      seedInspection({
        technicianName: "Tech A",
        technicianId: TECH_A_CLERK_ID,
        siteAddress: address,
        scheduledDate: new Date("2026-08-10T09:00:00.000Z"),
        status: "completed",
        completedAt: new Date("2026-08-10T10:00:00.000Z"),
      }),
      seedInspection({
        technicianName: "Tech A",
        technicianId: TECH_A_CLERK_ID,
        siteAddress: address,
        scheduledDate: new Date("2026-08-11T09:00:00.000Z"),
        status: "completed",
        completedAt: new Date("2026-08-11T10:00:00.000Z"),
      }),
      seedInspection({
        technicianName: "Tech A",
        technicianId: TECH_A_CLERK_ID,
        siteAddress: address,
        scheduledDate: new Date("2026-08-12T09:00:00.000Z"),
        status: "completed",
        completedAt: new Date("2026-08-12T10:00:00.000Z"),
      }),
      seedInspection({
        technicianName: "Tech A",
        technicianId: TECH_A_CLERK_ID,
        siteAddress: address,
        scheduledDate: new Date("2026-08-13T09:00:00.000Z"),
        status: "completed",
        completedAt: new Date("2026-08-13T10:00:00.000Z"),
      }),
    ]);
    const selectedStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: address,
      scheduledDate: new Date("2026-09-01T09:00:00.000Z"),
    });
    const sameDayCompletedStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: address,
      scheduledDate: new Date("2026-09-01T08:00:00.000Z"),
      status: "completed",
      completedAt: new Date("2026-09-01T08:30:00.000Z"),
    });
    const earlierPendingStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: address,
      scheduledDate: new Date("2026-08-20T09:00:00.000Z"),
    });
    const futureStop = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: address,
      scheduledDate: new Date("2026-09-02T09:00:00.000Z"),
      status: "completed",
      completedAt: new Date("2026-09-02T10:00:00.000Z"),
    });

    await db.insert(inspectionMediaTable).values([
      {
        companyId,
        inspectionId: priorStops[3]!.id,
        mediaType: "photo",
        url: "https://example.test/history-photo.jpg",
        filename: "history-photo.jpg",
        caption: "Prior kitchen evidence",
        createdAt: new Date("2026-08-13T10:05:00.000Z"),
      },
      {
        companyId,
        inspectionId: futureStop.id,
        mediaType: "photo",
        url: "https://example.test/future-stop-photo.jpg",
        createdAt: new Date("2026-09-02T10:05:00.000Z"),
      },
    ]);
    await db.insert(treatmentLogsTable).values([
      {
        companyId,
        inspectionId: priorStops[2]!.id,
        productId,
        targetPest: "Termites",
        siteClassification: "residential_exterior",
        totalProductOz: 2,
        appliedAt: new Date("2026-08-12T10:00:00.000Z"),
      },
      {
        companyId,
        inspectionId: futureStop.id,
        productId,
        targetPest: "Termites",
        siteClassification: "residential_exterior",
        totalProductOz: 1,
        appliedAt: new Date("2026-09-02T09:30:00.000Z"),
      },
    ]);

    asUser(TECH_A_CLERK_ID);
    const res = await request(app).get(`/api/schedule/stop-history/${selectedStop.id}`);

    expect(res.status).toBe(200);
    expect(res.body.stopId).toBe(selectedStop.id);
    expect(res.body.address).toBe(address);
    expect(res.body.pestPacHistory).toEqual({ status: "disabled", notes: [] });
    expect(res.body.recentInspections).toHaveLength(3);
    const recentIds = (res.body.recentInspections as Array<{ id: number }>).map(
      (inspection) => inspection.id,
    );
    expect(recentIds).toContain(sameDayCompletedStop.id);
    expect(recentIds).not.toContain(selectedStop.id);
    expect(recentIds).not.toContain(earlierPendingStop.id);
    expect(recentIds).not.toContain(futureStop.id);
    expect(res.body.historicalPhotos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inspectionId: priorStops[3]!.id,
          caption: "Prior kitchen evidence",
        }),
      ]),
    );
    expect(
      (res.body.historicalPhotos as Array<{ inspectionId: number }>).some(
        (photo) => photo.inspectionId === futureStop.id,
      ),
    ).toBe(false);
    expect(res.body.materialHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inspectionId: priorStops[2]!.id,
          productName: "Visit-Test Termiticide",
          totalProductOz: 2,
        }),
      ]),
    );
    expect(
      (res.body.materialHistory as Array<{ inspectionId: number }>).some(
        (material) => material.inspectionId === futureStop.id,
      ),
    ).toBe(false);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, selectedStop.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, sameDayCompletedStop.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, earlierPendingStop.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, futureStop.id));
    for (const stop of priorStops) {
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, stop.id));
    }
  });

  it("requires exact technician assignment and hides cross-company stop IDs", async () => {
    const address = "92 Stop Isolation Way, Shelbyville";
    const techAHistory = await seedInspection({
      technicianName: "Tech A",
      technicianId: TECH_A_CLERK_ID,
      siteAddress: address,
    });
    const techBStop = await seedInspection({
      technicianName: "Tech B",
      technicianId: TECH_B_CLERK_ID,
      siteAddress: address,
    });
    const otherCompanyStop = await seedInspection({
      companyId: companyBId,
      technicianName: "Other Tech",
      technicianId: OTHER_MGR_CLERK_ID,
      siteAddress: address,
    });

    asUser(TECH_A_CLERK_ID);
    const forbidden = await request(app).get(`/api/schedule/stop-history/${techBStop.id}`);
    expect(forbidden.status).toBe(403);

    asUser(MANAGER_CLERK_ID);
    const hidden = await request(app).get(
      `/api/schedule/stop-history/${otherCompanyStop.id}`,
    );
    expect(hidden.status).toBe(404);

    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, techAHistory.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, techBStop.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, otherCompanyStop.id));
  });
});
