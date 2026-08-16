import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

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
import { db, usersTable, companiesTable, inspectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Seed identifiers ─────────────────────────────────────────────────────────

const TECH_A_CLERK = "mg_test_tech_a_clerk";
const TECH_B_CLERK = "mg_test_tech_b_clerk";

let companyAId: number;
let companyBId: number;
let techAId: number;
let techBId: number;
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
