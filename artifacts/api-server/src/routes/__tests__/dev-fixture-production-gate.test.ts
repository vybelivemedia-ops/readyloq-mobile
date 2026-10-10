import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Confirms POST /api/dev/claim-fixture-role — an intentionally unauthenticated
 * endpoint that links any Clerk user to the fixture company with any role —
 * can never be reached in a deployed environment.
 *
 * app.ts mounts only outside deployment mode with a configured secret.
 * Unmounted requests now fall through to Express 404, not the former
 * authentication catch-all's 401. Mounted requests additionally enforce
 * requireDevSecret on every request, including deployment changes after import.
 */

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => ({ userId: null }),
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

const ORIGINAL_REPLIT_DEPLOYMENT = process.env.REPLIT_DEPLOYMENT;
const ORIGINAL_DEV_FIXTURE_SECRET = process.env.DEV_FIXTURE_SECRET;

function restoreEnv() {
  if (ORIGINAL_REPLIT_DEPLOYMENT === undefined) {
    delete process.env.REPLIT_DEPLOYMENT;
  } else {
    process.env.REPLIT_DEPLOYMENT = ORIGINAL_REPLIT_DEPLOYMENT;
  }
  if (ORIGINAL_DEV_FIXTURE_SECRET === undefined) {
    delete process.env.DEV_FIXTURE_SECRET;
  } else {
    process.env.DEV_FIXTURE_SECRET = ORIGINAL_DEV_FIXTURE_SECRET;
  }
}

afterAll(restoreEnv);
afterEach(() => { restoreEnv(); vi.restoreAllMocks(); });

describe("dev fixture route — production gate", () => {
  it("is inaccessible without mutations when deployed, even with a valid secret + header", async () => {
    vi.resetModules();
    process.env.REPLIT_DEPLOYMENT = "1";
    process.env.DEV_FIXTURE_SECRET = "test-fixture-secret";

    const { default: app } = await import("../../app");
    const { db } = await import("@workspace/db");
    const insert = vi.spyOn(db, "insert");
    const update = vi.spyOn(db, "update");

    const res = await request(app)
      .post("/api/dev/claim-fixture-role")
      .set("x-dev-fixture-secret", "test-fixture-secret")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });

    expect(res.status).toBe(404);
    expect(res.type).toBe("text/html"); // Express's unmounted-route response.
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    restoreEnv();
  });

  it("stays inaccessible with a deployment identifier and a configured secret", async () => {
    vi.resetModules();
    // Replit sets REPLIT_DEPLOYMENT to a non-empty identifier in real deployments.
    process.env.REPLIT_DEPLOYMENT = "prod-deployment-id";
    process.env.DEV_FIXTURE_SECRET = "test-fixture-secret";

    const { default: app } = await import("../../app");

    const res = await request(app)
      .post("/api/dev/claim-fixture-role")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });

    expect(res.status).toBe(404);
    expect(res.type).toBe("text/html");
    restoreEnv();
  });

  it("mounts the router and enforces the per-request secret when REPLIT_DEPLOYMENT is absent", async () => {
    vi.resetModules();
    delete process.env.REPLIT_DEPLOYMENT;
    process.env.DEV_FIXTURE_SECRET = "test-fixture-secret";

    const { default: app } = await import("../../app");

    // Missing/incorrect secret still 404s (per-request guard inside the
    // mounted router), but the response is the route's own structured JSON —
    // proving the router IS mounted, unlike the production cases above.
    const noSecret = await request(app)
      .post("/api/dev/claim-fixture-role")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });
    expect(noSecret.status).toBe(404);
    expect(noSecret.body).toEqual({ error: "Not found" });

    const wrongSecret = await request(app)
      .post("/api/dev/claim-fixture-role")
      .set("x-dev-fixture-secret", "wrong-secret")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });
    expect(wrongSecret.status).toBe(404);
    expect(wrongSecret.body).toEqual({ error: "Not found" });

    // Correct secret gets past the guard entirely, proven by reaching body
    // validation logic (400 for a missing clerkUserId) instead of the 404
    // short-circuit.
    const validSecret = await request(app)
      .post("/api/dev/claim-fixture-role")
      .set("x-dev-fixture-secret", "test-fixture-secret")
      .send({});
    expect(validSecret.status).toBe(400);
    restoreEnv();
  });

  it("stays inaccessible when the secret is unset, even outside production", async () => {
    vi.resetModules();
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.DEV_FIXTURE_SECRET;

    const { default: app } = await import("../../app");

    const res = await request(app)
      .post("/api/dev/claim-fixture-role")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });

    expect(res.status).toBe(404);
    expect(res.type).toBe("text/html");
    restoreEnv();
  });
  it("blocks deployment mode enabled after app import, before body validation or mutations", async () => {
    vi.resetModules();
    delete process.env.REPLIT_DEPLOYMENT;
    process.env.DEV_FIXTURE_SECRET = "test-fixture-secret";
    const { default: app } = await import("../../app");
    process.env.REPLIT_DEPLOYMENT = "1";
    const { db } = await import("@workspace/db");
    const insert = vi.spyOn(db, "insert");
    const update = vi.spyOn(db, "update");
    const response = await request(app).post("/api/dev/claim-fixture-role")
      .set("x-dev-fixture-secret", "test-fixture-secret").send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
