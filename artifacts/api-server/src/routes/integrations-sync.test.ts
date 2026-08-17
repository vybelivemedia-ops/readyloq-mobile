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
// The sync route acquires a session-level advisory lock (pg_try_advisory_lock)
// that spans the full critical section — cooldown check → external call →
// success-log write — and releases it explicitly via pg_advisory_unlock in a
// finally block.  We intercept pool.connect() so tests stay fast and
// self-contained.
//
// Default behaviour: lock acquired on first attempt, unlock is a no-op.
const { poolClientMock } = vi.hoisted(() => {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: true }] };
      }
      // pg_advisory_unlock, BEGIN, COMMIT, ROLLBACK, etc. — no-op by default.
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
    attachmentErrors: 0,
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
  // Reset to default: session lock acquired, unlock is a no-op.
  poolClientMock.query.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) {
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
        attachmentErrors: 0,
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

  describe("cooldown cache — cross-tenant isolation", () => {
    // Ensure both companies have active integration configs and there is a
    // recent successful sync log seeded for company A's inspection.
    beforeEach(async () => {
      // Company A config
      await db
        .delete(companyFieldIntegrationsTable)
        .where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-cooldown-a",
        apiKey: "key-cooldown-a",
        enabled: true,
      });

      // Company B config
      await db
        .delete(companyFieldIntegrationsTable)
        .where(eq(companyFieldIntegrationsTable.companyId, otherCompanyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId: otherCompanyId,
        systemType: "pestpac",
        accountId: "acc-cooldown-b",
        apiKey: "key-cooldown-b",
        enabled: true,
      });

      // Seed a fresh successful sync log for company A's inspection so the
      // cooldown window is active.
      await db
        .delete(inspectionSyncLogsTable)
        .where(eq(inspectionSyncLogsTable.inspectionId, completedInspectionId));
      await db.insert(inspectionSyncLogsTable).values({
        companyId,
        inspectionId: completedInspectionId,
        systemType: "pestpac",
        success: true,
        errorMessage: null,
        resultJson: {
          success: true,
          externalSystem: "pestpac",
          postedNotes: true,
          attachmentsPosted: 0,
          noteRetries: 0,
          attachmentRetries: 0,
        },
      });
    });

    it("company B is not served company A's cached cooldown result for the same inspectionId", async () => {
      // Company A owns completedInspectionId. Company B attempting to sync
      // that same ID must receive a 404 (inspection not found), NOT a 200
      // carrying company A's cached result.
      asUser(OUTSIDER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
      // The external sync adapter must never be called — the route must have
      // rejected before reaching the cooldown or sync stage.
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("company A still receives its own cached result after company B's rejected attempt", async () => {
      // First confirm company B is rejected.
      asUser(OUTSIDER_ID);
      const rejectedRes = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });
      expect(rejectedRes.status).toBe(404);

      // Now company A's request should hit the cooldown and get the cached
      // result (pool mock returns locked=true and the real DB has the log row).
      // We have to make the pool mock's cooldown path return the cached row via
      // the drizzle query (which is not mocked — it hits the real test DB).
      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      // Cooldown cache hit → 200 with _idempotent flag, no external call.
      expect(res.status).toBe(200);
      expect(res.body._idempotent).toBe(true);
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("cooldown — failed attempts are always retryable", () => {
    // Ensure company has an active config and the completed inspection's sync
    // logs are wiped so each test starts from a known state.
    beforeEach(async () => {
      await db
        .delete(companyFieldIntegrationsTable)
        .where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-retry",
        apiKey: "key-retry",
        enabled: true,
      });

      await db
        .delete(inspectionSyncLogsTable)
        .where(
          and(
            eq(inspectionSyncLogsTable.inspectionId, completedInspectionId),
            eq(inspectionSyncLogsTable.companyId, companyId),
          ),
        );
    });

    it("proceeds when the only recent log is a failure — does not return 409 or a cached response", async () => {
      // Seed a failed log inside the cooldown window.
      await db.insert(inspectionSyncLogsTable).values({
        companyId,
        inspectionId: completedInspectionId,
        systemType: "pestpac",
        success: false,
        errorMessage: "External system returned 500",
        resultJson: null,
      });

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      // Must not be a cooldown rejection (409) or a cached response.
      expect(res.status).toBe(200);
      expect(res.body._idempotent).toBeUndefined();
      // The external adapter must have been called exactly once.
      expect(syncMock).toHaveBeenCalledTimes(1);
    });

    it("returns the cached result when the only recent log is a success — contrast test", async () => {
      // Seed a successful log inside the cooldown window.
      const cachedResult = {
        success: true,
        externalSystem: "pestpac",
        postedNotes: true,
        attachmentsPosted: 2,
        noteRetries: 0,
        attachmentRetries: 0,
      };
      await db.insert(inspectionSyncLogsTable).values({
        companyId,
        inspectionId: completedInspectionId,
        systemType: "pestpac",
        success: true,
        errorMessage: null,
        resultJson: cachedResult,
      });

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      // Must return the cached result with the _idempotent flag set.
      expect(res.status).toBe(200);
      expect(res.body._idempotent).toBe(true);
      expect(res.body.attachmentsPosted).toBe(2);
      // The external adapter must NOT have been called.
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("advisory lock — concurrent sync prevention", () => {
    // Ensure company has an active integration config and no stale sync logs
    // so neither request hits the cooldown cache before the lock is reached.
    beforeEach(async () => {
      await db
        .delete(inspectionSyncLogsTable)
        .where(
          and(
            eq(inspectionSyncLogsTable.inspectionId, completedInspectionId),
            eq(inspectionSyncLogsTable.companyId, companyId),
          ),
        );

      await db
        .delete(companyFieldIntegrationsTable)
        .where(eq(companyFieldIntegrationsTable.companyId, companyId));
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType: "pestpac",
        accountId: "acc-concurrent",
        apiKey: "key-concurrent",
        enabled: true,
      });
    });

    it("request 2 gets 409 while request 1 is actively calling the external system", async () => {
      // This test validates that the session advisory lock is still held DURING
      // the external sync call — not just during the cooldown check.
      //
      // Mechanism:
      //   1. The pool mock tracks a stateful "lock held" flag:
      //      pg_try_advisory_lock succeeds once (request 1) and returns false
      //      thereafter; pg_advisory_unlock clears the flag.
      //   2. syncMock uses a deferred promise so request 1 pauses at the adapter
      //      call site; it also sets a flag the moment it is entered.
      //   3. Request 1 is started imperatively via .end(cb) so the HTTP request
      //      is initiated immediately (supertest defers the request until await
      //      when you use the promise API).  We wait for request 1 to reach the
      //      adapter via vi.waitFor on the flag before sending request 2.

      let lockHeld = false;
      poolClientMock.query.mockImplementation(async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          if (lockHeld) return { rows: [{ locked: false }] };
          lockHeld = true;
          return { rows: [{ locked: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          lockHeld = false;
          return { rows: [] };
        }
        return { rows: [] };
      });

      // Deferred adapter: request 1 pauses here; the flag tells us it arrived.
      let req1InAdapter = false;
      let resolveSync!: (v: Awaited<ReturnType<typeof syncMock>>) => void;
      const syncDeferred = new Promise<Awaited<ReturnType<typeof syncMock>>>(
        (resolve) => { resolveSync = resolve; },
      );
      syncMock.mockImplementationOnce(async () => {
        req1InAdapter = true;
        return syncDeferred;
      });

      asUser(OWNER_ID);

      // Wrap request 1 in a real Promise so it resolves as soon as the HTTP
      // response arrives — supertest's promise API is lazy (only fires when
      // awaited); .end(cb) starts the request immediately.
      const req1Done = new Promise<{ status: number; body: Record<string, unknown> }>(
        (resolve) => {
          request(app)
            .post("/api/integrations/sync")
            .send({ inspectionId: completedInspectionId })
            .end((_err, res) => resolve(res));
        },
      );

      // Wait until request 1 has acquired the lock and entered the adapter.
      await vi.waitFor(() => req1InAdapter, { timeout: 10_000 });

      // Request 2 arrives while the lock is still held by request 1.
      const req2 = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(req2.status).toBe(409);
      expect(req2.body.error).toMatch(/sync already in progress/i);

      // Unblock request 1 — it now completes, writes the log, and releases the lock.
      resolveSync({
        success: true,
        externalSystem: "pestpac" as const,
        postedNotes: true,
        attachmentsPosted: 0,
        noteRetries: 0,
        attachmentRetries: 0,
        attachmentErrors: 0,
      });

      // Wait for request 1's HTTP response to arrive.
      const req1 = await req1Done;

      expect(req1.status).toBe(200);
      // The external adapter must have been called exactly once.
      expect(syncMock).toHaveBeenCalledTimes(1);
    }, 15_000);

    it("the 409 body carries only the error field — no inspection data leaks", async () => {
      // When locked=false the route must return immediately with a minimal body.
      poolClientMock.query.mockImplementation(async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      });

      asUser(OWNER_ID);
      const res = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });

      expect(res.status).toBe(409);
      expect(Object.keys(res.body)).toEqual(["error"]);
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("the session lock is released after the sync so the next request can proceed", async () => {
      // pg_advisory_unlock must be called (lockHeld reset to false) after the
      // sync so a subsequent non-racing request can acquire the lock and succeed.
      let unlockCalled = false;
      let lockHeld = false;
      poolClientMock.query.mockImplementation(async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          if (lockHeld) return { rows: [{ locked: false }] };
          lockHeld = true;
          return { rows: [{ locked: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          lockHeld = false;
          unlockCalled = true;
          return { rows: [] };
        }
        return { rows: [] };
      });

      asUser(OWNER_ID);

      // First request — should succeed and release the lock.
      const res1 = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });
      expect(res1.status).toBe(200);
      expect(unlockCalled).toBe(true);

      // Clean up the success log so the second request is not served the cache.
      await db
        .delete(inspectionSyncLogsTable)
        .where(
          and(
            eq(inspectionSyncLogsTable.inspectionId, completedInspectionId),
            eq(inspectionSyncLogsTable.companyId, companyId),
          ),
        );

      // Second request — lock is free again, should also succeed.
      const res2 = await request(app)
        .post("/api/integrations/sync")
        .send({ inspectionId: completedInspectionId });
      expect(res2.status).toBe(200);
      expect(syncMock).toHaveBeenCalledTimes(2);
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
