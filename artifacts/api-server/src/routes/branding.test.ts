import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Controllable Clerk auth state. `vi.hoisted` guarantees the object exists
// before the (hoisted) vi.mock factory below references it.
const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    // Skip real Clerk session parsing in tests.
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import app from "../app";
import {
  db,
  usersTable,
  brandingProfilesTable,
  companiesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const MANAGER_ID = "test_manager_clerk_id";
const TECH_ID = "test_tech_clerk_id";

let platformCompanyId: number;
let testCompanyId: number;

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

beforeAll(async () => {
  // The reserved platform company owns the pre-login brand; the test company is
  // an ordinary tenant whose managers manage their own branding.
  platformCompanyId = await findOrCreateCompany("ReadyLoq Platform", "platform");
  testCompanyId = await findOrCreateCompany("Branding Test Co", "branding-test-co");
  await db.delete(usersTable);
  await db.insert(usersTable).values([
    { clerkUserId: MANAGER_ID, role: "manager", companyId: testCompanyId },
    { clerkUserId: TECH_ID, role: "technician", companyId: testCompanyId },
  ]);
});

beforeEach(async () => {
  asUser(null);
  // Reset branding for both the platform (pre-login brand) and the test company.
  await db.delete(brandingProfilesTable);
  await db.insert(brandingProfilesTable).values([
    { ...READYLOQ_DEFAULT_PROFILE, companyId: platformCompanyId, isDefault: true, isActive: true },
    { ...READYLOQ_DEFAULT_PROFILE, companyId: testCompanyId, isDefault: true, isActive: true },
  ]);
});

async function createProfile(name: string, extra: Record<string, unknown> = {}) {
  asUser(MANAGER_ID);
  const res = await request(app)
    .post("/api/branding/profiles")
    .send({ name, companyName: name, ...extra });
  asUser(null);
  return res;
}

describe("GET /api/branding/active (public, platform brand)", () => {
  it("returns 200 with the platform active profile without authentication", async () => {
    const res = await request(app).get("/api/branding/active");
    expect(res.status).toBe(200);
    expect(res.body.companyName).toBe("ReadyLoq");
    expect(res.body.isActive).toBe(true);
  });

  it("serves the same active profile from the GET / alias", async () => {
    const res = await request(app).get("/api/branding/");
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });
});

describe("GET /api/branding/company (authed, caller's brand)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/branding/company");
    expect(res.status).toBe(401);
  });

  it("returns the caller company's active profile for any member", async () => {
    asUser(TECH_ID);
    const res = await request(app).get("/api/branding/company");
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });
});

describe("manager-only access control", () => {
  it("returns 401 when listing profiles unauthenticated", async () => {
    const res = await request(app).get("/api/branding/profiles");
    expect(res.status).toBe(401);
  });

  it("returns 403 when a technician lists profiles", async () => {
    asUser(TECH_ID);
    const res = await request(app).get("/api/branding/profiles");
    expect(res.status).toBe(403);
  });

  it("returns 200 with the profile list for a manager", async () => {
    asUser(MANAGER_ID);
    const res = await request(app).get("/api/branding/profiles");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 401 when an unauthenticated user tries to create a profile", async () => {
    const res = await request(app)
      .post("/api/branding/profiles")
      .send({ name: "Hacker", companyName: "Hacker" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when a technician tries to create a profile", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .post("/api/branding/profiles")
      .send({ name: "Tech Co", companyName: "Tech Co" });
    expect(res.status).toBe(403);
  });
});

describe("protected default profile", () => {
  it("cannot be deleted", async () => {
    asUser(MANAGER_ID);
    const list = await request(app).get("/api/branding/profiles");
    const def = list.body.find((p: { isDefault: boolean }) => p.isDefault);
    expect(def).toBeTruthy();

    const res = await request(app).delete(`/api/branding/profiles/${def.id}`);
    expect(res.status).toBe(400);

    // Still present afterwards.
    const after = await request(app).get(`/api/branding/profiles/${def.id}`);
    expect(after.status).toBe(200);
  });
});

describe("hex color validation", () => {
  it("rejects an invalid primaryColor on create with 400", async () => {
    const res = await createProfile("Bad Create", { primaryColor: "not-a-color" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/primaryColor/);
  });

  it("rejects an invalid accentColor on patch with 400", async () => {
    const created = await createProfile("Patch Target", { accentColor: "#abcdef" });
    expect(created.status).toBe(201);

    asUser(MANAGER_ID);
    const res = await request(app)
      .patch(`/api/branding/profiles/${created.body.id}`)
      .send({ accentColor: "zzzzzz" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accentColor/);
  });

  it("accepts valid hex colors and never auto-defaults or auto-activates", async () => {
    const res = await createProfile("Valid Co", {
      primaryColor: "#123abc",
      secondaryColor: "#fff",
      accentColor: "#0ea5e9",
    });
    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(false);
    expect(res.body.isActive).toBe(false);
  });
});

describe("activation is transactional (exactly one active profile)", () => {
  it("activates a profile, deactivates others, and never touches the platform brand", async () => {
    const created = await createProfile("Activate Me");
    expect(created.status).toBe(201);

    asUser(MANAGER_ID);
    const activate = await request(app).post(
      `/api/branding/profiles/${created.body.id}/activate`,
    );
    expect(activate.status).toBe(200);
    expect(activate.body.isActive).toBe(true);

    const list = await request(app).get("/api/branding/profiles");
    const active = list.body.filter((p: { isActive: boolean }) => p.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(created.body.id);

    // The caller company's brand reflects the new active profile...
    const companyRes = await request(app).get("/api/branding/company");
    expect(companyRes.body.id).toBe(created.body.id);

    // ...but the public/platform pre-login brand is unaffected.
    const publicRes = await request(app).get("/api/branding/active");
    expect(publicRes.body.companyName).toBe("ReadyLoq");
    expect(publicRes.body.id).not.toBe(created.body.id);
  });
});

describe("deleting the active profile falls back to the default", () => {
  it("re-activates the company default profile after the active one is removed", async () => {
    const created = await createProfile("Temp Active");
    asUser(MANAGER_ID);
    await request(app).post(`/api/branding/profiles/${created.body.id}/activate`);

    const del = await request(app).delete(
      `/api/branding/profiles/${created.body.id}`,
    );
    expect(del.status).toBe(204);

    const companyRes = await request(app).get("/api/branding/company");
    expect(companyRes.status).toBe(200);
    expect(companyRes.body.isDefault).toBe(true);
    expect(companyRes.body.isActive).toBe(true);
  });
});

describe("restore-defaults", () => {
  it("resets the company default profile to canonical values and re-activates it", async () => {
    // Activate a non-default profile first.
    const created = await createProfile("Other Brand", { companyName: "Other Brand" });
    asUser(MANAGER_ID);
    await request(app).post(`/api/branding/profiles/${created.body.id}/activate`);

    const restore = await request(app).post("/api/branding/restore-defaults");
    expect(restore.status).toBe(200);
    expect(restore.body.isDefault).toBe(true);
    expect(restore.body.isActive).toBe(true);
    expect(restore.body.companyName).toBe(READYLOQ_DEFAULT_PROFILE.companyName);

    const companyRes = await request(app).get("/api/branding/company");
    expect(companyRes.body.isDefault).toBe(true);
    expect(companyRes.body.companyName).toBe("ReadyLoq");

    // Still exactly one active profile in the company.
    const list = await request(app).get("/api/branding/profiles");
    const active = list.body.filter((p: { isActive: boolean }) => p.isActive);
    expect(active).toHaveLength(1);
  });
});
