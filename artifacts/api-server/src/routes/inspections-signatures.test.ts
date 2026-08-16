import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Signature durability tests for PATCH /inspections/:id.
 *
 * Guards against the race window described in task #614:
 *   - The sync engine sends PATCH notes/pestTypes/signatures in step 5.
 *   - If the app hasn't fully flushed a freshly-captured signature to
 *     AsyncStorage yet, step 5 fires with `ownerSignature: undefined`.
 *   - The `!== undefined` guard in the route must ensure that an `undefined`
 *     (absent) value never overwrites a signature that the server already holds.
 *
 * Two invariants are pinned:
 *   1. PATCH with `ownerSignature` absent from the body leaves the DB value untouched.
 *   2. Signing after a partial sync (notes-only PATCH) cannot null-out a
 *      previously synced signature.
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

vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) {
      return url;
    }
    async getObjectEntityFile(_path: string) {
      return {} as never;
    }
    async downloadObject() {
      return new Response("file-bytes");
    }
  }
  return { ...actual, ObjectStorageService };
});

import app from "../app";
import { db, companiesTable, usersTable, inspectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const TECH_ID = "sig_tech_clerk_id";
let companyId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

async function createInspection(suffix: string): Promise<number> {
  asUser(TECH_ID);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: `${suffix} Signature St`, technicianName: "Tech" });
  expect(res.status).toBe(201);
  asUser(null);
  return res.body.id as number;
}

beforeAll(async () => {
  const slug = "sig-test-co";
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  companyId = existing
    ? existing.id
    : (await db.insert(companiesTable).values({ name: "Sig Test Co", slug }).returning())[0].id;

  await db.delete(usersTable).where(eq(usersTable.clerkUserId, TECH_ID));
  await db.insert(usersTable).values({ clerkUserId: TECH_ID, role: "technician", companyId });
});

beforeEach(() => {
  asUser(null);
});

describe("PATCH /inspections/:id — signature preservation", () => {
  it("leaves ownerSignature untouched when the key is absent from the PATCH body", async () => {
    const inspectionId = await createInspection("absent-key");
    const svgSignature = "<svg><path d='M 0 0 L 100 100'/></svg>";

    // First PATCH: sync the signature to the server.
    asUser(TECH_ID);
    const patch1 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: svgSignature, signedAt: new Date().toISOString() });
    expect(patch1.status).toBe(200);
    expect(patch1.body.ownerSignature).toBe(svgSignature);

    // Second PATCH: a notes-only update (ownerSignature key NOT present in body).
    // This simulates the sync engine step 5 firing while the app hasn't saved
    // the signature to AsyncStorage yet — the key is simply absent.
    const patch2 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ notes: "Updated field notes" });
    expect(patch2.status).toBe(200);

    // The server must not have overwritten the signature.
    expect(patch2.body.ownerSignature).toBe(svgSignature);

    // Confirm directly in the DB that the value was not nulled out.
    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    expect(row.ownerSignature).toBe(svgSignature);
  });

  it("leaves technicianSignature untouched when the key is absent from the PATCH body", async () => {
    const inspectionId = await createInspection("tech-sig-absent");
    const svgSignature = "<svg><path d='M 10 10 L 50 80'/></svg>";

    asUser(TECH_ID);
    // Sync technician signature.
    const patch1 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ technicianSignature: svgSignature, signedAt: new Date().toISOString() });
    expect(patch1.status).toBe(200);
    expect(patch1.body.technicianSignature).toBe(svgSignature);

    // Notes-only update — technicianSignature key absent.
    const patch2 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ notes: "Field update without signature" });
    expect(patch2.status).toBe(200);
    expect(patch2.body.technicianSignature).toBe(svgSignature);

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    expect(row.technicianSignature).toBe(svgSignature);
  });

  it("signing after a partial sync does not null-out a previously synced ownerSignature", async () => {
    // Scenario: the race window from task #614.
    //   T0 — technician signs on-device (SVG saved to AsyncStorage — eventually).
    //   T1 — sync engine runs step 5 with only notes/pestTypes (signature not yet
    //        available in the snapshot it read from AsyncStorage).
    //   T2 — sync engine runs step 5 again in the next pass with the full signature.
    //
    // After T1, the server must still hold the signature from T0 if it was
    // previously synced. After T2, it must hold the latest value.

    const inspectionId = await createInspection("race-window");
    const firstSig = "<svg><path d='M 5 5 L 95 95'/></svg>";
    const updatedSig = "<svg><path d='M 5 95 L 95 5'/></svg>";

    asUser(TECH_ID);

    // T0 — first full sync: notes + signature both present.
    const t0 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({
        notes: "Initial notes",
        pestTypes: ["ants"],
        ownerSignature: firstSig,
        signedAt: new Date().toISOString(),
      });
    expect(t0.status).toBe(200);
    expect(t0.body.ownerSignature).toBe(firstSig);

    // T1 — partial sync: the engine snapshot only contains notes (signature
    // not yet in its local copy). The key is absent — must NOT overwrite.
    const t1 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ notes: "Revised notes", pestTypes: ["ants", "roaches"] });
    expect(t1.status).toBe(200);
    // Signature must still be the one synced at T0.
    expect(t1.body.ownerSignature).toBe(firstSig);

    // T2 — next sync pass now has the updated signature in its snapshot.
    const t2 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: updatedSig });
    expect(t2.status).toBe(200);
    expect(t2.body.ownerSignature).toBe(updatedSig);

    // DB confirms the final state.
    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    expect(row.ownerSignature).toBe(updatedSig);
  });

  it("rejects an explicit null ownerSignature when the DB already has a non-null value (409)", async () => {
    // Task #626: guard against the re-sign race window where the app sends
    // ownerSignature: null between the user tapping "Re-sign" and the new SVG
    // being painted.  Without resignatureConsent: true the server must reject it.
    const inspectionId = await createInspection("explicit-null-guard");
    const svgSignature = "<svg><path d='M 0 50 L 100 50'/></svg>";

    asUser(TECH_ID);
    // First sync: store a valid signature.
    const patch1 = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: svgSignature });
    expect(patch1.status).toBe(200);
    expect(patch1.body.ownerSignature).toBe(svgSignature);

    // Accidental null (no consent flag) — must be rejected with 409.
    const wipe = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: null });
    expect(wipe.status).toBe(409);

    // DB value must be unchanged.
    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    expect(row.ownerSignature).toBe(svgSignature);
  });

  it("allows an explicit null ownerSignature when resignatureConsent: true is set", async () => {
    // The intentional re-sign flow: the UI clears the pad and explicitly
    // signals consent before the user draws the new signature.
    const inspectionId = await createInspection("explicit-null-consent");
    const svgSignature = "<svg><path d='M 0 50 L 100 50'/></svg>";

    asUser(TECH_ID);
    await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: svgSignature });

    // Explicit clear with consent — must succeed.
    const wipe = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: null, resignatureConsent: true });
    expect(wipe.status).toBe(200);
    expect(wipe.body.ownerSignature).toBeNull();

    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    expect(row.ownerSignature).toBeNull();
  });

  it("allows an explicit null ownerSignature when the DB value is already null (no existing sig to protect)", async () => {
    // No prior signature — null is safe to write through without consent.
    const inspectionId = await createInspection("null-on-unsigned");

    asUser(TECH_ID);
    const patch = await request(app)
      .patch(`/api/inspections/${inspectionId}`)
      .send({ ownerSignature: null });
    expect(patch.status).toBe(200);
    expect(patch.body.ownerSignature).toBeNull();
  });
});
