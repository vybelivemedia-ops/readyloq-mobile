import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { authState, storageState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  storageState: {
    nextId: 0,
    objectPaths: [] as string[],
    uploaded: null as null | { companyId: number; objectPath: string; bytes: number },
  },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// Avoid hitting real object storage / GCS during tests.
vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class InspectionUploadConstraintError extends Error {}
  class InspectionUploadTimeoutError extends Error {}
  class ObjectStorageService {
    async getObjectEntityUploadURL() {
      return "https://signed.example.com/upload/test-object";
    }
    createInspectionUploadPath(companyId: number) {
      return `/objects/companies/${companyId}/uploads/intent-${++storageState.nextId}`;
    }
    async uploadInspectionStream(companyId: number, objectPath: string, input: AsyncIterable<Buffer>) {
      const chunks: Buffer[] = [];
      for await (const chunk of input) chunks.push(Buffer.from(chunk));
      storageState.uploaded = {
        companyId,
        objectPath,
        bytes: Buffer.concat(chunks).length,
      };
      return "created";
    }
    async listCompanyUploadObjects() {
      return { objectPaths: storageState.objectPaths, truncated: false };
    }
    normalizeObjectEntityPath(_url: string) {
      return "/objects/uploads/test-object";
    }
  }
  return {
    ObjectNotFoundError,
    InspectionUploadConstraintError,
    InspectionUploadTimeoutError,
    ObjectStorageService,
  };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  intelligenceRecordsTable,
  inspectionMediaTable,
  inspectionUploadIntentsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { migrateInspectionUploadIntents } from "../lib/migrate-inspection-upload-intents";

const TECH_ID = "test_storage_tech_clerk_id";
const PEER_TECH_ID = "test_storage_peer_tech_clerk_id";
const MANAGER_ID = "test_storage_manager_clerk_id";
let companyId: number;
let inspectionId: number;
let userId: number;

beforeAll(async () => {
  await migrateInspectionUploadIntents();
  // Only refresh this suite's identities; do not delete other suites' users.
  const [company] = await db
    .insert(companiesTable)
    .values({ name: "Storage Test Co", slug: `storage-test-${Date.now()}` })
    .returning();
  companyId = company.id;
  await db
    .insert(usersTable)
    .values([
      { clerkUserId: TECH_ID, role: "technician", companyId: company.id },
      { clerkUserId: PEER_TECH_ID, role: "technician", companyId: company.id },
      { clerkUserId: MANAGER_ID, role: "manager", companyId: company.id },
    ]).onConflictDoUpdate({
      target: usersTable.clerkUserId,
      set: { role: sql`excluded.role`, companyId: sql`excluded.company_id` },
    });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TECH_ID));
  userId = user.id;
  authState.userId = TECH_ID;
  const inspectionResponse = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: "Storage Test Site", technicianName: "Technician" });
  expect(inspectionResponse.status).toBe(201);
  inspectionId = inspectionResponse.body.id as number;
  authState.userId = null;
});

beforeEach(() => {
  authState.userId = null;
  storageState.uploaded = null;
});

describe("POST /api/storage/uploads/request-url", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  it("requires an upgraded inspection client before issuing any legacy generic PUT URL", async () => {
    authState.userId = TECH_ID;
    const signedCountBefore = storageState.nextId;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "legacy-photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(426);
    expect(res.headers.upgrade).toBe("inspection-upload-intents-v1");
    expect(res.body).toMatchObject({
      code: "inspection_upload_upgrade_required",
      minimumClientContract: "inspection-upload-intents-v1",
    });
    expect(res.body.uploadURL).toBeUndefined();
    expect(storageState.nextId).toBe(signedCountBefore);
  });

  it("returns a presigned URL and object path for an authenticated user", async () => {
    authState.userId = TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg", purpose: "generic" });
    expect(res.status).toBe(200);
    expect(res.body.uploadURL).toBe("https://signed.example.com/upload/test-object");
    expect(res.body.objectPath).toBe("/objects/uploads/test-object");
  });

  it("persists owner-, company-, and inspection-bound reservation metadata", async () => {
    authState.userId = TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
        clientKey: "local-photo-operation-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.uploadIntentId).toEqual(expect.any(Number));
    expect(res.body.uploadURL).toBe(
      `/api/storage/uploads/intents/${res.body.uploadIntentId}/content`,
    );
    expect(res.body.objectPath).toMatch(new RegExp(`/companies/${companyId}/uploads/`));
    const [intent] = await db
      .select()
      .from(inspectionUploadIntentsTable)
      .where(eq(inspectionUploadIntentsTable.id, res.body.uploadIntentId));
    expect(intent).toMatchObject({
      userId,
      companyId,
      inspectionId,
      clientKey: "local-photo-operation-1",
      mediaType: "image",
      contentType: "image/jpeg",
      expectedSize: 1024,
      checksumAlgorithm: null,
      checksumValue: null,
      state: "reserved",
      objectPath: res.body.objectPath,
    });
    expect(intent.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("denies a same-company peer technician an inspection upload reservation", async () => {
    authState.userId = PEER_TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "peer-photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
        clientKey: "peer-cannot-reserve-owner-inspection",
      });

    expect(res.status).toBe(403);
    const [intent] = await db
      .select()
      .from(inspectionUploadIntentsTable)
      .where(eq(inspectionUploadIntentsTable.clientKey, "peer-cannot-reserve-owner-inspection"));
    expect(intent).toBeUndefined();
  });

  it("accepts bounded inspection bytes only at the authenticated reservation endpoint", async () => {
    authState.userId = TECH_ID;
    const reservation = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
        clientKey: "streamed-photo-upload",
      });
    const put = await request(app)
      .put(reservation.body.uploadURL)
      .set("Content-Type", "image/jpeg")
      .set("x-goog-if-generation-match", "0")
      .send(Buffer.alloc(1024, 7));

    expect(put.status).toBe(204);
    expect(storageState.uploaded).toMatchObject({
      companyId,
      objectPath: reservation.body.objectPath,
      bytes: 1024,
    });
  });

  it("does not let another authenticated user write bytes to an owned reservation", async () => {
    authState.userId = TECH_ID;
    const reservation = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
        clientKey: "owner-bound-stream",
      });

    authState.userId = MANAGER_ID;
    const put = await request(app)
      .put(reservation.body.uploadURL)
      .set("Content-Type", "image/jpeg")
      .set("x-goog-if-generation-match", "0")
      .send(Buffer.alloc(1024, 7));

    expect(put.status).toBe(404);
    expect(storageState.uploaded).toBeNull();
  });

  it("returns the same reservation and object path for the same idempotency key", async () => {
    authState.userId = TECH_ID;
    const body = {
      name: "photo.jpg",
      size: 2048,
      contentType: "image/jpeg",
      purpose: "inspection-evidence",
      inspectionId,
      mediaType: "image",
      clientKey: "stable-retry-key",
    };
    const first = await request(app).post("/api/storage/uploads/request-url").send(body);
    const retry = await request(app).post("/api/storage/uploads/request-url").send(body);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.uploadIntentId).toBe(first.body.uploadIntentId);
    expect(retry.body.objectPath).toBe(first.body.objectPath);
  });

  it("persists an optional MD5 checksum in the signed reservation", async () => {
    authState.userId = TECH_ID;
    const checksum = { algorithm: "md5", value: "AAAAAAAAAAAAAAAAAAAAAA==" };
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
        clientKey: "checksum-reservation-key",
        checksum,
      });
    expect(res.status).toBe(200);
    const [intent] = await db
      .select()
      .from(inspectionUploadIntentsTable)
      .where(eq(inspectionUploadIntentsTable.id, res.body.uploadIntentId));
    expect(intent.checksumAlgorithm).toBe("md5");
    expect(intent.checksumValue).toBe(checksum.value);
  });

  it("rejects reuse of an idempotency key with different immutable metadata", async () => {
    authState.userId = TECH_ID;
    const base = {
      name: "photo.jpg",
      size: 2048,
      contentType: "image/jpeg",
      purpose: "inspection-evidence",
      inspectionId,
      mediaType: "image",
      clientKey: "mismatched-retry-key",
    };
    expect((await request(app).post("/api/storage/uploads/request-url").send(base)).status).toBe(200);
    const conflict = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ ...base, size: base.size + 1 });
    expect(conflict.status).toBe(409);
  });

  it("rejects an inspection not belonging to the authenticated company", async () => {
    authState.userId = TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId: inspectionId + 9_000_000,
        mediaType: "image",
        clientKey: "wrong-company-inspection",
      });
    expect(res.status).toBe(404);
  });

  it("rejects invalid media/content type pairs and missing client keys", async () => {
    authState.userId = TECH_ID;
    const wrongType = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "video/mp4",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
        clientKey: "invalid-media-type-key",
      });
    const missingKey = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        purpose: "inspection-evidence",
        inspectionId,
        mediaType: "image",
      });
    expect(wrongType.status).toBe(400);
    expect(missingKey.status).toBe(400);
  });

  it("returns a read-only, company-scoped orphan reconciliation report", async () => {
    await db.delete(inspectionUploadIntentsTable)
      .where(eq(inspectionUploadIntentsTable.companyId, companyId));
    const orphanPath = `/objects/companies/${companyId}/uploads/unregistered-object`;
    storageState.objectPaths = [orphanPath];
    await db.insert(inspectionUploadIntentsTable).values({
      userId,
      companyId,
      inspectionId: inspectionId + 9_000_001,
      clientKey: "expired-orphan-report",
      mediaType: "image",
      contentType: "image/jpeg",
      expectedSize: 128,
      objectPath: `/objects/companies/${companyId}/uploads/expired-without-object`,
      expiresAt: new Date(Date.now() - 60_000),
    });
    authState.userId = MANAGER_ID;
    const res = await request(app).get("/api/storage/uploads/reconciliation");
    expect(res.status).toBe(200);
    expect(res.body.destructiveCleanup).toBe(false);
    expect(res.body.findings.abandonedUpload).toHaveLength(1);
    expect(res.body.findings.intentWithoutObject).toHaveLength(1);
    expect(res.body.findings.inspectionDeleted).toHaveLength(1);
    expect(res.body.findings.objectWithoutCompletedRegistration).toEqual([
      expect.objectContaining({ objectPath: orphanPath, state: "no_intent" }),
    ]);
  });

  it("reconciles every intent and object beyond the first 500 entries", async () => {
    await db.delete(inspectionUploadIntentsTable)
      .where(eq(inspectionUploadIntentsTable.companyId, companyId));
    const intents = Array.from({ length: 501 }, (_, index) => ({
      userId,
      companyId,
      inspectionId,
      clientKey: `many-intents-${index}`,
      mediaType: "image",
      contentType: "image/jpeg",
      expectedSize: 128,
      objectPath: `/objects/companies/${companyId}/uploads/many-${index}`,
      state: "registered" as const,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    await db.insert(inspectionUploadIntentsTable).values(intents);
    const orphanPath = `/objects/companies/${companyId}/uploads/orphan-after-500`;
    storageState.objectPaths = [...intents.map((intent) => intent.objectPath), orphanPath];

    authState.userId = MANAGER_ID;
    const res = await request(app).get("/api/storage/uploads/reconciliation");

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.findings.intentWithoutObject).toHaveLength(0);
    expect(res.body.findings.objectWithoutCompletedRegistration).toEqual([
      expect.objectContaining({ objectPath: orphanPath, state: "no_intent" }),
    ]);
  });

  it("recognizes a crop-generated replacement referenced by registered media", async () => {
    await db.delete(inspectionUploadIntentsTable)
      .where(eq(inspectionUploadIntentsTable.companyId, companyId));
    const originalPath = `/objects/companies/${companyId}/uploads/original-photo`;
    const replacementPath = `/objects/companies/${companyId}/uploads/cropped-photo`;
    const [media] = await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId,
      mediaType: "image",
      url: replacementPath,
    }).returning();
    await db.insert(inspectionUploadIntentsTable).values({
      userId,
      companyId,
      inspectionId,
      clientKey: "crop-lineage-source",
      mediaType: "image",
      contentType: "image/jpeg",
      expectedSize: 128,
      objectPath: originalPath,
      state: "registered",
      registeredMediaId: media.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    storageState.objectPaths = [originalPath, replacementPath];

    authState.userId = MANAGER_ID;
    const res = await request(app).get("/api/storage/uploads/reconciliation");

    expect(res.status).toBe(200);
    expect(res.body.findings.objectWithoutCompletedRegistration).toHaveLength(0);
    expect(res.body.findings.generatedReplacement).toEqual([
      expect.objectContaining({
        objectPath: replacementPath,
        mediaIds: [media.id],
        sourceIntentId: expect.any(Number),
      }),
    ]);
  });

  it("returns 400 for an authenticated request with a missing name", async () => {
    authState.userId = TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ size: 1024 });
    expect(res.status).toBe(400);
  });
});
