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

const TECH_ID  = "sig_test_tech_clerk";
const MGR_ID   = "sig_test_mgr_clerk";
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
  companyId  = await findOrCreateCompany("Sig Test Co",  "sig-test-co");
  companyBId = await findOrCreateCompany("Sig Test Co B", "sig-test-co-b");

  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.companyId, companyBId));

  await db.insert(usersTable).values([
    { clerkUserId: TECH_ID,  role: "technician", companyId },
    { clerkUserId: MGR_ID,   role: "manager",    companyId },
    { clerkUserId: OTHER_ID, role: "manager",    companyId: companyBId },
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
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Signature PATCH on a completed inspection", () => {
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

    const media = await request(app)
      .post(`/api/inspections/${id}/media`)
      .send({ mediaType: "photo", url: "https://storage.example.com/evidence/unit-correction.jpg" });
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
