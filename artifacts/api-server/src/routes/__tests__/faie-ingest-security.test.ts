import express from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { db, companiesTable, usersTable, faieTrainingImagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const state = vi.hoisted(() => ({
  identities: {} as Record<string, string>,
  upload: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  // Only the Clerk token boundary is mocked. Real requireAuth loads actual
  // membership from the test database; no caller-controlled req.user shortcut.
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: state.identities[req.headers.authorization ?? ""] ?? null,
  }),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class { uploadObjectBuffer = state.upload; },
}));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("../../lib/error-events", () => ({ logErrorEvent: vi.fn(async () => {}) }));

import router from "../faie";
import { apiLimiter } from "../../lib/api-rate-limit";

const paths = ["/dataset/ingest", "/training/ingest-global", "/training/ingest-anonymized"];
const imageBytes = Buffer.from([255, 216, 255, 217]).toString("base64");
let companyA: number;
let companyB: number;
let server: Server;
let origin: string;
let clerkA: string;
let clerkB: string;
let userIds: number[] = [];

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const companies = await db.insert(companiesTable).values([
    { name: "FAIE security A", slug: `faie-a-${suffix}` },
    { name: "FAIE security B", slug: `faie-b-${suffix}` },
  ]).returning();
  [companyA, companyB] = companies.map((company) => company.id);
  clerkA = `faie-a-${suffix}`;
  clerkB = `faie-b-${suffix}`;
  const users = await db.insert(usersTable).values([
    { clerkUserId: clerkA, companyId: companyA, role: "technician", betaAccess: true, lastSeenAt: new Date() },
    { clerkUserId: clerkB, companyId: companyB, role: "technician", betaAccess: true, lastSeenAt: new Date() },
    { clerkUserId: `faie-unassigned-${suffix}`, role: "technician", lastSeenAt: new Date() },
    { clerkUserId: `faie-paused-${suffix}`, companyId: companyA, role: "technician", betaAccess: false, lastSeenAt: new Date() },
  ]).returning();
  userIds = users.map((user) => user.id);
  state.identities = {
    "Bearer tenant-a": clerkA, "Bearer tenant-b": clerkB,
    "Bearer unassigned": users[2].clerkUserId, "Bearer paused": users[3].clerkUserId,
  };
});
beforeEach(async () => {
  vi.clearAllMocks();
  apiLimiter.resetKey("127.0.0.1");
  state.upload.mockImplementation(async (companyId: number) =>
    `/objects/companies/${companyId}/uploads/faie-security-test`);
  const app = express();
  app.use("/v1/faie", apiLimiter, router);
  app.use("/api/v1/faie", apiLimiter, router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  origin = `http://127.0.0.1:${address.port}/v1/faie`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(faieTrainingImagesTable).where(inArray(faieTrainingImagesTable.companyId, [companyA, companyB]));
});
afterAll(async () => {
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyA, companyB]));
});
const post = (path: string, body: unknown = { imageBytes }, token?: string) => fetch(`${origin}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

describe("FAIE authenticated tenant ingestion", () => {
  it("mounts after Clerk, with the same normal API limiter and before the global parser", () => {
    const source = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");
    const mount = source.indexOf('app.use("/v1/faie", apiLimiter, faieRouter)');
    expect(mount).toBeGreaterThan(source.indexOf("clerkMiddleware((req)"));
    expect(mount).toBeLessThan(source.indexOf("app.use(express.json())"));
    expect(source).toContain('app.use("/api", apiLimiter, glassesLimiter, router)');
    expect(source.indexOf('app.use("/api/v1/faie", apiLimiter, faieRouter)'))
      .toBeLessThan(source.indexOf("app.use(express.json())"));
  });
  it("protects the artifact-routed alias with the same auth and tenant checks", async () => {
    const url = origin.replace("/v1/faie", "/api/v1/faie");
    const send = (body: object, token?: string) => fetch(`${url}${paths[0]}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    expect((await send({ imageBytes })).status).toBe(401);
    expect((await send({ imageBytes, companyId: companyB }, "tenant-a")).status).toBe(403);
    expect((await send({ imageBytes }, "tenant-a")).status).toBe(200);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.upload.mock.calls[0][0]).toBe(companyA);
  });

  it.each(paths)("rejects anonymous and invalid tokens before any write: %s", async (path) => {
    expect((await post(path)).status).toBe(401);
    expect((await post(path, { imageBytes }, "invalid")).status).toBe(401);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it.each(paths)("rejects cross-tenant claims instead of trusting or silently dropping them: %s", async (path) => {
    expect((await post(path, { imageBytes, companyId: companyB }, "tenant-a")).status).toBe(403);
    expect((await post(`${path}?companyId=${companyB}`, { imageBytes }, "tenant-a")).status).toBe(403);
    expect((await post(path, { imageBytes, companyId: 0 }, "tenant-a")).status).toBe(403);
    expect(state.upload).not.toHaveBeenCalled();
    expect(await db.select().from(faieTrainingImagesTable)
      .where(inArray(faieTrainingImagesTable.companyId, [companyA, companyB]))).toHaveLength(0);
  });
  it.each(paths)("derives membership and stores legitimate same-tenant records: %s", async (path) => {
    expect((await post(path, { imageBytes }, "tenant-a")).status).toBe(200);
    expect((await post(path, { imageBytes, companyId: String(companyB) }, "tenant-b")).status).toBe(200);
    expect(state.upload.mock.calls.map(([companyId]) => companyId)).toEqual([companyA, companyB]);
    const records = await db.select().from(faieTrainingImagesTable)
      .where(inArray(faieTrainingImagesTable.companyId, [companyA, companyB]));
    expect(records.map((record) => record.companyId).sort()).toEqual([companyA, companyB].sort());
    expect(records.every((record) => record.imageUrl.includes(`/companies/${record.companyId}/`))).toBe(true);
    if (path.includes("global")) {
      expect(records.find((record) => record.companyId === companyA)?.technicianId).toBe(clerkA);
      expect(records.find((record) => record.companyId === companyB)?.technicianId).toBe(clerkB);
    }
  });
  it("rejects an authenticated account without company membership or beta access", async () => {
    expect((await post(paths[0], { imageBytes }, "unassigned")).status).toBe(403);
    expect((await post(paths[0], { imageBytes }, "paused")).status).toBe(403);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("rejects forged technician attribution", async () => {
    expect((await post(paths[1], { imageBytes, technicianId: clerkB }, "tenant-a")).status).toBe(403);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("rejects malformed base64 and metadata without consuming an upload slot permanently", async () => {
    expect((await post(paths[0], { imageBytes: "!bad" }, "tenant-a")).status).toBe(400);
    expect((await post(paths[0], { imageBytes, label: "x".repeat(257) }, "tenant-a")).status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
    expect((await post(paths[0], { imageBytes }, "tenant-a")).status).toBe(200);
  });
  it("accepts normal image bodies larger than the global 100 KB limit", async () => {
    const bytes = Buffer.alloc(128_000, 1).toString("base64");
    expect((await post(paths[1], { imageBytes: bytes }, "tenant-a")).status).toBe(200);
  });
  it("does not parse oversized anonymous payloads before authentication", async () => {
    expect((await post(paths[0], { imageBytes: "A".repeat(21 * 1024 * 1024) })).status).toBe(401);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("rejects authenticated bodies exceeding the image and JSON limits", async () => {
    expect((await post(paths[0], { imageBytes: "A".repeat(Math.ceil(14 * 1024 * 1024 / 3) * 4 + 4) }, "tenant-a")).status).toBe(400);
    expect((await post(paths[0], { imageBytes: "A".repeat(21 * 1024 * 1024) }, "tenant-a")).status).toBe(413);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("bounds same-tenant concurrent work and releases permits after completion", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    state.upload.mockImplementation(async (companyId: number) => {
      await hold; return `/objects/companies/${companyId}/uploads/held`;
    });
    const pending = [post(paths[0], { imageBytes }, "tenant-a"), post(paths[1], { imageBytes }, "tenant-a")];
    await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(2));
    try {
      expect((await post(paths[2], { imageBytes }, "tenant-a")).status).toBe(429);
    } finally {
      release();
      expect((await Promise.all(pending)).map((response) => response.status)).toEqual([200, 200]);
    }
    expect((await post(paths[2], { imageBytes }, "tenant-a")).status).toBe(200);
  });
  it("cleans up concurrency permits after storage errors", async () => {
    state.upload.mockRejectedValueOnce(new Error("test storage failure"));
    expect((await post(paths[0], { imageBytes }, "tenant-a")).status).toBe(500);
    expect((await post(paths[0], { imageBytes }, "tenant-a")).status).toBe(200);
  });
  it("applies the normal IP rate limit even to anonymous traffic", async () => {
    for (let i = 0; i < 500; i++) expect((await post(paths[0])).status).toBe(401);
    const limited = await post(paths[0]);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("ratelimit-limit")).toBe("500");
    expect(state.upload).not.toHaveBeenCalled();
  }, 15_000);
});
