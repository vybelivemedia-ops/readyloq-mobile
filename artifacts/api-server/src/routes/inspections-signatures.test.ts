/**
 * Integration tests — signature capture on a completed inspection
 *
 * Verifies the end-to-end path that the reviewer flagged:
 *   1. A tech creates and completes an inspection (POST + POST /complete)
 *   2. The summary screen captures signatures (PATCH with signature data)
 *   3. GET /inspections/:id returns all four signature fields correctly
 *   4. PATCH on a non-existent inspection returns 404
 *   5. Cross-company PATCH cannot overwrite another company's signatures
 *   6. The resignatureConsent guard blocks silent owner-signature clears
 *   7. Unauthenticated PATCH returns 401
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

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

vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  return {
    ...actual,
    ObjectStorageService: class {
      normalizeObjectEntityPath(path: string) {
        return path;
      }
      async getObjectEntityMetadata() {
        return { size: 123, contentType: "image/jpeg", md5Hash: null };
      }
    },
  };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionUploadIntentsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { migrateInspectionUploadIntents } from "../lib/migrate-inspection-upload-intents";

// ── Constants ─────────────────────────────────────────────────────────────────

const TECH_ID  = "sig_test_tech_clerk";
const PEER_TECH_ID = "sig_test_peer_tech_clerk";
const MGR_ID   = "sig_test_mgr_clerk";
const OWNER_ID = "sig_test_owner_clerk";
const OTHER_ID = "sig_test_other_mgr_clerk"; // different company

const TECH_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><path d="M10 80 L100 20 L200 120" stroke="#1a1a2e" stroke-width="2.5" fill="none"/></svg>';
const OWNER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><path d="M20 90 L120 30 L220 130" stroke="#1a1a2e" stroke-width="2.5" fill="none"/></svg>';

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

/** Create an inspection via the API (POST) and return its id. */
async function createInspection(): Promise<number> {
  asUser(TECH_ID);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: "99 Sig Test Ave, Springfield", technicianName: "Jane Tech" });
  expect(res.status).toBe(201);
  return (res.body as { id: number }).id;
}

/** Complete an inspection via the API (POST /complete). */
async function completeInspection(id: number): Promise<void> {
  asUser(TECH_ID);
  const res = await request(app).post(`/api/inspections/${id}/complete`);
  // 200 = completed (possibly already completed — both are fine for test setup)
  expect([200, 201]).toContain(res.status);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await migrateInspectionUploadIntents();
  companyId  = await findOrCreateCompany("Sig Test Co",  "sig-test-co");
  companyBId = await findOrCreateCompany("Sig Test Co B", "sig-test-co-b");

  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));

  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID,  role: "technician", companyId },
    { clerkUserId: PEER_TECH_ID, role: "technician", companyId },
    { clerkUserId: MGR_ID,   role: "manager",    companyId },
    { clerkUserId: OWNER_ID, role: "owner",      companyId },
    { clerkUserId: OTHER_ID, role: "manager",    companyId: companyBId },
  ]);
});

async function createPhotoUploadIntent(inspectionId: number, url: string): Promise<number> {
  const clerkUserId = authState.userId;
  if (!clerkUserId) throw new Error("Signature test upload intent requires an authenticated user");
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  if (!user) throw new Error("Signature test technician is missing");
  const objectPath = url.replace(/^\/api\/storage/, "");
  const [intent] = await db
    .insert(inspectionUploadIntentsTable)
    .values({
      userId: user.id,
      companyId,
      inspectionId,
      clientKey: randomUUID(),
      mediaType: "photo",
      contentType: "image/jpeg",
      expectedSize: 123,
      objectPath,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning({ id: inspectionUploadIntentsTable.id });
  return intent.id;
}

afterAll(async () => {
  await db
    .delete(inspectionUploadIntentsTable)
    .where(eq(inspectionUploadIntentsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyBId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));
  // Tenant identities must survive with immutable lifecycle history. Setup
  // reuses these test tenants; only their mutable records are cleaned up.
});

beforeEach(() => {
  asUser(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Signature PATCH on a completed inspection", () => {
  it("records future lifecycle transitions once under retries and concurrent completes/reopens", async () => {
    asUser(TECH_ID);
    const key = randomUUID();
    const body = { siteAddress: "Private lifecycle site", technicianName: "Private name", clientKey: key };
    const created = await request(app).post("/api/inspections").send(body);
    expect(created.status).toBe(201);
    const id = created.body.id;
    const retry = await request(app).post("/api/inspections").send(body);
    expect(retry.body.id).toBe(id);
    const completions = await Promise.all([
      request(app).post(`/api/inspections/${id}/complete`),
      request(app).post(`/api/inspections/${id}/complete`),
    ]);
    expect(completions.every((response) => response.status === 200)).toBe(true);
    // Reopening is a manager operation; both callers observe the same new
    // state but only the winner records the transition.
    asUser(MGR_ID);
    const reopens = await Promise.all([
      request(app).post(`/api/inspections/${id}/reopen`),
      request(app).post(`/api/inspections/${id}/reopen`),
    ]);
    expect(reopens.every((response) => response.status === 200)).toBe(true);
    // The legacy PATCH state path must also record the actual new mutation.
    expect((await request(app).patch(`/api/inspections/${id}`).send({ status: "completed" })).status).toBe(200);
    expect((await request(app).patch(`/api/inspections/${id}`).send({ status: "completed" })).status).toBe(200);
    const events = await db.select().from(missionControlInspectionEventsTable)
      .where(and(eq(missionControlInspectionEventsTable.companyId, companyId),
        eq(missionControlInspectionEventsTable.inspectionId, id)));
    expect(events.filter((event) => event.eventType === "inspection.created")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "inspection.completed")).toHaveLength(2);
    expect(events.filter((event) => event.eventType === "inspection.reopened")).toHaveLength(1);
    expect(new Set(events.map((event) => event.idempotencyKey)).size).toBe(4);
    expect(events.every((event) => event.sourceRecordId === String(id) && event.origin === "newly_generated")).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/Private lifecycle|Private name/);
  });
  it("stores a unit number at creation, allows clearing it, and returns both states", async () => {
    asUser(TECH_ID);
    const create = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "101 Unit Test Way, Springfield",
        technicianName: "Jane Tech",
        unitNumber: "4B",
      });
    expect(create.status).toBe(201);
    const id = (create.body as { id: number }).id;
    expect(create.body.unitNumber).toBe("4B");

    const clear = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ unitNumber: null });
    expect(clear.status).toBe(200);
    expect(clear.body.unitNumber).toBeNull();

    const get = await request(app).get(`/api/inspections/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.unitNumber).toBeNull();
  });

  it("cascades a post-capture unit correction to existing media evidence", async () => {
    asUser(TECH_ID);
    const create = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "202 Evidence Trace Lane, Springfield",
        technicianName: "Jane Tech",
      });
    expect(create.status).toBe(201);
    const id = (create.body as { id: number }).id;

    const mediaUrl = `/api/storage/objects/companies/${companyId}/uploads/evidence-unit-correction.jpg`;
    const uploadIntentId = await createPhotoUploadIntent(id, mediaUrl);
    const media = await request(app)
      .post(`/api/inspections/${id}/media`)
      .send({
        mediaType: "photo",
        url: mediaUrl,
        uploadIntentId,
      });
    expect(media.status).toBe(201);
    expect(media.body.unitNumber).toBeNull();

    // This mirrors the signature-panel edit after photos have already synced.
    const correction = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ unitNumber: "7C" });
    expect(correction.status).toBe(200);
    expect(correction.body.unitNumber).toBe("7C");
    expect(correction.body.media[0].unitNumber).toBe("7C");

    const get = await request(app).get(`/api/inspections/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.media[0].unitNumber).toBe("7C");
  });

  it("stores technicianSignature, ownerSignature, ownerNotAvailable=false, signedAt and returns them on GET", async () => {
    const id = await createInspection();
    await completeInspection(id);

    const signedAt = new Date().toISOString();

    asUser(TECH_ID);
    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({
        technicianSignature: TECH_SVG,
        ownerSignature: OWNER_SVG,
        ownerNotAvailable: false,
        signedAt,
      });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/inspections/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.technicianSignature).toBe(TECH_SVG);
    expect(get.body.ownerSignature).toBe(OWNER_SVG);
    expect(get.body.ownerNotAvailable).toBe(false);
    expect(get.body.signedAt).toBeDefined();
  });

  it("allows a technician to update sensitive fields on their own inspection by direct ID", async () => {
    const id = await createInspection();
    const signedAt = new Date().toISOString();

    asUser(TECH_ID);
    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({
        status: "completed",
        completedAt: signedAt,
        technicianSignature: TECH_SVG,
        ownerSignature: OWNER_SVG,
        signedAt,
      });

    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("completed");
    expect(patch.body.technicianSignature).toBe(TECH_SVG);
    expect(patch.body.ownerSignature).toBe(OWNER_SVG);
  });

  it("denies a technician sensitive direct-ID edits to a peer inspection but retains notes access", async () => {
    asUser(MGR_ID);
    const create = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Peer Inspection Way, Springfield",
        technicianName: "Peer Tech",
        technicianId: PEER_TECH_ID,
      });
    expect(create.status).toBe(201);
    const peerId = create.body.id as number;

    asUser(TECH_ID);
    const forbidden = await request(app)
      .patch(`/api/inspections/${peerId}`)
      .send({
        status: "completed",
        completedAt: new Date().toISOString(),
        technicianSignature: TECH_SVG,
        ownerSignature: OWNER_SVG,
        signedAt: new Date().toISOString(),
      });
    expect(forbidden.status).toBe(403);

    const notes = await request(app)
      .patch(`/api/inspections/${peerId}`)
      .send({ notes: "Shared scheduling note" });
    expect(notes.status).toBe(200);
    expect(notes.body.notes).toBe("Shared scheduling note");

    const directGet = await request(app).get(`/api/inspections/${peerId}`);
    expect(directGet.status).toBe(200);
    expect(directGet.body.status).toBe("pending");
    expect(directGet.body.technicianSignature).toBeNull();
    expect(directGet.body.ownerSignature).toBeNull();
  });

  it("allows a same-company manager to edit another technician's sensitive fields by direct ID", async () => {
    asUser(MGR_ID);
    const create = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Manager Assigned Way, Springfield",
        technicianName: "Peer Tech",
        technicianId: PEER_TECH_ID,
      });
    expect(create.status).toBe(201);

    const patch = await request(app)
      .patch(`/api/inspections/${create.body.id}`)
      .send({
        status: "completed",
        technicianSignature: TECH_SVG,
        ownerSignature: OWNER_SVG,
        signedAt: new Date().toISOString(),
      });

    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("completed");
    expect(patch.body.technicianSignature).toBe(TECH_SVG);
    expect(patch.body.ownerSignature).toBe(OWNER_SVG);
  });

  it("denies a technician completing a peer inspection and permits manager completion", async () => {
    asUser(MGR_ID);
    const create = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Peer Completion Way, Springfield",
        technicianName: "Peer Tech",
        technicianId: PEER_TECH_ID,
      });
    expect(create.status).toBe(201);
    const peerId = create.body.id as number;

    asUser(TECH_ID);
    const denied = await request(app).post(`/api/inspections/${peerId}/complete`);
    expect(denied.status).toBe(403);
    const unchanged = await request(app).get(`/api/inspections/${peerId}`);
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.status).toBe("pending");
    expect(unchanged.body.completedAt).toBeNull();

    asUser(MGR_ID);
    const completed = await request(app).post(`/api/inspections/${peerId}/complete`);
    expect(completed.status).toBe(200);
    expect(completed.body.inspection.status).toBe("completed");
  });

  it("returns 404 for cross-company direct-ID complete and delete requests", async () => {
    const id = await createInspection();

    asUser(OTHER_ID);
    const complete = await request(app).post(`/api/inspections/${id}/complete`);
    const remove = await request(app).delete(`/api/inspections/${id}`);
    expect(complete.status).toBe(404);
    expect(remove.status).toBe(404);

    const stillExists = await request(app).get(`/api/inspections/${id}`);
    expect(stillExists.status).toBe(404);
  });

  it("protects peer evidence from technician deletion but permits manager and owner deletion", async () => {
    asUser(MGR_ID);
    const create = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Peer Deletion Way, Springfield",
        technicianName: "Peer Tech",
        technicianId: PEER_TECH_ID,
      });
    expect(create.status).toBe(201);
    const peerId = create.body.id as number;
    const mediaUrl = `/api/storage/objects/companies/${companyId}/uploads/evidence-peer-delete-${randomUUID()}.jpg`;
    const uploadIntentId = await createPhotoUploadIntent(peerId, mediaUrl);
    const media = await request(app)
      .post(`/api/inspections/${peerId}/media`)
      .send({ mediaType: "photo", url: mediaUrl, uploadIntentId });
    expect(media.status).toBe(201);

    asUser(TECH_ID);
    const denied = await request(app).delete(`/api/inspections/${peerId}`);
    expect(denied.status).toBe(403);
    const unchanged = await request(app).get(`/api/inspections/${peerId}`);
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.id).toBe(peerId);
    expect(unchanged.body.media).toHaveLength(1);

    asUser(MGR_ID);
    const managerDelete = await request(app).delete(`/api/inspections/${peerId}`);
    expect(managerDelete.status).toBe(204);
    const removed = await request(app).get(`/api/inspections/${peerId}`);
    expect(removed.status).toBe(404);

    asUser(OWNER_ID);
    const ownerCreated = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Owner Deletion Way, Springfield",
        technicianName: "Peer Tech",
        technicianId: PEER_TECH_ID,
      });
    expect(ownerCreated.status).toBe(201);
    const ownerDelete = await request(app).delete(`/api/inspections/${ownerCreated.body.id}`);
    expect(ownerDelete.status).toBe(204);

    const ownId = await createInspection();
    asUser(TECH_ID);
    const ownDelete = await request(app).delete(`/api/inspections/${ownId}`);
    expect(ownDelete.status).toBe(204);
  });

  it("binds technician creation to self and limits manager assignment to same-company technicians", async () => {
    asUser(TECH_ID);
    const forged = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Forged Owner Way, Springfield",
        technicianName: "Peer Tech",
        technicianId: PEER_TECH_ID,
      });
    expect(forged.status).toBe(403);

    asUser(MGR_ID);
    const otherCompanyAssignment = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "Foreign Owner Way, Springfield",
        technicianName: "Different Company Manager",
        technicianId: OTHER_ID,
      });
    expect(otherCompanyAssignment.status).toBe(400);
  });

  it("stores ownerNotAvailable=true and returns it on GET (customer refused)", async () => {
    const id = await createInspection();
    await completeInspection(id);

    asUser(TECH_ID);
    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({
        technicianSignature: TECH_SVG,
        ownerNotAvailable: true,
      });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/inspections/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.technicianSignature).toBe(TECH_SVG);
    expect(get.body.ownerNotAvailable).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    const id = await createInspection();
    await completeInspection(id);

    asUser(null);
    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ technicianSignature: TECH_SVG });
    expect(patch.status).toBe(401);
  });

  it("returns 404 when the inspection belongs to another company", async () => {
    const id = await createInspection();
    await completeInspection(id);

    asUser(OTHER_ID);
    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ technicianSignature: TECH_SVG });
    expect(patch.status).toBe(404);
  });

  it("returns 409 when caller tries to clear an existing ownerSignature without resignatureConsent", async () => {
    const id = await createInspection();
    await completeInspection(id);
    const signedAt = new Date().toISOString();

    // First: store a valid owner signature
    asUser(TECH_ID);
    await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ ownerSignature: OWNER_SVG, signedAt });

    // Then: try to clear it without consent
    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ ownerSignature: null });
    expect(patch.status).toBe(409);
  });

  it("allows clearing ownerSignature when resignatureConsent=true (re-sign flow)", async () => {
    const id = await createInspection();
    await completeInspection(id);
    const signedAt = new Date().toISOString();

    asUser(TECH_ID);
    await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ ownerSignature: OWNER_SVG, signedAt });

    const patch = await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ ownerSignature: null, resignatureConsent: true });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/inspections/${id}`);
    expect(get.body.ownerSignature).toBeNull();
  });

  it("GET /inspections list returns signedAt and ownerNotAvailable for completed inspection", async () => {
    const id = await createInspection();
    await completeInspection(id);
    const signedAt = new Date().toISOString();

    asUser(TECH_ID);
    await request(app)
      .patch(`/api/inspections/${id}`)
      .send({ technicianSignature: TECH_SVG, signedAt });

    const list = await request(app).get("/api/inspections");
    expect(list.status).toBe(200);
    const row = (list.body as Array<{ id: number; signedAt?: string | null }>)
      .find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row!.signedAt).toBeDefined();
  });
});
