import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { db, companiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const TECH_ID = "media_type_test_clerk_id";
let inspectionId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

beforeAll(async () => {
  const slug = "media-type-test-co";
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  const companyId = existing
    ? existing.id
    : (await db.insert(companiesTable).values({ name: "Media Type Test Co", slug }).returning())[0].id;

  await db.delete(usersTable).where(eq(usersTable.clerkUserId, TECH_ID));
  await db.insert(usersTable).values({ clerkUserId: TECH_ID, role: "technician", companyId });

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
});

// Unique URL helper prevents the idempotency guard from masking test isolation.
let urlSeq = 0;
function uniqueUrl(label: string) {
  return `https://storage.example.com/media/${label}-${++urlSeq}.jpg`;
}

describe("POST /inspections/:id/media — mediaType validation", () => {
  it('accepts mediaType "photo" (sent by the mobile sync engine)', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: uniqueUrl("photo") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("photo");
  });

  it('accepts mediaType "voice" (sent for audio field notes)', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "voice", url: uniqueUrl("voice") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("voice");
  });

  it('accepts mediaType "image"', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "image", url: uniqueUrl("image") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("image");
  });

  it('accepts mediaType "video"', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "video", url: uniqueUrl("video") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("video");
  });

  it('accepts mediaType "audio"', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "audio", url: uniqueUrl("audio") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("audio");
  });

  it('accepts mediaType "document"', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "document", url: uniqueUrl("document") });
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe("document");
  });

  it('rejects an invalid mediaType "pdf" with 400', async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "pdf", url: uniqueUrl("pdf") });
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
});
