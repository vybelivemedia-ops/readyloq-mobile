/**
 * Tests for PATCH /api/auth/me/push-notifications — push-failure banner clearing.
 *
 * Scenarios covered:
 *  1. Re-enabling (enabled=true) when pushLastFailedAt is set → clears it (banner hides)
 *  2. GET /api/auth/me after re-enabling confirms pushLastFailedAt is null
 *  3. Disabling (enabled=false) does NOT clear pushLastFailedAt (banner stays)
 *  4. Unauthenticated request → 401
 *  5. Missing/invalid enabled value → 400
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Clerk auth mock ────────────────────────────────────────────────────────────

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

// ── Imports (after mocks are registered) ──────────────────────────────────────

import app from "../app";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Test constants ─────────────────────────────────────────────────────────────

const OWNER_CLERK_ID = "push_banner_test_owner_clerk_id";

function asUser(id: string | null) {
  authState.userId = id;
}

// ── DB setup ───────────────────────────────────────────────────────────────────

let companyId: number;
let userId: number;

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

beforeAll(async () => {
  companyId = await findOrCreateCompany("Push Banner Test Co", "push-banner-test-co");

  // Remove any pre-existing user row for this Clerk ID.
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_CLERK_ID));

  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: OWNER_CLERK_ID,
      role: "owner",
      companyId,
      pushNotificationsEnabled: true,
      pushToken: "ExponentPushToken[push_banner_test_token]",
    })
    .returning({ id: usersTable.id });
  userId = row.id;
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_CLERK_ID));
  asUser(null);
});

/** Seed pushLastFailedAt to a past timestamp so the banner is visible. */
async function setFailedAt(date: Date | null) {
  await db
    .update(usersTable)
    .set({ pushLastFailedAt: date })
    .where(eq(usersTable.id, userId));
}

/** Read pushLastFailedAt directly from the DB. */
async function getFailedAt(): Promise<Date | null> {
  const [row] = await db
    .select({ pushLastFailedAt: usersTable.pushLastFailedAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row?.pushLastFailedAt ?? null;
}

beforeEach(async () => {
  asUser(null);
  // Reset pushNotificationsEnabled to true and clear pushLastFailedAt between tests.
  await db
    .update(usersTable)
    .set({ pushNotificationsEnabled: true, pushLastFailedAt: null })
    .where(eq(usersTable.id, userId));
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PATCH /api/auth/me/push-notifications — push-failure banner clearing", () => {
  it("clears pushLastFailedAt when re-enabling (enabled=true) so the banner hides", async () => {
    // Start with push disabled and a recorded delivery failure.
    await db
      .update(usersTable)
      .set({ pushNotificationsEnabled: false, pushLastFailedAt: new Date("2026-08-01T10:00:00.000Z") })
      .where(eq(usersTable.id, userId));

    // Confirm the flag is set and notifications are off before we toggle.
    expect(await getFailedAt()).not.toBeNull();

    asUser(OWNER_CLERK_ID);

    // First disable via the API to ensure we're testing the false→true transition.
    await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: false })
      .expect(200);

    // Now re-enable — this is the transition that should clear pushLastFailedAt.
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: true })
      .expect(200);

    expect(res.body).toMatchObject({ success: true, pushNotificationsEnabled: true });

    // The failure timestamp must now be gone from the DB.
    expect(await getFailedAt()).toBeNull();
  });

  it("GET /api/auth/me returns pushLastFailedAt: null after re-enabling", async () => {
    // Start with push disabled and a recorded delivery failure.
    await db
      .update(usersTable)
      .set({ pushNotificationsEnabled: false, pushLastFailedAt: new Date("2026-08-05T08:00:00.000Z") })
      .where(eq(usersTable.id, userId));

    asUser(OWNER_CLERK_ID);

    // Re-enable from a disabled state (false→true transition).
    await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: true })
      .expect(200);

    // Confirm the flag is cleared from the user profile endpoint too.
    const me = await request(app).get("/api/auth/me").expect(200);
    expect(me.body.pushLastFailedAt).toBeNull();
  });

  it("does NOT clear pushLastFailedAt when disabling (enabled=false)", async () => {
    const failedAt = new Date("2026-07-20T12:00:00.000Z");
    await setFailedAt(failedAt);

    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: false })
      .expect(200);

    expect(res.body).toMatchObject({ success: true, pushNotificationsEnabled: false });

    // The failure timestamp must still be present — disabling doesn't clear it.
    const stored = await getFailedAt();
    expect(stored).not.toBeNull();
    expect(stored!.toISOString()).toBe(failedAt.toISOString());
  });

  it("returns 401 when no user is authenticated", async () => {
    asUser(null);
    await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: true })
      .expect(401);
  });

  it("returns 400 when enabled is not a boolean", async () => {
    asUser(OWNER_CLERK_ID);
    await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({ enabled: "yes" })
      .expect(400);
  });

  it("returns 400 when enabled is missing", async () => {
    asUser(OWNER_CLERK_ID);
    await request(app)
      .patch("/api/auth/me/push-notifications")
      .send({})
      .expect(400);
  });
});
