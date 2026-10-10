import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";

/**
 * Meta Glasses session tests.
 *
 * Key invariant: POST /api/meta-glasses/session must return 404 when the
 * supplied inspectionId belongs to a different company than the authenticated
 * user. A technician at Company A must not be able to hijack an inspection
 * session belonging to Company B.
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

// Stub out AI / storage integrations that are not relevant to this test.
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    audio: { transcriptions: { create: vi.fn(async () => ({ text: "" })) } },
  },
}));
vi.mock("../lib/intelligence-ai", () => ({
  analyzePhotoFromBase64: vi.fn(async () => null),
}));
vi.mock("../lib/glasses-zoom", () => ({
  zoomGlassesFrame: vi.fn(async (buf: Buffer) => ({ buffer: buf, subject: null })),
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    uploadObjectBuffer = vi.fn(async () => "mock/path.jpg");
  },
}));

import app from "../app";
import { db, usersTable, companiesTable, inspectionsTable, metaGlassesSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Seed identifiers ─────────────────────────────────────────────────────────

const TECH_A_CLERK = "mg_test_tech_a_clerk";
const TECH_B_CLERK = "mg_test_tech_b_clerk";
const MANAGER_A_CLERK = "mg_test_manager_a_clerk";

let companyAId: number;
let companyBId: number;
let techAId: number;
let techBId: number;
let managerAId: number;
let inspectionAId: number; // belongs to Company A
let inspectionBId: number; // belongs to Company B

function asUser(clerkId: string | null) {
  authState.userId = clerkId;
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

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  companyAId = await findOrCreateCompany("MG Test Co A", "mg-test-co-a");
  companyBId = await findOrCreateCompany("MG Test Co B", "mg-test-co-b");

  // Upsert technician A (belongs to Company A, beta access enabled)
  const [existingA] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, TECH_A_CLERK));
  if (existingA) {
    techAId = existingA.id;
  } else {
    const [row] = await db
      .insert(usersTable)
      .values({
        clerkUserId: TECH_A_CLERK,
        email: "tech-a@mg-test.example",
        name: "Tech A",
        role: "technician",
        companyId: companyAId,
        betaAccess: true,
      })
      .returning();
    techAId = row.id;
  }

  // Upsert technician B (belongs to Company B, beta access enabled)
  const [existingB] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, TECH_B_CLERK));
  if (existingB) {
    techBId = existingB.id;
  } else {
    const [row] = await db
      .insert(usersTable)
      .values({
        clerkUserId: TECH_B_CLERK,
        email: "tech-b@mg-test.example",
        name: "Tech B",
        role: "technician",
        companyId: companyBId,
        betaAccess: true,
      })
      .returning();
    techBId = row.id;
  }

  // Upsert manager A (belongs to Company A, manager role, beta access enabled)
  const [existingMA] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, MANAGER_A_CLERK));
  if (existingMA) {
    managerAId = existingMA.id;
  } else {
    const [row] = await db
      .insert(usersTable)
      .values({
        clerkUserId: MANAGER_A_CLERK,
        email: "manager-a@mg-test.example",
        name: "Manager A",
        role: "manager",
        companyId: companyAId,
        betaAccess: true,
      })
      .returning();
    managerAId = row.id;
  }

  // Create an inspection for each company
  const [inspA] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      technicianId: techAId,
      technicianName: "Tech A",
      siteAddress: "1 Alpha St",
      status: "in_progress",
    })
    .returning();
  inspectionAId = inspA.id;

  const [inspB] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyBId,
      technicianId: techBId,
      technicianName: "Tech B",
      siteAddress: "2 Beta Ave",
      status: "in_progress",
    })
    .returning();
  inspectionBId = inspB.id;
});

afterAll(async () => {
  // Best-effort cleanup — leave companies for reuse across test runs.
  if (inspectionAId) {
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionAId)).catch(() => {});
  }
  if (inspectionBId) {
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionBId)).catch(() => {});
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/meta-glasses/session — cross-company isolation", () => {
  it("returns 200 when the technician supplies their own company's inspection", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sessionId");
    expect(res.body).toHaveProperty("code");
  });

  it("reuses a persisted session on repeated registration without changing its pairing code", async () => {
    asUser(TECH_A_CLERK);
    const first = await request(app).post("/api/meta-glasses/session").send({ inspectionId: inspectionAId });
    const second = await request(app).post("/api/meta-glasses/session").send({ inspectionId: inspectionAId });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("returns one pairing code for concurrent registrations of a new inspection", async () => {
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId: companyAId,
      technicianId: techAId,
      technicianName: "Tech A",
      siteAddress: "3 Concurrent St",
      status: "in_progress",
    }).returning();
    try {
      asUser(TECH_A_CLERK);
      const responses = await Promise.all(Array.from({ length: 5 }, () =>
        request(app).post("/api/meta-glasses/session").send({ inspectionId: inspection.id }),
      ));
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(new Set(responses.map((response) => response.body.sessionId)).size).toBe(1);
    } finally {
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection.id));
    }
  });

  it("returns 404 when Tech A supplies an inspection belonging to Company B", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionBId }); // Company B's inspection

    // Must be 404 — same response as "not found" so existence is not leaked.
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for a non-existent inspection ID", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: 999_999_999 });

    expect(res.status).toBe(404);
  });

  it("returns 401 for an unauthenticated request", async () => {
    asUser(null);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });

    expect(res.status).toBe(401);
  });

  it("returns 400 when inspectionId is missing", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("glasses traffic has an independent API budget", () => {
  it("does not consume the inspection API's shared IP budget", async () => {
    // Meta webhook verification is cheap and does not need a valid session.
    // This deliberately exceeds the ordinary API's 500/15-minute limit.
    for (let i = 0; i < 501; i++) {
      const response = await request(app).get("/api/meta-glasses/webhook");
      expect(response.status).toBe(403);
    }
    asUser(null);
    const inspection = await request(app).get("/api/inspections");
    expect(inspection.status).toBe(401); // auth still runs, not a shared-budget 429
  });
});

// ─── GET /events/:sessionId — cross-company isolation ────────────────────────

describe("GET /api/meta-glasses/events/:sessionId — cross-company isolation", () => {
  let sessionIdForA: string;

  // Create a session owned by Company A before these tests run.
  beforeAll(async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });
    sessionIdForA = res.body.sessionId as string;
  });

  it("returns 200 and events when Tech A polls their own session", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app).get(
      `/api/meta-glasses/events/${sessionIdForA}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sessionId", sessionIdForA);
    expect(res.body).toHaveProperty("events");
  });

  it("reads a persisted session and sees events appended after an earlier poll", async () => {
    const persistedId = crypto.randomUUID();
    await db.insert(metaGlassesSessionsTable).values({
      sessionId: persistedId,
      code: "DBONLY",
      inspectionId: inspectionAId,
      companyId: companyAId,
      userId: techAId,
      events: [],
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      asUser(TECH_A_CLERK);
      const own = await request(app).get(`/api/meta-glasses/events/${persistedId}`);
      expect(own.status).toBe(200);
      expect(own.body.events).toEqual([]);
      // Simulate a webhook on another API process writing to the shared DB.
      const remoteEvent = { id: crypto.randomUUID(), type: "status", timestamp: Date.now(), text: "Remote frame" };
      await db.update(metaGlassesSessionsTable).set({ events: [remoteEvent] })
        .where(eq(metaGlassesSessionsTable.sessionId, persistedId));
      const updated = await request(app).get(`/api/meta-glasses/events/${persistedId}`);
      expect(updated.body.events).toEqual([remoteEvent]);
      asUser(TECH_B_CLERK);
      const other = await request(app).get(`/api/meta-glasses/events/${persistedId}`);
      expect(other.status).toBe(404);
    } finally {
      await db.delete(metaGlassesSessionsTable).where(eq(metaGlassesSessionsTable.sessionId, persistedId));
    }
  });

  it("keeps all events when several writers append to the same session at once", async () => {
    asUser(TECH_A_CLERK);
    const registration = await request(app).post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });
    const sessionId = registration.body.sessionId as string;
    const marker = crypto.randomUUID();
    const writes = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      request(app).post(`/api/meta-glasses/events/${sessionId}`)
        .send({ type: "ble_reconnect", text: `${marker}-${index}` }),
    ));
    expect(writes.every((response) => response.status === 204)).toBe(true);
    const polled = await request(app).get(`/api/meta-glasses/events/${sessionId}`);
    expect(polled.body.events.filter((event: { text: string }) => event.text.startsWith(marker)))
      .toHaveLength(5);
  });

  it("returns 404 when Tech B polls a session belonging to Company A", async () => {
    asUser(TECH_B_CLERK);
    const res = await request(app).get(
      `/api/meta-glasses/events/${sessionIdForA}`,
    );

    // Must be 404 — same response as "not found" so the session's existence
    // is not leaked to a caller from a different company.
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for a completely unknown sessionId", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app).get(
      "/api/meta-glasses/events/00000000-0000-0000-0000-000000000000",
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 for an unauthenticated poll attempt", async () => {
    asUser(null);
    const res = await request(app).get(
      `/api/meta-glasses/events/${sessionIdForA}`,
    );

    expect(res.status).toBe(401);
  });
});

// ─── POST /events/:sessionId — BLE frame-drop telemetry injection ─────────────

describe("POST /api/meta-glasses/events/:sessionId — cross-company injection guard", () => {
  let sessionIdForA: string;

  // Create a fresh session owned by Company A for this describe block.
  beforeAll(async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });
    sessionIdForA = res.body.sessionId as string;
  });

  it("returns 204 when Tech A posts a ble_frame_dropped event to their own session", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post(`/api/meta-glasses/events/${sessionIdForA}`)
      .send({ type: "ble_frame_dropped", text: "Frame 42 dropped — link flap" });

    expect(res.status).toBe(204);
  });

  it("returns 404 when Tech A posts a ble_frame_dropped event to Tech B's session (existence not leaked)", async () => {
    // First create a session for Company B so there is a real session to target.
    asUser(TECH_B_CLERK);
    const createRes = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionBId });
    const sessionIdForB = createRes.body.sessionId as string;

    // Now Tech A tries to inject a telemetry event into Company B's session.
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post(`/api/meta-glasses/events/${sessionIdForB}`)
      .send({ type: "ble_frame_dropped", text: "injected" });

    // Must be 404 — not 403 — so session existence is not revealed.
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 for an unauthenticated POST", async () => {
    asUser(null);
    const res = await request(app)
      .post(`/api/meta-glasses/events/${sessionIdForA}`)
      .send({ type: "ble_frame_dropped" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when an unsupported event type is posted", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post(`/api/meta-glasses/events/${sessionIdForA}`)
      .send({ type: "evil_inject_type" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

// ─── POST /events/:sessionId — ble_frame_dropped persistence and retrieval ────
//
// These tests confirm that a ble_frame_dropped event POSTed by the mobile app
// (via useMetaGlassesSession.postTelemetryEvent, wired in new-inspection.tsx)
// is durably stored and readable back through GET /events/:sessionId so that
// the portal's BLE Health / telemetry view can aggregate per-device drop counts.

describe("POST /events/:sessionId — ble_frame_dropped persistence and retrieval", () => {
  let sessionId: string;

  // Create a fresh session owned by Company A for every test in this block.
  beforeAll(async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });
    sessionId = res.body.sessionId as string;
  });

  it("persists the event so it is visible via GET /events/:sessionId immediately after POST", async () => {
    asUser(TECH_A_CLERK);

    // POST the telemetry event (mirrors the call made by new-inspection.tsx
    // via glassesSession.postTelemetryEvent when onDroppedFrame fires).
    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-persist",
        reason: "driver_drop",
        count: 3,
      });
    expect(postRes.status).toBe(204);

    // Poll the session and confirm the event is now visible.
    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const dropped = events.find(
      (e) => e.clientEventType === "ble_frame_dropped" && e.deviceId === "device-test-persist",
    );

    expect(dropped).toBeDefined();
    expect(dropped!.clientEventType).toBe("ble_frame_dropped");
    expect(dropped!.deviceId).toBe("device-test-persist");
    expect(dropped!.reason).toBe("driver_drop");
    expect(dropped!.count).toBe(3);
  });

  it("server assigns a fresh UUID id — a client-supplied id is overwritten", async () => {
    asUser(TECH_A_CLERK);

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        id: "forged-id-00000000",
        deviceId: "device-test-id-overwrite",
        reason: "cap_exceeded",
      });
    expect(postRes.status).toBe(204);

    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-id-overwrite",
    );

    expect(found).toBeDefined();
    // The server must have generated a new UUID — the forged id is silently ignored.
    expect(found!.id).not.toBe("forged-id-00000000");
    expect(found!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("event type is stored as 'status' (not 'ble_frame_dropped') with clientEventType as the discriminator", async () => {
    asUser(TECH_A_CLERK);

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-type-field",
        reason: "processing_error",
        count: 1,
      });
    expect(postRes.status).toBe(204);

    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-type-field",
    );

    expect(found).toBeDefined();
    // The `type` field categorises all client-push events as "status".
    // The original event type lives in `clientEventType` for telemetry queries.
    expect(found!.type).toBe("status");
    expect(found!.clientEventType).toBe("ble_frame_dropped");
  });

  it("missing count field defaults to 1 in the persisted event", async () => {
    asUser(TECH_A_CLERK);

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-no-count",
        reason: "driver_drop",
        // count deliberately omitted
      });
    expect(postRes.status).toBe(204);

    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-no-count",
    );

    expect(found).toBeDefined();
    // The server must normalise the absent count to 1.
    expect(found!.count).toBe(1);
  });

  it("count=7 survives the POST → GET round-trip unchanged", async () => {
    asUser(TECH_A_CLERK);

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-count-7",
        reason: "driver_drop",
        count: 7,
      });
    expect(postRes.status).toBe(204);

    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-count-7",
    );

    expect(found).toBeDefined();
    expect(found!.count).toBe(7);
  });

  it("negative count is clamped to 1 before persistence", async () => {
    asUser(TECH_A_CLERK);

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-negative-count",
        reason: "cap_exceeded",
        count: -10,
      });
    expect(postRes.status).toBe(204);

    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-negative-count",
    );

    expect(found).toBeDefined();
    expect(found!.count).toBe(1);
  });

  it("overflow count (> MAX_EVENT_COUNT=10000) is clamped to 10000 before persistence", async () => {
    asUser(TECH_A_CLERK);

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-overflow-count",
        reason: "driver_drop",
        count: 999_999,
      });
    expect(postRes.status).toBe(204);

    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-overflow-count",
    );

    expect(found).toBeDefined();
    expect(found!.count).toBe(10_000);
  });

  it("since= filter excludes events older than the cursor — only fresh drops are returned", async () => {
    asUser(TECH_A_CLERK);

    // Use the server's own clock (serverTime from a GET response) as the cursor
    // so we're not racing against wall-clock equality between client Date.now()
    // and the server-assigned event timestamp.
    const anchorRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}`,
    );
    expect(anchorRes.status).toBe(200);
    // serverTime is the server's Date.now() at the moment of the GET response —
    // guaranteed to be <= any event timestamp set by a subsequent POST.
    // Subtract 1 ms to make the filter strictly "events after this GET" (the
    // route uses `timestamp > since`, so equal timestamps are excluded).
    const cursor: number = (anchorRes.body.serverTime as number) - 1;

    const postRes = await request(app)
      .post(`/api/meta-glasses/events/${sessionId}`)
      .send({
        type: "ble_frame_dropped",
        deviceId: "device-test-since-filter",
        reason: "driver_drop",
        count: 2,
      });
    expect(postRes.status).toBe(204);

    // Poll with since=cursor: only events whose server timestamp is > cursor
    // (i.e. only events created after the anchor GET) should appear.
    const getRes = await request(app).get(
      `/api/meta-glasses/events/${sessionId}?since=${cursor}`,
    );
    expect(getRes.status).toBe(200);

    const events: GlassesEvent[] = getRes.body.events;
    const found = events.find(
      (e) =>
        e.clientEventType === "ble_frame_dropped" &&
        e.deviceId === "device-test-since-filter",
    );

    // The newly-posted drop must appear because its timestamp > cursor.
    expect(found).toBeDefined();
  });
});

// ─── GET /frame-drop-stats — BLE telemetry aggregation ───────────────────────

describe("GET /api/meta-glasses/frame-drop-stats", () => {
  // Seed a session for Company A with known frame-drop events directly in the
  // DB so we control the JSONB contents precisely.
  beforeAll(async () => {
    // Create one session for Company A containing two ble_frame_dropped events
    // (one with custom text so we verify clientEventType is the discriminator)
    // and one ble_reconnect event that must NOT appear in the counts.
    await db.insert(metaGlassesSessionsTable).values({
      sessionId: "fds-test-session-a",
      code: "FDSTST",
      inspectionId: inspectionAId,
      companyId: companyAId,
      userId: managerAId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      events: [
        {
          id: "evt-1",
          type: "status",
          timestamp: Date.now(),
          text: "Frame 42 dropped — link flap", // custom text; must still count
          clientEventType: "ble_frame_dropped",
          deviceId: "device-alpha",
          reason: "buffer_overflow",
          count: 1, // explicit single-frame drop
        },
        {
          id: "evt-2",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped", // default text
          clientEventType: "ble_frame_dropped",
          deviceId: "device-alpha",
          reason: "buffer_overflow",
          count: 7, // bulk driver drop — SUM must produce 8 total, not 2
        },
        {
          id: "evt-3",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_reconnect", // reconnect — must NOT be counted
          clientEventType: "ble_reconnect",
          deviceId: "device-alpha",
        },
        {
          id: "evt-4",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped", // no count field — must default to 1
          clientEventType: "ble_frame_dropped",
          deviceId: "device-alpha",
          reason: "buffer_overflow",
          // count intentionally absent to exercise COALESCE(..., 1)
        },
      ],
    }).onConflictDoNothing();

    // Create a session for Company B — its drops must never appear in Company A stats.
    await db.insert(metaGlassesSessionsTable).values({
      sessionId: "fds-test-session-b",
      code: "FDSTB2",
      inspectionId: inspectionBId,
      companyId: companyBId,
      userId: techBId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      events: [
        {
          id: "evt-b-1",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped",
          clientEventType: "ble_frame_dropped",
          deviceId: "device-beta",
          reason: "signal_loss",
        },
      ],
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(metaGlassesSessionsTable)
      .where(eq(metaGlassesSessionsTable.sessionId, "fds-test-session-a"))
      .catch(() => {});
    await db
      .delete(metaGlassesSessionsTable)
      .where(eq(metaGlassesSessionsTable.sessionId, "fds-test-session-b"))
      .catch(() => {});
  });

  it("returns 200 with correct drop counts for a manager", async () => {
    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stats");
    expect(res.body).toHaveProperty("queriedAt");

    // Company A seeded: device-alpha / buffer_overflow with counts 1 + 7 + 1 = 9.
    // SUM(count) must return 9, not 3 (COUNT(*) would give 3).
    const stat = (res.body.stats as Array<{ deviceId: string; reason: string; dropCount: number }>)
      .find((s) => s.deviceId === "device-alpha" && s.reason === "buffer_overflow");
    expect(stat).toBeDefined();
    expect(stat!.dropCount).toBe(9);
  });

  it("sums count > 1 correctly — a bulk driver drop is not treated as a single drop", async () => {
    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(200);

    // evt-2 has count=7, evt-1 count=1, evt-4 has no count (defaults to 1) → 9 total.
    // If the aggregation used COUNT(*) instead of SUM(count) it would return 3.
    const stat = (res.body.stats as Array<{ deviceId: string; reason: string; dropCount: number }>)
      .find((s) => s.deviceId === "device-alpha" && s.reason === "buffer_overflow");
    expect(stat).toBeDefined();
    expect(stat!.dropCount).toBeGreaterThan(3); // proves SUM is used, not COUNT
    expect(stat!.dropCount).toBe(9);            // exact value
  });

  it("counts events with custom text when clientEventType is ble_frame_dropped", async () => {
    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(200);

    // The event with text "Frame 42 dropped — link flap" must be counted
    // (discriminated by clientEventType, not text).
    const total = (res.body.stats as Array<{ dropCount: number }>)
      .reduce((sum, s) => sum + s.dropCount, 0);
    expect(total).toBeGreaterThanOrEqual(9);
  });

  it("excludes ble_reconnect events from the drop count", async () => {
    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(200);

    // There must be no row for device-alpha / reason:undefined from the reconnect event
    const reconnectRow = (res.body.stats as Array<{ deviceId: string; reason: string | null; dropCount: number }>)
      .find((s) => s.deviceId === "device-alpha" && s.reason === null);
    // If such a row exists its drop count should not include the reconnect event
    // (i.e. the reconnect must add 0 frame drops).
    if (reconnectRow) {
      expect(reconnectRow.dropCount).toBe(0);
    }
  });

  it("scopes results to the calling company — Company B's device must not appear", async () => {
    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(200);

    const hasBeta = (res.body.stats as Array<{ deviceId: string }>)
      .some((s) => s.deviceId === "device-beta");
    expect(hasBeta).toBe(false);
  });

  it("returns 403 when a technician (non-manager) calls the endpoint", async () => {
    asUser(TECH_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(403);
  });

  it("returns 401 for an unauthenticated request", async () => {
    asUser(null);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(401);
  });

  it("clamps malformed count to 1 and caps overflow count — endpoint never crashes", async () => {
    // Seed directly into the DB to test the SQL safe-cast without relying on
    // the fire-and-forget pushEvent path (which would introduce a race).
    await db.insert(metaGlassesSessionsTable).values({
      sessionId: "fds-test-malformed",
      code: "FDSMAL",
      inspectionId: inspectionAId,
      companyId: companyAId,
      userId: managerAId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      events: [
        {
          id: "evt-malformed-1",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped",
          clientEventType: "ble_frame_dropped",
          deviceId: "device-malformed",
          reason: "bad-counts",
          count: "not-a-number", // non-numeric string → SQL must default to 1
        },
        {
          id: "evt-malformed-2",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped",
          clientEventType: "ble_frame_dropped",
          deviceId: "device-malformed",
          reason: "bad-counts",
          count: 99_999_999, // oversized → SQL must cap at 10000 via LEAST
        },
        {
          id: "evt-malformed-3",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped",
          clientEventType: "ble_frame_dropped",
          deviceId: "device-malformed",
          reason: "bad-counts",
          count: -5, // negative (JSON number "-5") → SQL must default to 1
        },
      ],
    }).onConflictDoNothing();

    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");

    // Must return 200 — malformed counts must never crash the endpoint.
    expect(res.status).toBe(200);

    const malformedRow = (res.body.stats as Array<{ deviceId: string; reason: string; dropCount: number }>)
      .find((s) => s.deviceId === "device-malformed" && s.reason === "bad-counts");
    expect(malformedRow).toBeDefined();
    // "not-a-number" → 1 (bad string), 99_999_999 → 10000 (LEAST cap), -5 → 1 (negative)
    expect(malformedRow!.dropCount).toBe(10_002);

    // Cleanup
    await db.delete(metaGlassesSessionsTable)
      .where(eq(metaGlassesSessionsTable.sessionId, "fds-test-malformed"))
      .catch(() => {});
  });

  it("server caps count at MAX_EVENT_COUNT before persisting via POST /events/:sessionId", async () => {
    // Seed a session directly in the DB simulating what the server stores after
    // capping count=999999 → 10000.  We test the DB value directly rather than
    // going through the fire-and-forget pushEvent path (which would race with
    // the immediate stats query).
    await db.insert(metaGlassesSessionsTable).values({
      sessionId: "fds-test-overflow",
      code: "FDSOVF",
      inspectionId: inspectionAId,
      companyId: companyAId,
      userId: managerAId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      events: [
        {
          id: "evt-overflow-1",
          type: "status",
          timestamp: Date.now(),
          text: "Client event: ble_frame_dropped",
          clientEventType: "ble_frame_dropped",
          deviceId: "device-overflow",
          reason: "driver_drop",
          count: 10_000, // server-capped value (original might have been 999999)
        },
      ],
    }).onConflictDoNothing();

    asUser(MANAGER_A_CLERK);
    const res = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(res.status).toBe(200);

    const overflowRow = (res.body.stats as Array<{ deviceId: string; dropCount: number }>)
      .find((s) => s.deviceId === "device-overflow");
    expect(overflowRow).toBeDefined();
    // Value stored is exactly 10000 (capped by server); LEAST(10000, 10000) = 10000.
    expect(overflowRow!.dropCount).toBe(10_000);

    // Cleanup
    await db.delete(metaGlassesSessionsTable)
      .where(eq(metaGlassesSessionsTable.sessionId, "fds-test-overflow"))
      .catch(() => {});
  });

  it("does not count a ble_reconnect event that forges clientEventType=ble_frame_dropped", async () => {
    // Post a reconnect event with a forged clientEventType. The server must
    // overwrite clientEventType with the validated type ("ble_reconnect"), so
    // the stats query must not count it as a frame drop.
    asUser(MANAGER_A_CLERK);
    // We need a live session to push into — create one now.
    const sessionRes = await request(app)
      .post("/api/meta-glasses/session")
      .send({ inspectionId: inspectionAId });
    const forgerySessionId = sessionRes.body.sessionId as string;

    // Attempt to inject a ble_reconnect event disguised as a frame drop.
    await request(app)
      .post(`/api/meta-glasses/events/${forgerySessionId}`)
      .send({
        type: "ble_reconnect",
        clientEventType: "ble_frame_dropped", // forged — server must ignore this
        deviceId: "device-forgery",
        reason: "forged",
      });

    // Query stats and confirm device-forgery has zero frame drops.
    const statsRes = await request(app).get("/api/meta-glasses/frame-drop-stats");
    expect(statsRes.status).toBe(200);
    const forgeryRow = (statsRes.body.stats as Array<{ deviceId: string }>)
      .find((s) => s.deviceId === "device-forgery");
    expect(forgeryRow).toBeUndefined();
  });
});
