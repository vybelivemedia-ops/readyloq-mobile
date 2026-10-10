import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";

const { authState, clerkLookup, clerkGetUser } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  clerkLookup: vi.fn(),
  clerkGetUser: vi.fn(),
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    clerkClient: { users: { getUserList: clerkLookup, getUser: clerkGetUser } },
  };
});

import app from "../app";
import { migrateMissionControl } from "../lib/migrate-mission-control";
import {
  db,
  missionControlApprovalsTable,
  missionControlAuditTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireSingleAppMapping } from "./super-admin-bootstrap";

const OPERATOR = "bootstrap_test_operator";
const TARGET = "bootstrap_test_target";
const REGULAR = "bootstrap_test_regular";
const TARGET_EMAIL = "vybelivemedia@gmail.com";
const BOOTSTRAP_ACTION = "super_admin_bootstrap_granted";
const BOOTSTRAP_PATH = "/api/mission-control/super-admin/bootstrap";

let operatorAppUserId: number;
let targetAppUserId: number;
let priorAdminIds: number[] = [];

function asUser(userId: string) {
  authState.userId = userId;
}

function clerkResult(options: {
  id?: string;
  email?: string;
  verified?: boolean;
  count?: number;
} = {}) {
  const {
    id = TARGET,
    email = TARGET_EMAIL,
    verified = true,
    count = 1,
  } = options;
  return {
    totalCount: count,
    data: [{
      id,
      primaryEmailAddressId: "primary-email",
      emailAddresses: [{
        id: "primary-email",
        emailAddress: email,
        verification: { status: verified ? "verified" : "unverified" },
      }],
    }],
  };
}

function authorizeDevelopmentBootstrap() {
  vi.stubEnv("CLERK_SECRET_KEY", "development-test-only");
  vi.stubEnv("READYLOQ_SUPER_ADMIN_BOOTSTRAP_ENABLED", "true");
  vi.stubEnv("READYLOQ_SUPER_ADMIN_BOOTSTRAP_OPERATOR_CLERK_ID", OPERATOR);
}

function bootstrapRequest(overrides: {
  requestId?: string;
  reason?: string;
  confirmation?: unknown;
} = {}) {
  return {
    requestId: overrides.requestId ?? randomUUID(),
    reason: overrides.reason ?? "Establish the second Development Super Admin for governance testing",
    confirmation: overrides.confirmation ?? {
      clerkUserId: TARGET,
      appUserId: targetAppUserId,
      verifiedEmail: TARGET_EMAIL,
    },
  };
}

function postBootstrap(body: Record<string, unknown>) {
  return request(app).post(BOOTSTRAP_PATH)
    .set("Authorization", "Bearer development-clerk-session")
    .send(body);
}

// The application enforces append-only audit rows with a DB trigger. Fixture
// cleanup is test-only and disables that trigger only for the targeted DELETE.
async function removeBootstrapTestAudit() {
  await db.execute(sql.raw("ALTER TABLE mission_control_audit DISABLE TRIGGER mission_control_audit_immutable_trigger"));
  try {
    await db.delete(missionControlAuditTable).where(and(
      eq(missionControlAuditTable.action, BOOTSTRAP_ACTION),
      eq(missionControlAuditTable.targetId, TARGET),
    ));
  } finally {
    await db.execute(sql.raw("ALTER TABLE mission_control_audit ENABLE TRIGGER mission_control_audit_immutable_trigger"));
  }
}

beforeAll(async () => {
  await migrateMissionControl();
  const existingAdmins = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.isSuperAdmin, true));
  priorAdminIds = existingAdmins.map((user) => user.id);
  if (priorAdminIds.length) {
    await db.update(usersTable).set({ isSuperAdmin: false })
      .where(inArray(usersTable.id, priorAdminIds));
  }

  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, [OPERATOR, TARGET, REGULAR]));
  const inserted = await db.insert(usersTable).values([
    { clerkUserId: OPERATOR, role: "owner", isSuperAdmin: true },
    { clerkUserId: TARGET, role: "technician", isSuperAdmin: false },
    { clerkUserId: REGULAR, role: "technician", isSuperAdmin: false },
  ]).returning({ id: usersTable.id, clerkUserId: usersTable.clerkUserId });
  operatorAppUserId = inserted.find((user) => user.clerkUserId === OPERATOR)!.id;
  targetAppUserId = inserted.find((user) => user.clerkUserId === TARGET)!.id;
});

beforeEach(async () => {
  authorizeDevelopmentBootstrap();
  await removeBootstrapTestAudit();
  await db.update(usersTable).set({ isSuperAdmin: true }).where(eq(usersTable.id, operatorAppUserId));
  await db.update(usersTable).set({ isSuperAdmin: false }).where(eq(usersTable.id, targetAppUserId));
  await db.update(usersTable).set({ isSuperAdmin: false }).where(eq(usersTable.clerkUserId, REGULAR));
  clerkLookup.mockReset();
  clerkLookup.mockResolvedValue(clerkResult());
  clerkGetUser.mockReset();
  asUser(OPERATOR);
});

afterAll(async () => {
  await removeBootstrapTestAudit();
  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, [OPERATOR, TARGET, REGULAR]));
  if (priorAdminIds.length) {
    await db.update(usersTable).set({ isSuperAdmin: true })
      .where(inArray(usersTable.id, priorAdminIds));
  }
  vi.unstubAllEnvs();
  clerkLookup.mockReset();
  clerkGetUser.mockReset();
});

describe("one-time Mission Control Super Admin bootstrap (Development-only)", () => {
  it("allows only the explicitly configured current Super Admin operator", async () => {
    vi.stubEnv("READYLOQ_SUPER_ADMIN_BOOTSTRAP_OPERATOR_CLERK_ID", "some-other-clerk-user");
    await request(app).get(BOOTSTRAP_PATH).expect(403);
    await postBootstrap(bootstrapRequest()).expect(403);
    expect(clerkLookup).not.toHaveBeenCalled();

    asUser(REGULAR);
    await request(app).get(BOOTSTRAP_PATH).expect(403);
    await postBootstrap(bootstrapRequest()).expect(403);
    expect(clerkLookup).not.toHaveBeenCalled();
  });

  it("requires the explicit server-side Development enable flag", async () => {
    vi.stubEnv("READYLOQ_SUPER_ADMIN_BOOTSTRAP_ENABLED", "false");
    await request(app).get(BOOTSTRAP_PATH).expect(403);
    await postBootstrap(bootstrapRequest()).expect(403);
  });

  it("requires a verified exact target identity and rejects missing or ambiguous Clerk results", async () => {
    clerkLookup.mockResolvedValueOnce(clerkResult({ verified: false }));
    await request(app).get(BOOTSTRAP_PATH).expect(404);

    clerkLookup.mockResolvedValueOnce(clerkResult({ email: "different@example.test" }));
    await request(app).get(BOOTSTRAP_PATH).expect(404);

    clerkLookup.mockResolvedValueOnce({ totalCount: 0, data: [] });
    await request(app).get(BOOTSTRAP_PATH).expect(404);

    clerkLookup.mockResolvedValueOnce({
      ...clerkResult(),
      totalCount: 2,
      data: [
        clerkResult().data[0],
        { ...clerkResult().data[0], id: "second_matching_clerk_subject" },
      ],
    });
    await request(app).get(BOOTSTRAP_PATH).expect(409);

    clerkLookup.mockResolvedValueOnce({ ...clerkResult(), totalCount: 2 });
    await request(app).get(BOOTSTRAP_PATH).expect(409);
  });

  it("refuses an absent target app-user mapping without provisioning a row", async () => {
    clerkLookup.mockResolvedValueOnce(clerkResult({ id: "not_yet_mapped" }));
    const response = await request(app).get(BOOTSTRAP_PATH).expect(409);
    expect(response.body.error).toContain("sign in normally");
    const [row] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, "not_yet_mapped"));
    expect(row).toBeUndefined();
  });

  it("rejects ambiguous duplicate mappings in the single-mapping guard", () => {
    const existing = { id: targetAppUserId, clerkUserId: TARGET };
    expect(requireSingleAppMapping([existing], TARGET)).toEqual(existing);
    expect(requireSingleAppMapping([], TARGET)).toBeNull();
    expect(requireSingleAppMapping([existing, { ...existing, id: existing.id + 1 }], TARGET)).toBeNull();
    expect(requireSingleAppMapping([{ ...existing, clerkUserId: "another-subject" }], TARGET)).toBeNull();
  });

  it("returns the verified target preview and rejects an already-admin target", async () => {
    const preview = await request(app).get(BOOTSTRAP_PATH).expect(200);
    expect(preview.body).toMatchObject({
      clerkUserId: TARGET,
      appUserId: targetAppUserId,
      verifiedEmail: TARGET_EMAIL,
      isSuperAdmin: false,
      bootstrapOperationId: "readyloq:second-production-super-admin:v1",
    });

    // A one-admin fixture cannot also have an already-admin target. This
    // synthetic Clerk result deliberately resolves to the sole operator row
    // to exercise the target-state denial while preserving the one-admin guard.
    clerkLookup.mockResolvedValueOnce(clerkResult({ id: OPERATOR }));
    await request(app).get(BOOTSTRAP_PATH).expect(409);
    const [operator] = await db.select().from(usersTable).where(eq(usersTable.id, operatorAppUserId));
    expect(operator?.isSuperAdmin).toBe(true);
  });

  it("requires a reason, UUID request ID, Clerk session, and confirmation of the exact resolved identity", async () => {
    await postBootstrap({ ...bootstrapRequest(), reason: "  " }).expect(400);
    await postBootstrap({ ...bootstrapRequest(), requestId: "not-a-uuid" }).expect(400);
    await postBootstrap({ ...bootstrapRequest(), confirmation: null }).expect(400);
    await postBootstrap(bootstrapRequest({
      confirmation: { clerkUserId: "wrong-subject", appUserId: targetAppUserId, verifiedEmail: TARGET_EMAIL },
    })).expect(409);
    await postBootstrap(bootstrapRequest({
      confirmation: { clerkUserId: TARGET, appUserId: targetAppUserId + 100, verifiedEmail: TARGET_EMAIL },
    })).expect(409);
    await postBootstrap(bootstrapRequest({
      confirmation: { clerkUserId: TARGET, appUserId: targetAppUserId, verifiedEmail: "wrong@example.test" },
    })).expect(400);
    await request(app).post(BOOTSTRAP_PATH).send(bootstrapRequest()).expect(401);
  });

  it("atomically grants once and records the complete governance audit", async () => {
    const body = bootstrapRequest({ reason: "Verified second Development administrator" });
    const granted = await postBootstrap(body).expect(201);
    expect(granted.body).toMatchObject({
      targetClerkId: TARGET,
      targetUserId: targetAppUserId,
      previousIsSuperAdmin: false,
      isSuperAdmin: true,
      requestId: body.requestId,
      bootstrapOperationId: "readyloq:second-production-super-admin:v1",
      replayed: false,
    });
    expect(granted.body.operationId).toEqual(expect.any(String));
    expect(granted.body.auditId).toEqual(expect.any(Number));

    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetAppUserId));
    const [audit] = await db.select().from(missionControlAuditTable)
      .where(eq(missionControlAuditTable.id, granted.body.auditId));
    expect(target?.isSuperAdmin).toBe(true);
    expect(audit).toMatchObject({
      actorId: OPERATOR,
      action: BOOTSTRAP_ACTION,
      targetType: "user",
      targetId: TARGET,
    });
    expect(audit?.createdAt).toBeInstanceOf(Date);
    expect(audit?.details).toMatchObject({
      bootstrapActor: "explicitly_authorized_sole_super_admin",
      actorClerkId: OPERATOR,
      actorAppUserId: operatorAppUserId,
      targetClerkId: TARGET,
      targetUserId: targetAppUserId,
      verifiedTargetEmail: TARGET_EMAIL,
      previousIsSuperAdmin: false,
      newIsSuperAdmin: true,
      reason: body.reason,
      requestId: body.requestId,
      operationId: granted.body.operationId,
      bootstrapOperationId: "readyloq:second-production-super-admin:v1",
      timestamp: expect.any(String),
    });
    expect(new Date((audit?.details as { timestamp: string }).timestamp).getTime()).not.toBeNaN();
  });

  it("is idempotent for an exact replay and refuses a new operation ID", async () => {
    const body = bootstrapRequest();
    const first = await postBootstrap(body).expect(201);
    const replay = await postBootstrap(body).expect(200);
    expect(replay.body).toMatchObject({
      auditId: first.body.auditId,
      operationId: first.body.operationId,
      requestId: body.requestId,
      replayed: true,
    });
    await postBootstrap({ ...body, requestId: randomUUID() }).expect(410);

    const audits = await db.select().from(missionControlAuditTable)
      .where(and(eq(missionControlAuditTable.action, BOOTSTRAP_ACTION), eq(missionControlAuditTable.targetId, TARGET)));
    expect(audits).toHaveLength(1);
  });

  it("serializes concurrent requests and commits exactly one bootstrap", async () => {
    const firstBody = bootstrapRequest();
    const secondBody = bootstrapRequest();
    const results = await Promise.all([
      postBootstrap(firstBody),
      postBootstrap(secondBody),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 410]);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetAppUserId));
    const audits = await db.select().from(missionControlAuditTable)
      .where(and(eq(missionControlAuditTable.action, BOOTSTRAP_ACTION), eq(missionControlAuditTable.targetId, TARGET)));
    expect(target?.isSuperAdmin).toBe(true);
    expect(audits).toHaveLength(1);
  });

  it("disables bootstrap at two admins and stays disabled after the count later returns to one", async () => {
    const success = await postBootstrap(bootstrapRequest()).expect(201);
    await request(app).get(BOOTSTRAP_PATH).expect(410);
    await postBootstrap(bootstrapRequest()).expect(410);

    // Simulate a later legitimate revocation. The bootstrap audit permanently
    // consumes the one-time capability even after the current count returns to one.
    await db.update(usersTable).set({ isSuperAdmin: false }).where(eq(usersTable.id, targetAppUserId));
    await request(app).get(BOOTSTRAP_PATH).expect(410);
    const retry = await postBootstrap(bootstrapRequest({
      requestId: success.body.requestId,
      reason: "not the original operation",
    })).expect(410);
    expect(retry.body.error).toContain("already been used");
  });

  it("the new administrator can review a later Super Admin grant through normal two-admin approval", async () => {
    await postBootstrap(bootstrapRequest()).expect(201);
    clerkGetUser.mockResolvedValue(clerkResult({ id: REGULAR, email: "third@example.test" }).data[0]);
    const created = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: REGULAR, action: "super_admin_enable",
      verifiedEmail: "third@example.test", reason: "Normal governed grant after bootstrap",
    }).expect(201);
    try {
      asUser(TARGET);
      const decided = await request(app)
        .post(`/api/mission-control/approvals/${created.body.id}/decision`)
        .send({ decision: "approve", note: "Reviewed by distinct newly bootstrapped admin" })
        .expect(200);
      expect(decided.body.grantAuditId).toEqual(expect.any(Number));
      const [third] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, REGULAR));
      expect(third?.isSuperAdmin).toBe(true);
    } finally {
      await db.delete(missionControlApprovalsTable).where(eq(missionControlApprovalsTable.id, created.body.id));
      await db.update(usersTable).set({ isSuperAdmin: false }).where(eq(usersTable.clerkUserId, REGULAR));
    }
  });

  it("removes legacy HMAC token issuance and blocks an ordinary user's elevation attempt", async () => {
    await request(app).post("/api/admin/token-auth")
      .send({ token: "development-test-bootstrap-token" }).expect(404);
    asUser(REGULAR);
    await request(app).patch(`/api/admin/users/${targetAppUserId}`)
      .send({ isSuperAdmin: true }).expect(403);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetAppUserId));
    expect(target?.isSuperAdmin).toBe(false);
  });

  it("fails closed when the governance audit immutability trigger is disabled", async () => {
    await db.execute(sql.raw("ALTER TABLE mission_control_audit DISABLE TRIGGER mission_control_audit_immutable_trigger"));
    try {
      await postBootstrap(bootstrapRequest()).expect(503);
      const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetAppUserId));
      expect(target?.isSuperAdmin).toBe(false);
    } finally {
      await db.execute(sql.raw("ALTER TABLE mission_control_audit ENABLE TRIGGER mission_control_audit_immutable_trigger"));
    }
  });

  it("rolls back the Super Admin flag if the audit insert fails", async () => {
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fail_bootstrap_audit_insert_test()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = '${BOOTSTRAP_ACTION}' THEN
          RAISE EXCEPTION 'forced bootstrap audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_bootstrap_audit_insert_test
      BEFORE INSERT ON mission_control_audit
      FOR EACH ROW EXECUTE FUNCTION fail_bootstrap_audit_insert_test();
    `));
    try {
      await postBootstrap(bootstrapRequest()).expect(500);
      const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetAppUserId));
      const audits = await db.select().from(missionControlAuditTable)
        .where(and(eq(missionControlAuditTable.action, BOOTSTRAP_ACTION), eq(missionControlAuditTable.targetId, TARGET)));
      expect(target?.isSuperAdmin).toBe(false);
      expect(audits).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS fail_bootstrap_audit_insert_test ON mission_control_audit;
        DROP FUNCTION IF EXISTS fail_bootstrap_audit_insert_test();
      `));
    }
  });
});