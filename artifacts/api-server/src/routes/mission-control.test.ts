import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { normalizeAddressKey } from "../lib/property-intelligence";
import {
  MissionControlTimelineEventProvenance,
  MissionControlTimelineEventType,
} from "@workspace/api-zod";
import {
  db,
  analysisResultsTable,
  companiesTable,
  companyInvitesTable,
  missionControlApprovalsTable,
  missionControlAuditTable,
  missionControlInspectionEventsTable,
  inspectionsTable,
  inspectionMediaTable,
  inspectionSyncLogsTable,
  metaGlassesSessionsTable,
  errorEventsTable,
  missionControlIncidentsTable,
  propertyProfilesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

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
  it("returns platform identity only to super admins and denies non-admins, including companyless users", async () => {
    asUser(null);
    await request(app).get("/api/mission-control/me").expect(401);

    asUser(REGULAR_USER);
    const regular = await request(app).get("/api/mission-control/me").expect(403);
    expect(regular.body).toEqual({ error: "Super admin access required", code: "not_super_admin" });
    await request(app).get("/api/mission-control/companies").expect(403);
    await request(app).get("/api/mission-control/properties").expect(403);
    await request(app).get("/api/mission-control/overview").expect(403);

    asUser(INVITEE);
    const companyless = await request(app).get("/api/mission-control/me").expect(403);
    expect(companyless.body.code).toBe("not_super_admin");

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

  it("serves real privacy-safe inspection evidence, analysis, timeline, search, and atomic incident actions", async () => {
    const secretUrl = "https://storage.private.invalid/media/signed-token";
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId,
      siteAddress: "Mission Control MCPhaseTwoTwelve Lane",
      technicianId: TARGET_USER,
      technicianName: "Mission Control Evidence Technician",
      status: "completed",
    }).returning();
    const [property] = await db.insert(propertyProfilesTable).values({
      companyId,
      addressKey: normalizeAddressKey(inspection!.siteAddress),
      siteAddress: inspection!.siteAddress,
      propertyType: "Commercial",
    }).returning();
    const [media] = await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId: inspection!.id,
      mediaType: "photo",
      url: secretUrl,
      filename: "MCPhaseTwoTwelve-photo.jpg",
      captureSource: "phone_camera",
      qualityScore: 87,
      capturedAt: new Date(),
    }).returning();
    const [analysis] = await db.insert(analysisResultsTable).values({
      companyId,
      inspectionId: inspection!.id,
      status: "complete",
      findings: [{
        id: 901,
        category: "pest_activity",
        description: "Live pest evidence persisted for this inspection",
        confidence: 0.91,
        severity: "medium",
        location: "kitchen",
        imageUrl: secretUrl,
        treatment: null,
        exclusionOpportunity: null,
      }],
      analyzedImagePaths: [secretUrl],
      photoOutcomes: [{ imagePath: secretUrl, status: "completed" }],
      photoZones: { [secretUrl]: "kitchen" },
      coverage: {
        propertyType: "commercial",
        completenessPct: 100,
        requiredZones: [{ slug: "kitchen", label: "Kitchen" }],
        coveredRequired: [{ slug: "kitchen", label: "Kitchen" }],
        uncoveredRequired: [],
        suggested: [],
      },
    }).returning();
    const [syncLog] = await db.insert(inspectionSyncLogsTable).values({
      companyId,
      inspectionId: inspection!.id,
      systemType: "pestpac",
      success: false,
      errorMessage: "Bearer secret-bearing-token https://private.integration.invalid/diagnostic",
    }).returning();
    const [errorEvent, secondErrorEvent] = await db.insert(errorEventsTable).values([
      {
        companyId,
        userId: (await db.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.clerkUserId, TARGET_USER)))[0]!.id,
        category: "ai",
        message: "Private server diagnostic",
        inspectionId: inspection!.id,
      },
      {
        companyId,
        category: "auth",
        message: "Another private server diagnostic",
        inspectionId: inspection!.id,
      },
    ]).returning();
    const incidentReferences = [`error:${errorEvent!.id}`, `error:${secondErrorEvent!.id}`];
    try {
      asUser(REGULAR_USER);
      await request(app).get("/api/mission-control/search?q=MCPhaseTwoTwelve").expect(403);
      await request(app).get(`/api/mission-control/inspections/${inspection!.id}/evidence`).expect(403);
      await request(app).get(`/api/mission-control/inspections/${inspection!.id}/analysis`).expect(403);
      await request(app).get(`/api/mission-control/inspections/${inspection!.id}/timeline`).expect(403);

      asUser(REQUESTOR);
      const overview = await request(app).get("/api/mission-control/overview").expect(200);
      expect(overview.body.kpis.failedSyncCount).toBeGreaterThanOrEqual(1);
      expect(overview.body.kpis.inspectionsCompletedCount).toBeGreaterThanOrEqual(1);
      const results = await request(app).get("/api/mission-control/search?q=MCPhaseTwoTwelve").expect(200);
      expect(results.body.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "property", id: String(property!.id), companyId }),
        expect.objectContaining({ kind: "inspection", id: String(inspection!.id), companyId }),
        expect.objectContaining({ kind: "evidence", id: String(media!.id), inspectionId: inspection!.id }),
      ]));

      const evidenceList = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/evidence`).expect(200);
      expect(evidenceList.body.items[0]).toMatchObject({
        id: media!.id,
        inspectionId: inspection!.id,
        companyId,
        processingStatus: "completed",
        analysisStatus: "completed",
        zone: "kitchen",
        findings: [{ id: 901 }],
      });
      const evidenceDetail = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/evidence/${media!.id}`).expect(200);
      expect(evidenceDetail.body.id).toBe(media!.id);

      const analysisDetail = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/analysis`).expect(200);
      expect(analysisDetail.body).toMatchObject({
        inspectionId: inspection!.id,
        state: "completed",
        latestAnalysisId: analysis!.id,
        provider: null,
        model: null,
        runs: [{
          id: analysis!.id,
          findings: [{ id: 901, location: "kitchen" }],
          requiredZones: [{ slug: "kitchen", label: "Kitchen" }],
          coveredZones: [{ slug: "kitchen", label: "Kitchen" }],
        }],
      });
      const timeline = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/timeline`).expect(200);
      expect(timeline.body.items.map((event: { type: string }) => event.type)).toEqual(
        expect.arrayContaining(["inspection", "evidence", "analysis", "sync"]),
      );
      const timelineEntries = timeline.body.items as Array<{
        id: string;
        type: string;
        eventType: string;
        status: string | null;
        occurredAt: string | null;
        recordedAt: string | null;
        observedAt: string | null;
        provenance: string;
        sourceType: string;
        sourceId: string;
        relatedId: number | null;
      }>;
      expect(timelineEntries).toEqual([...timelineEntries].sort((a, b) => {
        const effective = (entry: typeof a) => entry.provenance === "current_state_derived"
          ? entry.observedAt
          : entry.occurredAt ?? entry.recordedAt;
        return new Date(effective(a) ?? Number.POSITIVE_INFINITY).getTime()
          - new Date(effective(b) ?? Number.POSITIVE_INFINITY).getTime()
          || a.id.localeCompare(b.id);
      }));
      expect(timelineEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "inspection",
          eventType: "inspection_state_snapshot",
          status: "completed",
          occurredAt: null,
          provenance: "current_state_derived",
          sourceType: "inspections",
          sourceId: String(inspection!.id),
          relatedId: inspection!.id,
        }),
        expect.objectContaining({
          type: "analysis",
          eventType: "analysis_result_snapshot",
          occurredAt: null,
          provenance: "current_state_derived",
          sourceType: "analysis_results",
          sourceId: String(analysis!.id),
        }),
        expect.objectContaining({
          type: "sync",
          eventType: "sync_attempt",
          status: "failed",
          provenance: "persisted_historical_event",
          sourceType: "inspection_sync_logs",
          sourceId: String(syncLog!.id),
        }),
      ]));
      expect(timelineEntries.every((entry) =>
        Object.values(MissionControlTimelineEventType).includes(entry.type as never)
        && Object.values(MissionControlTimelineEventProvenance).includes(entry.provenance as never),
      )).toBe(true);
      const generatedTimelineEventKeys = [
        "id", "type", "eventType", "status", "occurredAt", "recordedAt",
        "observedAt", "provenance", "sourceType", "sourceId", "companyId",
        "inspectionId", "relatedId", "detail",
      ].sort();
      expect(timelineEntries.every((entry) =>
        Object.keys(entry).sort().join(",") === generatedTimelineEventKeys.join(","),
      )).toBe(true);
      expect(timelineEntries.some((entry) =>
        /analysis[_ .]started|upload[_ .]started|capture[_ .]started/i.test(entry.eventType),
      )).toBe(false);
      const inspectionDetail = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}`).expect(200);
      expect(inspectionDetail.body).toMatchObject({
        propertyId: property!.id,
        siteAddress: inspection!.siteAddress,
        reportStatus: "unavailable",
        requiredZones: [{ slug: "kitchen", label: "Kitchen" }],
      });
      expect(JSON.stringify([
        results.body, evidenceList.body, evidenceDetail.body, analysisDetail.body,
        timeline.body, inspectionDetail.body,
      ])).not.toContain(secretUrl);
      expect(JSON.stringify(timeline.body)).not.toContain("secret-bearing-token");
      expect(JSON.stringify(timeline.body)).not.toContain("private.integration.invalid");

      const incidentList = await request(app)
        .get(`/api/mission-control/incidents?companyId=${companyId}&sourceType=error_event&limit=100`).expect(200);
      const firstIncident = incidentList.body.items.find((item: { sourceId: string }) => item.sourceId === String(errorEvent!.id));
      const secondIncident = incidentList.body.items.find((item: { sourceId: string }) => item.sourceId === String(secondErrorEvent!.id));
      expect(firstIncident).toBeDefined();
      expect(secondIncident).toBeDefined();
      const incidentSearch = await request(app).get(`/api/mission-control/search?q=${firstIncident.id}`).expect(200);
      expect(incidentSearch.body.items).toContainEqual(expect.objectContaining({
        kind: "incident",
        id: String(firstIncident.id),
        companyId,
      }));
      await request(app).get(`/api/mission-control/incidents/${firstIncident.id}`)
        .expect(200).expect(({ body }) => expect(body.id).toBe(firstIncident.id));
      const ackResponses = await Promise.all([
        request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`).send({ action: "acknowledge" }),
        request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`).send({ action: "acknowledge" }),
      ]);
      expect(ackResponses.map((response) => response.status).sort()).toEqual([200, 409]);
      await request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`)
        .send({ action: "assign", assigneeId: TARGET_USER }).expect(400);
      await request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`)
        .send({ action: "escalate", severity: "low" }).expect(400);
      const assigned = await request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`)
        .send({ action: "assign", assigneeId: APPROVER, note: "Reviewed by bearer secret-bearing-token" }).expect(200);
      expect(assigned.body.assignedTo).toBe(APPROVER);
      const resolved = await request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`)
        .send({ action: "resolve", note: "Diagnosis complete" }).expect(200);
      expect(resolved.body.status).toBe("resolved");
      await request(app).patch(`/api/mission-control/incidents/${firstIncident.id}`)
        .send({ action: "resolve" }).expect(409);
      const claimed = await request(app).patch(`/api/mission-control/incidents/${secondIncident.id}`)
        .send({ action: "claim" }).expect(200);
      expect(claimed.body).toMatchObject({ assignedTo: REQUESTOR, status: "investigating" });
      const actionTimeline = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/timeline`).expect(200);
      const committedActionEvents = actionTimeline.body.items.filter((event: {
        type: string;
        provenance: string;
        sourceType: string;
        relatedId: number | null;
        eventType: string;
      }) => event.type === "incident_action"
        && event.provenance === "newly_generated_event"
        && event.sourceType === "mission_control_audit"
        && event.relatedId === firstIncident.id);
      expect(committedActionEvents.map((event: { eventType: string }) => event.eventType))
        .toEqual(expect.arrayContaining(["incident.acknowledge", "incident.assign", "incident.resolve"]));
      expect(committedActionEvents).toHaveLength(3);
      expect(JSON.stringify(actionTimeline.body)).not.toContain("private");
      const auditRows = await db.select().from(missionControlAuditTable)
        .where(eq(missionControlAuditTable.targetId, String(firstIncident.id)));
      const actionAudit = auditRows.find((row) => row.action === "incident_resolve"
        && (row.details as { result?: string } | null)?.result === "applied");
      expect(actionAudit?.details).toMatchObject({
        companyId,
        action: "resolve",
        result: "applied",
        before: { status: "acknowledged", assignedTo: APPROVER },
        after: { status: "resolved", assignedTo: APPROVER },
      });
      expect(JSON.stringify(actionAudit?.details)).not.toContain("secret-bearing-token");
      const incidentAudit = await request(app)
        .get(`/api/mission-control/audit?targetType=incident&targetId=${firstIncident.id}&limit=100`).expect(200);
      const incidentAuditItems = incidentAudit.body.items.map((row: { details: string | null }) => ({
        ...row,
        details: row.details == null ? null : JSON.parse(row.details),
      }));
      expect(incidentAuditItems).toEqual(expect.arrayContaining([
        expect.objectContaining({
          targetType: "incident",
          targetId: String(firstIncident.id),
          action: "incident_assign",
          details: expect.objectContaining({
            companyId,
            action: "assign",
            result: "rejected",
            reason: "Assignee must be an existing super admin",
            before: expect.objectContaining({ status: "acknowledged", assignedTo: null }),
            after: expect.objectContaining({ status: "acknowledged", assignedTo: null }),
          }),
        }),
        expect.objectContaining({
          targetType: "incident",
          targetId: String(firstIncident.id),
          action: "incident_escalate",
          details: expect.objectContaining({
            companyId,
            action: "escalate",
            result: "rejected",
            reason: "Escalation must increase incident severity",
          }),
        }),
      ]));
    } finally {
      await db.delete(missionControlIncidentsTable).where(inArray(missionControlIncidentsTable.reference, incidentReferences));
      await db.delete(errorEventsTable).where(inArray(errorEventsTable.id, [errorEvent!.id, secondErrorEvent!.id]));
      await db.delete(inspectionSyncLogsTable).where(eq(inspectionSyncLogsTable.id, syncLog!.id));
      await db.delete(analysisResultsTable).where(eq(analysisResultsTable.id, analysis!.id));
      await db.delete(inspectionMediaTable).where(eq(inspectionMediaTable.id, media!.id));
      await db.delete(propertyProfilesTable).where(eq(propertyProfilesTable.id, property!.id));
      const appendedTimelineEvents = await db.select({ id: missionControlInspectionEventsTable.id })
        .from(missionControlInspectionEventsTable)
        .where(and(
          eq(missionControlInspectionEventsTable.companyId, companyId),
          eq(missionControlInspectionEventsTable.inspectionId, inspection!.id),
        ));
      // The new ledger is append-only and intentionally retains the source
      // inspection reference once an action event has been committed.
      if (appendedTimelineEvents.length === 0) {
        await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
      }
    }
  });

  it("scopes inspection detail and health metrics by both inspection and company IDs", async () => {
    asUser(REQUESTOR);
    const [companyBefore, overviewBefore] = await Promise.all([
      request(app).get(`/api/mission-control/companies/${companyId}`).expect(200),
      request(app).get("/api/mission-control/overview").expect(200),
    ]);
    const [otherCompany] = await db.insert(companiesTable).values({
      name: "Mission Control Mismatched Row Company",
      slug: "mission-control-mismatched-row-company",
    }).returning();
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId,
      siteAddress: "Mission Control Tenant Match Test",
      technicianId: TARGET_USER,
      technicianName: "Mission Control Tenant Match Technician",
    }).returning();
    const validAt = new Date();
    const laterAt = new Date(validAt.getTime() + 60_000);
    const [validMedia] = await db.insert(inspectionMediaTable).values({
      companyId,
      inspectionId: inspection!.id,
      mediaType: "photo",
      url: "https://storage.private.invalid/valid-tenant-media",
      filename: "valid-tenant-media.jpg",
    }).returning();
    const [foreignMedia] = await db.insert(inspectionMediaTable).values({
      companyId: otherCompany!.id,
      inspectionId: inspection!.id,
      mediaType: "photo",
      url: "https://storage.private.invalid/foreign-tenant-media",
      filename: "foreign-tenant-media.jpg",
    }).returning();
    const [validAnalysis] = await db.insert(analysisResultsTable).values({
      companyId,
      inspectionId: inspection!.id,
      status: "failed",
      failureReason: "Expected matching-tenant failure",
      createdAt: validAt,
    }).returning();
    const [foreignAnalysis] = await db.insert(analysisResultsTable).values({
      companyId: otherCompany!.id,
      inspectionId: inspection!.id,
      status: "complete",
      createdAt: laterAt,
    }).returning();
    const [validSync] = await db.insert(inspectionSyncLogsTable).values({
      companyId,
      inspectionId: inspection!.id,
      systemType: "pestpac",
      success: false,
      syncedAt: validAt,
    }).returning();
    const [foreignSync] = await db.insert(inspectionSyncLogsTable).values({
      companyId: otherCompany!.id,
      inspectionId: inspection!.id,
      systemType: "pestpac",
      success: true,
      syncedAt: laterAt,
    }).returning();
    const [foreignIncident] = await db.insert(missionControlIncidentsTable).values({
      reference: `timeline-foreign-${randomUUID()}`,
      sourceType: "error_event",
      sourceId: randomUUID(),
      companyId: otherCompany!.id,
      inspectionId: inspection!.id,
      status: "open",
      severity: "critical",
    }).returning();

    try {
      const [companyAfter, overviewAfter] = await Promise.all([
        request(app).get(`/api/mission-control/companies/${companyId}`).expect(200),
        request(app).get("/api/mission-control/overview").expect(200),
      ]);
      expect(companyAfter.body.failedSyncCount).toBe(companyBefore.body.failedSyncCount + 1);
      expect(companyAfter.body.failedAnalysisCount).toBe(companyBefore.body.failedAnalysisCount + 1);
      expect(overviewAfter.body.kpis.failedSyncCount).toBe(overviewBefore.body.kpis.failedSyncCount + 1);
      expect(overviewAfter.body.kpis.failedAnalysisCount).toBe(overviewBefore.body.kpis.failedAnalysisCount + 1);

      const detail = await request(app).get(`/api/mission-control/inspections/${inspection!.id}`).expect(200);
      expect(detail.body.mediaCounts.total).toBe(1);
      expect(detail.body.media).toEqual([expect.objectContaining({ id: validMedia!.id })]);
      expect(detail.body.syncLogs.map((row: { id: number }) => row.id)).toEqual([validSync!.id]);
      const evidence = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/evidence`).expect(200);
      expect(evidence.body.items.map((row: { id: number }) => row.id)).toEqual([validMedia!.id]);
      const analysis = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/analysis`).expect(200);
      expect(analysis.body.runs.map((row: { id: number }) => row.id)).toEqual([validAnalysis!.id]);
      const timeline = await request(app)
        .get(`/api/mission-control/inspections/${inspection!.id}/timeline`).expect(200);
      expect(timeline.body.items.map((row: { relatedId: number }) => row.relatedId))
        .not.toContain(foreignMedia!.id);
      expect(timeline.body.items.map((row: { relatedId: number }) => row.relatedId))
        .not.toContain(foreignAnalysis!.id);
      expect(timeline.body.items.map((row: { relatedId: number }) => row.relatedId))
        .not.toContain(foreignSync!.id);
      expect(timeline.body.items.map((row: { relatedId: number }) => row.relatedId))
        .not.toContain(foreignIncident!.id);
      const foreignCompany = await request(app)
        .get(`/api/mission-control/companies/${otherCompany!.id}`).expect(200);
      expect(foreignCompany.body).toMatchObject({
        inspectionCount: 0,
        failedSyncCount: 0,
        failedAnalysisCount: 0,
      });
    } finally {
      await db.delete(inspectionSyncLogsTable).where(inArray(inspectionSyncLogsTable.id, [validSync!.id, foreignSync!.id]));
      await db.delete(analysisResultsTable).where(inArray(analysisResultsTable.id, [validAnalysis!.id, foreignAnalysis!.id]));
      await db.delete(inspectionMediaTable).where(inArray(inspectionMediaTable.id, [validMedia!.id, foreignMedia!.id]));
      await db.delete(missionControlIncidentsTable).where(eq(missionControlIncidentsTable.id, foreignIncident!.id));
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
      await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany!.id));
    }
  });

  it("reconciles a failed sync incident after a later successful sync", async () => {
    asUser(REQUESTOR);
    const baseline = await request(app).get("/api/mission-control/overview").expect(200);
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId,
      siteAddress: "Mission Control Recovered Sync Test",
      technicianId: TARGET_USER,
      technicianName: "Mission Control Recovered Sync Technician",
    }).returning();
    const failedAt = new Date(Date.now() - 60_000);
    const [failure] = await db.insert(inspectionSyncLogsTable).values({
      companyId,
      inspectionId: inspection!.id,
      systemType: "pestpac",
      success: false,
      errorMessage: "Historical failure",
      syncedAt: failedAt,
    }).returning();
    let incidentId: number | undefined;

    try {
      const failedMetrics = await request(app).get("/api/mission-control/overview").expect(200);
      expect(failedMetrics.body.kpis.failedSyncCount).toBe(baseline.body.kpis.failedSyncCount + 1);
      expect(failedMetrics.body.kpis.openIncidentCount).toBe(baseline.body.kpis.openIncidentCount + 1);
      const failedList = await request(app)
        .get(`/api/mission-control/incidents?companyId=${companyId}&sourceType=sync_log&limit=100`).expect(200);
      const historical = failedList.body.items.find((item: { sourceId: string }) => item.sourceId === String(failure!.id));
      expect(historical).toMatchObject({ status: "open", sourceType: "sync_log" });
      incidentId = historical.id;
      expect(Number.isSafeInteger(incidentId)).toBe(true);
      const sourceSearch = await request(app).get(`/api/mission-control/search?q=${failure!.id}`).expect(200);
      expect(sourceSearch.body.items).toContainEqual(expect.objectContaining({
        kind: "incident",
        id: String(incidentId),
        title: "Field synchronization failed",
      }));

      await db.insert(inspectionSyncLogsTable).values({
        companyId,
        inspectionId: inspection!.id,
        systemType: "pestpac",
        success: true,
        syncedAt: new Date(failedAt.getTime() + 30_000),
      });
      const recoveredMetrics = await request(app).get("/api/mission-control/overview").expect(200);
      expect(recoveredMetrics.body.kpis.failedSyncCount).toBe(baseline.body.kpis.failedSyncCount);
      expect(recoveredMetrics.body.kpis.openIncidentCount).toBe(baseline.body.kpis.openIncidentCount);
      const active = await request(app)
        .get(`/api/mission-control/incidents?companyId=${companyId}&sourceType=sync_log&status=open&limit=100`).expect(200);
      expect(active.body.items.some((item: { id: number }) => item.id === incidentId)).toBe(false);
      const resolved = await request(app)
        .get(`/api/mission-control/incidents?companyId=${companyId}&sourceType=sync_log&status=resolved&limit=100`).expect(200);
      expect(resolved.body.items).toContainEqual(expect.objectContaining({
        id: incidentId,
        sourceId: String(failure!.id),
        status: "resolved",
      }));
      const detail = await request(app).get(`/api/mission-control/incidents/${incidentId}`).expect(200);
      expect(detail.body.status).toBe("resolved");
      const recoveryAudit = await request(app)
        .get(`/api/mission-control/audit?targetType=incident&targetId=${incidentId}&limit=100`).expect(200);
      const recoveryAuditItems = recoveryAudit.body.items.map((row: { details: string | null }) => ({
        ...row,
        details: row.details == null ? null : JSON.parse(row.details),
      }));
      expect(recoveryAuditItems).toContainEqual(expect.objectContaining({
        actorId: "system:mission-control",
        action: "incident_sync_recovered",
        details: expect.objectContaining({
          companyId,
          action: "sync_recovery",
          result: "reconciled",
          before: expect.objectContaining({ status: "open" }),
          after: expect.objectContaining({ status: "resolved" }),
        }),
      }));
    } finally {
      if (incidentId != null) {
        await db.delete(missionControlIncidentsTable).where(eq(missionControlIncidentsTable.id, incidentId));
      }
      await db.delete(inspectionSyncLogsTable).where(eq(inspectionSyncLogsTable.inspectionId, inspection!.id));
      await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
    }
  });

  it("keeps every overview metric equal to its filtered paginated record set", async () => {
    asUser(REQUESTOR);
    await request(app).get("/api/mission-control/overview").expect(200);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const [processing, completed, errorInspection, pendingInspection, recoveredSyncInspection, futureInspection] =
      await db.insert(inspectionsTable).values([
        { companyId, siteAddress: "MC parity processing", technicianId: TARGET_USER, technicianName: "MC Parity Tech", status: "processing", createdAt: new Date() },
        { companyId, siteAddress: "MC parity completed", technicianId: TARGET_USER, technicianName: "MC Parity Tech", status: "completed", createdAt: new Date() },
        { companyId, siteAddress: "MC parity analysis errors", technicianId: TARGET_USER, technicianName: "MC Parity Tech", status: "pending", createdAt: new Date() },
        { companyId, siteAddress: "MC parity pending analysis", technicianId: TARGET_USER, technicianName: "MC Parity Tech", status: "pending", createdAt: new Date() },
        { companyId, siteAddress: "MC parity recovered sync", technicianId: TARGET_USER, technicianName: "MC Parity Tech", status: "pending", createdAt: new Date() },
        { companyId, siteAddress: "MC parity future UTC", technicianId: TARGET_USER, technicianName: "MC Parity Tech", status: "completed", createdAt: tomorrowStart },
      ]).returning();
    const [failedSync, recoveredSync, recoveredSuccess] = await db.insert(inspectionSyncLogsTable).values([
      { companyId, inspectionId: processing!.id, systemType: "pestpac", success: false, syncedAt: new Date() },
      { companyId, inspectionId: recoveredSyncInspection!.id, systemType: "pestpac", success: false, syncedAt: new Date(Date.now() - 60_000) },
      { companyId, inspectionId: recoveredSyncInspection!.id, systemType: "pestpac", success: true, syncedAt: new Date() },
    ]).returning();
    const [latestFailedAnalysis, analysisWithErrors, latestPendingAnalysis, supersededFailure, laterComplete] =
      await db.insert(analysisResultsTable).values([
        { companyId, inspectionId: processing!.id, status: "failed", analysisErrors: 0, createdAt: new Date() },
        { companyId, inspectionId: errorInspection!.id, status: "complete", analysisErrors: 2, createdAt: new Date() },
        { companyId, inspectionId: pendingInspection!.id, status: "pending", createdAt: new Date() },
        { companyId, inspectionId: completed!.id, status: "failed", createdAt: new Date(Date.now() - 60_000) },
        { companyId, inspectionId: completed!.id, status: "complete", createdAt: new Date() },
      ]).returning();
    const userId = (await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.clerkUserId, TARGET_USER)))[0]!.id;
    const [session] = await db.insert(metaGlassesSessionsTable).values({
      sessionId: randomUUID(),
      code: randomUUID().slice(0, 6).toUpperCase(),
      companyId,
      inspectionId: processing!.id,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const events = await db.insert(errorEventsTable).values([
      { companyId, userId, category: "ai", message: "MC parity open event", inspectionId: processing!.id },
      { companyId, userId, category: "ai", message: "MC parity acknowledged event", inspectionId: processing!.id },
    ]).returning();
    const [approval] = await db.insert(missionControlApprovalsTable).values({
      type: "access_change",
      status: "pending",
      requestedBy: REQUESTOR,
      targetType: "company",
      targetId: String(companyId),
      action: "suspend",
      request: "MC metric parity approval",
      reason: "MC metric parity test",
      idempotencyKey: `mc-parity-${randomUUID()}`,
    }).returning();
    const incidentReferences = [
      ...events.map((event) => `error:${event.id}`),
      `sync:${failedSync!.id}`,
      `sync:${recoveredSync!.id}`,
      `analysis:${latestFailedAnalysis!.id}`,
      `analysis:${analysisWithErrors!.id}`,
    ];

    try {
      const materialized = await request(app)
        .get(`/api/mission-control/incidents?companyId=${companyId}&limit=100`).expect(200);
      const openEvent = materialized.body.items.find((item: { sourceId: string }) => item.sourceId === String(events[0]!.id));
      const acknowledgedEvent = materialized.body.items.find((item: { sourceId: string }) => item.sourceId === String(events[1]!.id));
      expect(openEvent?.sessionId).toBe(session!.id);
      expect(acknowledgedEvent?.sessionId).toBe(session!.id);
      await db.update(missionControlIncidentsTable).set({ status: "acknowledged" })
        .where(eq(missionControlIncidentsTable.id, acknowledgedEvent.id));

      const overview = await request(app).get("/api/mission-control/overview").expect(200);
      const parityCases = [
        ["activeCompanyCount", "/companies?accessStatus=enabled", "id"],
        ["activeTechnicianCount", "/technicians?companyAccess=enabled", "id"],
        ["inspectionCount", "/inspections", "id"],
        ["inspectionsTodayCount", "/inspections?createdToday=true", "id"],
        ["inspectionsProcessingCount", "/inspections?status=processing", "id"],
        ["inspectionsCompletedCount", "/inspections?status=completed", "id"],
        ["failedSyncCount", "/inspections?syncStatus=failed", "id"],
        ["failedAnalysisCount", "/inspections?analysisStatus=failed", "id"],
        ["pendingAnalysisCount", "/inspections?analysisStatus=pending", "id"],
        ["openIncidentCount", "/incidents?activeOnly=true", "id"],
        ["unacknowledgedAlertCount", "/incidents?status=open", "id"],
        ["problemDeviceSessionCount", "/incidents?activeOnly=true&hasSession=true", "id"],
        ["pendingApprovalCount", "/approvals?status=pending", "id"],
      ] as const;
      for (const [metric, path, idField] of parityCases) {
        const readPagedIds = async () => {
          const limit = 100;
          const separator = path.includes("?") ? "&" : "?";
          const first = await request(app).get(`/api/mission-control${path}${separator}page=1&limit=${limit}`).expect(200);
          const ids = [...first.body.items.map((item: Record<string, number | string>) => String(item[idField]))];
          for (let page = 2; page <= first.body.totalPages; page += 1) {
            const response = await request(app)
              .get(`/api/mission-control${path}${separator}page=${page}&limit=${limit}`).expect(200);
            expect(response.body.total).toBe(first.body.total);
            ids.push(...response.body.items.map((item: Record<string, number | string>) => String(item[idField])));
          }
          return { total: first.body.total as number, ids };
        };
        const listed = await readPagedIds();
        expect(overview.body.kpis[metric]).toBe(listed.total);
        expect(listed.ids).toHaveLength(listed.total);
        expect(new Set(listed.ids).size).toBe(listed.total);
      }

      expect(overview.body.kpis.failedSyncCount).toBeGreaterThanOrEqual(1);
      expect(overview.body.kpis.failedAnalysisCount).toBeGreaterThanOrEqual(2);
      expect(overview.body.kpis.pendingAnalysisCount).toBeGreaterThanOrEqual(1);
      expect(overview.body.kpis.problemDeviceSessionCount).toBeGreaterThanOrEqual(2);
      const activeIncidents = await request(app)
        .get(`/api/mission-control/incidents?companyId=${companyId}&activeOnly=true&limit=100`).expect(200);
      expect(activeIncidents.body.items.some((item: { sourceId: string }) => item.sourceId === String(recoveredSync!.id))).toBe(false);
      const todayInspections = await request(app)
        .get("/api/mission-control/inspections?createdToday=true&limit=100").expect(200);
      expect(todayInspections.body.items.some((item: { id: number }) => item.id === futureInspection!.id)).toBe(false);
      expect(todayInspections.body.items.some((item: { id: number }) => item.id === processing!.id)).toBe(true);
    } finally {
      await db.delete(missionControlIncidentsTable).where(inArray(missionControlIncidentsTable.reference, incidentReferences));
      await db.delete(errorEventsTable).where(inArray(errorEventsTable.id, events.map((event) => event.id)));
      await db.delete(missionControlApprovalsTable).where(eq(missionControlApprovalsTable.id, approval!.id));
      await db.delete(metaGlassesSessionsTable).where(eq(metaGlassesSessionsTable.id, session!.id));
      await db.delete(inspectionSyncLogsTable).where(inArray(inspectionSyncLogsTable.id, [failedSync!.id, recoveredSync!.id, recoveredSuccess!.id]));
      await db.delete(analysisResultsTable).where(inArray(analysisResultsTable.id, [
        latestFailedAnalysis!.id, analysisWithErrors!.id, latestPendingAnalysis!.id, supersededFailure!.id, laterComplete!.id,
      ]));
      await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, [
        processing!.id, completed!.id, errorInspection!.id, pendingInspection!.id, recoveredSyncInspection!.id, futureInspection!.id,
      ]));
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

  it("resolves only a verified primary Clerk email with an existing app-user mapping", async () => {
    asUser(REGULAR_USER);
    await request(app).get("/api/mission-control/super-admin/resolve?email=operator@example.test").expect(403);
    asUser(REQUESTOR);
    vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
    try {
      clerkLookup.mockResolvedValue({ totalCount: 1, data: [{
        id: TARGET_USER,
        primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "primary", emailAddress: "operator@example.test", verification: { status: "verified" } }],
      }] });
      const resolved = await request(app).get("/api/mission-control/super-admin/resolve?email=Operator@Example.test").expect(200);
      expect(resolved.body).toMatchObject({ clerkUserId: TARGET_USER, verifiedEmail: "operator@example.test", isSuperAdmin: false, companyId });
      expect(resolved.body.appUserId).toEqual(expect.any(Number));
      clerkLookup.mockResolvedValueOnce({ totalCount: 1, data: [{
        id: TARGET_USER,
        primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "primary", emailAddress: "operator@example.test", verification: { status: "unverified" } }],
      }] });
      await request(app).get("/api/mission-control/super-admin/resolve?email=operator@example.test").expect(404);
      clerkLookup.mockResolvedValueOnce({ totalCount: 1, data: [{
        id: "clerk_not_mapped",
        primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "primary", emailAddress: "operator@example.test", verification: { status: "verified" } }],
      }] });
      await request(app).get("/api/mission-control/super-admin/resolve?email=operator@example.test").expect(409);
      const [notMapped] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, "clerk_not_mapped"));
      expect(notMapped).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      clerkLookup.mockReset();
    }
  });

  it("requires a different authenticated Super Admin's approval and records an atomic grant and revoke", async () => {
    clerkGetUser.mockResolvedValue({
      id: TARGET_USER,
      primaryEmailAddressId: "primary",
      emailAddresses: [{ id: "primary", emailAddress: "operator@example.test", verification: { status: "verified" } }],
    });
    const [targetBefore] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    expect(targetBefore?.isSuperAdmin).toBe(false);
    asUser(REGULAR_USER);
    await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: TARGET_USER, action: "super_admin_enable", reason: "Unauthorized",
      verifiedEmail: "operator@example.test",
    }).expect(403);
    asUser(REQUESTOR);
    await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: REQUESTOR, action: "super_admin_disable", reason: "Self-revocation",
      verifiedEmail: "operator@example.test",
    }).expect(403);
    const grant = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: TARGET_USER, action: "super_admin_enable", reason: "Approved platform operator",
      verifiedEmail: "operator@example.test",
    }).expect(201);
    expect(grant.body.type).toBe("user_super_admin_access");
    await request(app).post(`/api/mission-control/approvals/${grant.body.id}/decision`).send({
      decision: "approve", note: "Cannot self approve",
    }).expect(403);
    const [stillTarget] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    expect(stillTarget?.isSuperAdmin).toBe(false);
    asUser(APPROVER);
    const granted = await request(app).post(`/api/mission-control/approvals/${grant.body.id}/decision`).send({
      decision: "approve", note: "Identity and need verified",
    }).expect(200);
    expect(granted.body.grantAuditId).toEqual(expect.any(Number));
    const [grantAudit] = await db.select().from(missionControlAuditTable)
      .where(eq(missionControlAuditTable.id, granted.body.grantAuditId));
    const replay = await request(app).post(`/api/mission-control/approvals/${grant.body.id}/decision`).send({
      decision: "approve", note: "Retried after a lost response",
    }).expect(200);
    expect(replay.body.grantAuditId).toBe(granted.body.grantAuditId);
    expect(grantAudit).toMatchObject({ actorId: APPROVER, action: "super_admin_enable", targetId: TARGET_USER });
    expect(grantAudit?.createdAt).toBeInstanceOf(Date);
    expect(grantAudit?.details).toMatchObject({
      actor: "authenticated_super_admin", actorClerkId: APPROVER, actorAppUserId: expect.any(Number),
      targetUserId: stillTarget!.id, targetClerkId: TARGET_USER,
      previousIsSuperAdmin: false, newIsSuperAdmin: true,
      verifiedEmail: "operator@example.test",
      reason: "Approved platform operator", requestId: grant.body.id, operationId: expect.any(String),
      timestamp: expect.any(String),
    });
    const [enabled] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    expect(enabled?.isSuperAdmin).toBe(true);

    asUser(REQUESTOR);
    const revoke = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: TARGET_USER, action: "super_admin_disable", reason: "End platform access",
      verifiedEmail: "operator@example.test",
    }).expect(201);
    asUser(APPROVER);
    const revoked = await request(app).post(`/api/mission-control/approvals/${revoke.body.id}/decision`).send({
      decision: "approve", note: "Revocation reviewed",
    }).expect(200);
    const [revokeAudit] = await db.select().from(missionControlAuditTable)
      .where(eq(missionControlAuditTable.id, revoked.body.grantAuditId));
    expect(revokeAudit?.details).toMatchObject({
      previousIsSuperAdmin: true, newIsSuperAdmin: false, targetUserId: stillTarget!.id,
    });
    asUser(TARGET_USER);
    await request(app).get("/api/mission-control/overview").expect(403);
  });

  it("keeps a stale platform grant pending and rejects approval by the target", async () => {
    clerkGetUser.mockResolvedValue({
      id: TARGET_USER,
      primaryEmailAddressId: "primary",
      emailAddresses: [{ id: "primary", emailAddress: "operator@example.test", verification: { status: "verified" } }],
    });
    asUser(REQUESTOR);
    const pending = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: TARGET_USER, action: "super_admin_enable", reason: "State-check grant",
      verifiedEmail: "operator@example.test",
    }).expect(201);
    await db.update(usersTable).set({ isSuperAdmin: true }).where(eq(usersTable.clerkUserId, TARGET_USER));
    try {
      asUser(TARGET_USER);
      await request(app).post(`/api/mission-control/approvals/${pending.body.id}/decision`).send({
        decision: "approve", note: "Target cannot approve own grant",
      }).expect(403);
      asUser(APPROVER);
      await request(app).post(`/api/mission-control/approvals/${pending.body.id}/decision`).send({
        decision: "approve", note: "Stale state",
      }).expect(409);
      const [approval] = await db.select().from(missionControlApprovalsTable)
        .where(eq(missionControlApprovalsTable.id, pending.body.id));
      expect(approval?.status).toBe("pending");
    } finally {
      await db.update(usersTable).set({ isSuperAdmin: false }).where(eq(usersTable.clerkUserId, TARGET_USER));
    }
  });

  it("rejects a direct-ID grant without verified email and an identity changed before approval", async () => {
    asUser(REQUESTOR);
    await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: TARGET_USER, action: "super_admin_enable", reason: "Missing identity evidence",
    }).expect(400);
    clerkGetUser.mockResolvedValue({
      id: TARGET_USER, primaryEmailAddressId: "primary",
      emailAddresses: [{ id: "primary", emailAddress: "operator@example.test", verification: { status: "verified" } }],
    });
    const pending = await request(app).post("/api/mission-control/approvals/requests").send({
      targetType: "user", targetId: TARGET_USER, action: "super_admin_enable",
      verifiedEmail: "operator@example.test", reason: "Verified before request",
    }).expect(201);
    clerkGetUser.mockResolvedValue({
      id: TARGET_USER, primaryEmailAddressId: "primary",
      emailAddresses: [{ id: "primary", emailAddress: "other@example.test", verification: { status: "verified" } }],
    });
    asUser(APPROVER);
    await request(app).post(`/api/mission-control/approvals/${pending.body.id}/decision`).send({
      decision: "approve", note: "Identity changed",
    }).expect(409);
    const [approval] = await db.select().from(missionControlApprovalsTable)
      .where(eq(missionControlApprovalsTable.id, pending.body.id));
    const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    expect(approval?.status).toBe("pending");
    expect(target?.isSuperAdmin).toBe(false);
  });

  it("does not expose legacy HMAC token issuance or an unaudited Super Admin grant", async () => {
    asUser(REQUESTOR);
    await request(app).post("/api/admin/token-auth").send({ token: "legacy-token" }).expect(404);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, TARGET_USER));
    await request(app).patch(`/api/admin/users/${target!.id}`)
      .send({ isSuperAdmin: true }).expect(403);
    const [unchanged] = await db.select().from(usersTable).where(eq(usersTable.id, target!.id));
    expect(unchanged?.isSuperAdmin).toBe(false);
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

  it("filters metric drill-down pages to the matching enabled, technician, UTC-day, analysis, and incident records", async () => {
    const suffix = randomUUID();
    const [enabledCompany] = await db.insert(companiesTable).values({
      name: "Mission Control Filter Enabled",
      slug: `mission-control-filter-enabled-${suffix}`,
      accessSuspended: false,
    }).returning();
    const [suspendedCompany] = await db.insert(companiesTable).values({
      name: "Mission Control Filter Suspended",
      slug: `mission-control-filter-suspended-${suffix}`,
      accessSuspended: true,
    }).returning();
    const enabledTechnicianId = `mc-filter-enabled-${suffix}`;
    const enabledTechnicianPageTwoId = `mc-filter-enabled-page-two-${suffix}`;
    const suspendedTechnicianId = `mc-filter-suspended-${suffix}`;
    const unassignedTechnicianId = `mc-filter-unassigned-${suffix}`;
    const [enabledTechnician, enabledTechnicianPageTwo, suspendedTechnician, unassignedTechnician] = await db.insert(usersTable).values([
      { clerkUserId: enabledTechnicianId, companyId: enabledCompany!.id, role: "technician" },
      { clerkUserId: enabledTechnicianPageTwoId, companyId: enabledCompany!.id, role: "technician" },
      { clerkUserId: suspendedTechnicianId, companyId: suspendedCompany!.id, role: "technician" },
      { clerkUserId: unassignedTechnicianId, companyId: null, role: "technician" },
    ]).returning();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    const [firstInspection, secondInspection, oldInspection] = await db.insert(inspectionsTable).values([
      {
        companyId: enabledCompany!.id,
        siteAddress: "Metric filter today one",
        technicianId: enabledTechnicianId,
        technicianName: "Metric Filter Technician",
        status: "completed",
        createdAt: today,
      },
      {
        companyId: enabledCompany!.id,
        siteAddress: "Metric filter today two",
        technicianId: enabledTechnicianId,
        technicianName: "Metric Filter Technician",
        status: "completed",
        createdAt: new Date(today.getTime() - 1_000),
      },
      {
        companyId: enabledCompany!.id,
        siteAddress: "Metric filter yesterday",
        technicianId: enabledTechnicianId,
        technicianName: "Metric Filter Technician",
        status: "completed",
        createdAt: new Date(todayStart.getTime() - 1),
      },
    ]).returning();
    const analysisStart = new Date(Date.now() - 10_000);
    const [olderFailedAnalysis, latestPartialAnalysis, failedAnalysis] = await db.insert(analysisResultsTable).values([
      {
        companyId: enabledCompany!.id,
        inspectionId: firstInspection!.id,
        status: "failed",
        createdAt: analysisStart,
      },
      {
        companyId: enabledCompany!.id,
        inspectionId: firstInspection!.id,
        status: "complete",
        analysisErrors: 2,
        createdAt: new Date(analysisStart.getTime() + 1_000),
      },
      {
        companyId: enabledCompany!.id,
        inspectionId: secondInspection!.id,
        status: "failed",
        createdAt: analysisStart,
      },
    ]).returning();
    const [failedSync, recoveredSync, recoverySync] = await db.insert(inspectionSyncLogsTable).values([
      {
        companyId: enabledCompany!.id,
        inspectionId: secondInspection!.id,
        systemType: "pestpac",
        success: false,
        syncedAt: new Date(Date.now() - 30_000),
      },
      {
        companyId: enabledCompany!.id,
        inspectionId: firstInspection!.id,
        systemType: "pestpac",
        success: false,
        syncedAt: new Date(Date.now() - 20_000),
      },
      {
        companyId: enabledCompany!.id,
        inspectionId: firstInspection!.id,
        systemType: "pestpac",
        success: true,
        syncedAt: new Date(Date.now() - 10_000),
      },
    ]).returning();
    const [session] = await db.insert(metaGlassesSessionsTable).values({
      sessionId: `mc-filter-session-${suffix}`,
      code: "831642",
      inspectionId: firstInspection!.id,
      companyId: enabledCompany!.id,
      userId: enabledTechnician!.id,
      expiresAt: new Date(Date.now() + 60_000),
      events: [],
    }).returning();
    const [sessionEvent, sessionlessEvent] = await db.insert(errorEventsTable).values([
      {
        companyId: enabledCompany!.id,
        userId: enabledTechnician!.id,
        category: "ai",
        message: "Metric filter event attached to a device session",
        inspectionId: firstInspection!.id,
      },
      {
        companyId: enabledCompany!.id,
        category: "auth",
        message: "Metric filter event without a session",
      },
    ]).returning();
    let recoveredDismissedIncident: { id: number } | undefined;

    try {
      asUser(REQUESTOR);
      const overview = await request(app).get("/api/mission-control/overview").expect(200);
      const allTechnicians = await request(app)
        .get("/api/mission-control/technicians?limit=100&page=1").expect(200);
      const allTechnicianIds = allTechnicians.body.items.map((row: { id: string }) => row.id);
      for (let page = 2; page <= allTechnicians.body.totalPages; page++) {
        const nextPage = await request(app)
          .get(`/api/mission-control/technicians?limit=100&page=${page}`).expect(200);
        allTechnicianIds.push(...nextPage.body.items.map((row: { id: string }) => row.id));
      }
      expect(allTechnicians.body.total).toBe(overview.body.kpis.technicianCount);
      expect(allTechnicianIds).toHaveLength(overview.body.kpis.technicianCount);
      expect(new Set(allTechnicianIds).size).toBe(allTechnicianIds.length);
      expect(allTechnicianIds).toContain(enabledTechnicianId);
      expect(allTechnicianIds).not.toContain(unassignedTechnicianId);

      const activeCompanies = await request(app)
        .get("/api/mission-control/companies?accessStatus=enabled&limit=1").expect(200);
      expect(activeCompanies.body.total).toBe(overview.body.kpis.activeCompanyCount);
      expect(activeCompanies.body.items.every((row: { accessStatus: string }) => row.accessStatus === "enabled")).toBe(true);

      const activeTechnicians = await request(app)
        .get("/api/mission-control/technicians?companyAccess=enabled&limit=1").expect(200);
      expect(activeTechnicians.body.total).toBe(overview.body.kpis.activeTechnicianCount);
      expect(activeTechnicians.body.items.every((row: { status: string }) => row.status === "active")).toBe(true);

      const todayPage = await request(app)
        .get("/api/mission-control/inspections?createdToday=true&limit=100").expect(200);
      expect(todayPage.body.total).toBe(overview.body.kpis.inspectionsTodayCount);
      expect(todayPage.body.items.some((row: { id: number }) => row.id === oldInspection!.id)).toBe(false);
      expect(todayPage.body.items.some((row: { id: number }) => row.id === firstInspection!.id)).toBe(true);

      const scopedFailedAnalysis = await request(app).get(
        `/api/mission-control/inspections?companyId=${enabledCompany!.id}&technicianId=${encodeURIComponent(enabledTechnicianId)}&analysisStatus=failed&limit=100`,
      ).expect(200);
      const scopedFailedSync = await request(app).get(
        `/api/mission-control/inspections?companyId=${enabledCompany!.id}&technicianId=${encodeURIComponent(enabledTechnicianId)}&syncStatus=failed&limit=100`,
      ).expect(200);
      const companyDetail = await request(app)
        .get(`/api/mission-control/companies/${enabledCompany!.id}`).expect(200);
      expect(scopedFailedAnalysis.body.total).toBe(companyDetail.body.failedAnalysisCount);
      expect(scopedFailedAnalysis.body.items.map((row: { id: number }) => row.id).sort((a: number, b: number) => a - b))
        .toEqual([firstInspection!.id, secondInspection!.id].sort((a, b) => a - b));
      expect(scopedFailedSync.body.total).toBe(companyDetail.body.failedSyncCount);
      expect(scopedFailedSync.body.items.map((row: { id: number }) => row.id)).toEqual([secondInspection!.id]);
      expect(scopedFailedAnalysis.body.items.map((row: { id: number }) => row.id)).not.toContain(oldInspection!.id);

      const scopedTechnicians = await request(app).get(
        `/api/mission-control/technicians?companyId=${enabledCompany!.id}&companyAccess=enabled&limit=100`,
      ).expect(200);
      const technicianPageOne = await request(app).get(
        `/api/mission-control/technicians?companyId=${enabledCompany!.id}&companyAccess=enabled&limit=1&page=1`,
      ).expect(200);
      const technicianPageTwo = await request(app).get(
        `/api/mission-control/technicians?companyId=${enabledCompany!.id}&companyAccess=enabled&limit=1&page=2`,
      ).expect(200);
      expect(technicianPageOne.body.total).toBe(2);
      expect(technicianPageTwo.body.total).toBe(2);
      expect([
        ...technicianPageOne.body.items.map((row: { id: string }) => row.id),
        ...technicianPageTwo.body.items.map((row: { id: string }) => row.id),
      ]).toEqual([enabledTechnicianId, enabledTechnicianPageTwoId].sort());
      expect(scopedTechnicians.body.total).toBe(2);
      const technicianMetrics = scopedTechnicians.body.items.find(
        (row: { id: string }) => row.id === enabledTechnicianId,
      );
      expect(technicianMetrics).toMatchObject({
        failedAnalysisCount: scopedFailedAnalysis.body.total,
        failedSyncCount: scopedFailedSync.body.total,
      });
      expect(scopedTechnicians.body.items.some((row: { id: string }) => row.id === suspendedTechnicianId)).toBe(false);
      expect(scopedTechnicians.body.items.some((row: { id: string }) => row.id === unassignedTechnicianId)).toBe(false);

      await request(app)
        .get(`/api/mission-control/incidents?companyId=${enabledCompany!.id}&sourceType=sync_log&limit=100`)
        .expect(200);
      [recoveredDismissedIncident] = await db.select({ id: missionControlIncidentsTable.id })
        .from(missionControlIncidentsTable)
        .where(eq(missionControlIncidentsTable.reference, `sync:${recoveredSync!.id}`));
      expect(recoveredDismissedIncident).toBeDefined();
      await db.update(missionControlIncidentsTable).set({ status: "dismissed" })
        .where(eq(missionControlIncidentsTable.id, recoveredDismissedIncident!.id));
      const openIncidents = await request(app)
        .get("/api/mission-control/incidents?activeOnly=true&limit=100").expect(200);
      expect(openIncidents.body.total).toBe(overview.body.kpis.openIncidentCount);
      expect(openIncidents.body.items.every((row: { status: string }) =>
        ["open", "acknowledged", "investigating"].includes(row.status))).toBe(true);
      expect(openIncidents.body.items.some((row: { sourceId: string }) => row.sourceId === String(recoveredSync!.id))).toBe(false);
      expect(openIncidents.body.items.some((row: { sourceId: string }) => row.sourceId === String(recoverySync!.id))).toBe(false);
      const unacknowledgedIncidents = await request(app)
        .get("/api/mission-control/incidents?status=open&limit=100").expect(200);
      expect(unacknowledgedIncidents.body.total).toBe(overview.body.kpis.unacknowledgedAlertCount);
      expect(unacknowledgedIncidents.body.items.some((row: { sourceId: string }) =>
        row.sourceId === String(recoveredSync!.id))).toBe(false);
      const resolvedIncidents = await request(app)
        .get(`/api/mission-control/incidents?companyId=${enabledCompany!.id}&status=resolved&limit=100`).expect(200);
      expect(resolvedIncidents.body.items.some((row: { sourceId: string }) =>
        row.sourceId === String(recoveredSync!.id))).toBe(false);
      const dismissedIncidents = await request(app)
        .get(`/api/mission-control/incidents?companyId=${enabledCompany!.id}&status=dismissed&limit=100`).expect(200);
      expect(dismissedIncidents.body.items).toContainEqual(expect.objectContaining({
        sourceId: String(recoveredSync!.id),
        status: "dismissed",
      }));

      const sessionIncidents = await request(app)
        .get("/api/mission-control/incidents?activeOnly=true&hasSession=true&limit=100").expect(200);
      expect(sessionIncidents.body.items).toContainEqual(expect.objectContaining({
        sourceId: String(sessionEvent!.id),
        sessionId: session!.id,
      }));
      expect(sessionIncidents.body.items.some((row: { sourceId: string }) => row.sourceId === String(sessionlessEvent!.id))).toBe(false);
      expect(sessionIncidents.body.items.some((row: { sourceId: string }) => row.sourceId === String(recoveredSync!.id))).toBe(false);

      asUser(REGULAR_USER);
      await request(app).get("/api/mission-control/companies?accessStatus=enabled").expect(403);
      await request(app).get("/api/mission-control/technicians?companyAccess=enabled").expect(403);
      await request(app).get("/api/mission-control/inspections?createdToday=true").expect(403);
      await request(app).get("/api/mission-control/incidents?activeOnly=true&hasSession=true").expect(403);
    } finally {
      if (recoveredDismissedIncident) {
        await db.delete(missionControlAuditTable).where(and(
          eq(missionControlAuditTable.action, "incident_sync_recovered"),
          eq(missionControlAuditTable.targetType, "incident"),
          eq(missionControlAuditTable.targetId, String(recoveredDismissedIncident.id)),
        ));
      }
      await db.delete(missionControlIncidentsTable).where(inArray(missionControlIncidentsTable.reference, [
        `error:${sessionEvent!.id}`,
        `error:${sessionlessEvent!.id}`,
        `sync:${recoveredSync!.id}`,
      ]));
      await db.delete(errorEventsTable).where(inArray(errorEventsTable.id, [sessionEvent!.id, sessionlessEvent!.id]));
      await db.delete(metaGlassesSessionsTable).where(eq(metaGlassesSessionsTable.id, session!.id));
      await db.delete(inspectionSyncLogsTable).where(inArray(inspectionSyncLogsTable.id, [
        failedSync!.id,
        recoveredSync!.id,
        recoverySync!.id,
      ]));
      await db.delete(analysisResultsTable).where(inArray(analysisResultsTable.id, [
        olderFailedAnalysis!.id,
        latestPartialAnalysis!.id,
        failedAnalysis!.id,
      ]));
      await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, [
        firstInspection!.id,
        secondInspection!.id,
        oldInspection!.id,
      ]));
      await db.delete(usersTable).where(inArray(usersTable.clerkUserId, [
        enabledTechnicianId,
        enabledTechnicianPageTwoId,
        suspendedTechnicianId,
        unassignedTechnicianId,
      ]));
      await db.delete(companiesTable).where(inArray(companiesTable.id, [
        enabledCompany!.id,
        suspendedCompany!.id,
      ]));
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
