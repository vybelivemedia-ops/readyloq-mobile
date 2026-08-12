import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * POST /api/integrations/sync — tenant-isolation and error-handling tests.
 *
 * Invariants:
 *  1. 422 when the company has no active integration config.
 *  2. 404 when the requested inspection belongs to a different company.
 *  3. 422 when the inspection is not yet finalized.
 *  4. Successful sync passes the correct payload to syncInspectionToExternalSystem.
 */

// ── Auth mock ─────────────────────────────────────────────────────────────────
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

// ── Pool mock ─────────────────────────────────────────────────────────────────
// The sync route uses pool.connect() to run an advisory-lock transaction before
// calling the external system.  We intercept this so tests stay fast and
// self-contained.  By default the mock simulates: lock acquired, no cached
// result, transaction committed successfully.
const { poolClientMock } = vi.hoisted(() => {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { poolClientMock: client };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const poolMock = {
    connect: vi.fn(async () => poolClientMock),
  };
  return { ...actual, pool: poolMock };
});

// ── External-system adapter mock ──────────────────────────────────────────────
// Import the real type so vi.fn is typed correctly (mock.calls[0] is a tuple
// matching the function's parameter list, not the zero-element tuple '[]').
import type { syncInspectionToExternalSystem as SyncFn } from "../services/field-integration";

const { syncMock } = vi.hoisted(() => ({
  syncMock: vi.fn<typeof SyncFn>(async () => ({
    success: true,
    externalSystem: "pestpac" as const,
    postedNotes: true,
    attachmentsPosted: 0,
    noteRetries: 0,
    attachmentRetries: 0,
  })),
}));

vi.mock("../services/field-integration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/field-integration")>();
  return { ...actual, syncInspectionToExternalSystem: syncMock };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import app from "../app";
import {
  db,
  companiesTable,
  usersTable,
  inspectionsTable,
  companyFieldIntegrationsTable,
  inspectionSyncLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Test fixtures ─────────────────────────────────────────────────────────────
const OWNER_ID = "intsync_owner_clerk";
const OUTSIDER_ID = "intsync_outsider_clerk";

let companyId: number;
let otherCompanyId: number;
let completedInspectionId: number;
let pendingInspectionId: number;
let otherInspectionId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

beforeAll(async () => {
  // Companies
  for (const [slug, name] of [
    ["intsync-co", "IntSync Co"],
    ["intsync-other-co", "IntSync Other Co"],
  ] as const) {
    const [existing] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.slug, slug));
    const id = existing
      ? existing.id
      : (await db.insert(companiesTable).values({ name, slug }).returning())[0].id;
    if (slug === "intsync-co") companyId = id;
    else otherCompanyId = id;
  }

  // Users
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_ID));
  await db.insert(usersTable).values({ clerkUserId: OWNER_ID, role: "owner", companyId });
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OUTSIDER_ID));
  await db.insert(usersTable).values({ clerkUserId: OUTSIDER_ID, role: "owner", companyId: otherCompanyId });

  // Inspections
  const [completed] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: "42 Sync Lane",
      technicianName: "Tech",
      status: "completed",
    })
    .returning();
  completedInspectionId = completed.id;

  const [pending] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: "43 Pending St",
      technicianName: "Tech",
      status: "pending",
    })
    .returning();
  pendingInspectionId = pending.id;

  const [other] = await db
    .insert(inspectionsTable)
    .values({
      companyId: otherCompanyId,
      siteAddress: "99 Other Co Blvd",
      technicianName: "Tech",
      status: "completed",
    })
    .returning();
  otherInspectionId = other.id;
});

beforeEach(() => {
  asUser(null);
  syncMock.mockClear();
  poolClientMock.query.mockClear();
  poolClientMock.release.mockClear();
  // Reset to default: lock acquired, no cooldown hit
  poolClientMock.query.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory_xact_lock")) {
      return { rows: [{ locked: true }] };
    }
    return { rows: [] };
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/integrations/sync", () => {
  describe("422 — no active integration configured", () => {
    it("returns 422 when the company has no integration config row", async () => {
      // Ensure no config exists for this company
      await db
        .delete(companyFieldIntegrationsTable)
        .where(eq(companyFieldIntegrationsTable.companyId, companyId));

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/no active field-service integration/i);
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("returns 422 when the integration config exists but is disabled", async () => {
      await db.delete(companyFieldIntegrationsTable).where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-disabled",
        apiKey: "key-disabled",
        enabled: false,
      });

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/no active field-service integration/i);
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("404 — inspection belongs to another company", () => {
    beforeEach(async () => {
      // Ensure company has a valid integration config
      await db.delete(companyFieldIntegrationsTable).where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-tenant",
        apiKey: "key-tenant",
        enabled: true,
      });
    });

    it("returns 404 when the inspection ID belongs to a different company", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: otherInspectionId });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("does not reveal the existence of the foreign inspection via error shape", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: otherInspectionId });

      // Must be the same 404 shape as "not found" — no extra fields leaking data
      expect(res.status).toBe(404);
      expect(Object.keys(res.body)).toEqual(["error"]);
    });

    it("outsider using their own valid config still cannot sync another company's inspection", async () => {
      // Give the outsider company a config too
      await db.delete(companyFieldIntegrationsTable).where(eq(companyFieldIntegrationsTable.companyId, otherCompanyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId: otherCompanyId,
        systemType: "fieldroutes",
        accountId: "acc-outsider",
        apiKey: "key-outsider",
        enabled: true,
      });

      // Outsider tries to sync the primary company's inspection
      asUser(OUTSIDER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(404);
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("422 — inspection not yet finalized", () => {
    beforeEach(async () => {
      await db.delete(companyFieldIntegrationsTable).where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-finalize",
        apiKey: "key-finalize",
        enabled: true,
      });
    });

    it("returns 422 when the inspection is still pending", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: pendingInspectionId });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/not yet finalized/i);
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("returns 422 for a freshly-created (draft) inspection", async () => {
      asUser(OWNER_ID);
      const created = await request(app)
        .post("/api/inspections")
        .send({ siteAddress: "Draft Sync Ave", technicianName: "Tech" });
      expect(created.status).toBe(201);

      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: created.body.id });

      expect(res.status).toBe(422);
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("successful sync", () => {
    beforeEach(async () => {
      // Clean up any stale sync logs for the completed inspection
      await db
        .delete(inspectionSyncLogsTable)
        .where(
          and(
            eq(inspectionSyncLogsTable.inspectionId, completedInspectionId),
            eq(inspectionSyncLogsTable.companyId, companyId),
          ),
        );

      await db.delete(companyFieldIntegrationsTable).where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-success",
        apiKey: "key-success",
        enabled: true,
      });
    });

    it("calls syncInspectionToExternalSystem with the correct system and account", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(200);
      expect(syncMock).toHaveBeenCalledTimes(1);

      const payload = syncMock.mock.calls[0][0];
      expect(payload.externalSystem).toBe("pestpac");
      expect(payload.accountId).toBe("acc-success");
    });

    it("never forwards the api_key to the client response", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(200);
      // The api_key must not appear anywhere in the JSON body
      const body = JSON.stringify(res.body);
      expect(body).not.toContain("key-success");
    });

    it("passes inspectionDate derived from the inspection record", async () => {
      asUser(OWNER_ID);
      await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      const payload = syncMock.mock.calls[0][0];
      // inspectionDate must be a YYYY-MM-DD string
      expect(payload.inspectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns the result from syncInspectionToExternalSystem directly", async () => {
      syncMock.mockResolvedValueOnce({
        success: true,
        externalSystem: "pestpac" as const,
        postedNotes: true,
        attachmentsPosted: 3,
        noteRetries: 0,
        attachmentRetries: 0,
      });

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.attachmentsPosted).toBe(3);
    });

    it("writes a success log so the cooldown idempotency guard can work", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(200);

      const [log] = await db
        .select()
        .from(inspectionSyncLogsTable)
        .where(
          and(
            eq(inspectionSyncLogsTable.inspectionId, completedInspectionId),
            eq(inspectionSyncLogsTable.companyId, companyId),
          ),
        );
      expect(log).toBeTruthy();
      expect(log.success).toBe(true);
      expect(log.systemType).toBe("pestpac");
    });

    it("accepts a 'complete' status (older spelling) as finalized", async () => {
      // Insert an inspection with legacy status 'complete'
      const [legacyInspection] = await db
        .insert(inspectionsTable)
        .values({
          companyId,
          siteAddress: "Legacy Status Rd",
          technicianName: "Tech",
          status: "complete",
        })
        .returning();

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: legacyInspection.id });

      expect(res.status).toBe(200);
      expect(syncMock).toHaveBeenCalledTimes(1);

      // Cleanup
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, legacyInspection.id));
    });
  });

  describe("input validation", () => {
    it("returns 400 for a missing inspectionId", async () => {
      asUser(OWNER_ID);
      const res = await request(app).post("/api/integrations/sync").send({});
      expect(res.status).toBe(400);
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a non-integer inspectionId", async () => {
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: "not-a-number" });
      expect(res.status).toBe(400);
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("returns 401 for an unauthenticated request", async () => {
      asUser(null);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });
      expect(res.status).toBe(401);
      expect(syncMock).not.toHaveBeenCalled();
    });
  });
});
