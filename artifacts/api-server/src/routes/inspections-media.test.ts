import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";

/**
 * mediaType validation tests for POST /inspections/:id/media.
 *
 * Guards against silent rejection of the mediaType values that the sync engine
 * actually sends.  Before task #621 the route only accepted
 * ["image","video","document","audio"] — rejecting "photo" and "voice" with 400
 * while the sync engine retried indefinitely with no user-visible error.
 *
 * Invariants pinned:
 *   1. "photo" (sent by the mobile sync engine) is accepted.
 *   2. "voice" (sent for audio notes) is accepted.
 *   3. All other documented valid types are accepted.
 *   4. A genuinely invalid type (e.g. "pdf") is rejected with 400.
 */

const { authState, objectStorageState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  objectStorageState: {
    missingPaths: new Set<string>(),
    stalledPaths: new Set<string>(),
    existingPaths: new Set<string>(),
    metadataByPath: new Map<string, { size: number; contentType: string; md5Hash: string | null }>(),
    requireExplicitExistence: false,
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

vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) {
      return url;
    }
    async getObjectEntityFile(path: string) {
      if (objectStorageState.stalledPaths.has(path)) {
        return new Promise<never>(() => {});
      }
      if (
        objectStorageState.missingPaths.has(path) ||
        (objectStorageState.requireExplicitExistence && !objectStorageState.existingPaths.has(path))
      ) {
        throw new actual.ObjectNotFoundError();
      }
      return {} as never;
    }
    async getObjectEntityMetadata(path: string) {
      if (objectStorageState.stalledPaths.has(path)) {
        return new Promise<never>(() => {});
      }
      if (
        objectStorageState.missingPaths.has(path) ||
        (objectStorageState.requireExplicitExistence && !objectStorageState.existingPaths.has(path))
      ) {
        throw new actual.ObjectNotFoundError();
      }
      return objectStorageState.metadataByPath.get(path) ?? {
        size: 123,
        contentType: "image/jpeg",
        md5Hash: null,
      };
    }
    async downloadObject() {
      return new Response("file-bytes");
    }
  }
  return { ...actual, ObjectStorageService };
});

import app from "../app";
import {
  db,
  companiesTable,
  usersTable,
  inspectionsTable,
  inspectionMediaTable,
  inspectionUploadIntentsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { migrateInspectionUploadIntents } from "../lib/migrate-inspection-upload-intents";

const TECH_ID = "media_type_test_clerk_id";
const OTHER_TECH_ID = "media_type_other_tech_clerk_id";
const SAME_COMPANY_OTHER_TECH_ID = "media_type_same_company_other_tech_clerk_id";
let inspectionId: number;
let companyId: number;
let otherCompanyId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

beforeAll(async () => {
  await migrateInspectionUploadIntents();
  const slug = "media-type-test-co";
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  companyId = existing
    ? existing.id
    : (await db.insert(companiesTable).values({ name: "Media Type Test Co", slug }).returning())[0].id;

  const otherSlug = "media-type-outsider-co";
  const [existingOther] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, otherSlug));
  otherCompanyId = existingOther
    ? existingOther.id
    : (await db.insert(companiesTable).values({ name: "Media Type Outsider Co", slug: otherSlug }).returning())[0].id;
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, TECH_ID));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OTHER_TECH_ID));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, SAME_COMPANY_OTHER_TECH_ID));
  await db.insert(usersTable).values({ clerkUserId: TECH_ID, role: "technician", companyId });
  await db.insert(usersTable).values({
    clerkUserId: SAME_COMPANY_OTHER_TECH_ID,
    role: "technician",
    companyId,
  });
  await db.insert(usersTable).values({
    clerkUserId: OTHER_TECH_ID,
    role: "technician",
    companyId: otherCompanyId,
  });

  // Create one inspection shared across the mediaType tests.
  asUser(TECH_ID);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: "1 Media Type Ave", technicianName: "Tech" });
  expect(res.status).toBe(201);
  inspectionId = res.body.id as number;
  asUser(null);
});

beforeEach(() => {
  asUser(null);
  objectStorageState.missingPaths.clear();
  objectStorageState.stalledPaths.clear();
  objectStorageState.existingPaths.clear();
  objectStorageState.metadataByPath.clear();
  objectStorageState.requireExplicitExistence = false;
});

// Unique URL helper prevents the idempotency guard from masking test isolation.
let urlSeq = 0;
function uniqueUrl(label: string) {
  return `/api/storage/objects/companies/${companyId}/uploads/${label}-${++urlSeq}-${randomUUID()}.jpg`;
}

async function createUploadIntent(
  parentInspectionId: number,
  mediaType: string,
  url: string,
  options: {
    expiresAt?: Date;
    expectedSize?: number;
    checksum?: { algorithm: "md5"; value: string };
  } = {},
) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, authState.userId!));
  const [inspection] = await db.select().from(inspectionsTable)
    .where(eq(inspectionsTable.id, parentInspectionId));
  if (!user || !inspection) throw new Error("test upload intent requires an authenticated inspection owner");
  const objectPath = url.replace(/^\/api\/storage/, "");
  const contentType = mediaType === "video"
    ? "video/webm"
    : mediaType === "audio" || mediaType === "voice"
      ? "audio/aac"
      : mediaType === "document"
        ? "application/pdf"
        : "image/jpeg";
  const expectedSize = options.expectedSize ?? 123;
  const [intent] = await db.insert(inspectionUploadIntentsTable).values({
    userId: user.id,
    companyId: inspection.companyId,
    inspectionId: parentInspectionId,
    clientKey: randomUUID(),
    mediaType,
    contentType,
    expectedSize,
    checksumAlgorithm: options.checksum?.algorithm ?? null,
    checksumValue: options.checksum?.value ?? null,
    objectPath,
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
  }).returning();
  objectStorageState.metadataByPath.set(objectPath, {
    size: expectedSize,
    contentType,
    md5Hash: options.checksum?.value ?? null,
  });
  return intent;
}

async function postMedia(
  targetInspectionId: number,
  body: Record<string, unknown>,
  reservationInspectionId = targetInspectionId,
) {
  const intent = await createUploadIntent(
    reservationInspectionId,
    String(body.mediaType ?? "photo"),
    String(body.url),
  );
  return request(app)
    .post(`/api/inspections/${targetInspectionId}/media`)
    .send({ ...body, uploadIntentId: intent.id });
}

describe("POST /inspections/:id/media — mediaType validation", () => {
  it('accepts mediaType "photo" (sent by the mobile sync engine)', async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, { mediaType: "photo", url: uniqueUrl("photo") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("photo");
  });

  it('accepts mediaType "voice" (sent for audio field notes)', async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, { mediaType: "voice", url: uniqueUrl("voice") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("voice");
  });

  it('accepts mediaType "image"', async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, { mediaType: "image", url: uniqueUrl("image") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("image");
  });

  it("persists an explicit unit number with the media row", async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, {
      mediaType: "image",
      url: uniqueUrl("unit"),
      unitNumber: "4B",
    });
    expect(res.status).toBe(201);
    expect(res.body.unitNumber).toBe("4B");
  });

  it('accepts mediaType "video"', async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, { mediaType: "video", url: uniqueUrl("video") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("video");
  });

  it('accepts mediaType "audio"', async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, { mediaType: "audio", url: uniqueUrl("audio") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("audio");
  });

  it('accepts mediaType "document"', async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, {
      mediaType: "document",
      url: uniqueUrl("document"),
    });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("document");
  });

  it('rejects an invalid mediaType "pdf" with 400', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "pdf", url: uniqueUrl("pdf"), uploadIntentId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid mediaType/i);
  });

  it("rejects a missing mediaType with 400", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ url: uniqueUrl("no-type") });
    expect(res.status).toBe(400);
  });

  it("rejects a missing url with 400", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo" });
    expect(res.status).toBe(400);
  });

  it("does not register inspection evidence without a durable upload intent", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: uniqueUrl("without-intent") });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uploadIntentId/i);
  });

  it("persists capturedAt separately from the server-generated createdAt", async () => {
    asUser(TECH_ID);
    const capturedAt = "2020-01-02T03:04:05.000Z";
    const res = await postMedia(inspectionId, {
      mediaType: "photo",
      url: uniqueUrl("captured-at"),
      capturedAt,
    });

    expect(res.status).toBe(201);
    expect(res.body.capturedAt).toBe(capturedAt);
    expect(res.body.createdAt).toMatch(/Z$/);
    expect(res.body.createdAt).not.toBe(capturedAt);
    expect(new Date(res.body.createdAt).getTime()).toBeGreaterThan(new Date(capturedAt).getTime());

    const [stored] = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.id, res.body.id));
    expect(stored.capturedAt?.toISOString()).toBe(capturedAt);

    const detail = await request(app).get(`/api/inspections/${inspectionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.media.find((m: { id: number }) => m.id === res.body.id)).toMatchObject({
      capturedAt,
      createdAt: res.body.createdAt,
    });
  });

  it("keeps capturedAt nullable for legacy media registrations", async () => {
    asUser(TECH_ID);
    const res = await postMedia(inspectionId, {
      mediaType: "photo",
      url: uniqueUrl("legacy-no-captured-at"),
    });

    expect(res.status).toBe(201);
    expect(res.body.capturedAt).toBeNull();
    expect(res.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(new Date(res.body.createdAt).getTime())).toBe(false);

    const [stored] = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.id, res.body.id));
    expect(stored.capturedAt).toBeNull();
    expect(stored.createdAt.toISOString()).toBe(res.body.createdAt);
  });

  it("rejects an invalid capturedAt before registering media", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("invalid-captured-at");
    const before = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.inspectionId, inspectionId));
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, capturedAt: "not-a-timestamp", uploadIntentId: intent.id });

    expect(res.status).toBe(400);
    const after = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.inspectionId, inspectionId));
    expect(after).toHaveLength(before.length);
  });

  it("returns the original capturedAt and createdAt for duplicate registration", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("duplicate-captured-at");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const first = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({
        mediaType: "photo",
        url,
        capturedAt: "2021-02-03T04:05:06.000Z",
        uploadIntentId: intent.id,
      });
    const duplicate = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({
        mediaType: "photo",
        url,
        capturedAt: "2022-03-04T05:06:07.000Z",
        uploadIntentId: intent.id,
      });
    const normalizedAlias = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({
        mediaType: "photo",
        url: url.replace("/api/storage", ""),
        uploadIntentId: intent.id,
      });

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(200);
    expect(normalizedAlias.status).toBe(200);
    expect(duplicate.body.id).toBe(first.body.id);
    expect(normalizedAlias.body.id).toBe(first.body.id);
    const milestones = await db.select().from(missionControlInspectionEventsTable)
      .where(and(eq(missionControlInspectionEventsTable.inspectionId, inspectionId),
        eq(missionControlInspectionEventsTable.sourceRecordType, "inspection_media"),
        eq(missionControlInspectionEventsTable.sourceRecordId, String(first.body.id))));
    expect(milestones.map((event) => event.eventType).sort())
      .toEqual(["evidence.captured", "evidence.registered"]);
    expect(milestones.find((event) => event.eventType === "evidence.captured")!.occurredAt!.toISOString())
      .toBe(first.body.capturedAt);
    expect(duplicate.body.capturedAt).toBe(first.body.capturedAt);
    expect(duplicate.body.createdAt).toBe(first.body.createdAt);
  });

  it("replays registered intent provenance when a retry supplies a cropped replacement URL", async () => {
    asUser(TECH_ID);
    const originalUrl = uniqueUrl("registered-original");
    const croppedRetryUrl = uniqueUrl("registered-cropped-retry");
    const intent = await createUploadIntent(inspectionId, "photo", originalUrl);
    const first = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: originalUrl, uploadIntentId: intent.id });
    expect(first.status).toBe(201);

    const croppedObjectPath = croppedRetryUrl.replace("/api/storage", "");
    objectStorageState.missingPaths.add(croppedObjectPath);
    const retry = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: croppedRetryUrl, uploadIntentId: intent.id });

    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.url).toBe(originalUrl.replace("/api/storage", ""));
    expect(objectStorageState.metadataByPath.has(croppedObjectPath)).toBe(false);
  });

  it("rejects a media path belonging to another company", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({
        mediaType: "photo",
        url: `/api/storage/objects/companies/${otherCompanyId}/uploads/foreign-photo`,
        uploadIntentId: 1,
      });

    expect(res.status).toBe(404);
  });

  it("does not let a valid company upload URL register against another company's inspection", async () => {
    asUser(OTHER_TECH_ID);
    const otherInspection = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "2 Media Type Ave", technicianName: "Other Tech" });
    expect(otherInspection.status).toBe(201);
    const otherInspectionId = otherInspection.body.id as number;
    const [before] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, otherInspectionId));
    const mediaBefore = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.inspectionId, otherInspectionId));

    // Model a known-present Company A upload, as if Company A's caller holds
    // its valid signed upload URL. It cannot be attached to Company B's parent.
    const signedObjectPath = uniqueUrl("valid-signed-upload").replace("/api/storage", "");
    objectStorageState.requireExplicitExistence = true;
    objectStorageState.existingPaths.add(signedObjectPath);
    asUser(TECH_ID);
    const res = await postMedia(otherInspectionId, {
        mediaType: "photo",
        url: `/api/storage${signedObjectPath}`,
      }, inspectionId);

    expect(res.status).toBe(404);
    expect(objectStorageState.existingPaths.has(signedObjectPath)).toBe(true);
    const [after] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, otherInspectionId));
    const mediaAfter = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.inspectionId, otherInspectionId));
    expect(after.mediaCount).toBe(before.mediaCount);
    expect(mediaAfter).toEqual(mediaBefore);
  });

  it("rejects foreign URL claims on registered replay while preserving same-tenant crop retries", async () => {
    asUser(TECH_ID);
    const url = `/api/storage/objects/companies/${companyId}/uploads/retry-boundary-${randomUUID()}.jpg`;
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const send = (candidate: string) => request(app).post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: candidate, uploadIntentId: intent.id });
    const registered = await send(url);
    expect(registered.status).toBe(201);
    const correctRetry = await send(url);
    expect(correctRetry.status).toBe(200);
    expect(correctRetry.body.id).toBe(registered.body.id);
    expect((await send(`/api/storage/objects/companies/${otherCompanyId}/uploads/foreign.jpg`)).status).toBe(400);
    const cropRetry = await send(`/api/storage/objects/companies/${companyId}/uploads/different.jpg`);
    expect(cropRetry.status).toBe(200);
    expect(cropRetry.body.id).toBe(registered.body.id);
    expect(cropRetry.body.url).toBe(registered.body.url);
    const [unchanged] = await db.select().from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.id, registered.body.id));
    expect(unchanged.url).toBe(intent.objectPath);
    expect(unchanged.companyId).toBe(companyId);
  });

  it("rejects a same-company path whose object does not exist without creating evidence", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("missing-object");
    const objectPath = url.replace("/api/storage", "");
    objectStorageState.missingPaths.add(objectPath);

    const res = await postMedia(inspectionId, { mediaType: "photo", url });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unable to register media");
    const phantomRows = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.url, objectPath));
    expect(phantomRows).toHaveLength(0);
  });

  it("bounds stalled object verification and does not insert evidence", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("stalled-object-check");
    const objectPath = url.replace("/api/storage", "");
    objectStorageState.stalledPaths.add(objectPath);

    const res = await postMedia(inspectionId, { mediaType: "photo", url });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Media storage verification unavailable");
    const phantomRows = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.url, objectPath));
    expect(phantomRows).toHaveLength(0);
  });

  it("returns an existing evidence row on retry even if its object is now missing", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("object-later-missing");
    const objectPath = url.replace("/api/storage", "");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const first = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(first.status).toBe(201);

    objectStorageState.missingPaths.add(objectPath);
    const retry = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });

    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
  });

  it("filters nested location data from captureMetadata but keeps source and calibration fields", async () => {
    asUser(TECH_ID);
    const safeCaptureMetadata = {
      source: "native_camera",
      calibration: { profile: "room-scale-v2", focalLengthMm: 4.2 },
      laserMeasurement: {
        kind: "distance",
        value: 42.5,
        unit: "cm",
        metadata: {
          method: "burst_reference",
          heightInches: 18,
          coordinates: { latitude: 37.4, longitude: -122.08 },
        },
      },
      gpsLatitude: 37.4,
      deviceLocation: { altitude: 12, locationName: "Warehouse A" },
      nested: [{ keep: "measurement", geotag: "private" }],
    };
    const expectedCaptureMetadata = {
      source: "native_camera",
      calibration: { profile: "room-scale-v2", focalLengthMm: 4.2 },
      laserMeasurement: {
        kind: "distance",
        value: 42.5,
        unit: "cm",
        metadata: { method: "burst_reference", heightInches: 18 },
      },
      nested: [{ keep: "measurement" }],
    };
    const res = await postMedia(inspectionId, {
        mediaType: "photo",
        url: uniqueUrl("filtered-capture-metadata"),
        captureMetadata: safeCaptureMetadata,
      });

    expect(res.status).toBe(201);
    expect(res.body.captureMetadata).toEqual(expectedCaptureMetadata);
    expect(JSON.stringify(res.body.captureMetadata)).not.toMatch(
      /gps|latitude|longitude|altitude|coordinates|location|geotag/i,
    );
    const [stored] = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.id, res.body.id));
    expect(stored.captureMetadata).toEqual(expectedCaptureMetadata);
  });

  it("serializes concurrent duplicate registrations into one media row", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("concurrent-retry");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const [first, retry] = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/inspections/${inspectionId}/media`)
          .send({ mediaType: "photo", url, uploadIntentId: intent.id }),
      ),
    );

    expect([first.status, retry.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBe(retry.body.id);
    const matchingRows = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.url, url.replace("/api/storage", "")));
    expect(matchingRows).toHaveLength(1);
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.id, inspectionId));
    expect(inspection.mediaCount).toBeGreaterThan(0);
  });

  it("denies a peer technician before looking up another user's reservation", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("wrong-user");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    asUser(SAME_COMPANY_OTHER_TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(res.status).toBe(403);
  });

  it("denies a same-company peer technician registration on another technician's inspection", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("peer-owner-check");
    const intent = await createUploadIntent(inspectionId, "photo", url);

    asUser(SAME_COMPANY_OTHER_TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });

    expect(res.status).toBe(403);
  });

  it("does not let an intent be replayed against another inspection", async () => {
    asUser(TECH_ID);
    const otherInspection = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "3 Media Type Ave", technicianName: "Tech" });
    expect(otherInspection.status).toBe(201);
    const url = uniqueUrl("wrong-inspection");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const res = await request(app)
      .post(`/api/inspections/${otherInspection.body.id}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(res.status).toBe(404);
  });

  it("rejects media type mismatches against the reservation", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("wrong-media-type");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "image", url, uploadIntentId: intent.id });
    expect(res.status).toBe(404);
  });

  it("rejects expired upload reservations", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("expired");
    const intent = await createUploadIntent(inspectionId, "photo", url, {
      expiresAt: new Date(Date.now() - 1_000),
    });
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("rejects object sizes that differ from the reservation", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("wrong-size");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    objectStorageState.metadataByPath.set(intent.objectPath, {
      size: intent.expectedSize + 1,
      contentType: intent.contentType,
      md5Hash: null,
    });
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/size/i);
  });

  it("rejects object content types that differ from the reservation", async () => {
    asUser(TECH_ID);
    const url = uniqueUrl("wrong-content-type");
    const intent = await createUploadIntent(inspectionId, "photo", url);
    objectStorageState.metadataByPath.set(intent.objectPath, {
      size: intent.expectedSize,
      contentType: "image/png",
      md5Hash: null,
    });
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it("rejects an object whose MD5 checksum differs from the reservation", async () => {
    asUser(TECH_ID);
    const expected = "AAAAAAAAAAAAAAAAAAAAAA==";
    const url = uniqueUrl("wrong-checksum");
    const intent = await createUploadIntent(inspectionId, "photo", url, {
      checksum: { algorithm: "md5", value: expected },
    });
    objectStorageState.metadataByPath.set(intent.objectPath, {
      size: intent.expectedSize,
      contentType: intent.contentType,
      md5Hash: "BBBBBBBBBBBBBBBBBBBBBB==",
    });
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url, uploadIntentId: intent.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/checksum/i);
  });
});
