import { Router, type IRouter, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { missionControlAgentWorkerStatus } from "../lib/mission-control-worker";
import { executiveRegistry } from "../lib/mission-control-executives";
import { normalizeAddressKey } from "../lib/property-intelligence";
import { appendMissionControlInspectionEvent } from "../lib/mission-control-inspection-events";
import superAdminBootstrapRouter from "./super-admin-bootstrap";
import { getMissionControlInspectionTimeline } from "../lib/mission-control-inspection-timeline";
import {
  db,
  analysisResultsTable,
  type AnalysisResult,
  companiesTable,
  errorEventsTable,
  inspectionMediaTable,
  type InspectionMedia,
  inspectionSyncLogsTable,
  inspectionsTable,
  metaGlassesSessionsTable,
  missionControlAgentTasksTable,
  missionControlDelegationsTable,
  missionControlWorkTracesTable,
  missionControlApprovalsTable,
  missionControlAuditTable,
  missionControlIncidentsTable,
  propertyProfilesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateMissionControlAgentTaskBody,
  DecideMissionControlApprovalBody,
  GetMissionControlInspectionEvidenceParams,
  GetMissionControlInspectionParams,
  GetMissionControlInspectionAnalysisParams,
  GetMissionControlInspectionTimelineParams,
  ListMissionControlAgentTasksQueryParams,
  ListMissionControlApprovalsQueryParams,
  ListMissionControlAuditQueryParams,
  ListMissionControlCompaniesQueryParams,
  ListMissionControlIncidentsQueryParams,
  ListMissionControlInspectionsQueryParams,
  ListMissionControlPropertiesQueryParams,
  ListMissionControlTechniciansQueryParams,
  GetMissionControlPropertyParams,
  UpdateMissionControlCompanyAccessBody,
  UpdateMissionControlIncidentBody,
  UpdateMissionControlUserAccessBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/super-admin/bootstrap", superAdminBootstrapRouter);
const MAX_LIMIT = 100;
const VERIFIED_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function superAdminApprovalEmail(request: string): string | null {
  try {
    const parsed: unknown = JSON.parse(request);
    if (!parsed || typeof parsed !== "object" || !("verifiedEmail" in parsed) ||
        typeof parsed.verifiedEmail !== "string" || !VERIFIED_EMAIL.test(parsed.verifiedEmail)) return null;
    return parsed.verifiedEmail;
  } catch {
    return null;
  }
}

async function verifiedPrimaryEmailForClerkUser(clerkUserId: string): Promise<string | null> {
  const identity = await clerkClient.users.getUser(clerkUserId);
  const primary = identity.emailAddresses.find((address) => address.id === identity.primaryEmailAddressId);
  return primary?.verification?.status === "verified" ? primary.emailAddress.toLowerCase() : null;
}

function pageArgs(query: { page?: number; limit?: number }) {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(query.limit ?? 25)));
  return { page, limit, offset: (page - 1) * limit };
}

function pageResult<T>(items: T[], page: number, limit: number, total: number) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

function utcTodayStart(): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function utcTomorrowStart(start = utcTodayStart()): Date {
  const tomorrow = new Date(start);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow;
}

function latestSyncEligibility(success: boolean) {
  return sql`EXISTS (
    SELECT 1 FROM inspection_sync_logs latest_sync
    WHERE latest_sync.inspection_id = ${inspectionsTable.id}
      AND latest_sync.company_id = ${inspectionsTable.companyId}
      AND latest_sync.id = (
        SELECT newest.id FROM inspection_sync_logs newest
        WHERE newest.inspection_id = ${inspectionsTable.id}
          AND newest.company_id = ${inspectionsTable.companyId}
        ORDER BY newest.synced_at DESC, newest.id DESC LIMIT 1
      )
      AND latest_sync.success = ${success}
  )`;
}

function latestAnalysisEligibility(status: "failed" | "pending" | "complete") {
  const outcome = status === "failed"
    ? sql`(latest_analysis.status = 'failed' OR COALESCE(latest_analysis.analysis_errors, 0) > 0)`
    : sql`latest_analysis.status = ${status}`;
  return sql`EXISTS (
    SELECT 1 FROM analysis_results latest_analysis
    WHERE latest_analysis.inspection_id = ${inspectionsTable.id}
      AND latest_analysis.company_id = ${inspectionsTable.companyId}
      AND latest_analysis.id = (
        SELECT newest.id FROM analysis_results newest
        WHERE newest.inspection_id = ${inspectionsTable.id}
          AND newest.company_id = ${inspectionsTable.companyId}
        ORDER BY newest.created_at DESC, newest.id DESC LIMIT 1
      )
      AND ${outcome}
  )`;
}

function inspectionStatusEligibility(status?: string) {
  return status ? eq(inspectionsTable.status, status) : undefined;
}

function inspectionDateEligibility(createdToday?: string, start = utcTodayStart(), end = utcTomorrowStart()) {
  return createdToday === "true"
    ? and(gte(inspectionsTable.createdAt, start), lt(inspectionsTable.createdAt, end))
    : createdToday === "false"
      ? or(lt(inspectionsTable.createdAt, start), gte(inspectionsTable.createdAt, end))
      : undefined;
}

function incidentEligibility(filters: {
  status?: string;
  activeOnly?: boolean;
  hasSession?: boolean;
}) {
  const effectiveStatus = incidentEffectiveStatusSql();
  return sql`
    ${filters.status == null ? sql`TRUE` : sql`
      ${effectiveStatus} = ${filters.status}
    `}
    AND ${filters.activeOnly ? sql`
      NOT s.is_recovered
      AND ${effectiveStatus}
        IN ('open', 'acknowledged', 'investigating')
    ` : sql`TRUE`}
    AND ${filters.hasSession ? sql`s.session_id IS NOT NULL` : sql`TRUE`}
  `;
}

function incidentEffectiveStatusSql() {
  return sql`CASE
    WHEN i.status = 'dismissed' THEN 'dismissed'
    WHEN s.is_recovered THEN 'resolved'
    ELSE COALESCE(i.status, 'open')
  END`;
}

function companyAccessEligibility(accessStatus?: "enabled" | "suspended") {
  return accessStatus === "enabled" ? eq(companiesTable.accessSuspended, false)
    : accessStatus === "suspended" ? eq(companiesTable.accessSuspended, true) : undefined;
}

function technicianAccessEligibility(companyAccess?: "enabled" | "suspended") {
  return companyAccess === "enabled" ? eq(companiesTable.accessSuspended, false)
    : companyAccess === "suspended" ? eq(companiesTable.accessSuspended, true) : undefined;
}

function technicianEligibility(options: {
  companyAccess?: "enabled" | "suspended";
  companyId?: number;
}) {
  return and(
    eq(usersTable.role, "technician"),
    isNotNull(usersTable.companyId),
    options.companyId == null ? undefined : eq(usersTable.companyId, options.companyId),
    technicianAccessEligibility(options.companyAccess),
  );
}

function approvalStatusEligibility(status?: string) {
  return status ? eq(missionControlApprovalsTable.status, status) : undefined;
}

type OperationalMetrics = {
  inspectionsTodayCount: number;
  inspectionsProcessingCount: number;
  inspectionsCompletedCount: number;
  failedSyncCount: number;
  failedAnalysisCount: number;
  pendingAnalysisCount: number;
  openIncidentCount: number;
  unacknowledgedAlertCount: number;
  problemDeviceSessionCount: number;
  pendingApprovalCount: number;
};

async function getOperationalMetrics(companyId?: number): Promise<OperationalMetrics> {
  const companyFilter = companyId == null ? undefined : eq(inspectionsTable.companyId, companyId);
  const todayStart = utcTodayStart();
  const tomorrowStart = utcTomorrowStart(todayStart);
  const approvalFilter = and(
    companyId == null ? undefined
      : and(eq(missionControlApprovalsTable.targetType, "company"), eq(missionControlApprovalsTable.targetId, String(companyId))),
    approvalStatusEligibility("pending"),
  );
  const [today, processing, completed, failedSync, failedAnalysis, pendingAnalysis, incidentCounts, [pendingApprovals]] = await Promise.all([
    db.select({ value: count() }).from(inspectionsTable).where(and(
      companyFilter, inspectionDateEligibility("true", todayStart, tomorrowStart),
    )),
    db.select({ value: count() }).from(inspectionsTable).where(and(companyFilter, inspectionStatusEligibility("processing"))),
    db.select({ value: count() }).from(inspectionsTable).where(and(companyFilter, inspectionStatusEligibility("completed"))),
    db.select({ value: count() }).from(inspectionsTable).where(and(
      companyFilter, latestSyncEligibility(false),
    )),
    db.select({ value: count() }).from(inspectionsTable).where(and(
      companyFilter, latestAnalysisEligibility("failed"),
    )),
    db.select({ value: count() }).from(inspectionsTable).where(and(
      companyFilter, latestAnalysisEligibility("pending"),
    )),
    db.execute(sql`
      ${missionControlIncidentSourceCte}
      SELECT
        count(*) FILTER (WHERE ${incidentEligibility({ activeOnly: true })})::int AS open_incidents,
        count(*) FILTER (WHERE ${incidentEligibility({ status: "open", activeOnly: true })})::int AS unacknowledged_alerts,
        count(*) FILTER (WHERE ${incidentEligibility({ activeOnly: true, hasSession: true })})::int AS problem_sessions
      FROM source_events s
      LEFT JOIN mission_control_incidents i ON i.reference = s.reference
        AND i.company_id = s.company_id AND i.source_type = s.source_type AND i.source_id = s.source_id
      WHERE ${companyId == null ? sql`TRUE` : sql`s.company_id = ${companyId}`}
    `),
    db.select({ value: count() }).from(missionControlApprovalsTable).where(approvalFilter),
  ]);
  const incidentRow = incidentCounts.rows[0] as Record<string, number | string | null> | undefined;
  const incidentMetric = (key: string) => Number(incidentRow?.[key] ?? 0);
  return {
    inspectionsTodayCount: today[0]?.value ?? 0,
    inspectionsProcessingCount: processing[0]?.value ?? 0,
    inspectionsCompletedCount: completed[0]?.value ?? 0,
    failedSyncCount: failedSync[0]?.value ?? 0,
    failedAnalysisCount: failedAnalysis[0]?.value ?? 0,
    pendingAnalysisCount: pendingAnalysis[0]?.value ?? 0,
    openIncidentCount: incidentMetric("open_incidents"),
    unacknowledgedAlertCount: incidentMetric("unacknowledged_alerts"),
    problemDeviceSessionCount: incidentMetric("problem_sessions"),
    pendingApprovalCount: pendingApprovals?.value ?? 0,
  };
}

async function getTechnicianMetrics(clerkUserId: string, companyId: number) {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM inspections i
        WHERE i.company_id = ${companyId} AND i.technician_id = ${clerkUserId}) AS inspection_count,
      (SELECT count(DISTINCT s.inspection_id)::int FROM inspection_sync_logs s
        WHERE s.company_id = ${companyId}
          AND s.inspection_id IN (SELECT i.id FROM inspections i WHERE i.company_id = ${companyId} AND i.technician_id = ${clerkUserId})
          AND s.id = (SELECT newer.id FROM inspection_sync_logs newer
            WHERE newer.inspection_id = s.inspection_id AND newer.company_id = s.company_id
            ORDER BY newer.synced_at DESC, newer.id DESC LIMIT 1)
          AND s.success = FALSE) AS failed_sync,
      (SELECT count(DISTINCT a.inspection_id)::int FROM analysis_results a
        WHERE a.company_id = ${companyId}
          AND a.inspection_id IN (SELECT i.id FROM inspections i WHERE i.company_id = ${companyId} AND i.technician_id = ${clerkUserId})
          AND a.id = (SELECT newer.id FROM analysis_results newer
            WHERE newer.inspection_id = a.inspection_id AND newer.company_id = a.company_id
            ORDER BY newer.created_at DESC, newer.id DESC LIMIT 1)
          AND (a.status = 'failed' OR COALESCE(a.analysis_errors, 0) > 0)) AS failed_analysis,
      (SELECT count(DISTINCT a.inspection_id)::int FROM analysis_results a
        WHERE a.company_id = ${companyId}
          AND a.inspection_id IN (SELECT i.id FROM inspections i WHERE i.company_id = ${companyId} AND i.technician_id = ${clerkUserId})
          AND a.id = (SELECT newer.id FROM analysis_results newer
            WHERE newer.inspection_id = a.inspection_id AND newer.company_id = a.company_id
            ORDER BY newer.created_at DESC, newer.id DESC LIMIT 1)
          AND a.status = 'pending') AS pending_analysis
  `);
  const row = result.rows[0] as Record<string, number | string | null> | undefined;
  const metric = (key: string) => Number(row?.[key] ?? 0);
  return {
    inspectionCount: metric("inspection_count"),
    failedSyncCount: metric("failed_sync"),
    failedAnalysisCount: metric("failed_analysis"),
    pendingAnalysisCount: metric("pending_analysis"),
  };
}

function safeDiagnostic(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim()
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[external endpoint]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 500);
}

type AnalysisState = "queued" | "processing" | "completed" | "partial" | "failed" | "timed_out" | "deferred" | "unavailable";

function analysisState(analysis?: Pick<AnalysisResult, "status" | "analysisErrors" | "failureReason" | "photoOutcomes">): AnalysisState {
  if (!analysis) return "unavailable";
  if (analysis.status === "pending") return "queued";
  if (analysis.status === "failed") {
    return /time[ -]?out|timeout/i.test(analysis.failureReason ?? "") ? "timed_out" : "failed";
  }
  if (analysis.status === "complete") {
    const outcomes = analysis.photoOutcomes ?? [];
    const onlyDeferred = outcomes.length > 0 && outcomes.every((outcome) => outcome.status === "deferred" || outcome.status === "rate_limited");
    if (onlyDeferred) return "deferred";
    return (analysis.analysisErrors ?? 0) > 0 ? "partial" : "completed";
  }
  return "unavailable";
}

function evidenceView(media: InspectionMedia, analyses: AnalysisResult[]) {
  const outcome = analyses.flatMap((analysis) => analysis.photoOutcomes ?? [])
    .find((entry) => entry.imagePath === media.url);
  const latestAnalysis = analyses[0];
  const analyzed = analyses.some((analysis) => analysis.analyzedImagePaths?.includes(media.url));
  const isPhoto = media.mediaType === "photo";
  let status: "pending" | "completed" | "partial" | "failed" | "timed_out" | "deferred" | "unsupported";
  if (!isPhoto) {
    status = "unsupported";
  } else if (outcome?.status === "completed" || analyzed) {
    status = "completed";
  } else if (outcome?.status === "failed") {
    status = "failed";
  } else if (outcome?.status === "deferred" || outcome?.status === "rate_limited") {
    status = "deferred";
  } else if (analysisState(latestAnalysis) === "timed_out") {
    status = "timed_out";
  } else if (latestAnalysis?.status === "failed") {
    status = "failed";
  } else if (latestAnalysis?.status === "complete" && (latestAnalysis.analysisErrors ?? 0) > 0) {
    status = "partial";
  } else {
    status = "pending";
  }
  const findings = media.mediaType === "photo"
    ? analyses.flatMap((analysis) => analysis.findings ?? [])
      .filter((finding) => finding.imageUrl === media.url)
      .map((finding) => ({
        id: finding.id,
        category: finding.category,
        description: finding.description,
        confidence: finding.confidence,
        severity: finding.severity,
        location: finding.location,
      }))
    : [];
  const zone = analyses.find((analysis) => analysis.photoZones?.[media.url])?.photoZones?.[media.url] ?? null;
  const error = status === "failed" || status === "timed_out"
    ? safeDiagnostic(latestAnalysis?.failureReason) ?? "Analysis did not complete; diagnostic details are unavailable"
    : status === "deferred" ? "Analysis was deferred or rate limited" : null;
  return {
    id: media.id,
    inspectionId: media.inspectionId,
    companyId: media.companyId,
    mediaType: media.mediaType,
    filename: media.filename,
    captureSource: media.captureSource,
    capturedAt: media.capturedAt,
    createdAt: media.createdAt,
    qualityScore: media.qualityScore,
    processingStatus: status === "completed" ? "completed" as const
      : status === "partial" ? "partial" as const
        : status === "failed" || status === "timed_out" ? status
          : status === "deferred" || status === "unsupported" ? "deferred" as const : "pending" as const,
    analysisStatus: status,
    zone,
    findings,
    error,
    provider: null,
    model: null,
  };
}

function paramId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function reservedCompany(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return ["readyloq", "platform", "platform-admin", "legacy", "legacy-company"].includes(normalized);
}

async function addAudit(
  tx: any,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: unknown,
) {
  return tx.insert(missionControlAuditTable).values({
    actorId,
    action,
    targetType,
    targetId,
    details: details as Record<string, unknown>,
  }).returning({
    id: missionControlAuditTable.id,
    createdAt: missionControlAuditTable.createdAt,
  });
}

export const missionControlMeHandler: RequestHandler = (req, res): void => {
  if (!req.user!.isSuperAdmin) {
    res.status(403).json({ error: "Super admin access required", code: "not_super_admin" });
    return;
  }
  res.json({ userId: req.user!.clerkUserId, isSuperAdmin: true });
};

router.get("/overview", async (_req, res): Promise<void> => {
  await reconcileRecoveredSyncIncidents();
  const analysisWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    [companyCount],
    [activeCompanyCount],
    [userCount],
    [technicianCount],
    [activeTechnicianCount],
    [inspectionCount],
    [analysisHealth],
    operationalMetrics,
  ] = await Promise.all([
    db.select({ value: count() }).from(companiesTable),
    db.select({ value: count() }).from(companiesTable).where(companyAccessEligibility("enabled")),
    db.select({ value: count() }).from(usersTable),
    db.select({ value: count() }).from(usersTable)
      .innerJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
      .where(technicianEligibility({})),
    db.select({ value: count() }).from(usersTable)
      .innerJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
      .where(technicianEligibility({ companyAccess: "enabled" })),
    db.select({ value: count() }).from(inspectionsTable),
    db.select({
      completedCount: sql<number>`count(*) FILTER (WHERE ${analysisResultsTable.status} = 'complete')::int`,
      failedCount: sql<number>`count(*) FILTER (WHERE ${analysisResultsTable.status} = 'failed')::int`,
      pendingCount: sql<number>`count(*) FILTER (WHERE ${analysisResultsTable.status} = 'pending')::int`,
      latestResultAt: sql<Date | null>`max(${analysisResultsTable.createdAt})`,
    }).from(analysisResultsTable).where(gte(analysisResultsTable.createdAt, analysisWindowStart)),
    getOperationalMetrics(),
  ]);
  const alertEvents = await db
    .select({
      id: errorEventsTable.id,
      companyId: errorEventsTable.companyId,
      createdAt: errorEventsTable.createdAt,
    })
    .from(errorEventsTable)
    .orderBy(desc(errorEventsTable.createdAt))
    .limit(8);
  const alertCompanyIds = [...new Set(alertEvents.map((event) => event.companyId))];
  const companies = alertCompanyIds.length
    ? await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable)
      .where(inArray(companiesTable.id, alertCompanyIds))
    : [];
  const names = new Map(companies.map((company) => [company.id, company.name]));
  res.json({
    kpis: {
      companyCount: companyCount.value,
      activeCompanyCount: activeCompanyCount.value,
      userCount: userCount.value,
      technicianCount: technicianCount.value,
      activeTechnicianCount: activeTechnicianCount.value,
      inspectionCount: inspectionCount.value,
      ...operationalMetrics,
    },
    recentAlerts: alertEvents.map((event) => ({
      id: event.id,
      severity: "medium",
      title: "Recorded platform error",
      message: `Recorded error event ${event.id}`,
      companyId: event.companyId,
      companyName: names.get(event.companyId) ?? null,
      createdAt: event.createdAt,
    })),
    aiAnalysisHealth: {
      windowHours: 24,
      completedCount: analysisHealth.completedCount,
      failedCount: analysisHealth.failedCount,
      pendingCount: analysisHealth.pendingCount,
      latestResultAt: analysisHealth.latestResultAt,
    },
  });
});

router.get("/search", async (req, res): Promise<void> => {
  const rawQuery = req.query.q;
  if (typeof rawQuery !== "string" || rawQuery.trim().length < 2 || rawQuery.trim().length > 120) {
    res.status(400).json({ error: "Search query must contain 2 to 120 characters" });
    return;
  }
  const query = rawQuery.trim();
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const numericId = /^\d+$/.test(query) && Number.isSafeInteger(Number(query)) ? Number(query) : undefined;
  const [companies, technicians, properties, inspections, evidence, incidents] = await Promise.all([
    db.select({
      id: companiesTable.id, name: companiesTable.name,
      suspended: companiesTable.accessSuspended,
    }).from(companiesTable).where(ilike(companiesTable.name, pattern)).limit(10),
    db.select({
      id: usersTable.clerkUserId, companyId: companiesTable.id, companyName: companiesTable.name,
    }).from(usersTable).innerJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
      .where(and(eq(usersTable.role, "technician"), ilike(usersTable.clerkUserId, pattern))).limit(10),
    db.select({
      id: propertyProfilesTable.id, companyId: propertyProfilesTable.companyId,
      companyName: companiesTable.name, siteAddress: propertyProfilesTable.siteAddress,
    }).from(propertyProfilesTable).innerJoin(companiesTable, eq(propertyProfilesTable.companyId, companiesTable.id))
      .where(ilike(propertyProfilesTable.siteAddress, pattern)).limit(10),
    db.select({
      id: inspectionsTable.id, companyId: inspectionsTable.companyId,
      companyName: companiesTable.name, siteAddress: inspectionsTable.siteAddress,
      status: inspectionsTable.status,
    }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
      .where(or(
        ilike(inspectionsTable.siteAddress, pattern),
        ilike(inspectionsTable.technicianId, pattern),
        numericId == null ? undefined : eq(inspectionsTable.id, numericId),
      )).limit(10),
    db.select({
      id: inspectionMediaTable.id, companyId: inspectionMediaTable.companyId,
      inspectionId: inspectionMediaTable.inspectionId, mediaType: inspectionMediaTable.mediaType,
      companyName: companiesTable.name,
    }).from(inspectionMediaTable)
      .innerJoin(companiesTable, eq(inspectionMediaTable.companyId, companiesTable.id))
      .where(or(
        ilike(inspectionMediaTable.filename, pattern),
        ilike(inspectionMediaTable.caption, pattern),
        numericId == null ? undefined : eq(inspectionMediaTable.id, numericId),
      )).limit(10),
    (async () => {
      const result = await db.execute(sql`
        ${missionControlIncidentSourceCte}
        SELECT s.source_type AS "sourceType", s.source_id AS "sourceId",
          s.company_id AS "companyId", s.inspection_id AS "inspectionId",
          s.company_name AS "companyName", s.title, s.severity,
          s.is_recovered AS "isRecovered", s.recovered_at AS "recoveredAt"
        FROM source_events s
        LEFT JOIN mission_control_incidents persisted
          ON persisted.reference = s.reference
          AND persisted.company_id = s.company_id
          AND persisted.source_type = s.source_type
          AND persisted.source_id = s.source_id
        WHERE s.title ILIKE ${pattern}
          OR s.description ILIKE ${pattern}
          OR s.source_id = ${numericId == null ? null : String(numericId)}
          OR persisted.id = ${numericId ?? null}
        ORDER BY s.created_at DESC
        LIMIT 10
      `);
      return result.rows as Array<{
        sourceType: string; sourceId: string; companyId: number;
        inspectionId: number | null; companyName: string; title: string; severity: string;
        isRecovered: boolean; recoveredAt: Date | string | null;
      }>;
    })(),
  ]);
  const items = [
    ...companies.map((row) => ({
      kind: "company" as const, id: String(row.id), title: row.name,
      subtitle: row.suspended ? "Suspended" : "Enabled", companyId: row.id, inspectionId: null,
    })),
    ...technicians.map((row) => ({
      kind: "technician" as const, id: row.id, title: row.id,
      subtitle: row.companyName, companyId: row.companyId, inspectionId: null,
    })),
    ...properties.map((row) => ({
      kind: "property" as const, id: String(row.id), title: row.siteAddress,
      subtitle: row.companyName, companyId: row.companyId, inspectionId: null,
    })),
    ...inspections.map((row) => ({
      kind: "inspection" as const, id: String(row.id), title: row.siteAddress,
      subtitle: `${row.companyName} · ${row.status}`, companyId: row.companyId, inspectionId: row.id,
    })),
    ...evidence.map((row) => ({
      kind: "evidence" as const, id: String(row.id), title: `${row.mediaType} evidence #${row.id}`,
      subtitle: `${row.companyName} · inspection #${row.inspectionId}`,
      companyId: row.companyId, inspectionId: row.inspectionId,
    })),
    ...((await Promise.all(incidents.map(async (row) => {
      const source = await loadIncidentSource(row.sourceType, row.sourceId);
      if (!source || source.companyId !== row.companyId) return null;
      const recoveredAt = row.recoveredAt == null
        ? null
        : row.recoveredAt instanceof Date ? row.recoveredAt : new Date(row.recoveredAt);
      const stored = await persistedIncident({
        ...source,
        isRecovered: row.isRecovered,
        recoveredAt,
      });
      if (!stored || stored.companyId !== source.companyId || stored.reference !== source.reference) return null;
      return {
        kind: "incident" as const, id: String(stored.id),
        title: source.title, subtitle: `${source.companyName} · ${stored.severity}`,
        companyId: source.companyId, inspectionId: source.inspectionId ?? null,
      };
    }))).filter((row): row is NonNullable<typeof row> => row != null)),
  ].slice(0, 50);
  res.json({ items });
});

router.get("/companies", async (req, res): Promise<void> => {
  const parsed = ListMissionControlCompaniesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const filters = and(
    parsed.data.search
      ? ilike(companiesTable.name, `%${parsed.data.search.replace(/[%_]/g, "\\$&")}%`)
      : undefined,
    companyAccessEligibility(parsed.data.accessStatus),
  );
  const [totalRow] = await db.select({ value: count() }).from(companiesTable).where(filters);
  const rows = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.name,
      slug: companiesTable.slug,
      accessSuspended: companiesTable.accessSuspended,
      createdAt: companiesTable.createdAt,
    })
    .from(companiesTable)
    .where(filters)
    .orderBy(desc(companiesTable.createdAt), desc(companiesTable.id))
    .limit(limit)
    .offset(offset);
  const ids = rows.map((row) => row.id);
  const users = ids.length
    ? await db.select({ companyId: usersTable.companyId, value: count() }).from(usersTable).where(inArray(usersTable.companyId, ids)).groupBy(usersTable.companyId)
    : [];
  const techs = ids.length
    ? await db.select({ companyId: usersTable.companyId, value: count() }).from(usersTable).where(and(inArray(usersTable.companyId, ids), eq(usersTable.role, "technician"))).groupBy(usersTable.companyId)
    : [];
  const inspections = ids.length
    ? await db.select({ companyId: inspectionsTable.companyId, value: count() }).from(inspectionsTable).where(inArray(inspectionsTable.companyId, ids)).groupBy(inspectionsTable.companyId)
    : [];
  const activity = ids.length
    ? await db.select({ companyId: inspectionsTable.companyId, value: sql<Date>`max(${inspectionsTable.createdAt})` }).from(inspectionsTable).where(inArray(inspectionsTable.companyId, ids)).groupBy(inspectionsTable.companyId)
    : [];
  const toMap = (values: Array<{ companyId: number | null; value: number | Date | null }>) => new Map(values.map((item) => [item.companyId, item.value]));
  const userMap = toMap(users);
  const techMap = toMap(techs);
  const inspectionMap = toMap(inspections);
  const activityMap = toMap(activity);
  await reconcileRecoveredSyncIncidents();
  const operationalByCompany = new Map(await Promise.all(rows.map(async (row) => [
    row.id,
    await getOperationalMetrics(row.id),
  ] as const)));
  res.json(pageResult(rows.map((row) => ({
    id: row.id,
    name: row.name,
    accessStatus: row.accessSuspended ? "suspended" : "enabled",
    createdAt: row.createdAt,
    userCount: Number(userMap.get(row.id) ?? 0),
    technicianCount: Number(techMap.get(row.id) ?? 0),
    inspectionCount: Number(inspectionMap.get(row.id) ?? 0),
    lastActivityAt: activityMap.get(row.id) ?? null,
    ...operationalByCompany.get(row.id),
  })), page, limit, totalRow.value));
});

router.get("/companies/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  await reconcileRecoveredSyncIncidents();
  const operationalMetrics = await getOperationalMetrics(id);
  const members = await db.select({
    id: usersTable.clerkUserId,
    role: usersTable.role,
    betaAccessEnabled: usersTable.betaAccess,
  }).from(usersTable).where(eq(usersTable.companyId, id)).orderBy(usersTable.id).limit(250);
  const [owner] = await db.select({ id: usersTable.clerkUserId }).from(usersTable)
    .where(and(eq(usersTable.companyId, id), eq(usersTable.role, "owner"))).limit(1);
  const [[userCount], [technicianCount], [inspectionCount], [lastActivity]] = await Promise.all([
    db.select({ value: count() }).from(usersTable).where(eq(usersTable.companyId, id)),
    db.select({ value: count() }).from(usersTable).where(and(eq(usersTable.companyId, id), eq(usersTable.role, "technician"))),
    db.select({ value: count() }).from(inspectionsTable).where(eq(inspectionsTable.companyId, id)),
    db.select({ value: sql<Date | null>`max(${inspectionsTable.createdAt})` }).from(inspectionsTable).where(eq(inspectionsTable.companyId, id)),
  ]);
  const inspections = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
    companyName: companiesTable.name,
    technicianId: inspectionsTable.technicianId,
    technicianName: inspectionsTable.technicianName,
    status: inspectionsTable.status,
    siteAddress: inspectionsTable.siteAddress,
    createdAt: inspectionsTable.createdAt,
  }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
    .where(eq(inspectionsTable.companyId, id)).orderBy(desc(inspectionsTable.createdAt)).limit(10);
  res.json({
    id,
    name: company.name,
    accessStatus: company.accessSuspended ? "suspended" : "enabled",
    createdAt: company.createdAt,
    userCount: userCount.value,
    technicianCount: technicianCount.value,
    inspectionCount: inspectionCount.value,
    lastActivityAt: lastActivity.value,
    ...operationalMetrics,
    owner: owner ? { userId: owner.id, name: null, email: null } : null,
    users: members.map((member) => ({ id: member.id, name: null, email: null, role: member.role, betaAccessEnabled: member.betaAccessEnabled })),
    recentInspections: inspections.map((inspection) => ({
      ...inspection,
    })),
  });
});

router.get("/properties", async (req, res): Promise<void> => {
  const parsed = ListMissionControlPropertiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const filters = and(
    parsed.data.companyId == null ? undefined : eq(propertyProfilesTable.companyId, parsed.data.companyId),
    parsed.data.search
      ? ilike(propertyProfilesTable.siteAddress, `%${parsed.data.search.replace(/[%_]/g, "\\$&")}%`)
      : undefined,
  );
  const [total] = await db.select({ value: count() }).from(propertyProfilesTable).where(filters);
  const profiles = await db.select({
    id: propertyProfilesTable.id,
    companyId: propertyProfilesTable.companyId,
    companyName: companiesTable.name,
    siteAddress: propertyProfilesTable.siteAddress,
    propertyType: propertyProfilesTable.propertyType,
    updatedAt: propertyProfilesTable.updatedAt,
  }).from(propertyProfilesTable)
    .innerJoin(companiesTable, eq(propertyProfilesTable.companyId, companiesTable.id))
    .where(filters)
    .orderBy(desc(propertyProfilesTable.updatedAt), desc(propertyProfilesTable.id))
    .limit(limit)
    .offset(offset);
  const ids = profiles.map((profile) => profile.id);
  const stats = ids.length
    ? await db.select({
      profileId: propertyProfilesTable.id,
      value: count(inspectionsTable.id),
      latestInspectionId: sql<number | null>`(array_agg(${inspectionsTable.id} ORDER BY ${inspectionsTable.createdAt} DESC, ${inspectionsTable.id} DESC))[1]`,
    }).from(propertyProfilesTable)
      .leftJoin(inspectionsTable, and(
        eq(inspectionsTable.companyId, propertyProfilesTable.companyId),
        eq(inspectionsTable.siteAddress, propertyProfilesTable.siteAddress),
      ))
      .where(inArray(propertyProfilesTable.id, ids))
      .groupBy(propertyProfilesTable.id)
    : [];
  const statMap = new Map(stats.map((stat) => [stat.profileId, stat]));
  res.json(pageResult(profiles.map((profile) => ({
    id: profile.id,
    companyId: profile.companyId,
    companyName: profile.companyName,
    siteAddress: profile.siteAddress,
    propertyType: profile.propertyType,
    inspectionCount: Number(statMap.get(profile.id)?.value ?? 0),
    latestInspectionId: statMap.get(profile.id)?.latestInspectionId ?? null,
    updatedAt: profile.updatedAt,
  })), page, limit, total.value));
});

router.get("/properties/:id", async (req, res): Promise<void> => {
  const params = GetMissionControlPropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid property id" });
    return;
  }
  const [profile] = await db.select({
    id: propertyProfilesTable.id,
    companyId: propertyProfilesTable.companyId,
    companyName: companiesTable.name,
    siteAddress: propertyProfilesTable.siteAddress,
    propertyType: propertyProfilesTable.propertyType,
    updatedAt: propertyProfilesTable.updatedAt,
  }).from(propertyProfilesTable)
    .innerJoin(companiesTable, eq(propertyProfilesTable.companyId, companiesTable.id))
    .where(eq(propertyProfilesTable.id, params.data.id));
  if (!profile) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const inspectionFilter = and(
    eq(inspectionsTable.companyId, profile.companyId),
    eq(inspectionsTable.siteAddress, profile.siteAddress),
  );
  const [[inspectionTotal], inspections] = await Promise.all([
    db.select({ value: count() }).from(inspectionsTable).where(inspectionFilter),
    db.select({
      id: inspectionsTable.id,
      status: inspectionsTable.status,
      createdAt: inspectionsTable.createdAt,
    }).from(inspectionsTable)
      .where(inspectionFilter)
      .orderBy(desc(inspectionsTable.createdAt), desc(inspectionsTable.id))
      .limit(MAX_LIMIT),
  ]);
  res.json({
    id: profile.id,
    companyId: profile.companyId,
    companyName: profile.companyName,
    siteAddress: profile.siteAddress,
    propertyType: profile.propertyType,
    inspectionCount: inspectionTotal.value,
    latestInspectionId: inspections[0]?.id ?? null,
    updatedAt: profile.updatedAt,
    inspections,
  });
});

router.post("/companies/:id/access", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const parsed = UpdateMissionControlCompanyAccessBody.safeParse(req.body);
  if (!id || !parsed.success || !parsed.data.reason?.trim()) {
    res.status(400).json({ error: "Valid company id, action, approvalId, and reason are required" });
    return;
  }
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if (reservedCompany(company.slug)) {
    res.status(403).json({ error: "Reserved platform or legacy companies cannot be changed" });
    return;
  }
  const approval = await db.select().from(missionControlApprovalsTable)
    .where(and(
      eq(missionControlApprovalsTable.id, parsed.data.approvalId),
      eq(missionControlApprovalsTable.status, "approved"),
      eq(missionControlApprovalsTable.targetType, "company"),
      eq(missionControlApprovalsTable.targetId, String(id)),
      eq(missionControlApprovalsTable.action, parsed.data.action),
    )).limit(1);
  if (!approval.length || approval[0]!.reason !== parsed.data.reason.trim()) {
    res.status(403).json({ error: "A matching approved request is required" });
    return;
  }
  const desiredSuspended = parsed.data.action === "suspend";
  if (company.accessSuspended !== desiredSuspended) {
    res.status(409).json({ error: "Approval action was not applied; access changes are only committed by the approval decision" });
    return;
  }
  res.json({ companyId: id, accessStatus: desiredSuspended ? "suspended" : "enabled", approvalId: parsed.data.approvalId, changedAt: approval[0]!.decidedAt });
});

router.get("/technicians", async (req, res): Promise<void> => {
  const parsed = ListMissionControlTechniciansQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const where = and(
    technicianEligibility({ companyId: parsed.data.companyId, companyAccess: parsed.data.companyAccess }),
    parsed.data.search ? or(ilike(usersTable.clerkUserId, `%${parsed.data.search}%`), ilike(companiesTable.name, `%${parsed.data.search}%`)) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(usersTable)
    .innerJoin(companiesTable, eq(usersTable.companyId, companiesTable.id)).where(where);
  const rows = await db.select({
    id: usersTable.clerkUserId,
    name: sql<string | null>`(
      SELECT i.technician_name FROM inspections i
      WHERE i.company_id = ${usersTable.companyId}
        AND i.technician_id = ${usersTable.clerkUserId}
      ORDER BY i.created_at DESC, i.id DESC LIMIT 1
    )`,
    companyId: companiesTable.id,
    companyName: companiesTable.name,
    suspended: companiesTable.accessSuspended,
    lastActiveAt: usersTable.lastSeenAt,
  }).from(usersTable).innerJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(where).orderBy(desc(usersTable.lastSeenAt), usersTable.id).limit(limit).offset(offset);
  const metricsByTechnician = new Map(await Promise.all(rows
    .filter((row): row is typeof row & { companyId: number } => row.companyId != null)
    .map(async (row) => [row.id, await getTechnicianMetrics(row.id, row.companyId)] as const)));
  res.json(pageResult(rows.map((row) => ({
    id: row.id,
    name: row.name,
    companyId: row.companyId!,
    companyName: row.companyName ?? "",
    status: row.suspended ? "suspended" : "active",
    lastActiveAt: row.lastActiveAt,
    ...metricsByTechnician.get(row.id),
  })), page, limit, total.value));
});

router.get("/technicians/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: "Invalid technician id" });
    return;
  }
  const [technician] = await db.select({
    id: usersTable.clerkUserId,
    companyId: companiesTable.id,
    companyName: companiesTable.name,
    suspended: companiesTable.accessSuspended,
    lastActiveAt: usersTable.lastSeenAt,
  }).from(usersTable).innerJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(and(eq(usersTable.clerkUserId, id), eq(usersTable.role, "technician")));
  if (!technician) {
    res.status(404).json({ error: "Technician not found" });
    return;
  }
  const inspections = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
    companyName: companiesTable.name,
    technicianId: inspectionsTable.technicianId,
    technicianName: inspectionsTable.technicianName,
    status: inspectionsTable.status,
    siteAddress: inspectionsTable.siteAddress,
    createdAt: inspectionsTable.createdAt,
  }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
    .where(and(
      eq(inspectionsTable.companyId, technician.companyId),
      eq(inspectionsTable.technicianId, technician.id),
    ))
    .orderBy(desc(inspectionsTable.createdAt), desc(inspectionsTable.id))
    .limit(MAX_LIMIT);
  const [metrics, deviceSessions] = await Promise.all([
    getTechnicianMetrics(technician.id, technician.companyId),
    db.select({
      id: metaGlassesSessionsTable.id,
      userId: usersTable.clerkUserId,
      createdAt: metaGlassesSessionsTable.createdAt,
      expiresAt: metaGlassesSessionsTable.expiresAt,
      eventCount: sql<number>`jsonb_array_length(${metaGlassesSessionsTable.events})`,
    }).from(metaGlassesSessionsTable)
      .innerJoin(usersTable, and(
        eq(metaGlassesSessionsTable.userId, usersTable.id),
        eq(metaGlassesSessionsTable.companyId, usersTable.companyId),
      ))
      .where(and(
        eq(metaGlassesSessionsTable.companyId, technician.companyId),
        eq(usersTable.clerkUserId, technician.id),
      ))
      .orderBy(desc(metaGlassesSessionsTable.createdAt)).limit(20),
  ]);
  res.json({
    id: technician.id,
    name: inspections[0]?.technicianName ?? null,
    companyId: technician.companyId,
    companyName: technician.companyName,
    status: technician.suspended ? "suspended" : "active",
    lastActiveAt: technician.lastActiveAt,
    ...metrics,
    inspections: inspections.map((inspection) => ({
      id: inspection.id,
      companyId: inspection.companyId,
      companyName: inspection.companyName,
      technicianId: inspection.technicianId,
      technicianName: inspection.technicianName,
      status: inspection.status,
      siteAddress: inspection.siteAddress,
      createdAt: inspection.createdAt,
    })),
    deviceSessions: deviceSessions.map((session) => ({
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      eventCount: session.eventCount,
    })),
  });
});

router.post("/users/:id/access", async (req, res): Promise<void> => {
  const targetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = UpdateMissionControlUserAccessBody.safeParse(req.body);
  if (!targetId || !parsed.success || !parsed.data.reason?.trim()) {
    res.status(400).json({ error: "Valid user id, action, approvalId, and reason are required" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, targetId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.clerkUserId === req.user!.clerkUserId && parsed.data.action === "disable") {
    res.status(403).json({ error: "Self-lockout is not permitted" });
    return;
  }
  const action = parsed.data.action === "enable" ? "beta_enable" : "beta_disable";
  const [approval] = await db.select().from(missionControlApprovalsTable).where(and(
    eq(missionControlApprovalsTable.id, parsed.data.approvalId),
    eq(missionControlApprovalsTable.status, "approved"),
    eq(missionControlApprovalsTable.targetType, "user"),
    eq(missionControlApprovalsTable.targetId, targetId),
    eq(missionControlApprovalsTable.action, action),
  )).limit(1);
  if (!approval || approval.reason !== parsed.data.reason.trim()) {
    res.status(403).json({ error: "A matching approved request is required" });
    return;
  }
  const enabled = parsed.data.action === "enable";
  if (target.betaAccess !== enabled) {
    res.status(409).json({ error: "Approval action was not applied; access changes are only committed by the approval decision" });
    return;
  }
  res.json({ userId: targetId, betaAccessEnabled: enabled, approvalId: approval.id, changedAt: approval.decidedAt });
});

router.get("/inspections", async (req, res): Promise<void> => {
  const parsed = ListMissionControlInspectionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const todayStart = utcTodayStart();
  const tomorrowStart = utcTomorrowStart(todayStart);
  const filters = and(
    parsed.data.companyId == null ? undefined : eq(inspectionsTable.companyId, parsed.data.companyId),
    parsed.data.technicianId == null ? undefined : eq(inspectionsTable.technicianId, parsed.data.technicianId),
    inspectionDateEligibility(parsed.data.createdToday, todayStart, tomorrowStart),
    inspectionStatusEligibility(parsed.data.status),
    parsed.data.search ? or(
      ilike(inspectionsTable.siteAddress, `%${parsed.data.search.replace(/[\\%_]/g, "\\$&")}%`),
      ilike(inspectionsTable.technicianId, `%${parsed.data.search.replace(/[\\%_]/g, "\\$&")}%`),
    ) : undefined,
    parsed.data.syncStatus ? latestSyncEligibility(parsed.data.syncStatus === "success") : undefined,
    parsed.data.analysisStatus ? latestAnalysisEligibility(parsed.data.analysisStatus) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(inspectionsTable).where(filters);
  const items = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
    companyName: companiesTable.name,
    technicianId: inspectionsTable.technicianId,
    technicianName: inspectionsTable.technicianName,
    status: inspectionsTable.status,
    siteAddress: inspectionsTable.siteAddress,
    createdAt: inspectionsTable.createdAt,
  }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
    .where(filters).orderBy(desc(inspectionsTable.createdAt), desc(inspectionsTable.id)).limit(limit).offset(offset);
  res.json(pageResult(items.map((item) => ({
    ...item,
  })), page, limit, total.value));
});

router.get("/inspections/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid inspection id" });
    return;
  }
  const [item] = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
    companyName: companiesTable.name,
    technicianId: inspectionsTable.technicianId,
    technicianName: inspectionsTable.technicianName,
    status: inspectionsTable.status,
    siteAddress: inspectionsTable.siteAddress,
    createdAt: inspectionsTable.createdAt,
    completedAt: inspectionsTable.completedAt,
  }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
    .where(eq(inspectionsTable.id, id));
  if (!item) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const [media, analyses, syncLogs, session] = await Promise.all([
    db.select({
      id: inspectionMediaTable.id, mediaType: inspectionMediaTable.mediaType,
      filename: inspectionMediaTable.filename, caption: inspectionMediaTable.caption,
      durationSec: inspectionMediaTable.durationSec, captureSource: inspectionMediaTable.captureSource,
      qualityScore: inspectionMediaTable.qualityScore, capturedAt: inspectionMediaTable.capturedAt,
      storageUrl: inspectionMediaTable.url,
    }).from(inspectionMediaTable)
      .where(and(
        eq(inspectionMediaTable.inspectionId, id),
        eq(inspectionMediaTable.companyId, item.companyId),
      )).limit(500),
    db.select({
      id: analysisResultsTable.id, status: analysisResultsTable.status,
      error: analysisResultsTable.failureReason, updatedAt: analysisResultsTable.createdAt,
      analyzedImagePaths: analysisResultsTable.analyzedImagePaths,
      photoOutcomes: analysisResultsTable.photoOutcomes,
      coverage: analysisResultsTable.coverage,
      analysisErrors: analysisResultsTable.analysisErrors,
    })
      .from(analysisResultsTable).where(and(
        eq(analysisResultsTable.inspectionId, id),
        eq(analysisResultsTable.companyId, item.companyId),
      )).orderBy(desc(analysisResultsTable.createdAt), desc(analysisResultsTable.id)).limit(100),
    db.select({ id: inspectionSyncLogsTable.id, status: inspectionSyncLogsTable.success, message: inspectionSyncLogsTable.errorMessage, createdAt: inspectionSyncLogsTable.syncedAt })
      .from(inspectionSyncLogsTable).where(and(
        eq(inspectionSyncLogsTable.inspectionId, id),
        eq(inspectionSyncLogsTable.companyId, item.companyId),
      )).orderBy(desc(inspectionSyncLogsTable.syncedAt), desc(inspectionSyncLogsTable.id)).limit(100),
    db.select({
      id: metaGlassesSessionsTable.id,
      userClerkId: usersTable.clerkUserId,
      createdAt: metaGlassesSessionsTable.createdAt,
      expiresAt: metaGlassesSessionsTable.expiresAt,
      eventCount: sql<number>`jsonb_array_length(${metaGlassesSessionsTable.events})`,
    }).from(metaGlassesSessionsTable)
      .leftJoin(usersTable, and(
        eq(metaGlassesSessionsTable.userId, usersTable.id),
        eq(metaGlassesSessionsTable.companyId, usersTable.companyId),
      ))
      .where(and(
        eq(metaGlassesSessionsTable.inspectionId, id),
        eq(metaGlassesSessionsTable.companyId, item.companyId),
      )).orderBy(desc(metaGlassesSessionsTable.createdAt)).limit(20),
  ]);
  const propertyAddressKey = normalizeAddressKey(item.siteAddress);
  const [property] = propertyAddressKey
    ? await db.select({ id: propertyProfilesTable.id }).from(propertyProfilesTable)
      .where(and(
        eq(propertyProfilesTable.companyId, item.companyId),
        eq(propertyProfilesTable.addressKey, propertyAddressKey),
      )).limit(1)
    : [];
  const latestCoverage = analyses[0]?.coverage;
  res.json({
    ...item,
    mediaCounts: {
      total: media.length,
      photos: media.filter((entry) => entry.mediaType === "photo").length,
      videos: media.filter((entry) => entry.mediaType === "video").length,
      pendingAnalysis: media.filter((entry) => {
        if (entry.mediaType !== "photo") return false;
        const outcome = analyses.flatMap((analysis) => analysis.photoOutcomes ?? [])
          .find((item) => item.imagePath === entry.storageUrl);
        return outcome ? outcome.status !== "completed" : !analyses.some((analysis) => analysis.analyzedImagePaths?.includes(entry.storageUrl));
      }).length,
    },
    analysisStatuses: media.filter((entry) => entry.mediaType === "photo").map((entry) => {
      const outcome = analyses.flatMap((analysis) => analysis.photoOutcomes ?? [])
        .find((item) => item.imagePath === entry.storageUrl);
      const analyzed = analyses.some((analysis) => analysis.analyzedImagePaths?.includes(entry.storageUrl));
      const runState = analyses[0] ? analysisState({
        status: analyses[0].status,
        analysisErrors: analyses[0].analysisErrors,
        failureReason: analyses[0].error,
        photoOutcomes: analyses[0].photoOutcomes,
      }) : "unavailable";
      const status = outcome
        ? outcome.status === "rate_limited" ? "deferred" : outcome.status
        : analyzed ? "completed"
          : runState === "failed" || runState === "timed_out" || runState === "partial" || runState === "deferred"
            ? runState === "timed_out" ? "failed" : runState
            : "pending";
      return {
        mediaId: entry.id,
        status,
        error: status === "failed" ? safeDiagnostic(analyses[0]?.error) ?? "Analysis failed; diagnostic details unavailable" : null,
        updatedAt: analyses[0]?.updatedAt ?? null,
      };
    }),
    syncLogs: syncLogs.map((log) => ({
      id: log.id,
      status: log.status ? "success" : "failed",
      message: log.status ? "Synchronization completed" : "Synchronization failed; raw diagnostic text is withheld",
      createdAt: log.createdAt,
    })),
    media: media.map((entry) => ({
      id: entry.id, mediaType: entry.mediaType,
      durationSec: entry.durationSec, captureSource: entry.captureSource,
      qualityScore: entry.qualityScore, capturedAt: entry.capturedAt,
    })),
    deviceSessions: session.map((entry) => ({
      id: entry.id,
      userId: entry.userClerkId ?? null,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      eventCount: entry.eventCount,
    })),
    completedAt: item.completedAt,
    propertyId: property?.id ?? null,
    requiredZones: latestCoverage?.requiredZones ?? [],
    capturedZones: latestCoverage?.coveredRequired ?? [],
    reportStatus: "unavailable",
  });
});

router.get("/inspections/:id/evidence", async (req, res): Promise<void> => {
  const params = GetMissionControlInspectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid inspection id" });
    return;
  }
  const [inspection] = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
  }).from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const [media, analyses] = await Promise.all([
    db.select().from(inspectionMediaTable)
      .where(and(
        eq(inspectionMediaTable.inspectionId, inspection.id),
        eq(inspectionMediaTable.companyId, inspection.companyId),
      )).orderBy(desc(inspectionMediaTable.capturedAt), desc(inspectionMediaTable.createdAt), desc(inspectionMediaTable.id))
      .limit(500),
    db.select().from(analysisResultsTable)
      .where(and(
        eq(analysisResultsTable.inspectionId, inspection.id),
        eq(analysisResultsTable.companyId, inspection.companyId),
      )).orderBy(desc(analysisResultsTable.createdAt), desc(analysisResultsTable.id)).limit(100),
  ]);
  res.json({ items: media.map((entry) => evidenceView(entry, analyses)), total: media.length });
});

router.get("/inspections/:id/evidence/:evidenceId", async (req, res): Promise<void> => {
  const params = GetMissionControlInspectionEvidenceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid inspection or evidence id" });
    return;
  }
  const [inspection] = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
  }).from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const [media] = await db.select().from(inspectionMediaTable).where(and(
    eq(inspectionMediaTable.id, params.data.evidenceId),
    eq(inspectionMediaTable.inspectionId, inspection.id),
    eq(inspectionMediaTable.companyId, inspection.companyId),
  ));
  if (!media) {
    res.status(404).json({ error: "Evidence not found for inspection" });
    return;
  }
  const analyses = await db.select().from(analysisResultsTable)
    .where(and(
      eq(analysisResultsTable.inspectionId, inspection.id),
      eq(analysisResultsTable.companyId, inspection.companyId),
    )).orderBy(desc(analysisResultsTable.createdAt), desc(analysisResultsTable.id)).limit(100);
  res.json(evidenceView(media, analyses));
});

router.get("/inspections/:id/analysis", async (req, res): Promise<void> => {
  const params = GetMissionControlInspectionAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid inspection id" });
    return;
  }
  const [inspection] = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
  }).from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const analyses = await db.select().from(analysisResultsTable)
    .where(and(
      eq(analysisResultsTable.inspectionId, inspection.id),
      eq(analysisResultsTable.companyId, inspection.companyId),
    )).orderBy(desc(analysisResultsTable.createdAt), desc(analysisResultsTable.id)).limit(100);
  const toZone = (zones: Array<{ slug: string; label: string }> | null | undefined) =>
    Array.isArray(zones) ? zones.map(({ slug, label }) => ({ slug, label })) : [];
  res.json({
    inspectionId: inspection.id,
    state: analysisState(analyses[0]),
    latestAnalysisId: analyses[0]?.id ?? null,
    provider: null,
    model: null,
    runs: analyses.map((analysis) => {
      const coverage = analysis.coverage;
      const state = analysisState(analysis);
      const error = state === "failed" || state === "timed_out"
        ? safeDiagnostic(analysis.failureReason) ?? "Analysis failed; diagnostic details unavailable"
        : null;
      return {
        id: analysis.id,
        state,
        recordedAt: analysis.createdAt,
        error,
        findings: (analysis.findings ?? []).map((finding) => ({
          id: finding.id,
          category: finding.category,
          description: finding.description,
          confidence: finding.confidence,
          severity: finding.severity,
          location: finding.location,
        })),
        requiredZones: toZone(coverage?.requiredZones),
        coveredZones: toZone(coverage?.coveredRequired),
        uncoveredZones: toZone(coverage?.uncoveredRequired),
        analysisErrors: analysis.analysisErrors,
      };
    }),
  });
});

router.get("/inspections/:id/timeline", async (req, res): Promise<void> => {
  const params = GetMissionControlInspectionTimelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid inspection id" });
    return;
  }
  const [inspection] = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
  }).from(inspectionsTable).where(eq(inspectionsTable.id, params.data.id));
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }
  const timeline = await getMissionControlInspectionTimeline({
    companyId: inspection.companyId,
    inspectionId: inspection.id,
  });
  const typeForSource = (sourceType: string) => {
    switch (sourceType) {
      case "inspections": return "inspection" as const;
      case "inspection_media": return "evidence" as const;
      case "analysis_results": return "analysis" as const;
      case "inspection_sync_logs": return "sync" as const;
      case "enterprise_outbox": return "sync" as const;
      case "analysis_provider_attempts": return "analysis" as const;
      case "inspection_upload_intents": return "evidence" as const;
      case "meta_glasses_sessions": return "device_session" as const;
      case "mission_control_incidents": return "incident" as const;
      case "mission_control_audit": return "incident_action" as const;
      default: return "event" as const;
    }
  };
  res.json({
    inspectionId: inspection.id,
    items: timeline.map((event) => ({
      ...event,
      type: typeForSource(event.sourceType),
      companyId: inspection.companyId,
      inspectionId: inspection.id,
    })),
  });
});

router.get("/device-sessions/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid device session id" });
    return;
  }
  const [session] = await db.select({
    id: metaGlassesSessionsTable.id,
    inspectionId: inspectionsTable.id,
    companyId: companiesTable.id,
    companyName: companiesTable.name,
    userId: usersTable.clerkUserId,
    createdAt: metaGlassesSessionsTable.createdAt,
    expiresAt: metaGlassesSessionsTable.expiresAt,
    events: metaGlassesSessionsTable.events,
  }).from(metaGlassesSessionsTable)
    .innerJoin(inspectionsTable, and(
      eq(metaGlassesSessionsTable.inspectionId, inspectionsTable.id),
      eq(metaGlassesSessionsTable.companyId, inspectionsTable.companyId),
    ))
    .innerJoin(companiesTable, eq(metaGlassesSessionsTable.companyId, companiesTable.id))
    .leftJoin(usersTable, and(
      eq(metaGlassesSessionsTable.userId, usersTable.id),
      eq(metaGlassesSessionsTable.companyId, usersTable.companyId),
    ))
    .where(eq(metaGlassesSessionsTable.id, id));
  if (!session) {
    res.status(404).json({ error: "Device session not found" });
    return;
  }
  const events = Array.isArray(session.events) ? session.events.slice(-MAX_LIMIT) : [];
  const sanitizedEvents = events.flatMap((rawEvent) => {
    if (!rawEvent || typeof rawEvent !== "object") return [];
    const event = rawEvent as { type?: unknown; timestamp?: unknown };
    const timestamp = typeof event.timestamp === "number" ? event.timestamp : Number(event.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8.64e15) return [];
    const knownTypes = ["finding", "status", "transcription"] as const;
    const type = typeof event.type === "string" && knownTypes.includes(event.type as typeof knownTypes[number])
      ? event.type
      : "status";
    return [{ type, createdAt: new Date(timestamp).toISOString() }];
  });
  res.json({
    id: session.id,
    inspectionId: session.inspectionId,
    companyId: session.companyId,
    companyName: session.companyName,
    userId: session.userId ?? null,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    eventCount: Array.isArray(session.events) ? session.events.length : 0,
    events: sanitizedEvents,
  });
});

type IncidentSource = {
  reference: string;
  sourceType: string;
  sourceId: string;
  companyId: number;
  companyName: string;
  inspectionId?: number;
  userId?: number;
  sessionId?: number;
  userClerkId?: string | null;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  createdAt: Date;
  isRecovered?: boolean;
  recoveredAt?: Date | string | null;
};

const missionControlIncidentSourceCte = sql`
  WITH source_events AS (
    SELECT
      ('error:' || e.id)::text AS reference,
      'error_event'::text AS source_type,
      e.id::text AS source_id,
      e.company_id,
      ei.id AS inspection_id,
      COALESCE(eu.id, etu.id) AS user_id,
      COALESCE(eu.clerk_user_id, etu.clerk_user_id) AS user_clerk_id,
      related_session.id AS session_id,
      c.name AS company_name,
      (e.category || ' error')::text AS title,
      ('Recorded error event ' || e.id)::text AS description,
      CASE WHEN e.category = 'auth' THEN 'high' ELSE 'medium' END::text AS severity,
      e.created_at,
      FALSE AS is_recovered,
      NULL::timestamp AS recovered_at
    FROM error_events e
    JOIN companies c ON c.id = e.company_id
    LEFT JOIN inspections ei ON ei.id = e.inspection_id AND ei.company_id = e.company_id
    LEFT JOIN users eu ON eu.id = e.user_id AND eu.company_id = e.company_id
    LEFT JOIN users etu ON etu.company_id = e.company_id AND etu.clerk_user_id = ei.technician_id
    LEFT JOIN LATERAL (
      SELECT m.id
      FROM meta_glasses_sessions m
      WHERE m.company_id = e.company_id
        AND m.inspection_id = ei.id
        AND m.user_id = COALESCE(eu.id, etu.id)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) related_session ON TRUE
    UNION ALL
    SELECT
      ('sync:' || s.id)::text AS reference,
      'sync_log'::text AS source_type,
      s.id::text AS source_id,
      s.company_id,
      si.id AS inspection_id,
      su.id AS user_id,
      su.clerk_user_id AS user_clerk_id,
      NULL::integer AS session_id,
      c.name AS company_name,
      'Field synchronization failed'::text AS title,
      ('Failed synchronization attempt ' || s.id || '; diagnostic text is withheld')::text AS description,
      'high'::text AS severity,
      s.synced_at AS created_at,
      (recovery.recovered_at IS NOT NULL) AS is_recovered,
      recovery.recovered_at
    FROM inspection_sync_logs s
    JOIN companies c ON c.id = s.company_id
    JOIN inspections si ON si.id = s.inspection_id AND si.company_id = s.company_id
    LEFT JOIN users su ON su.company_id = s.company_id AND su.clerk_user_id = si.technician_id
    LEFT JOIN LATERAL (
      SELECT max(newer.synced_at) AS recovered_at
      FROM inspection_sync_logs newer
      WHERE newer.company_id = s.company_id
        AND newer.inspection_id = s.inspection_id
        AND newer.success = TRUE
        AND (newer.synced_at > s.synced_at OR (newer.synced_at = s.synced_at AND newer.id > s.id))
    ) recovery ON TRUE
    WHERE s.success = FALSE
    UNION ALL
    SELECT
      ('analysis:' || a.id)::text AS reference,
      'analysis'::text AS source_type,
      a.id::text AS source_id,
      a.company_id,
      ai.id AS inspection_id,
      au.id AS user_id,
      au.clerk_user_id AS user_clerk_id,
      NULL::integer AS session_id,
      c.name AS company_name,
      'Inspection analysis failed'::text AS title,
      ('Failed analysis result ' || a.id || '; diagnostic text is withheld')::text AS description,
      'medium'::text AS severity,
      a.created_at,
      FALSE AS is_recovered,
      NULL::timestamp AS recovered_at
    FROM analysis_results a
    JOIN companies c ON c.id = a.company_id
    JOIN inspections ai ON ai.id = a.inspection_id AND ai.company_id = a.company_id
    LEFT JOIN users au ON au.company_id = a.company_id AND au.clerk_user_id = ai.technician_id
    WHERE a.status = 'failed' OR a.analysis_errors > 0
  )
`;

async function reconcileRecoveredSyncIncidents(): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT i.id, i.reference, i.company_id AS "companyId", i.status, i.severity,
        i.assigned_to AS "assignedTo", i.acknowledged_at AS "acknowledgedAt",
        recovery.recovered_at AS "recoveredAt"
      FROM mission_control_incidents i
      JOIN inspection_sync_logs failed
        ON i.reference = ('sync:' || failed.id)::text
        AND i.source_type = 'sync_log'
        AND i.company_id = failed.company_id
      JOIN inspections owner_inspection
        ON owner_inspection.id = failed.inspection_id
        AND owner_inspection.company_id = failed.company_id
      JOIN LATERAL (
        SELECT max(newer.synced_at) AS recovered_at
        FROM inspection_sync_logs newer
        WHERE newer.company_id = failed.company_id
          AND newer.inspection_id = failed.inspection_id
          AND newer.success = TRUE
          AND (
            newer.synced_at > failed.synced_at
            OR (newer.synced_at = failed.synced_at AND newer.id > failed.id)
          )
      ) recovery ON recovery.recovered_at IS NOT NULL
      WHERE failed.success = FALSE
        AND i.status IN ('open', 'acknowledged', 'investigating')
      FOR UPDATE OF i SKIP LOCKED
    `);
    for (const raw of result.rows as Array<{
      id: number; reference: string; companyId: number; status: string; severity: string;
      assignedTo: string | null; acknowledgedAt: Date | null; recoveredAt: Date | string;
    }>) {
      const recoveredAt = raw.recoveredAt instanceof Date ? raw.recoveredAt : new Date(raw.recoveredAt);
      const [updated] = await tx.update(missionControlIncidentsTable).set({
        status: "resolved",
        updatedAt: recoveredAt,
      }).where(and(
        eq(missionControlIncidentsTable.id, raw.id),
        inArray(missionControlIncidentsTable.status, ["open", "acknowledged", "investigating"]),
      )).returning();
      if (!updated) continue;
      await addAudit(tx, "system:mission-control", "incident_sync_recovered", "incident", String(raw.id), {
        sourceReference: raw.reference,
        companyId: raw.companyId,
        action: "sync_recovery",
        result: "reconciled",
        reason: "A later successful synchronization superseded the failed attempt.",
        before: {
          status: raw.status,
          severity: raw.severity,
          assignedTo: raw.assignedTo,
          acknowledgedAt: raw.acknowledgedAt,
        },
        after: {
          status: updated.status,
          severity: updated.severity,
          assignedTo: updated.assignedTo,
          acknowledgedAt: updated.acknowledgedAt,
        },
      });
    }
  });
}

async function countOpenIncidents(): Promise<number> {
  const result = await db.execute(sql`
    ${missionControlIncidentSourceCte}
    SELECT count(*)::integer AS total
    FROM source_events s
    LEFT JOIN mission_control_incidents i ON i.reference = s.reference
      AND i.company_id = s.company_id AND i.source_type = s.source_type AND i.source_id = s.source_id
    WHERE ${incidentEligibility({ activeOnly: true })}
  `);
  return Number((result.rows[0] as { total?: number | string } | undefined)?.total ?? 0);
}

async function loadIncidentSource(sourceType: string, rawId: string): Promise<IncidentSource | undefined> {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  if (sourceType === "error_event") {
    const [row] = await db.select({
      id: errorEventsTable.id, companyId: errorEventsTable.companyId,
      companyName: companiesTable.name, category: errorEventsTable.category,
      inspectionId: errorEventsTable.inspectionId, userId: errorEventsTable.userId,
      createdAt: errorEventsTable.createdAt,
    }).from(errorEventsTable).innerJoin(companiesTable, eq(errorEventsTable.companyId, companiesTable.id))
      .where(eq(errorEventsTable.id, id));
    if (!row) return undefined;
    const refs = await loadIncidentReferences(row.companyId, row.inspectionId, row.userId);
    return {
      reference: `error:${id}`, sourceType, sourceId: rawId, companyId: row.companyId,
      ...refs,
      companyName: row.companyName, title: `${row.category} error`,
      description: `Recorded error event ${id} (${row.category})`,
      severity: row.category === "auth" ? "high" : "medium", createdAt: row.createdAt,
    };
  }
  if (sourceType === "sync_log") {
    const [row] = await db.select({
      id: inspectionSyncLogsTable.id, companyId: inspectionSyncLogsTable.companyId,
      companyName: companiesTable.name, inspectionId: inspectionSyncLogsTable.inspectionId,
      createdAt: inspectionSyncLogsTable.syncedAt,
      recoveredAt: sql<Date | null>`(
        SELECT max(recovered.synced_at) FROM inspection_sync_logs recovered
        WHERE recovered.company_id = ${inspectionSyncLogsTable.companyId}
          AND recovered.inspection_id = ${inspectionSyncLogsTable.inspectionId}
          AND recovered.success = TRUE
          AND (
            recovered.synced_at > ${inspectionSyncLogsTable.syncedAt}
            OR (recovered.synced_at = ${inspectionSyncLogsTable.syncedAt} AND recovered.id > ${inspectionSyncLogsTable.id})
          )
      )`,
    }).from(inspectionSyncLogsTable)
      .innerJoin(inspectionsTable, and(
        eq(inspectionSyncLogsTable.inspectionId, inspectionsTable.id),
        eq(inspectionSyncLogsTable.companyId, inspectionsTable.companyId),
      ))
      .innerJoin(companiesTable, eq(inspectionSyncLogsTable.companyId, companiesTable.id))
      .where(and(eq(inspectionSyncLogsTable.id, id), eq(inspectionSyncLogsTable.success, false)));
    if (!row) return undefined;
    const refs = await loadIncidentReferences(row.companyId, row.inspectionId, null);
    return {
      reference: `sync:${id}`, sourceType, sourceId: rawId, companyId: row.companyId,
      ...refs,
      companyName: row.companyName, title: "Field synchronization failed",
      description: `Failed synchronization attempt ${id}; diagnostic text is withheld`,
      severity: "high", createdAt: row.createdAt,
      isRecovered: row.recoveredAt != null,
      recoveredAt: row.recoveredAt == null
        ? null
        : row.recoveredAt instanceof Date ? row.recoveredAt : new Date(row.recoveredAt),
    };
  }
  if (sourceType === "analysis") {
    const [row] = await db.select({
      id: analysisResultsTable.id, companyId: analysisResultsTable.companyId,
      companyName: companiesTable.name, inspectionId: analysisResultsTable.inspectionId,
      createdAt: analysisResultsTable.createdAt,
    }).from(analysisResultsTable)
      .innerJoin(inspectionsTable, and(
        eq(analysisResultsTable.inspectionId, inspectionsTable.id),
        eq(analysisResultsTable.companyId, inspectionsTable.companyId),
      ))
      .innerJoin(companiesTable, eq(analysisResultsTable.companyId, companiesTable.id))
      .where(and(eq(analysisResultsTable.id, id), or(
        eq(analysisResultsTable.status, "failed"),
        sql`${analysisResultsTable.analysisErrors} > 0`,
      )));
    if (!row) return undefined;
    const refs = await loadIncidentReferences(row.companyId, row.inspectionId, null);
    return {
      reference: `analysis:${id}`, sourceType, sourceId: rawId, companyId: row.companyId,
      ...refs,
      companyName: row.companyName, title: "Inspection analysis failed",
      description: `Failed analysis result ${id}; diagnostic text is withheld`,
      severity: "medium", createdAt: row.createdAt,
    };
  }
  return undefined;
}

async function loadIncidentReferences(
  companyId: number,
  rawInspectionId: number | null,
  rawUserId: number | null,
): Promise<Pick<IncidentSource, "inspectionId" | "userId" | "sessionId" | "userClerkId">> {
  const [inspection] = rawInspectionId != null && Number.isSafeInteger(rawInspectionId) && rawInspectionId > 0
    ? await db.select({ id: inspectionsTable.id, technicianId: inspectionsTable.technicianId })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, rawInspectionId), eq(inspectionsTable.companyId, companyId)))
      .limit(1)
    : [];
  let user = rawUserId != null && Number.isSafeInteger(rawUserId) && rawUserId > 0
    ? (await db.select({ id: usersTable.id, clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(and(eq(usersTable.id, rawUserId), eq(usersTable.companyId, companyId)))
      .limit(1))[0]
    : undefined;
  if (!user && inspection?.technicianId) {
    user = (await db.select({ id: usersTable.id, clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(and(
        eq(usersTable.clerkUserId, inspection.technicianId),
        eq(usersTable.companyId, companyId),
      ))
      .limit(1))[0];
  }
  const inspectionId = inspection?.id;
  const userId = user?.id;
  let sessionId: number | undefined;
  if (inspectionId != null && userId != null) {
    const [session] = await db.select({ id: metaGlassesSessionsTable.id })
      .from(metaGlassesSessionsTable)
      .where(and(
        eq(metaGlassesSessionsTable.companyId, companyId),
        eq(metaGlassesSessionsTable.inspectionId, inspectionId),
        eq(metaGlassesSessionsTable.userId, userId),
      ))
      .orderBy(desc(metaGlassesSessionsTable.createdAt), desc(metaGlassesSessionsTable.id))
      .limit(1);
    sessionId = session?.id;
  }
  return {
    ...(inspectionId == null ? {} : { inspectionId }),
    ...(userId == null ? {} : { userId }),
    ...(sessionId == null ? {} : { sessionId }),
    ...(user?.clerkUserId == null ? {} : { userClerkId: user.clerkUserId }),
  };
}

async function persistedIncident(source: IncidentSource) {
  const recoveredAt = source.recoveredAt == null
    ? null
    : source.recoveredAt instanceof Date ? source.recoveredAt : new Date(source.recoveredAt);
  const [row] = await db.insert(missionControlIncidentsTable).values({
    reference: source.reference,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    companyId: source.companyId,
    inspectionId: source.inspectionId ?? null,
    userId: source.userId ?? null,
    sessionId: source.sessionId ?? null,
    severity: source.severity,
    status: source.isRecovered ? "resolved" : "open",
    createdAt: source.createdAt,
    updatedAt: source.isRecovered && recoveredAt ? recoveredAt : source.createdAt,
  }).onConflictDoNothing({ target: missionControlIncidentsTable.reference }).returning();
  if (row) return row;
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(missionControlIncidentsTable)
      .where(eq(missionControlIncidentsTable.reference, source.reference)).for("update");
    if (!existing
      || existing.reference !== source.reference
      || existing.sourceType !== source.sourceType
      || existing.sourceId !== source.sourceId
      || existing.companyId !== source.companyId) return undefined;
    const missingReferences = {
      ...(source.inspectionId != null && existing.inspectionId == null ? { inspectionId: source.inspectionId } : {}),
      ...(source.userId != null && existing.userId == null ? { userId: source.userId } : {}),
      ...(source.sessionId != null && existing.sessionId == null ? { sessionId: source.sessionId } : {}),
    };
    let current = existing;
    if (source.isRecovered && ["open", "acknowledged", "investigating"].includes(existing.status)) {
      const recoveredAt = source.recoveredAt == null
        ? new Date()
        : source.recoveredAt instanceof Date ? source.recoveredAt : new Date(source.recoveredAt);
      const [updated] = await tx.update(missionControlIncidentsTable).set({
        ...missingReferences,
        status: "resolved",
        updatedAt: recoveredAt,
      }).where(eq(missionControlIncidentsTable.id, existing.id)).returning();
      if (!updated) return undefined;
      await addAudit(tx, "system:mission-control", "incident_sync_recovered", "incident", String(existing.id), {
        sourceReference: source.reference,
        companyId: source.companyId,
        action: "sync_recovery",
        result: "reconciled",
        reason: "A later successful synchronization superseded the failed attempt.",
        before: {
          status: existing.status,
          severity: existing.severity,
          assignedTo: existing.assignedTo,
          acknowledgedAt: existing.acknowledgedAt,
        },
        after: {
          status: updated.status,
          severity: updated.severity,
          assignedTo: updated.assignedTo,
          acknowledgedAt: updated.acknowledgedAt,
        },
      });
      current = updated;
    } else if (Object.keys(missingReferences).length > 0) {
      const [updated] = await tx.update(missionControlIncidentsTable).set(missingReferences)
        .where(eq(missionControlIncidentsTable.id, existing.id)).returning();
      current = updated ?? existing;
    }
    return current;
  });
}

function incidentView(
  source: IncidentSource,
  stored: typeof missionControlIncidentsTable.$inferSelect,
  effectiveStatus = stored.status,
) {
  return {
    id: stored.id,
    companyId: source.companyId,
    companyName: source.companyName,
    severity: stored.severity,
    status: effectiveStatus,
    title: source.title,
    description: source.description.slice(0, 2000),
    assignedTo: stored.assignedTo,
    acknowledgedAt: stored.acknowledgedAt,
    createdAt: source.createdAt,
    updatedAt: stored.updatedAt,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    ...(source.inspectionId == null ? {} : { inspectionId: source.inspectionId }),
    userId: source.userClerkId ?? null,
    ...(source.sessionId == null ? {} : { sessionId: source.sessionId }),
  };
}

router.get("/incidents", async (req, res): Promise<void> => {
  const parsed = ListMissionControlIncidentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await reconcileRecoveredSyncIncidents();
  const { page, limit, offset } = pageArgs(parsed.data);
  const companyFilter = parsed.data.companyId == null ? sql`TRUE` : sql`s.company_id = ${parsed.data.companyId}`;
  const sourceTypeFilter = parsed.data.sourceType == null ? sql`TRUE` : sql`s.source_type = ${parsed.data.sourceType}`;
  const severityFilter = parsed.data.severity == null ? sql`TRUE` : sql`COALESCE(i.severity, s.severity) = ${parsed.data.severity}`;
  const eligibility = incidentEligibility({
    status: parsed.data.status,
    activeOnly: parsed.data.activeOnly === "true",
    hasSession: parsed.data.hasSession === "true",
  });
  const where = sql`${companyFilter} AND ${sourceTypeFilter} AND ${severityFilter} AND ${eligibility}`;
  const totalResult = await db.execute(sql`
    ${missionControlIncidentSourceCte}
    SELECT count(*)::integer AS total
    FROM source_events s
    LEFT JOIN mission_control_incidents i ON i.reference = s.reference
      AND i.company_id = s.company_id AND i.source_type = s.source_type AND i.source_id = s.source_id
    WHERE ${where}
  `);
  const dataResult = await db.execute(sql`
    ${missionControlIncidentSourceCte}
    SELECT
      s.reference, s.source_type AS "sourceType", s.source_id AS "sourceId",
      s.company_id AS "companyId", s.company_name AS "companyName",
      s.inspection_id AS "inspectionId", s.user_id AS "userId", s.user_clerk_id AS "userClerkId",
      s.session_id AS "sessionId",
      s.title, s.description, COALESCE(i.severity, s.severity) AS severity,
      ${incidentEffectiveStatusSql()} AS status,
      s.is_recovered AS "isRecovered", s.recovered_at AS "recoveredAt",
      i.assigned_to AS "assignedTo",
      i.acknowledged_at AS "acknowledgedAt", s.created_at AS "createdAt",
      COALESCE(s.recovered_at, i.updated_at, s.created_at) AS "updatedAt"
    FROM source_events s
    LEFT JOIN mission_control_incidents i ON i.reference = s.reference
      AND i.company_id = s.company_id AND i.source_type = s.source_type AND i.source_id = s.source_id
    WHERE ${where}
    ORDER BY s.created_at DESC, s.reference ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const total = Number((totalResult.rows[0] as { total?: number | string } | undefined)?.total ?? 0);
  const rawRows = dataResult.rows as Array<Omit<IncidentSource, "createdAt"> & {
    createdAt: Date | string;
    isRecovered: boolean;
    recoveredAt: Date | string | null;
    status: string;
    assignedTo: string | null;
    acknowledgedAt: Date | null;
    updatedAt: Date;
  }>;
  const rows: Array<IncidentSource & {
    status: string;
    assignedTo: string | null;
    acknowledgedAt: Date | null;
    updatedAt: Date;
  }> = rawRows.map((source) => ({
    ...source,
    createdAt: source.createdAt instanceof Date ? source.createdAt : new Date(source.createdAt),
    recoveredAt: source.recoveredAt == null
      ? null
      : source.recoveredAt instanceof Date ? source.recoveredAt : new Date(source.recoveredAt),
  }));
  const storedRows = await Promise.all(rows.map(persistedIncident));
  res.json(pageResult(rows.flatMap((source, index) => {
    const stored = storedRows[index];
    return stored ? [incidentView(source, stored, source.status)] : [];
  }), page, limit, total));
});

router.get("/incidents/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid incident id" });
    return;
  }
  await reconcileRecoveredSyncIncidents();
  const [stored] = await db.select().from(missionControlIncidentsTable).where(eq(missionControlIncidentsTable.id, id));
  if (!stored) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const source = await loadIncidentSource(stored.sourceType, stored.sourceId);
  if (!source || source.reference !== stored.reference || source.companyId !== stored.companyId) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  const reconciled = await persistedIncident(source);
  if (!reconciled) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  res.json(incidentView(source, reconciled));
});

async function auditRejectedIncidentAction(
  id: number,
  actorId: string,
  action: "assign" | "escalate",
  reason: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [stored] = await tx.select().from(missionControlIncidentsTable)
      .where(eq(missionControlIncidentsTable.id, id)).for("update");
    if (!stored) return false;
    const state = {
      status: stored.status,
      severity: stored.severity,
      assignedTo: stored.assignedTo,
      acknowledgedAt: stored.acknowledgedAt,
    };
    await addAudit(tx, actorId, `incident_${action}`, "incident", String(id), {
      sourceReference: stored.reference,
      companyId: stored.companyId,
      action,
      result: "rejected",
      reason,
      before: state,
      after: state,
    });
    return true;
  });
}

router.patch("/incidents/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const parsed = UpdateMissionControlIncidentBody.safeParse(req.body);
  if (!id) {
    res.status(400).json({ error: "Valid incident id and update are required" });
    return;
  }
  if (!parsed.success) {
    const attemptedAction = req.body && typeof req.body === "object"
      ? (req.body as { action?: unknown }).action
      : undefined;
    if (attemptedAction === "assign" || attemptedAction === "escalate") {
      await reconcileRecoveredSyncIncidents();
      const recorded = await auditRejectedIncidentAction(id, req.user!.clerkUserId, attemptedAction, "Invalid action fields");
      if (!recorded) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }
    }
    res.status(400).json({ error: "Valid incident update is required" });
    return;
  }
  await reconcileRecoveredSyncIncidents();
  const action = parsed.data.action;
  const [beforeUpdate] = await db.select().from(missionControlIncidentsTable)
    .where(eq(missionControlIncidentsTable.id, id));
  if (!beforeUpdate) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const existingSource = await loadIncidentSource(beforeUpdate.sourceType, beforeUpdate.sourceId);
  if (!existingSource || existingSource.reference !== beforeUpdate.reference || existingSource.companyId !== beforeUpdate.companyId) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  const reconciled = await persistedIncident(existingSource);
  if (!reconciled) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  const note = parsed.data.note ? safeDiagnostic(parsed.data.note) : null;
  const result = await db.transaction(async (tx) => {
    const [stored] = await tx.select().from(missionControlIncidentsTable)
      .where(eq(missionControlIncidentsTable.id, id)).for("update");
    if (!stored) return { status: 404 as const, error: "Incident not found" };
    const before = {
      status: stored.status,
      severity: stored.severity,
      assignedTo: stored.assignedTo,
      acknowledgedAt: stored.acknowledgedAt,
    };
    const reject = async (message: string, status: 400 | 409 = 409) => {
      await addAudit(tx, req.user!.clerkUserId, `incident_${action}`, "incident", String(id), {
        sourceReference: stored.reference,
        companyId: stored.companyId,
        action,
        result: "rejected",
        reason: message,
        before,
        after: before,
        note,
      });
      return { status, error: message };
    };
    const terminal = stored.status === "resolved" || stored.status === "dismissed";
    const updates: Partial<typeof missionControlIncidentsTable.$inferInsert> = { updatedAt: new Date() };
    if (terminal) return reject("Resolved or dismissed incidents cannot be changed");
    if (action === "acknowledge") {
      if (stored.status !== "open" || stored.acknowledgedAt != null) {
        return reject("Incident has already been acknowledged or is no longer open");
      }
      updates.status = "acknowledged";
      updates.acknowledgedAt = new Date();
    } else if (action === "claim") {
      if (stored.assignedTo != null) return reject("Incident is already assigned");
      updates.assignedTo = req.user!.clerkUserId;
      updates.status = "investigating";
      updates.acknowledgedAt = stored.acknowledgedAt ?? new Date();
    } else if (action === "assign") {
      const assigneeId = parsed.data.assigneeId?.trim();
      if (!assigneeId) return reject("Assignment requires an assignee", 400);
      const [assignee] = await tx.select({
        id: usersTable.clerkUserId,
        isSuperAdmin: usersTable.isSuperAdmin,
      }).from(usersTable).where(eq(usersTable.clerkUserId, assigneeId)).limit(1);
      if (!assignee?.isSuperAdmin) {
        return reject("Assignee must be an existing super admin", 400);
      }
      if (stored.assignedTo === assignee.id) return reject("Incident is already assigned to this user");
      updates.assignedTo = assignee.id;
    } else if (action === "resolve") {
      updates.status = "resolved";
    } else if (action === "escalate") {
      if (!parsed.data.severity) return reject("Escalation requires a severity", 400);
      const severityRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
      const priorSeverity = severityRank[stored.severity];
      if (priorSeverity == null || severityRank[parsed.data.severity] <= priorSeverity) {
        return reject("Escalation must increase incident severity", 400);
      }
      updates.severity = parsed.data.severity;
    } else {
      return { status: 400 as const, error: "Action requires its corresponding fields" };
    }
    if (note) updates.note = note;
    const [row] = await tx.update(missionControlIncidentsTable).set(updates)
      .where(eq(missionControlIncidentsTable.id, id)).returning();
    if (!row) return { status: 404 as const, error: "Incident not found" };
    const [audit] = await addAudit(tx, req.user!.clerkUserId, `incident_${action}`, "incident", String(id), {
      sourceReference: stored.reference,
      companyId: stored.companyId,
      action,
      result: "applied",
      before,
      after: {
        status: row.status,
        severity: row.severity,
        assignedTo: row.assignedTo,
        acknowledgedAt: row.acknowledgedAt,
      },
      note,
    });
    if (audit && row.inspectionId != null) {
      await appendMissionControlInspectionEvent(tx, {
        companyId: row.companyId,
        inspectionId: row.inspectionId,
        eventType: `incident.${action}`,
        entityType: "incident",
        entityId: String(row.id),
        sourceRecordType: "mission_control_audit",
        sourceRecordId: String(audit.id),
        actor: req.user!.clerkUserId,
        occurredAt: audit.createdAt,
        idempotencyKey: `mission-control-incident-audit:${audit.id}`,
        payload: { action, status: row.status },
      });
    }
    return { status: 200 as const, row, reference: stored.reference, companyId: stored.companyId };
  });
  if (!("row" in result) || !result.row) {
    res.status(result.status).json({ error: "error" in result ? result.error : "Incident update failed" });
    return;
  }
  const source = await loadIncidentSource(result.row.sourceType, result.row.sourceId);
  if (!source || source.reference !== result.reference || source.companyId !== result.companyId) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  res.json(incidentView(source, result.row));
});

router.get("/audit", async (req, res): Promise<void> => {
  const parsed = ListMissionControlAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const filters = and(
    parsed.data.action ? eq(missionControlAuditTable.action, parsed.data.action) : undefined,
    parsed.data.actorId ? eq(missionControlAuditTable.actorId, parsed.data.actorId) : undefined,
    parsed.data.targetType ? eq(missionControlAuditTable.targetType, parsed.data.targetType) : undefined,
    parsed.data.targetId ? eq(missionControlAuditTable.targetId, parsed.data.targetId) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(missionControlAuditTable).where(filters);
  const rows = await db.select().from(missionControlAuditTable).where(filters)
    .orderBy(desc(missionControlAuditTable.createdAt), desc(missionControlAuditTable.id)).limit(limit).offset(offset);
  res.json(pageResult(rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    actorName: null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    details: row.details ? JSON.stringify(row.details) : null,
    createdAt: row.createdAt,
  })), page, limit, total.value));
});

router.get("/agents", async (_req, res): Promise<void> => {
  const [queued] = await db.select({ value: count() }).from(missionControlAgentTasksTable)
    .where(eq(missionControlAgentTasksTable.status, "queued"));
  const [running] = await db.select({ value: count() }).from(missionControlAgentTasksTable)
    .where(eq(missionControlAgentTasksTable.status, "running"));
  const worker = await missionControlAgentWorkerStatus();
  const workerReady = worker.running && worker.leader && worker.geminiConfigured;
  const active = await db.select({ specialist: missionControlDelegationsTable.specialist })
    .from(missionControlDelegationsTable).where(eq(missionControlDelegationsTable.status, "running"));
  const busy = new Set(active.map((row) => row.specialist));
  res.json({
    agents: executiveRegistry.map(({ identity, displayName, role, capability }) => ({
      identity, displayName, role, capability,
      status: !workerReady ? "unavailable" : identity === "quinn"
        ? running.value > 0 ? "busy" : "available"
        : busy.has(identity) ? "busy" : "available",
    })),
    // Investigation tasks are not executable Agent Zero jobs. No execution endpoint
    // accepts model output; consequential actions use the separate human approval flow.
    agentZero: { available: false, realTaskCount: 0, basis: "real_tasks", approvalRequired: true },
    queueCounts: { queued: queued.value, running: running.value },
  });
});

router.get("/agents/tasks", async (req, res): Promise<void> => {
  const parsed = ListMissionControlAgentTasksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const filters = and(
    parsed.data.companyId == null ? undefined : eq(missionControlAgentTasksTable.companyId, parsed.data.companyId),
    parsed.data.status ? eq(missionControlAgentTasksTable.status, parsed.data.status) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(missionControlAgentTasksTable).where(filters);
  const rows = await db.select({
    id: missionControlAgentTasksTable.id, companyId: missionControlAgentTasksTable.companyId,
    companyName: companiesTable.name, prompt: missionControlAgentTasksTable.prompt,
    status: missionControlAgentTasksTable.status, createdBy: missionControlAgentTasksTable.createdBy,
    result: missionControlAgentTasksTable.result, error: missionControlAgentTasksTable.error,
    createdAt: missionControlAgentTasksTable.createdAt, startedAt: missionControlAgentTasksTable.startedAt,
    completedAt: missionControlAgentTasksTable.completedAt,
  }).from(missionControlAgentTasksTable).innerJoin(companiesTable, eq(missionControlAgentTasksTable.companyId, companiesTable.id))
    .where(filters).orderBy(desc(missionControlAgentTasksTable.createdAt), desc(missionControlAgentTasksTable.id))
    .limit(limit).offset(offset);
  res.json(pageResult(rows, page, limit, total.value));
});

router.post("/agents/tasks", async (req, res): Promise<void> => {
  const parsed = CreateMissionControlAgentTaskBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.prompt.trim()) {
    res.status(400).json({ error: parsed.success ? "Task prompt is required" : parsed.error.message });
    return;
  }
  const [company] = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable).where(eq(companiesTable.id, parsed.data.companyId));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const task = await db.transaction(async (tx) => {
    const [created] = await tx.insert(missionControlAgentTasksTable).values({
      companyId: company.id,
      prompt: parsed.data.prompt.trim().slice(0, 4000),
      createdBy: req.user!.clerkUserId,
    }).returning();
    await addAudit(tx, req.user!.clerkUserId, "agent_task_created", "agent_task", String(created!.id), {
      companyId: company.id,
    });
    return created;
  });
  res.status(201).json({ ...task, companyName: company.name });
});

router.get("/agents/tasks/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }
  const [task] = await db.select({
    id: missionControlAgentTasksTable.id, companyId: missionControlAgentTasksTable.companyId,
    companyName: companiesTable.name, prompt: missionControlAgentTasksTable.prompt,
    status: missionControlAgentTasksTable.status, createdBy: missionControlAgentTasksTable.createdBy,
    result: missionControlAgentTasksTable.result, error: missionControlAgentTasksTable.error,
    createdAt: missionControlAgentTasksTable.createdAt, startedAt: missionControlAgentTasksTable.startedAt,
    completedAt: missionControlAgentTasksTable.completedAt,
  }).from(missionControlAgentTasksTable).innerJoin(companiesTable, eq(missionControlAgentTasksTable.companyId, companiesTable.id))
    .where(eq(missionControlAgentTasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "Agent task not found" });
    return;
  }
  const [delegations, traces] = await Promise.all([
    db.select({
      id: missionControlDelegationsTable.id, specialist: missionControlDelegationsTable.specialist,
      scope: missionControlDelegationsTable.scope, status: missionControlDelegationsTable.status,
      result: missionControlDelegationsTable.result, error: missionControlDelegationsTable.error,
      createdAt: missionControlDelegationsTable.createdAt, completedAt: missionControlDelegationsTable.completedAt,
    }).from(missionControlDelegationsTable).where(and(
      eq(missionControlDelegationsTable.companyId, task.companyId),
      eq(missionControlDelegationsTable.taskId, task.id),
    )).orderBy(missionControlDelegationsTable.id),
    db.select({
      id: missionControlWorkTracesTable.id, delegationId: missionControlWorkTracesTable.delegationId,
      actor: missionControlWorkTracesTable.actor, event: missionControlWorkTracesTable.event,
      detail: missionControlWorkTracesTable.detail, createdAt: missionControlWorkTracesTable.createdAt,
    }).from(missionControlWorkTracesTable).where(and(
      eq(missionControlWorkTracesTable.companyId, task.companyId),
      eq(missionControlWorkTracesTable.taskId, task.id),
    )).orderBy(missionControlWorkTracesTable.id).limit(100),
  ]);
  res.json({ ...task, delegations, traces });
});

router.get("/approvals", async (req, res): Promise<void> => {
  const parsed = ListMissionControlApprovalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const filter = approvalStatusEligibility(parsed.data.status);
  const [total] = await db.select({ value: count() }).from(missionControlApprovalsTable).where(filter);
  const rows = await db.select().from(missionControlApprovalsTable).where(filter)
    .orderBy(desc(missionControlApprovalsTable.createdAt), desc(missionControlApprovalsTable.id)).limit(limit).offset(offset);
  res.json(pageResult(rows.map((row) => ({
    id: row.id, type: row.type, status: row.status, requestedBy: row.requestedBy,
    request: row.request, reason: row.reason, note: row.note, decidedBy: row.decidedBy,
    createdAt: row.createdAt, decidedAt: row.decidedAt,
    targetType: row.targetType, targetId: row.targetId, action: row.action,
    ...(row.type === "user_super_admin_access" ? { verifiedEmail: superAdminApprovalEmail(row.request) } : {}),
  })), page, limit, total.value));
});

// Explicit approval request creation is the first step of every reversible
// access action. The creator can never decide their own request.
// Resolve the Production Clerk subject only on the server that serves the
// authenticated operator. The target must sign in first so /auth/me creates
// its app-user mapping; looking up an email never creates a phantom user.
router.get("/super-admin/resolve", async (req, res): Promise<void> => {
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
  if (!VERIFIED_EMAIL.test(email) || email.length > 254) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (!process.env.CLERK_SECRET_KEY) {
    res.status(503).json({ error: "Clerk identity lookup is not configured" });
    return;
  }
  try {
    const result = await clerkClient.users.getUserList({ emailAddress: [email], limit: 100 });
    if (result.totalCount > result.data.length) {
      res.status(409).json({ error: "Identity search was incomplete; no target can be selected" });
      return;
    }
    const matches = result.data.filter((user) => {
      const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
      return primary?.emailAddress.toLowerCase() === email && primary.verification?.status === "verified";
    });
    if (matches.length > 1) {
      res.status(409).json({ error: "Multiple verified identities match this email" });
      return;
    }
    const identity = matches[0];
    if (!identity) {
      res.status(404).json({ error: "No verified Clerk identity matches this email" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, identity.id));
    if (!user) {
      res.status(409).json({ error: "This account must sign in to ReadyLoq first to create its app-user mapping" });
      return;
    }
    res.json({
      clerkUserId: identity.id,
      appUserId: user.id,
      verifiedEmail: email,
      isSuperAdmin: user.isSuperAdmin,
      companyId: user.companyId,
    });
  } catch {
    res.status(503).json({ error: "Clerk identity lookup is temporarily unavailable" });
  }
});

router.post("/approvals/requests", async (req, res): Promise<void> => {
  const body = req.body as { targetType?: unknown; targetId?: unknown; action?: unknown; reason?: unknown; verifiedEmail?: unknown; idempotencyKey?: unknown };
  if (!["company", "user"].includes(String(body.targetType)) || typeof body.targetId !== "string" ||
      !body.targetId.trim() || typeof body.action !== "string" || typeof body.reason !== "string" ||
      !body.reason.trim() || body.reason.length > 1000 ||
      (body.idempotencyKey != null && (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length > 128))) {
    res.status(400).json({ error: "targetType, targetId, action, reason, and optional idempotencyKey are required" });
    return;
  }
  const targetType = body.targetType as "company" | "user";
  const targetId = body.targetId;
  const action = body.action;
  const superAdminAction = action === "super_admin_enable" || action === "super_admin_disable";
  let expectedAccessState: boolean;
  const reason = body.reason.trim();
  const validAction = targetType === "company"
    ? ["suspend", "enable"].includes(action)
    : ["beta_enable", "beta_disable", "super_admin_enable", "super_admin_disable"].includes(action);
  if (!validAction) {
    res.status(400).json({ error: "Unsupported approval action" });
    return;
  }
  let verifiedEmail: string | null = null;
  if (superAdminAction) {
    verifiedEmail = typeof body.verifiedEmail === "string" ? body.verifiedEmail.trim().toLowerCase() : null;
    if (!verifiedEmail || !VERIFIED_EMAIL.test(verifiedEmail) || verifiedEmail.length > 254) {
      res.status(400).json({ error: "A verified primary Clerk email is required for Super Admin changes" });
      return;
    }
    try {
      if (await verifiedPrimaryEmailForClerkUser(targetId) !== verifiedEmail) {
        res.status(409).json({ error: "Target Clerk identity does not have this verified primary email" });
        return;
      }
    } catch {
      res.status(503).json({ error: "Clerk identity verification is unavailable" });
      return;
    }
  }
  if (targetType === "company") {
    const companyId = Number(targetId);
    if (!Number.isSafeInteger(companyId) || companyId <= 0) {
      res.status(400).json({ error: "Company targetId must be a positive integer" });
      return;
    }
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    expectedAccessState = company.accessSuspended;
    if (reservedCompany(company.slug)) {
      res.status(403).json({ error: "Reserved platform or legacy companies cannot be changed" });
      return;
    }
  } else {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, targetId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    expectedAccessState = superAdminAction ? user.isSuperAdmin : user.betaAccess;
    if (superAdminAction && user.clerkUserId === req.user!.clerkUserId) {
      res.status(403).json({ error: "Super Admin self-grants and self-revocations are not permitted" });
      return;
    }
    if (superAdminAction && expectedAccessState === (action === "super_admin_enable")) {
      res.status(409).json({ error: "Target already has the requested Super Admin state" });
      return;
    }
    if (user.clerkUserId === req.user!.clerkUserId && action === "beta_disable") {
      res.status(403).json({ error: "Self-lockout is not permitted" });
      return;
    }
  }
  const type = targetType === "company" ? "company_access" : superAdminAction ? "user_super_admin_access" : "user_beta_access";
  const request = superAdminAction
    ? JSON.stringify({ action, targetId, verifiedEmail, reason })
    : `${action} ${targetType} ${targetId}: ${reason}`;
  const approval = await db.transaction(async (tx) => {
    const [created] = await tx.insert(missionControlApprovalsTable).values({
      type,
      requestedBy: req.user!.clerkUserId,
      targetType,
      targetId,
      action,
      expectedAccessState,
      request,
      reason,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
    }).onConflictDoNothing().returning();
    let existing = created;
    if (!existing && typeof body.idempotencyKey === "string") {
      [existing] = await tx.select().from(missionControlApprovalsTable)
        .where(eq(missionControlApprovalsTable.idempotencyKey, body.idempotencyKey));
    }
    if (existing && created == null &&
        (existing.requestedBy !== req.user!.clerkUserId || existing.targetType !== targetType ||
         existing.targetId !== targetId || existing.action !== action || existing.reason !== reason ||
         existing.request !== request ||
         existing.expectedAccessState !== expectedAccessState)) {
      return undefined;
    }
    if (existing && created) {
      await addAudit(tx, req.user!.clerkUserId, "approval_requested", targetType, targetId, {
        approvalId: existing.id, action, reason,
      });
    }
    return existing;
  });
  if (!approval) {
    res.status(409).json({ error: "Could not create or retrieve approval request" });
    return;
  }
  res.status(201).json({
    id: approval.id, type: approval.type, status: approval.status, requestedBy: approval.requestedBy,
    request: approval.request, reason: approval.reason, note: approval.note, decidedBy: approval.decidedBy,
    createdAt: approval.createdAt, decidedAt: approval.decidedAt,
    targetType: approval.targetType, targetId: approval.targetId, action: approval.action,
    ...(superAdminAction ? { verifiedEmail } : {}),
  });
});

router.post("/approvals/:id/decision", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const parsed = DecideMissionControlApprovalBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid approval id" : parsed.error.message });
    return;
  }
  const note = parsed.data.note.trim();
  if (!note) {
    res.status(400).json({ error: "A decision note is required" });
    return;
  }
  // Recheck the actual Clerk subject before applying an approved elevation.
  // The verified email is stored by the server in the existing approval row;
  // neither the reviewer nor the requester can change it on decision.
  const [priorApproval] = await db.select().from(missionControlApprovalsTable)
    .where(eq(missionControlApprovalsTable.id, id));
  if (priorApproval?.status === "pending" && parsed.data.decision === "approve" &&
      ["super_admin_enable", "super_admin_disable"].includes(priorApproval.action)) {
    const email = superAdminApprovalEmail(priorApproval.request);
    if (!email) {
      res.status(409).json({ error: "Approval lacks verified identity evidence" });
      return;
    }
    try {
      if (await verifiedPrimaryEmailForClerkUser(priorApproval.targetId) !== email) {
        res.status(409).json({ error: "Target Clerk identity no longer matches the verified email" });
        return;
      }
    } catch {
      res.status(503).json({ error: "Clerk identity verification is unavailable" });
      return;
    }
  }
  const result = await db.transaction(async (tx) => {
    const [approval] = await tx.select().from(missionControlApprovalsTable)
      .where(eq(missionControlApprovalsTable.id, id)).for("update");
    if (!approval) return { error: "not_found" as const };
    if (priorApproval && approval.request !== priorApproval.request) return { error: "stale_request" as const };
    const superAdminDecision = approval.targetType === "user" &&
      ["super_admin_enable", "super_admin_disable"].includes(approval.action);
    // Lock all users in ID order: crossed approvals (A->B and B->A)
    // must not acquire actor and target rows in opposite orders.
    const [targetIdentity] = superAdminDecision
      ? await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.clerkUserId, approval.targetId))
      : [];
    if (superAdminDecision && !targetIdentity) return { error: "invalid_target" as const };
    const lockedUsers = await tx.select().from(usersTable)
      .where(inArray(usersTable.id, superAdminDecision ? [req.user!.id, targetIdentity!.id] : [req.user!.id]))
      .orderBy(usersTable.id).for("update");
    const actor = lockedUsers.find((user) => user.id === req.user!.id);
    if (!actor?.isSuperAdmin || actor.clerkUserId !== req.user!.clerkUserId) {
      return { error: "actor_revoked" as const };
    }
    if (approval.requestedBy === actor.clerkUserId) return { error: "self_approval" as const };
    if (approval.status !== "pending") {
      if (approval.status === (parsed.data.decision === "approve" ? "approved" : "rejected")) {
        const [audit] = superAdminDecision && approval.status === "approved"
          ? await tx.select({ id: missionControlAuditTable.id }).from(missionControlAuditTable)
            .where(and(
              eq(missionControlAuditTable.action, approval.action),
              eq(missionControlAuditTable.targetId, approval.targetId),
              sql`${missionControlAuditTable.details}->>'approvalId' = ${String(approval.id)}`,
            )).orderBy(desc(missionControlAuditTable.id)).limit(1)
          : [];
        return { approval, grantAuditId: audit?.id };
      }
      return { error: "already_decided" as const };
    }
    if (superAdminDecision && (!priorApproval || !superAdminApprovalEmail(approval.request))) {
      return { error: "stale_request" as const };
    }
    if (parsed.data.decision === "approve" && approval.targetType === "company") {
      const companyId = Number(approval.targetId);
      if (!Number.isSafeInteger(companyId) || companyId <= 0) return { error: "invalid_target" as const };
      const [company] = await tx.select().from(companiesTable)
        .where(eq(companiesTable.id, companyId)).for("update");
      if (!company || reservedCompany(company.slug)) return { error: "invalid_target" as const };
      if (!["suspend", "enable"].includes(approval.action)) return { error: "invalid_action" as const };
      if (approval.expectedAccessState == null || company.accessSuspended !== approval.expectedAccessState) {
        return { error: "stale_request" as const };
      }
    } else if (parsed.data.decision === "approve" && approval.targetType === "user") {
      const [target] = superAdminDecision
        ? lockedUsers.filter((user) => user.clerkUserId === approval.targetId)
        : await tx.select().from(usersTable)
          .where(eq(usersTable.clerkUserId, approval.targetId)).for("update");
      if (!target) return { error: "invalid_target" as const };
      if (!["beta_enable", "beta_disable", "super_admin_enable", "super_admin_disable"].includes(approval.action)) return { error: "invalid_action" as const };
      if (target.clerkUserId === req.user!.clerkUserId && approval.action === "beta_disable") return { error: "self_lockout" as const };
      const superAdminAction = approval.action === "super_admin_enable" || approval.action === "super_admin_disable";
      if (superAdminAction && (target.clerkUserId === actor.clerkUserId || target.clerkUserId === approval.requestedBy)) {
        return { error: "self_approval" as const };
      }
      if (approval.expectedAccessState == null ||
          (superAdminAction ? target.isSuperAdmin : target.betaAccess) !== approval.expectedAccessState) {
        return { error: "stale_request" as const };
      }
    } else if (parsed.data.decision === "approve") return { error: "invalid_target" as const };
    const decisionStatus = parsed.data.decision === "approve" ? "approved" : "rejected";
    const now = new Date();
    const [updated] = await tx.update(missionControlApprovalsTable)
      .set({ status: decisionStatus, note, decidedBy: req.user!.clerkUserId, decidedAt: now })
      .where(and(eq(missionControlApprovalsTable.id, id), eq(missionControlApprovalsTable.status, "pending")))
      .returning();
    if (!updated) return { error: "already_decided" as const };
    let grantAuditId: number | undefined;
    if (decisionStatus === "approved") {
      if (approval.targetType === "company") {
        const companyId = Number(approval.targetId);
        const [company] = await tx.select().from(companiesTable).where(eq(companiesTable.id, companyId)).for("update");
        if (!company || reservedCompany(company.slug)) return { error: "invalid_target" as const };
        const suspended = approval.action === "suspend";
        if (!["suspend", "enable"].includes(approval.action)) return { error: "invalid_action" as const };
        await tx.update(companiesTable).set({ accessSuspended: suspended }).where(eq(companiesTable.id, companyId));
        await addAudit(tx, req.user!.clerkUserId, `company_${approval.action}`, "company", approval.targetId, {
          approvalId: approval.id, requestedBy: approval.requestedBy, reason: approval.reason, note,
        });
      } else if (approval.targetType === "user") {
        const [target] = superAdminDecision
          ? lockedUsers.filter((user) => user.clerkUserId === approval.targetId)
          : await tx.select().from(usersTable).where(eq(usersTable.clerkUserId, approval.targetId)).for("update");
        if (!target) return { error: "invalid_target" as const };
        if (target.clerkUserId === req.user!.clerkUserId && approval.action === "beta_disable") return { error: "self_lockout" as const };
        if (approval.action === "super_admin_enable" || approval.action === "super_admin_disable") {
          if (target.clerkUserId === actor.clerkUserId || target.clerkUserId === approval.requestedBy) return { error: "self_approval" as const };
          const next = approval.action === "super_admin_enable";
          const operationId = randomUUID();
          await tx.update(usersTable).set({ isSuperAdmin: next }).where(eq(usersTable.id, target.id));
          const [audit] = await addAudit(tx, actor.clerkUserId, approval.action, "user", target.clerkUserId, {
            actor: "authenticated_super_admin",
            actorClerkId: actor.clerkUserId,
            actorAppUserId: actor.id,
            action: approval.action,
            targetUserId: target.id,
            targetClerkId: target.clerkUserId,
            verifiedEmail: superAdminApprovalEmail(approval.request),
            previousIsSuperAdmin: target.isSuperAdmin,
            newIsSuperAdmin: next,
            reason: approval.reason,
            note,
            timestamp: now.toISOString(),
            requestId: approval.id,
            operationId,
            approvalId: approval.id,
            requestedBy: approval.requestedBy,
          });
          grantAuditId = audit.id;
        } else {
          if (!["beta_enable", "beta_disable"].includes(approval.action)) return { error: "invalid_action" as const };
          await tx.update(usersTable).set({ betaAccess: approval.action === "beta_enable" })
            .where(eq(usersTable.id, target.id));
          await addAudit(tx, req.user!.clerkUserId, approval.action, "user", approval.targetId, {
            approvalId: approval.id, requestedBy: approval.requestedBy, reason: approval.reason, note,
          });
        }
      } else return { error: "invalid_target" as const };
    }
    await addAudit(tx, req.user!.clerkUserId, `approval_${decisionStatus}`, approval.targetType, approval.targetId, {
      approvalId: approval.id, requestedBy: approval.requestedBy, reason: approval.reason, note,
    });
    return { approval: updated, grantAuditId };
  });
  if ("error" in result) {
    if (result.error === "stale_request") {
      res.status(409).json({ error: "Approval is stale; target access changed since the request was created" });
      return;
    }
    const status = result.error === "not_found" ? 404 : result.error === "self_approval" || result.error === "self_lockout" || result.error === "actor_revoked" ? 403 : 409;
    res.status(status).json({ error: result.error });
    return;
  }
  const approval = result.approval;
  res.json({
    id: approval.id, type: approval.type, status: approval.status, requestedBy: approval.requestedBy,
    request: approval.request, reason: approval.reason, note: approval.note, decidedBy: approval.decidedBy,
    createdAt: approval.createdAt, decidedAt: approval.decidedAt,
    targetType: approval.targetType, targetId: approval.targetId, action: approval.action,
    ...(approval.type === "user_super_admin_access" ? { verifiedEmail: superAdminApprovalEmail(approval.request) } : {}),
    ...(result.grantAuditId ? { grantAuditId: result.grantAuditId } : {}),
  });
});

export default router;