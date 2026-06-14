import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// Avoid hitting real object storage / GCS during tests.
vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityUploadURL() {
      return "https://signed.example.com/upload/test-object";
    }
    normalizeObjectEntityPath(_url: string) {
      return "/objects/uploads/test-object";
    }
  }
  return { ObjectNotFoundError, ObjectStorageService };
});

import app from "../app";
import { db, usersTable } from "@workspace/db";

const TECH_ID = "test_storage_tech_clerk_id";

beforeAll(async () => {
  await db.delete(usersTable);
  await db.insert(usersTable).values([{ clerkUserId: TECH_ID, role: "technician" }]);
});

beforeEach(() => {
  authState.userId = null;
});

describe("POST /api/storage/uploads/request-url", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  it("returns a presigned URL and object path for an authenticated user", async () => {
    authState.userId = TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.uploadURL).toBe("https://signed.example.com/upload/test-object");
    expect(res.body.objectPath).toBe("/objects/uploads/test-object");
  });

  it("returns 400 for an authenticated request with a missing name", async () => {
    authState.userId = TECH_ID;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ size: 1024 });
    expect(res.status).toBe(400);
  });
});
