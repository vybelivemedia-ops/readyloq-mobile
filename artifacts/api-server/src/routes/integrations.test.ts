import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Integration config tests.
 *
 * Exercises the full connect → update → disconnect lifecycle for
 * PUT / GET / DELETE /api/integrations/config and verifies:
 *
 *  1. Status chip transitions: NOT SET → CONNECTED → NOT SET
 *  2. The API key is never returned in any GET response
 *  3. Saves are rejected when accountId or apiKey is blank
 *  4. Only owners can save or disconnect (role enforcement)
 *  5. Existing inspection data is unaffected by disconnecting
 *
 * Also covers the sync cooldown boundary:
 *  6. Failed syncs are immediately retryable — the 60-second cooldown applies
 *     only to successful syncs.
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
// Exposed via vi.hoisted so individual tests can override behaviour.
const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));
vi.mock("../services/field-integration", () => ({
  syncInspectionToExternalSystem: syncMock,
  probeIntegrationCredentials: vi.fn(async () => ({ ok: true })),
}));

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  companyFieldIntegrationsTable,
  inspectionsTable,
  inspectionSyncLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

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
  // Restore the default success implementation so existing lifecycle tests are
  // not affected by cooldown tests that override this mock.
  syncMock.mockReset();
  syncMock.mockResolvedValue({
    success: true,
    externalSystem: "pestpac",
    postedNotes: true,
    attachmentsPosted: 0,
  });
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

describe("tenant isolation — sync-history cannot expose another company's logs", () => {
  const HIST_OWNER_A_ID = "hist_tenant_owner_a_clerk_id";
  const HIST_OWNER_B_ID = "hist_tenant_owner_b_clerk_id";

  let histCompanyAId: number;
  let histCompanyBId: number;
  let histInspectionBId: number;

  beforeAll(async () => {
    histCompanyAId = await findOrCreateCompany("Hist Tenant Co A", "hist-tenant-co-a");
    histCompanyBId = await findOrCreateCompany("Hist Tenant Co B", "hist-tenant-co-b");

    for (const [clerkId, cid] of [
      [HIST_OWNER_A_ID, histCompanyAId],
      [HIST_OWNER_B_ID, histCompanyBId],
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
    authState.userId = HIST_OWNER_B_ID;
    const inspRes = await request(app)
      .post("/api/inspections")
      .send({
        siteAddress: "99 Moth Lane",
        technicianName: "Tech B",
        clientName: "Client B",
        pestTypes: ["moths"],
      });
    expect(inspRes.status).toBe(201);
    histInspectionBId = inspRes.body.id;

    // Mark the inspection as completed.
    await db
      .update(inspectionsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(inspectionsTable.id, histInspectionBId));

    // Seed a sync log entry for company B's inspection directly into the DB.
    await db.insert(inspectionSyncLogsTable).values({
      companyId: histCompanyBId,
      inspectionId: histInspectionBId,
      systemType: "pestpac",
      success: true,
      errorMessage: null,
      resultJson: { externalId: "ext-b-001" },
    });
  });

  it("returns 200 with an empty logs array when company A queries company B's inspectionId", async () => {
    authState.userId = HIST_OWNER_A_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${histInspectionBId}`);

    expect(res.status).toBe(200);
    // The response must not leak company B's sync log entry.
    expect(res.body.logs).toEqual([]);
  });

  it("company B can still read its own sync history for the same inspectionId", async () => {
    authState.userId = HIST_OWNER_B_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${histInspectionBId}`);

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].inspectionId).toBe(histInspectionBId);
  });
});

describe("tenant isolation — unfiltered sync-history is scoped to the requesting company", () => {
  const UNFILTERED_OWNER_A_ID = "unfiltered_hist_owner_a_clerk_id";
  const UNFILTERED_OWNER_B_ID = "unfiltered_hist_owner_b_clerk_id";

  let unfilteredCompanyAId: number;
  let unfilteredCompanyBId: number;
  let logAId: number;
  let logBId: number;

  beforeAll(async () => {
    unfilteredCompanyAId = await findOrCreateCompany(
      "Unfiltered Hist Co A",
      "unfiltered-hist-co-a",
    );
    unfilteredCompanyBId = await findOrCreateCompany(
      "Unfiltered Hist Co B",
      "unfiltered-hist-co-b",
    );

    // Ensure owner users exist for both companies.
    for (const [clerkId, cid] of [
      [UNFILTERED_OWNER_A_ID, unfilteredCompanyAId],
      [UNFILTERED_OWNER_B_ID, unfilteredCompanyBId],
    ] as [string, number][]) {
      const existing = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkId));
      if (existing.length === 0) {
        await db
          .insert(usersTable)
          .values({ clerkUserId: clerkId, role: "owner", companyId: cid });
      }
    }

    // Seed completed inspections for both companies so the sync log rows have
    // valid foreign-key references.
    const [inspA] = await db
      .insert(inspectionsTable)
      .values({
        companyId: unfilteredCompanyAId,
        siteAddress: "1 Alpha St",
        technicianName: "Tech A",
        status: "completed",
      })
      .returning();

    const [inspB] = await db
      .insert(inspectionsTable)
      .values({
        companyId: unfilteredCompanyBId,
        siteAddress: "2 Beta Blvd",
        technicianName: "Tech B",
        status: "completed",
      })
      .returning();

    // Seed one sync log entry for company A and one for company B.
    const [rowA] = await db
      .insert(inspectionSyncLogsTable)
      .values({
        companyId: unfilteredCompanyAId,
        inspectionId: inspA.id,
        systemType: "pestpac",
        success: true,
        errorMessage: null,
        resultJson: { externalId: "ext-a-unfiltered" },
      })
      .returning({ id: inspectionSyncLogsTable.id });

    const [rowB] = await db
      .insert(inspectionSyncLogsTable)
      .values({
        companyId: unfilteredCompanyBId,
        inspectionId: inspB.id,
        systemType: "fieldroutes",
        success: true,
        errorMessage: null,
        resultJson: { externalId: "ext-b-unfiltered" },
      })
      .returning({ id: inspectionSyncLogsTable.id });

    logAId = rowA.id;
    logBId = rowB.id;
  });

  it("company A's unfiltered sync-history response contains only its own log entries", async () => {
    authState.userId = UNFILTERED_OWNER_A_ID;

    const res = await request(app).get("/api/integrations/sync-history");

    expect(res.status).toBe(200);

    const ids: number[] = res.body.logs.map((l: { id: number }) => l.id);

    // Company A's own entry must appear.
    expect(ids).toContain(logAId);

    // Company B's entry must never appear — even without an inspectionId filter.
    expect(ids).not.toContain(logBId);
  });

  it("company B's unfiltered sync-history response contains only its own log entries", async () => {
    authState.userId = UNFILTERED_OWNER_B_ID;

    const res = await request(app).get("/api/integrations/sync-history");

    expect(res.status).toBe(200);

    const ids: number[] = res.body.logs.map((l: { id: number }) => l.id);

    // Company B's own entry must appear.
    expect(ids).toContain(logBId);

    // Company A's entry must not appear.
    expect(ids).not.toContain(logAId);
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

// ─── Sync cooldown boundary ───────────────────────────────────────────────────
//
// The 60-second cooldown intentionally applies ONLY to successful syncs so
// that transient external-system failures can be retried immediately without
// the owner waiting a full minute.
//
// These tests pin that boundary so a future refactor cannot silently apply
// the cooldown to failed attempts.

describe("POST /api/integrations/sync — cooldown boundary", () => {
  /** Stub result returned by the mock when the sync succeeds. */
  const SUCCESS_RESULT = {
    success: true,
    externalSystem: "pestpac",
    postedNotes: true,
    attachmentsPosted: 0,
  };

  const COOLDOWN_OWNER_ID = "sync_cooldown_owner_clerk_id";
  let cooldownCompanyId: number;
  let cooldownInspectionId: number;

  beforeAll(async () => {
    cooldownCompanyId = await findOrCreateCompany("Sync Cooldown Co", "sync-cooldown-co");

    // Owner user for this sub-suite.
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, COOLDOWN_OWNER_ID));
    if (existing.length === 0) {
      await db.insert(usersTable).values({ clerkUserId: COOLDOWN_OWNER_ID, role: "owner", companyId: cooldownCompanyId });
    }

    // Integration config.
    await db.delete(companyFieldIntegrationsTable).where(
      eq(companyFieldIntegrationsTable.companyId, cooldownCompanyId),
    );
    await db.insert(companyFieldIntegrationsTable).values({
      companyId: cooldownCompanyId,
      systemType: "pestpac",
      accountId: "acct-cooldown",
      apiKey: "test-api-key",
      enabled: true,
    });

    // A completed inspection owned by this company.
    const [insp] = await db
      .insert(inspectionsTable)
      .values({ companyId: cooldownCompanyId, siteAddress: "1 Cooldown Ave", technicianName: "Tech", status: "completed" })
      .returning();
    cooldownInspectionId = insp.id;
  });

  beforeEach(async () => {
    // Clear sync logs between tests so each test starts clean.
    await db
      .delete(inspectionSyncLogsTable)
      .where(
        and(
          eq(inspectionSyncLogsTable.companyId, cooldownCompanyId),
          eq(inspectionSyncLogsTable.inspectionId, cooldownInspectionId),
        ),
      );
  });

  it("returns cached result on a second successful sync within the cooldown window", async () => {
    asUser(COOLDOWN_OWNER_ID);

    const first = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: cooldownInspectionId });
    expect(first.status).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(1);

    // Second call within the 60-second window — must not hit the external system.
    const second = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: cooldownInspectionId });
    expect(second.status).toBe(200);
    expect(second.body._idempotent).toBe(true);
    expect(syncMock).toHaveBeenCalledTimes(1); // still only one call to the external system
  });

  it("allows an immediate retry after a failed sync — does NOT apply the cooldown", async () => {
    // First call: external system returns an error.
    syncMock.mockRejectedValueOnce(new Error("PestPac 503: service unavailable"));

    asUser(COOLDOWN_OWNER_ID);
    const first = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: cooldownInspectionId });

    // The route should surface the failure to the caller.
    expect(first.status).toBe(502);
    expect(syncMock).toHaveBeenCalledTimes(1);

    // Second call: external system recovers.  The failure must NOT have
    // triggered a cooldown — the external system must be reached again.
    const second = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: cooldownInspectionId });

    expect(second.status).toBe(200);
    expect(second.body._idempotent).toBeUndefined(); // real sync, not a cache hit
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it("allows multiple consecutive failed retries without hitting the cooldown", async () => {
    syncMock
      .mockRejectedValueOnce(new Error("PestPac timeout"))
      .mockRejectedValueOnce(new Error("PestPac timeout"));
    // Third call uses the default success implementation restored in the outer beforeEach.

    asUser(COOLDOWN_OWNER_ID);

    // Attempt 1 — fail.
    const a1 = await request(app).post("/api/integrations/sync").send({ inspectionId: cooldownInspectionId });
    expect(a1.status).toBe(502);

    // Attempt 2 — fail again, still no cooldown.
    const a2 = await request(app).post("/api/integrations/sync").send({ inspectionId: cooldownInspectionId });
    expect(a2.status).toBe(502);
    expect(syncMock).toHaveBeenCalledTimes(2);

    // Attempt 3 — succeeds; must reach the external system.
    const a3 = await request(app).post("/api/integrations/sync").send({ inspectionId: cooldownInspectionId });
    expect(a3.status).toBe(200);
    expect(a3.body._idempotent).toBeUndefined();
    expect(syncMock).toHaveBeenCalledTimes(3);
  });

  it("records a failure log for a failed sync so operators can inspect it", async () => {
    syncMock.mockRejectedValueOnce(new Error("PestPac 401: bad credentials"));

    asUser(COOLDOWN_OWNER_ID);
    await request(app).post("/api/integrations/sync").send({ inspectionId: cooldownInspectionId });

    const logs = await db
      .select()
      .from(inspectionSyncLogsTable)
      .where(
        and(
          eq(inspectionSyncLogsTable.companyId, cooldownCompanyId),
          eq(inspectionSyncLogsTable.inspectionId, cooldownInspectionId),
        ),
      );

    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
    expect(logs[0].errorMessage).toContain("PestPac 401");
    expect(logs[0].resultJson).toBeNull();
  });

  it("records a success log and stores the result JSON after a successful sync", async () => {
    asUser(COOLDOWN_OWNER_ID);
    const res = await request(app).post("/api/integrations/sync").send({ inspectionId: cooldownInspectionId });
    expect(res.status).toBe(200);

    const logs = await db
      .select()
      .from(inspectionSyncLogsTable)
      .where(
        and(
          eq(inspectionSyncLogsTable.companyId, cooldownCompanyId),
          eq(inspectionSyncLogsTable.inspectionId, cooldownInspectionId),
          eq(inspectionSyncLogsTable.success, true),
        ),
      );

    expect(logs).toHaveLength(1);
    expect(logs[0].resultJson).toMatchObject(SUCCESS_RESULT);
  });
});

// ─── Sync cooldown isolation — per inspectionId, not per company ─────────────
//
// The cooldown query filters by BOTH companyId AND inspectionId.  A bug that
// drops the inspectionId filter would cause a successful sync of inspection A
// to block immediate retries of inspection B at the same company — silently
// breaking multi-inspection workflows.  This suite pins that isolation.

describe("POST /api/integrations/sync — cooldown is per inspectionId, not per company", () => {
  const ISO_OWNER_ID = "sync_iso_owner_clerk_id";
  let isoCompanyId: number;
  let isoInspectionAId: number;
  let isoInspectionBId: number;

  beforeAll(async () => {
    isoCompanyId = await findOrCreateCompany("Sync Iso Co", "sync-iso-co");

    // Owner user.
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, ISO_OWNER_ID));
    if (existing.length === 0) {
      await db.insert(usersTable).values({
        clerkUserId: ISO_OWNER_ID,
        role: "owner",
        companyId: isoCompanyId,
      });
    }

    // Integration config for the company.
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, isoCompanyId));
    await db.insert(companyFieldIntegrationsTable).values({
      companyId: isoCompanyId,
      systemType: "pestpac",
      accountId: "iso-acct",
      apiKey: "iso-key",
      enabled: true,
    });

    // Two completed inspections belonging to the same company.
    const [inspA, inspB] = await db
      .insert(inspectionsTable)
      .values([
        {
          companyId: isoCompanyId,
          siteAddress: "1 Alpha Rd",
          technicianName: "Tech",
          status: "completed",
        },
        {
          companyId: isoCompanyId,
          siteAddress: "2 Beta Rd",
          technicianName: "Tech",
          status: "completed",
        },
      ])
      .returning();
    isoInspectionAId = inspA.id;
    isoInspectionBId = inspB.id;
  });

  beforeEach(async () => {
    // Clear sync logs for both inspections so tests are independent.
    await db
      .delete(inspectionSyncLogsTable)
      .where(eq(inspectionSyncLogsTable.companyId, isoCompanyId));
  });

  it("a successful sync of inspection A does not block an immediate sync of inspection B", async () => {
    asUser(ISO_OWNER_ID);

    // Sync inspection A — this records a success log and starts its cooldown.
    const resA = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: isoInspectionAId });
    expect(resA.status).toBe(200);
    expect(resA.body._idempotent).toBeUndefined(); // real sync, not cache
    expect(syncMock).toHaveBeenCalledTimes(1);

    // Sync inspection B — must reach the external system (callCount goes to 2),
    // not be served from inspection A's cached result.
    const resB = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: isoInspectionBId });
    expect(resB.status).toBe(200);
    expect(resB.body._idempotent).toBeUndefined(); // real sync, not cache
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it("inspection A's own cooldown still applies to a second sync of inspection A", async () => {
    asUser(ISO_OWNER_ID);

    // First sync of A.
    const first = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: isoInspectionAId });
    expect(first.status).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(1);

    // Second sync of A within the window — must be served from cache.
    const second = await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: isoInspectionAId });
    expect(second.status).toBe(200);
    expect(second.body._idempotent).toBe(true);
    expect(syncMock).toHaveBeenCalledTimes(1); // external system NOT called again
  });
});

// ─── sync-history — retry ordering and errorMessage ──────────────────────────
//
// This suite exercises the full retry sequence via actual HTTP POST
// /api/integrations/sync calls (not direct DB inserts) so the assertions
// reflect exactly what the UI owner sees after repeated attempts:
//
//   1. Three failed attempts followed by one success.
//   2. GET /api/integrations/sync-history returns all four entries.
//   3. Entries are newest-first (the latest attempt is history[0]).
//   4. Failed rows carry a non-empty errorMessage; the success row has null.
//
// The client-side sliceSyncHistory() cap (SYNC_HISTORY_DISPLAY_LIMIT = 10) is
// tested separately in the mobile app's
// lib/sync-history/__tests__/sliceSyncHistory.test.ts.

describe("GET /api/integrations/sync-history — retry ordering and errorMessage", () => {
  const RETRY_OWNER_ID = "retry_order_owner_clerk_id";

  let retryCompanyId: number;
  let retryInspectionId: number;

  beforeAll(async () => {
    retryCompanyId = await findOrCreateCompany("Retry Order Co", "retry-order-co");

    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, RETRY_OWNER_ID));
    if (existing.length === 0) {
      await db.insert(usersTable).values({
        clerkUserId: RETRY_OWNER_ID,
        role: "owner",
        companyId: retryCompanyId,
      });
    }

    // Integration config for this company.
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, retryCompanyId));
    await db.insert(companyFieldIntegrationsTable).values({
      companyId: retryCompanyId,
      systemType: "pestpac",
      accountId: "retry-acct",
      apiKey: "retry-key",
      enabled: true,
    });

    // Completed inspection owned by this company.
    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId: retryCompanyId,
        siteAddress: "77 Order Blvd",
        technicianName: "Tech R",
        status: "completed",
      })
      .returning();
    retryInspectionId = insp.id;

    // ── Exercise the real retry sequence via HTTP ────────────────────────────
    // Attempt 1 — fail.
    syncMock.mockRejectedValueOnce(new Error("PestPac 503: gateway timeout"));
    authState.userId = RETRY_OWNER_ID;
    await request(app).post("/api/integrations/sync").send({ inspectionId: retryInspectionId });

    // Attempt 2 — fail.
    syncMock.mockRejectedValueOnce(new Error("PestPac 503: still unavailable"));
    await request(app).post("/api/integrations/sync").send({ inspectionId: retryInspectionId });

    // Attempt 3 — fail.
    syncMock.mockRejectedValueOnce(new Error("PestPac 401: credentials expired"));
    await request(app).post("/api/integrations/sync").send({ inspectionId: retryInspectionId });

    // Attempt 4 — succeed (syncMock restored to default success by outer beforeEach
    // but since this is beforeAll, re-set it explicitly).
    syncMock.mockResolvedValueOnce({
      success: true,
      externalSystem: "pestpac",
      postedNotes: true,
      attachmentsPosted: 0,
    });
    await request(app).post("/api/integrations/sync").send({ inspectionId: retryInspectionId });
  });

  afterAll(async () => {
    await db
      .delete(inspectionSyncLogsTable)
      .where(eq(inspectionSyncLogsTable.companyId, retryCompanyId));
    await db
      .delete(inspectionsTable)
      .where(eq(inspectionsTable.id, retryInspectionId));
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, retryCompanyId));
  });

  it("returns all retry attempts (3 failures + 1 success = 4 entries)", async () => {
    authState.userId = RETRY_OWNER_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${retryInspectionId}`);

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(4);
  });

  it("returns entries newest-first — the successful attempt is history[0]", async () => {
    authState.userId = RETRY_OWNER_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${retryInspectionId}`);

    expect(res.status).toBe(200);
    const logs: { syncedAt: string; success: boolean }[] = res.body.logs;

    // Newest entry must be the success (attempt 4).
    expect(logs[0].success).toBe(true);

    // Each subsequent entry must be no newer than the previous one.
    for (let i = 1; i < logs.length; i++) {
      const prev = new Date(logs[i - 1].syncedAt).getTime();
      const curr = new Date(logs[i].syncedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("returns entries in exact newest-first order with correct success flags and distinct error messages", async () => {
    // Expected sequence newest-first:
    //   [0] success      → errorMessage null
    //   [1] attempt 3    → "PestPac 401: credentials expired"
    //   [2] attempt 2    → "PestPac 503: still unavailable"
    //   [3] attempt 1    → "PestPac 503: gateway timeout"
    authState.userId = RETRY_OWNER_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${retryInspectionId}`);

    expect(res.status).toBe(200);
    const logs: { success: boolean; errorMessage: string | null; syncedAt: string }[] =
      res.body.logs;

    expect(logs).toHaveLength(4);

    // Entry 0 — the successful attempt is the newest.
    expect(logs[0].success).toBe(true);
    expect(logs[0].errorMessage).toBeNull();

    // Entry 1 — most-recent failure (attempt 3: credentials expired).
    expect(logs[1].success).toBe(false);
    expect(logs[1].errorMessage).toBe("PestPac 401: credentials expired");

    // Entry 2 — second failure (attempt 2: still unavailable).
    expect(logs[2].success).toBe(false);
    expect(logs[2].errorMessage).toBe("PestPac 503: still unavailable");

    // Entry 3 — oldest failure (attempt 1: gateway timeout).
    expect(logs[3].success).toBe(false);
    expect(logs[3].errorMessage).toBe("PestPac 503: gateway timeout");

    // Confirm monotonically non-increasing timestamps (newest-first ordering).
    for (let i = 1; i < logs.length; i++) {
      const prev = new Date(logs[i - 1].syncedAt).getTime();
      const curr = new Date(logs[i].syncedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

// ─── sync-history — API returns >10 entries; UI display cap is client-side ───
//
// The server returns up to 100 entries; the client caps display at 10 via
// sliceSyncHistory() in SyncHistoryBadge.  This suite drives 11 sync attempts
// (10 failures + 1 success — failures are never cooled down, so each is
// retryable immediately) and confirms the API returns all 11.  The slicing
// behaviour is covered independently in the mobile-app unit test
// lib/sync-history/__tests__/sliceSyncHistory.test.ts.

describe("GET /api/integrations/sync-history — API returns all entries above the display cap", () => {
  const DISPLAY_CAP_OWNER_ID = "display_cap_owner_clerk_id";

  let displayCapCompanyId: number;
  let displayCapInspectionId: number;

  beforeAll(async () => {
    displayCapCompanyId = await findOrCreateCompany(
      "Display Cap Co",
      "display-cap-co",
    );

    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, DISPLAY_CAP_OWNER_ID));
    if (existing.length === 0) {
      await db.insert(usersTable).values({
        clerkUserId: DISPLAY_CAP_OWNER_ID,
        role: "owner",
        companyId: displayCapCompanyId,
      });
    }

    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, displayCapCompanyId));
    await db.insert(companyFieldIntegrationsTable).values({
      companyId: displayCapCompanyId,
      systemType: "pestpac",
      accountId: "cap-acct",
      apiKey: "cap-key",
      enabled: true,
    });

    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId: displayCapCompanyId,
        siteAddress: "11 Cap Lane",
        technicianName: "Tech C",
        status: "completed",
      })
      .returning();
    displayCapInspectionId = insp.id;

    // Exercise 10 failed sync attempts (failures are never subject to cooldown,
    // so each call reaches the external-system mock and writes a log row).
    authState.userId = DISPLAY_CAP_OWNER_ID;
    for (let i = 0; i < 10; i++) {
      syncMock.mockRejectedValueOnce(new Error(`timeout attempt ${i}`));
      await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: displayCapInspectionId });
    }

    // One final successful attempt — brings the total to 11.
    syncMock.mockResolvedValueOnce({
      success: true,
      externalSystem: "pestpac",
      postedNotes: true,
      attachmentsPosted: 0,
    });
    await request(app)
      .post("/api/integrations/sync")
      .send({ inspectionId: displayCapInspectionId });
  });

  afterAll(async () => {
    await db
      .delete(inspectionSyncLogsTable)
      .where(eq(inspectionSyncLogsTable.companyId, displayCapCompanyId));
    await db
      .delete(inspectionsTable)
      .where(eq(inspectionsTable.id, displayCapInspectionId));
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, displayCapCompanyId));
  });

  it("returns all 11 entries — the API does not apply the 10-entry UI cap", async () => {
    authState.userId = DISPLAY_CAP_OWNER_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${displayCapInspectionId}`);

    expect(res.status).toBe(200);
    // 11 entries must be returned even though the UI cap is 10.
    // sliceSyncHistory() in SyncHistoryBadge enforces the cap client-side.
    expect(res.body.logs).toHaveLength(11);
  });

  it("newest entry is the successful attempt — the 10 failures precede it in the list", async () => {
    authState.userId = DISPLAY_CAP_OWNER_ID;

    const res = await request(app)
      .get(`/api/integrations/sync-history?inspectionId=${displayCapInspectionId}`);

    expect(res.status).toBe(200);
    const logs: { success: boolean }[] = res.body.logs;

    expect(logs[0].success).toBe(true);
    // All remaining entries must be failures.
    for (const log of logs.slice(1)) {
      expect(log.success).toBe(false);
    }
  });
});

// ─── sync-history — invalid inspectionId format ───────────────────────────────
//
// The GET /api/integrations/sync-history route validates the optional
// ?inspectionId= query param and must return 400 (not a silent empty array)
// for any value that is not a positive integer.

describe("GET /api/integrations/sync-history — invalid inspectionId format", () => {
  it("returns 400 for a non-numeric inspectionId (abc)", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/sync-history?inspectionId=abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid inspectionId");
  });

  it("returns 400 for inspectionId=0 (not positive)", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/sync-history?inspectionId=0");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid inspectionId");
  });

  it("returns 400 for a negative inspectionId (-5)", async () => {
    asUser(OWNER_ID);
    const res = await request(app).get("/api/integrations/sync-history?inspectionId=-5");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid inspectionId");
  });
});

// ─── GET /api/integrations/sync-history/export ────────────────────────────────
//
// Verifies:
//  1. Returns 401 for unauthenticated requests.
//  2. Returns 403 for non-owner roles (technician).
//  3. Returns CSV with correct headers and one row per log entry.
//  4. Correctly labels all three supported system types (pestpac, fieldroutes, servsuite).
//  5. Tenant-scoped: only the owner's own company logs are exported.
//  6. Formula-injection characters (=, +, -, @) in errorMessage are neutralised with a tab prefix.
//  7. Returns all rows with no 100-entry cap (at least 101 entries are exported).
//  8. Returns 400 for an invalid inspectionId.

const EXPORT_OWNER_ID = "csv_export_owner_clerk";
const EXPORT_TECH_ID = "csv_export_tech_clerk";
const EXPORT_OUTSIDER_ID = "csv_export_outsider_clerk";

let exportCompanyId: number;
let exportOtherCompanyId: number;
let exportInspectionId: number;
let exportOtherInspectionId: number;

describe("GET /api/integrations/sync-history/export", () => {
  beforeAll(async () => {
    exportCompanyId = await findOrCreateCompany("CSV Export Co", "csv-export-co");
    exportOtherCompanyId = await findOrCreateCompany("CSV Export Other Co", "csv-export-other-co");

    await db.delete(usersTable).where(eq(usersTable.clerkUserId, EXPORT_OWNER_ID));
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, EXPORT_TECH_ID));
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, EXPORT_OUTSIDER_ID));
    await db.insert(usersTable).values([
      { clerkUserId: EXPORT_OWNER_ID, role: "owner", companyId: exportCompanyId },
      { clerkUserId: EXPORT_TECH_ID, role: "technician", companyId: exportCompanyId },
      { clerkUserId: EXPORT_OUTSIDER_ID, role: "owner", companyId: exportOtherCompanyId },
    ]);

    const [insp] = await db
      .insert(inspectionsTable)
      .values({ companyId: exportCompanyId, siteAddress: "1 Export Ave", technicianName: "Exporter", status: "completed" })
      .returning();
    exportInspectionId = insp.id;

    // Seed logs for the owner's inspection (three different system types + formula values).
    await db.insert(inspectionSyncLogsTable).values([
      { companyId: exportCompanyId, inspectionId: exportInspectionId, systemType: "pestpac", success: true, errorMessage: null },
      { companyId: exportCompanyId, inspectionId: exportInspectionId, systemType: "fieldroutes", success: false, errorMessage: "=DANGEROUS()" },
      { companyId: exportCompanyId, inspectionId: exportInspectionId, systemType: "servsuite", success: false, errorMessage: "+1 exploit" },
    ]);

    // Seed a log for the outsider's company — must never appear in owner's export.
    const [otherInsp] = await db
      .insert(inspectionsTable)
      .values({ companyId: exportOtherCompanyId, siteAddress: "99 Other St", technicianName: "Other", status: "completed" })
      .returning();
    exportOtherInspectionId = otherInsp.id;
    await db.insert(inspectionSyncLogsTable).values([
      { companyId: exportOtherCompanyId, inspectionId: otherInsp.id, systemType: "pestpac", success: true, errorMessage: null },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for technician role", async () => {
    asUser(EXPORT_TECH_ID);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid inspectionId", async () => {
    asUser(EXPORT_OWNER_ID);
    const res = await request(app).get("/api/integrations/sync-history/export?inspectionId=abc");
    expect(res.status).toBe(400);
  });

  it("returns text/csv with a header row", async () => {
    asUser(EXPORT_OWNER_ID);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = (res.text as string).split("\n");
    expect(lines[0]).toBe("Timestamp,System,Result,Error Message");
  });

  it("labels pestpac as PestPac", async () => {
    asUser(EXPORT_OWNER_ID);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"PestPac"');
  });

  it("labels fieldroutes as FieldRoutes", async () => {
    asUser(EXPORT_OWNER_ID);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"FieldRoutes"');
  });

  it("labels servsuite as ServSuite", async () => {
    asUser(EXPORT_OWNER_ID);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"ServSuite"');
  });

  it("neutralises formula-injection characters with a tab prefix", async () => {
    asUser(EXPORT_OWNER_ID);
    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${exportInspectionId}`);
    expect(res.status).toBe(200);
    // =DANGEROUS() must be stored as \t=DANGEROUS() inside the CSV quotes.
    expect(res.text).toContain('"\t=DANGEROUS()"');
    // +1 exploit must be stored as \t+1 exploit.
    expect(res.text).toContain('"\t+1 exploit"');
  });

  it("is tenant-scoped: owner's logs are absent from the outsider's export", async () => {
    asUser(EXPORT_OUTSIDER_ID);
    // Filter to the outsider's own inspection — guaranteed to be exactly 1 log.
    const res = await request(app).get(
      `/api/integrations/sync-history/export?inspectionId=${exportOtherInspectionId}`,
    );
    expect(res.status).toBe(200);
    const lines = (res.text as string).split("\n").filter(Boolean);
    // Header + exactly one log entry for the outsider's inspection.
    expect(lines.length).toBe(2);
    // The owner's inspection ID must not appear anywhere in the CSV.
    expect(res.text).not.toContain(String(exportInspectionId));
    // The owner-only error messages must not appear.
    expect(res.text).not.toContain("=DANGEROUS()");
  });

  it("returns more than 100 entries when there are more than 100 sync attempts", async () => {
    asUser(EXPORT_OWNER_ID);

    // Create a fresh inspection with 101 sync logs.
    const [bigInsp] = await db
      .insert(inspectionsTable)
      .values({ companyId: exportCompanyId, siteAddress: "101 Rows Blvd", technicianName: "Bulk", status: "completed" })
      .returning();

    const rows = Array.from({ length: 101 }, (_, i) => ({
      companyId: exportCompanyId,
      inspectionId: bigInsp.id,
      systemType: "pestpac" as const,
      success: i % 2 === 0,
      errorMessage: i % 2 === 0 ? null : `Error ${i}`,
    }));
    await db.insert(inspectionSyncLogsTable).values(rows);

    const res = await request(app).get(`/api/integrations/sync-history/export?inspectionId=${bigInsp.id}`);
    expect(res.status).toBe(200);
    const dataLines = (res.text as string).split("\n").filter(Boolean).slice(1); // skip header
    expect(dataLines.length).toBe(101);

    // Cleanup.
    await db.delete(inspectionSyncLogsTable).where(eq(inspectionSyncLogsTable.inspectionId, bigInsp.id));
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, bigInsp.id));
  });
});
