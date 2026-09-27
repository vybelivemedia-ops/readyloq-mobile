import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Confirms POST /api/dev/claim-fixture-role — an intentionally unauthenticated
 * endpoint that links any Clerk user to the fixture company with any role —
 * can never be reached in a deployed environment.
 *
 * The mount-time gate in app.ts is `!REPLIT_DEPLOYMENT && DEV_FIXTURE_SECRET`.
 * REPLIT_DEPLOYMENT (not NODE_ENV) is the environment signal: Replit sets it
 * automatically in every deployed build, whereas the local dev workflow never
 * sets NODE_ENV, which would make a NODE_ENV-based check always pass. Each
 * test re-imports app.ts after mutating process.env so the module-level `if`
 * gate re-evaluates against the scenario under test.
 *
 * When the dev router isn't mounted, Express falls through to the main /api
 * router's final catch-all (`router.use(requireAuth, transcribeRouter)`,
 * registered with no path prefix in routes/index.ts), so an unauthenticated
 * request to /api/dev/claim-fixture-role gets 401 from requireAuth rather
 * than a plain 404 — it never reaches a route that could act on the body.
 * That is distinct from the *mounted* router's own guard, which returns a
 * deliberate 404 so the endpoint is indistinguishable from a nonexistent
 * route (see requireDevSecret in routes/dev.ts).
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

describe("dev fixture route — production gate", () => {
  it("is completely unmounted when REPLIT_DEPLOYMENT is set, even with a valid secret + header", async () => {
    vi.resetModules();
    process.env.REPLIT_DEPLOYMENT = "1";
    process.env.DEV_FIXTURE_SECRET = "test-fixture-secret";

    const { default: app } = await import("../../app");

    const res = await request(app)
      .post("/api/dev/claim-fixture-role")
      .set("x-dev-fixture-secret", "test-fixture-secret")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });

    // The request falls through to the main /api router's catch-all
    // requireAuth (401 Unauthorized), never reaching claim-fixture-role's own
    // handler or its dev-only body-validation logic — proving the router was
    // never registered at all, not merely that the per-request guard
    // rejected the call.
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
    restoreEnv();
  });

  it("stays unmounted in production with a realistic REPLIT_DEPLOYMENT value, even if DEV_FIXTURE_SECRET is also present", async () => {
    vi.resetModules();
    // Replit sets REPLIT_DEPLOYMENT to a non-empty identifier in real deployments.
    process.env.REPLIT_DEPLOYMENT = "prod-deployment-id";
    process.env.DEV_FIXTURE_SECRET = "test-fixture-secret";

    const { default: app } = await import("../../app");

    const res = await request(app)
      .post("/api/dev/claim-fixture-role")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
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

  it("never mounts the router when DEV_FIXTURE_SECRET is unset, even outside production", async () => {
    vi.resetModules();
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.DEV_FIXTURE_SECRET;

    const { default: app } = await import("../../app");

    const res = await request(app)
      .post("/api/dev/claim-fixture-role")
      .send({ clerkUserId: "some_clerk_id", role: "owner" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
    restoreEnv();
  });
});
