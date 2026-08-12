import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Integration config tests (Task #244).
 *
 * Exercises the full connect → update → disconnect lifecycle for
 * PUT / GET / DELETE /api/integrations/config and verifies:
 *
 *  1. Status chip transitions: NOT SET → CONNECTED → NOT SET
 *  2. The API key is never returned in any GET response
 *  3. Saves are rejected when accountId or apiKey is blank
 *  4. Only owners can save or disconnect (role enforcement)
 *  5. Existing inspection data is unaffected by disconnecting
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

// field-integration.ts makes outbound HTTP calls to PestPac/FieldRoutes. We
// stub it out to avoid any real network calls and keep the suite hermetic.
vi.mock("../services/field-integration", () => ({
  syncInspectionToExternalSystem: vi.fn(async () => ({
    success: true,
    externalSystem: "pestpac",
    postedNotes: true,
    attachmentsPosted: 0,
  })),
}));

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  companyFieldIntegrationsTable,
  inspectionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Identities ───────────────────────────────────────────────────────────────

const OWNER_ID = "intg_owner_clerk_id";
const TECH_ID = "intg_tech_clerk_id";

let companyId: number;

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

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  companyId = await findOrCreateCompany("Integration Test Co", "intg-test-co");

  await db.delete(companyFieldIntegrationsTable).where(
    eq(companyFieldIntegrationsTable.companyId, companyId),
  );
  await db
    .delete(usersTable)
    .where(eq(usersTable.companyId, companyId));
  await db.insert(usersTable).values([
    { clerkUserId: OWNER_ID, role: "owner", companyId },
    { clerkUserId: TECH_ID, role: "technician", companyId },
  ]);
});

beforeEach(async () => {
  asUser(null);
  // Reset to a clean slate before each test so tests are order-independent.
  await db.delete(companyFieldIntegrationsTable).where(
    eq(companyFieldIntegrationsTable.companyId, companyId),
  );
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/config — initial state", () => {
  it("returns configured:false when no integration is set", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it("requires authentication", async () => {
    asUser(null);
    const res = await request(app).get("/api/integrations/config");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/integrations/config — connect", () => {
  it("saves a valid pestpac config and returns configured:true without the api key", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "acct-123", apiKey: "secret-key" });

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.systemType).toBe("pestpac");
    expect(res.body.accountId).toBe("acct-123");
    // The API key must NEVER be echoed back to the client.
    expect(JSON.stringify(res.body)).not.toContain("secret-key");
  });

  it("saves a valid fieldroutes config", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "fieldroutes", accountId: "fr-acct", apiKey: "fr-secret" });

    expect(res.status).toBe(200);
    expect(res.body.systemType).toBe("fieldroutes");
    expect(res.body.accountId).toBe("fr-acct");
  });

  it("rejects the save when accountId is blank", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "", apiKey: "secret-key" });

    expect(res.status).toBe(400);
  });

  it("rejects the save when apiKey is blank", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "acct-123", apiKey: "" });

    expect(res.status).toBe(400);
  });

  it("rejects the save when both accountId and apiKey are missing", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac" });

    expect(res.status).toBe(400);
  });

  it("rejects an unknown systemType", async () => {
    asUser(OWNER_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "unknownsystem", accountId: "acct-123", apiKey: "key" });

    expect(res.status).toBe(400);
  });

  it("blocks a technician from saving (403)", async () => {
    asUser(TECH_ID);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "acct-123", apiKey: "key" });

    expect(res.status).toBe(403);
  });

  it("blocks an unauthenticated request (401)", async () => {
    asUser(null);
    const res = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "acct-123", apiKey: "key" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/integrations/config — after connect", () => {
  beforeEach(async () => {
    // Seed a connected integration for the owner's company.
    asUser(OWNER_ID);
    await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "acct-456", apiKey: "stored-secret" });
  });

  it("returns configured:true with systemType and accountId visible", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/config");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.integration.systemType).toBe("pestpac");
    expect(res.body.integration.accountId).toBe("acct-456");
  });

  it("never returns the api key in the GET response", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/config");

    // Check both the parsed body and the raw response text.
    expect(res.body.integration).not.toHaveProperty("apiKey");
    expect(res.text).not.toContain("stored-secret");
  });

  it("the integration object has the expected non-sensitive fields only", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/config");

    const keys = Object.keys(res.body.integration);
    // These are the safe fields the client is allowed to see.
    for (const k of keys) {
      expect(["id", "systemType", "accountId", "apiBaseUrl", "enabled", "updatedAt"]).toContain(k);
    }
  });

  it("technician is blocked from reading the config (manager+ required)", async () => {
    asUser(TECH_ID);
    const res = await request(app).get("/api/integrations/config");

    // The whole integrations router is gated at manager+; technicians see 403.
    expect(res.status).toBe(403);
    // The api key must never appear in any response regardless of role.
    expect(res.text).not.toContain("stored-secret");
  });
});

describe("full connect → update → disconnect lifecycle", () => {
  it("status transitions: NOT SET → CONNECTED → updated → NOT SET", async () => {
    asUser(OWNER_ID);

    // Step 1: initially not configured
    const initial = await request(app).get("/api/integrations/config");
    expect(initial.body.configured).toBe(false); // NOT SET

    // Step 2: connect (PUT)
    const connect = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "lifecycle-acct", apiKey: "lifecycle-key" });
    expect(connect.status).toBe(200);
    expect(connect.body.configured).toBe(true); // CONNECTED

    // Step 3: GET reflects CONNECTED
    const afterConnect = await request(app).get("/api/integrations/config");
    expect(afterConnect.body.configured).toBe(true);
    expect(afterConnect.body.integration.systemType).toBe("pestpac");
    expect(afterConnect.body.integration.accountId).toBe("lifecycle-acct");
    expect(afterConnect.text).not.toContain("lifecycle-key");

    // Step 4: update (rotate key and change accountId via another PUT)
    const update = await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "lifecycle-acct-v2", apiKey: "new-key" });
    expect(update.status).toBe(200);

    // Step 5: GET reflects updated accountId
    const afterUpdate = await request(app).get("/api/integrations/config");
    expect(afterUpdate.body.integration.accountId).toBe("lifecycle-acct-v2");
    expect(afterUpdate.text).not.toContain("new-key");

    // Step 6: disconnect (DELETE)
    const disconnect = await request(app).delete("/api/integrations/config");
    expect(disconnect.status).toBe(200);
    expect(disconnect.body.configured).toBe(false); // NOT SET

    // Step 7: GET reflects NOT SET
    const afterDisconnect = await request(app).get("/api/integrations/config");
    expect(afterDisconnect.body.configured).toBe(false);
    expect(afterDisconnect.body).not.toHaveProperty("integration");
  });

  it("a second PUT upserts (no duplicate rows)", async () => {
    asUser(OWNER_ID);

    await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "dup-test", apiKey: "key-1" });
    await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "fieldroutes", accountId: "dup-test-v2", apiKey: "key-2" });

    // Only one row should exist in the DB for this company.
    const rows = await db
      .select()
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].systemType).toBe("fieldroutes");
    expect(rows[0].accountId).toBe("dup-test-v2");
    // The updated key is stored (not empty).
    expect(rows[0].apiKey).toBe("key-2");
  });
});

describe("DELETE /api/integrations/config — disconnect", () => {
  beforeEach(async () => {
    asUser(OWNER_ID);
    await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "del-acct", apiKey: "del-key" });
  });

  it("removes the config and returns configured:false", async () => {
    asUser(OWNER_ID);
    const res = await request(app).delete("/api/integrations/config");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it("blocks a technician from disconnecting (403)", async () => {
    asUser(TECH_ID);
    const res = await request(app).delete("/api/integrations/config");

    expect(res.status).toBe(403);

    // The config must remain intact after the blocked attempt.
    asUser(OWNER_ID);
    const check = await request(app).get("/api/integrations/config");
    expect(check.body.configured).toBe(true);
  });

  it("blocks an unauthenticated disconnect (401)", async () => {
    asUser(null);
    const res = await request(app).delete("/api/integrations/config");

    expect(res.status).toBe(401);
  });

  it("is idempotent — deleting twice does not error", async () => {
    asUser(OWNER_ID);
    const first = await request(app).delete("/api/integrations/config");
    expect(first.status).toBe(200);

    const second = await request(app).delete("/api/integrations/config");
    expect(second.status).toBe(200);
    expect(second.body.configured).toBe(false);
  });

  it("disconnecting does not delete existing inspections", async () => {
    // Seed an inspection for the owner's company.
    asUser(OWNER_ID);
    const insp = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "99 Bug St", technicianName: "Tech", clientName: "Client", pestTypes: ["ants"] });
    expect(insp.status).toBe(201);
    const inspectionId: number = insp.body.id;

    // Disconnect the integration.
    const del = await request(app).delete("/api/integrations/config");
    expect(del.status).toBe(200);

    // The inspection must still exist and be unmodified.
    const check = await request(app).get(`/api/inspections/${inspectionId}`);
    expect(check.status).toBe(200);
    expect(check.body.id).toBe(inspectionId);
    expect(check.body.siteAddress).toBe("99 Bug St");

    // Clean up.
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
  });
});

describe("tenant isolation — sync button cannot target another company's inspection", () => {
  const SYNC_OWNER_A_ID = "sync_tenant_owner_a_clerk_id";
  const SYNC_OWNER_B_ID = "sync_tenant_owner_b_clerk_id";

  let companyAId: number;
  let companyBId: number;
  let inspectionBId: number;

  beforeAll(async () => {
    // Create two separate companies.
    companyAId = await findOrCreateCompany("Sync Tenant Co A", "sync-tenant-co-a");
    companyBId = await findOrCreateCompany("Sync Tenant Co B", "sync-tenant-co-b");

    // Ensure owner users exist for each.
    for (const [clerkId, cid] of [
      [SYNC_OWNER_A_ID, companyAId],
      [SYNC_OWNER_B_ID, companyBId],
    ] as [string, number][]) {
      const existing = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkId));
      if (existing.length === 0) {
        await db.insert(usersTable).values({ clerkUserId: clerkId, role: "owner", companyId: cid });
      }
    }

    // Seed a completed inspection belonging to company B.
    authState.userId = SYNC_OWNER_B_ID;
    const inspRes = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "42 Roach Ave",
        technicianName: "Tech B",
        clientName: "Client B",
        pestTypes: ["roaches"],
      });
    expect(inspRes.status).toBe(201);
    inspectionBId = inspRes.body.id;

    // Mark the inspection as completed so the sync route doesn't reject it as unfinished.
    await db
      .update(inspectionsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(inspectionsTable.id, inspectionBId));

    // Give company A a valid integration config.
    await db.delete(companyFieldIntegrationsTable).where(
      eq(companyFieldIntegrationsTable.companyId, companyAId),
    );
    await db.insert(companyFieldIntegrationsTable).values({
      companyId: companyAId,
      systemType: "pestpac",
      accountId: "sync-a-acct",
      apiKey: "sync-a-key",
      enabled: true,
    });
  });

  it("returns 404 when company A's owner tries to sync an inspection owned by company B", async () => {
    // Act as company A's owner — their token is valid, but the inspection belongs to B.
    authState.userId = SYNC_OWNER_A_ID;

    const res = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: inspectionBId });

    // The route must enforce tenant isolation and return 404 (not 200 or 502).
    expect(res.status).toBe(404);
  });

  it("company B's owner can still sync their own inspection successfully", async () => {
    // Give company B a valid integration config too.
    await db.delete(companyFieldIntegrationsTable).where(
      eq(companyFieldIntegrationsTable.companyId, companyBId),
    );
    await db.insert(companyFieldIntegrationsTable).values({
      companyId: companyBId,
      systemType: "pestpac",
      accountId: "sync-b-acct",
      apiKey: "sync-b-key",
      enabled: true,
    });

    authState.userId = SYNC_OWNER_B_ID;

    const res = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: inspectionBId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Clean up.
    await db.delete(companyFieldIntegrationsTable).where(
      eq(companyFieldIntegrationsTable.companyId, companyBId),
    );
  });
});

describe("tenant isolation — config is scoped per company", () => {
  it("two companies each hold their own independent config", async () => {
    const otherCompanyId = await findOrCreateCompany("Other Intg Co", "other-intg-co");
    const OTHER_OWNER_ID = "other_intg_owner_clerk_id";

    // Seed the other company's user.
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, OTHER_OWNER_ID));
    if (existing.length === 0) {
      await db.insert(usersTable).values({
        clerkUserId: OTHER_OWNER_ID,
        role: "owner",
        companyId: otherCompanyId,
      });
    }

    // Clean up any leftover integration for the other company.
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, otherCompanyId));

    // Company A connects.
    asUser(OWNER_ID);
    await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "pestpac", accountId: "co-a-acct", apiKey: "co-a-key" });

    // Company B connects with different settings.
    asUser(OTHER_OWNER_ID);
    await request(app)
      .put("/api/integrations/config")
      .send({ systemType: "fieldroutes", accountId: "co-b-acct", apiKey: "co-b-key" });

    // Each company sees only its own config.
    asUser(OWNER_ID);
    const configA = await request(app).get("/api/integrations/config");
    expect(configA.body.integration.systemType).toBe("pestpac");
    expect(configA.body.integration.accountId).toBe("co-a-acct");
    expect(configA.text).not.toContain("co-b-key");

    asUser(OTHER_OWNER_ID);
    const configB = await request(app).get("/api/integrations/config");
    expect(configB.body.integration.systemType).toBe("fieldroutes");
    expect(configB.body.integration.accountId).toBe("co-b-acct");
    expect(configB.text).not.toContain("co-a-key");

    // Disconnecting B does not affect A.
    const del = await request(app).delete("/api/integrations/config");
    expect(del.body.configured).toBe(false);

    asUser(OWNER_ID);
    const afterDel = await request(app).get("/api/integrations/config");
    expect(afterDel.body.configured).toBe(true);
    expect(afterDel.body.integration.accountId).toBe("co-a-acct");

    // Tear down the extra company's integration.
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, otherCompanyId));
  });
});
