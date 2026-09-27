import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

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

import app from "../app";
import { migrateMissionControl } from "../lib/migrate-mission-control";
import {
  db,
  analysisResultsTable,
  companiesTable,
  companyInvitesTable,
  missionControlApprovalsTable,
  missionControlAuditTable,
  inspectionsTable,
  metaGlassesSessionsTable,
  errorEventsTable,
  missionControlIncidentsTable,
  propertyProfilesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const REQUESTOR = "mission_control_requestor";
const APPROVER = "mission_control_approver";
const REGULAR_USER = "mission_control_regular";
const TARGET_USER = "mission_control_access_target";
const INVITEE = "mission_control_suspended_invitee";
const COMPANY_SLUG = "mission-control-test-company";

let companyId: number;

function asUser(userId: string | null) {
  authState.userId = userId;
}

beforeAll(async () => {
  await migrateMissionControl();
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, COMPANY_SLUG));
  companyId = existing?.id ?? (await db.insert(companiesTable).values({
    name: "Mission Control Test Company",
    slug: COMPANY_SLUG,
  }).returning())[0]!.id;
  await db.update(companiesTable).set({ accessSuspended: false }).where(eq(companiesTable.id, companyId));
  await db.delete(missionControlApprovalsTable).where(inArray(missionControlApprovalsTable.requestedBy, [REQUESTOR, APPROVER]));
  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, [REQUESTOR, APPROVER, REGULAR_USER, TARGET_USER, INVITEE]));
  await db.insert(usersTable).values([
    { clerkUserId: REQUESTOR, companyId, role: "owner", isSuperAdmin: true },
    { clerkUserId: APPROVER, companyId, role: "owner", isSuperAdmin: true },
    { clerkUserId: REGULAR_USER, companyId, role: "owner", isSuperAdmin: false },
    { clerkUserId: TARGET_USER, companyId, role: "technician", betaAccess: true },
    { clerkUserId: INVITEE, companyId: null, role: "technician" },
  ]);
});

afterAll(async () => {
  await db.delete(missionControlApprovalsTable).where(inArray(missionControlApprovalsTable.requestedBy, [REQUESTOR, APPROVER]));
  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, [REQUESTOR, APPROVER, REGULAR_USER, TARGET_USER, INVITEE]));
});

describe("Mission Control authentication and approval actions", () => {
  it("returns authoritative platform identity to authenticated users while protecting platform directories", async () => {
    asUser(null);
    await request(app).get("/api/mission-control/me").expect(401);

    asUser(REGULAR_USER);
    const regular = await request(app).get("/api/mission-control/me").expect(200);
    expect(regular.body).toEqual({ userId: REGULAR_USER, isSuperAdmin: false });
    await request(app).get("/api/mission-control/companies").expect(403);
    await request(app).get("/api/mission-control/properties").expect(403);

    asUser(REQUESTOR);
    const response = await request(app).get("/api/mission-control/me").expect(200);
    expect(response.body).toEqual({ userId: REQUESTOR, isSuperAdmin: true });
  });

  it("reports aggregate AI analysis outcomes from the last 24 hours", async () => {
    asUser(REQUESTOR);
    const before = await request(app).get("/api/mission-control/overview").expect(200);
    const baseline = before.body.aiAnalysisHealth;
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId,
      siteAddress: "Mission Control AI health test",
      technicianId: TARGET_USER,
      technicianName: "Mission Control AI Health Test",
    }).returning();
    const insertedAt = new Date();
    const inserted = await db.insert(analysisResultsTable).values([
      { companyId, inspectionId: inspection!.id, status: "complete", createdAt: insertedAt },
      { companyId, inspectionId: inspection!.id, status: "failed", createdAt: insertedAt },
      { companyId, inspectionId: inspection!.id, status: "pending", createdAt: insertedAt },
    ]).returning({ id: analysisResultsTable.id });

    try {
      const response = await request(app).get("/api/mission-control/overview").expect(200);
      expect(response.body.aiAnalysisHealth).toMatchObject({
        windowHours: 24,
        completedCount: baseline.completedCount + 1,
        failedCount: baseline.failedCount + 1,
        pendingCount: baseline.pendingCount + 1,
      });
      expect(Object.keys(response.body.aiAnalysisHealth).sort()).toEqual([
        "completedCount", "failedCount", "latestResultAt", "pendingCount", "windowHours",
      ]);
      expect(new Date(response.body.aiAnalysisHealth.latestResultAt).getTime()).toBeGreaterThanOrEqual(insertedAt.getTime());
    } finally {
      await db.delete(analysisResultsTable).where(inArray(analysisResultsTable.id, inserted.map((row) => row.id)));
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
    }
  });

  it("records requests atomically, rejects self-approval, and applies company access only after another admin approves", async () => {
    asUser(REQUESTOR);
    const created = await request(app)
      .post("/api/mission-control/approvals/requests")
      .send({
        targetType: "company",
        targetId: String(companyId),
        action: "suspend",
        reason: "Security investigation",
        idempotencyKey: "mc-company-suspend-once",
      })
      .expect(201);
    const approvalId = created.body.id as number;

    await request(app).post(`/api/mission-control/approvals/${approvalId}/decision`)
      .send({ decision: "approve", note: "Reviewed" }).expect(403);
    const [stillPending] = await db.select().from(missionControlApprovalsTable)
      .where(eq(missionControlApprovalsTable.id, approvalId));
    expect(stillPending?.status).toBe("pending");

    asUser(APPROVER);
    const decision = await request(app).post(`/api/mission-control/approvals/${approvalId}/decision`)
      .send({ decision: "approve", note: "Verified incident" }).expect(200);
    expect(decision.body.status).toBe("approved");
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    expect(company?.accessSuspended).toBe(true);

    await request(app).post(`/api/mission-control/companies/${companyId}/access`)
      .send({ action: "suspend", approvalId, reason: "Security investigation" }).expect(200);

    const audit = await db.select().from(missionControlAuditTable)
      .where(eq(missionControlAuditTable.targetId, String(companyId)));
    expect(audit.some((entry) => entry.action === "company_suspend")).toBe(true);

    asUser(TARGET_USER);
    await request(app).get("/api/inspections").expect(403);
  });

  it("rejects an opposite pending access approval after newer state has changed", async () => {
    await db.update(companiesTable).set({ accessSuspended: false }).where(eq(companiesTable.id, companyId));
    asUser(REQUESTOR);
    const suspend = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "company",
      targetId: String(companyId),
      action: "suspend",
      reason: "Suspend for review",
      idempotencyKey: "mc-stale-suspend",
    }).expect(201);
    const enable = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "company",
      targetId: String(companyId),
      action: "enable",
      reason: "Enable after review",
      idempotencyKey: "mc-stale-enable",
    }).expect(201);

    asUser(APPROVER);
    await request(app).post(`/api/mission-control/approvals/${suspend.body.id}/decision`)
      .send({ decision: "approve", note: "Suspend confirmed" }).expect(200);
    const stale = await request(app).post(`/api/mission-control/approvals/${enable.body.id}/decision`)
      .send({ decision: "approve", note: "Enable confirmed" }).expect(409);
    expect(stale.body.error).toContain("stale");
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    const [stillPending] = await db.select().from(missionControlApprovalsTable)
      .where(eq(missionControlApprovalsTable.id, enable.body.id));
    expect(company?.accessSuspended).toBe(true);
    expect(stillPending?.status).toBe("pending");
  });

  it("blocks suspended tenant entrypoints while leaving account and platform diagnostics available", async () => {
    await db.update(companiesTable).set({ accessSuspended: true }).where(eq(companiesTable.id, companyId));
    asUser(TARGET_USER);
    let inviteId: number | undefined;
    try {
      const guardedRequests = [
        request(app).post("/api/storage/uploads/request-url").send({}),
        request(app).get("/api/auth/invites"),
        request(app).post("/api/meta-glasses/session").send({}),
        request(app).get("/api/client/me"),
        request(app).get("/api/billing/license"),
      ];
      for (const response of await Promise.all(guardedRequests)) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("company_access_suspended");
      }
      const [invite] = await db.insert(companyInvitesTable).values({
        companyId,
        token: "mission-control-suspended-invite",
        role: "technician",
      }).returning();
      inviteId = invite!.id;
      asUser(INVITEE);
      await request(app).post("/api/auth/accept-invite").send({ token: invite!.token })
        .expect(403).expect(({ body }) => expect(body.code).toBe("company_access_suspended"));
      const [invitee] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, INVITEE));
      expect(invitee?.companyId).toBeNull();
      asUser(TARGET_USER);
      await request(app).get("/api/auth/me").expect(200);
      await request(app).get("/api/healthz").expect(200);
      asUser(APPROVER);
      await request(app).get("/api/mission-control/me").expect(200);
    } finally {
      if (inviteId != null) await db.delete(companyInvitesTable).where(eq(companyInvitesTable.id, inviteId));
      await db.update(companiesTable).set({ accessSuspended: false }).where(eq(companiesTable.id, companyId));
    }
  });

  it("returns technician and numeric device-session details without event payloads or bearer IDs", async () => {
    const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId,
      technicianId: TARGET_USER,
      technicianName: "Mission Control Test Technician",
      siteAddress: "Private address",
    }).returning();
    const bearerId = "mc-private-session-bearer";
    const [session] = await db.insert(metaGlassesSessionsTable).values({
      sessionId: bearerId,
      code: "742913",
      inspectionId: inspection!.id,
      companyId,
      userId: target!.id,
      expiresAt: new Date(Date.now() + 60_000),
      events: [{
        type: "finding",
        timestamp: Date.now(),
        text: "private event payload",
        storagePath: "private/media/url",
      }],
    }).returning();
    let errorEventId: number | undefined;

    try {
      asUser(APPROVER);
      const technician = await request(app).get(`/api/mission-control/technicians/${TARGET_USER}`).expect(200);
      expect(technician.body.id).toBe(TARGET_USER);
      expect(technician.body.inspections.map((row: { id: number }) => row.id)).toContain(inspection!.id);

      const inspectionDetail = await request(app).get(`/api/mission-control/inspections/${inspection!.id}`).expect(200);
      expect(inspectionDetail.body.deviceSessions).toContainEqual(expect.objectContaining({
        id: session!.id,
        userId: TARGET_USER,
      }));

      const detail = await request(app).get(`/api/mission-control/device-sessions/${session!.id}`).expect(200);
      expect(detail.body.id).toBe(session!.id);
      expect(detail.body.inspectionId).toBe(inspection!.id);
      expect(detail.body.userId).toBe(TARGET_USER);
      expect(detail.body.events).toEqual([{ type: "finding", createdAt: expect.any(String) }]);
      expect(JSON.stringify(detail.body)).not.toContain(bearerId);
      expect(JSON.stringify(detail.body)).not.toContain("private event payload");
      expect(JSON.stringify(detail.body)).not.toContain("private/media/url");
      await request(app).get(`/api/mission-control/device-sessions/${bearerId}`).expect(400);

      const [errorEvent] = await db.insert(errorEventsTable).values({
        companyId,
        userId: target!.id,
        category: "ai",
        message: "Private source diagnostic",
        context: { sessionId: bearerId },
        inspectionId: inspection!.id,
      }).returning();
      errorEventId = errorEvent!.id;
      const incidents = await request(app).get("/api/mission-control/incidents?limit=100").expect(200);
      const incident = incidents.body.items.find((item: { sourceId: string }) => item.sourceId === String(errorEvent!.id));
      expect(incident).toMatchObject({
        companyId,
        inspectionId: inspection!.id,
        userId: TARGET_USER,
        sessionId: session!.id,
      });
      expect(JSON.stringify(incident)).not.toContain(bearerId);
      const incidentDetail = await request(app).get(`/api/mission-control/incidents/${incident.id}`).expect(200);
      expect(incidentDetail.body.userId).toBe(TARGET_USER);
    } finally {
      if (errorEventId != null) {
        await db.delete(missionControlIncidentsTable).where(eq(missionControlIncidentsTable.reference, `error:${errorEventId}`));
        await db.delete(errorEventsTable).where(eq(errorEventsTable.id, errorEventId));
      }
      await db.delete(metaGlassesSessionsTable).where(eq(metaGlassesSessionsTable.id, session!.id));
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
    }
  });

  it("serves privacy-safe property directory/detail cross-company only to DB super-admins", async () => {
    const [otherCompany] = await db.insert(companiesTable).values({
      name: "Mission Control Other Property Company",
      slug: "mission-control-other-property-company",
    }).returning();
    const [property] = await db.insert(propertyProfilesTable).values({
      companyId,
      addressKey: "mc-native-property-alpha",
      siteAddress: "123 Private Test Avenue",
      clientName: "Private Client Name",
      propertyType: "Commercial",
      technicianKnowledge: "Confidential access instructions",
      hotspots: [{ zone: "private", description: "Private hotspot", severity: "high" }],
    }).returning();
    const [otherProperty] = await db.insert(propertyProfilesTable).values({
      companyId: otherCompany!.id,
      addressKey: "mc-native-property-beta",
      siteAddress: "456 Other Test Avenue",
      propertyType: "Warehouse",
    }).returning();
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId,
      siteAddress: "123 Private Test Avenue",
      technicianId: TARGET_USER,
      technicianName: "Private Technician",
      clientName: "Private Inspection Client",
    }).returning();
    const [otherInspection] = await db.insert(inspectionsTable).values({
      companyId: otherCompany!.id,
      siteAddress: "456 Other Test Avenue",
      technicianId: TARGET_USER,
      technicianName: "Other Company Technician",
    }).returning();

    try {
      asUser(REGULAR_USER);
      await db.update(usersTable).set({ roleOverride: "owner" }).where(eq(usersTable.clerkUserId, REGULAR_USER));
      await request(app).get("/api/mission-control/properties").expect(403);
      await request(app).get(`/api/mission-control/properties/${property!.id}`).expect(403);

      asUser(APPROVER);
      const scoped = await request(app)
        .get(`/api/mission-control/properties?companyId=${companyId}&search=Private&page=1&limit=10`)
        .expect(200);
      expect(scoped.body.total).toBe(1);
      expect(scoped.body.items[0]).toMatchObject({
        id: property!.id,
        companyId,
        siteAddress: "123 Private Test Avenue",
        inspectionCount: 1,
        latestInspectionId: inspection!.id,
      });
      expect(JSON.stringify(scoped.body)).not.toContain("Private Client Name");
      expect(JSON.stringify(scoped.body)).not.toContain("Confidential access instructions");
      expect(JSON.stringify(scoped.body)).not.toContain("Private hotspot");

      const detail = await request(app).get(`/api/mission-control/properties/${property!.id}`).expect(200);
      expect(detail.body).toMatchObject({
        id: property!.id,
        companyId,
        inspections: [{ id: inspection!.id }],
      });
      expect(detail.body.inspections.map((row: { id: number }) => row.id)).not.toContain(otherInspection!.id);
      expect(JSON.stringify(detail.body)).not.toContain("Private Inspection Client");
      const noCrossCompanyMatch = await request(app)
        .get(`/api/mission-control/properties?companyId=${companyId}&search=Other`)
        .expect(200);
      expect(noCrossCompanyMatch.body.items).toEqual([]);
      await request(app).get(`/api/mission-control/properties/${otherProperty!.id + 1}`).expect(404);
      expect(otherProperty!.id).not.toBe(property!.id);
    } finally {
      await db.update(usersTable).set({ roleOverride: null }).where(eq(usersTable.clerkUserId, REGULAR_USER));
      await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, [inspection!.id, otherInspection!.id]));
      await db.delete(propertyProfilesTable).where(inArray(propertyProfilesTable.id, [property!.id, otherProperty!.id]));
      await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany!.id));
    }
  });

  it("rejects self-lockout and applies user beta access changes only via the approval decision", async () => {
    asUser(REQUESTOR);
    await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user",
      targetId: REQUESTOR,
      action: "beta_disable",
      reason: "cannot disable self",
    }).expect(403);

    const created = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user",
      targetId: TARGET_USER,
      action: "beta_disable",
      reason: "Temporary access pause",
    }).expect(201);
    asUser(APPROVER);
    await request(app).post(`/api/mission-control/approvals/${created.body.id}/decision`)
      .send({ decision: "approve", note: "Approved for investigation" }).expect(200);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    expect(target?.betaAccess).toBe(false);
    await request(app).post(`/api/mission-control/users/${TARGET_USER}/access`)
      .send({ action: "disable", approvalId: created.body.id, reason: "Temporary access pause" }).expect(200);
  });
});