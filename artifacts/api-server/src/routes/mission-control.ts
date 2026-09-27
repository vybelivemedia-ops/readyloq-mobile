import { Router, type IRouter, type RequestHandler } from "express";
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { missionControlAgentWorkerStatus } from "../lib/mission-control-worker";
import { executiveRegistry } from "../lib/mission-control-executives";
import {
  db,
  analysisResultsTable,
  companiesTable,
  errorEventsTable,
  inspectionMediaTable,
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
const MAX_LIMIT = 100;

function pageArgs(query: { page?: number; limit?: number }) {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(query.limit ?? 25)));
  return { page, limit, offset: (page - 1) * limit };
}

function pageResult<T>(items: T[], page: number, limit: number, total: number) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
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
  await tx.insert(missionControlAuditTable).values({
    actorId,
    action,
    targetType,
    targetId,
    details: details as Record<string, unknown>,
  });
}

export const missionControlMeHandler: RequestHandler = (req, res): void => {
  res.json({ userId: req.user!.clerkUserId, isSuperAdmin: Boolean(req.user!.isSuperAdmin) });
};

router.get("/overview", async (_req, res): Promise<void> => {
  const analysisWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    [companyCount],
    [activeCompanyCount],
    [userCount],
    [technicianCount],
    [inspectionCount],
    [analysisHealth],
  ] = await Promise.all([
    db.select({ value: count() }).from(companiesTable),
    db.select({ value: count() }).from(companiesTable).where(eq(companiesTable.accessSuspended, false)),
    db.select({ value: count() }).from(usersTable),
    db.select({ value: count() }).from(usersTable).where(eq(usersTable.role, "technician")),
    db.select({ value: count() }).from(inspectionsTable),
    db.select({
      completedCount: sql<number>`count(*) FILTER (WHERE ${analysisResultsTable.status} = 'complete')::int`,
      failedCount: sql<number>`count(*) FILTER (WHERE ${analysisResultsTable.status} = 'failed')::int`,
      pendingCount: sql<number>`count(*) FILTER (WHERE ${analysisResultsTable.status} = 'pending')::int`,
      latestResultAt: sql<Date | null>`max(${analysisResultsTable.createdAt})`,
    }).from(analysisResultsTable).where(gte(analysisResultsTable.createdAt, analysisWindowStart)),
  ]);
  const openIncidentCount = await countOpenIncidents();
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
      inspectionCount: inspectionCount.value,
      openIncidentCount,
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

router.get("/companies", async (req, res): Promise<void> => {
  const parsed = ListMissionControlCompaniesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, offset } = pageArgs(parsed.data);
  const filters = parsed.data.search
    ? ilike(companiesTable.name, `%${parsed.data.search.replace(/[%_]/g, "\\$&")}%`)
    : undefined;
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
  res.json(pageResult(rows.map((row) => ({
    id: row.id,
    name: row.name,
    accessStatus: row.accessSuspended ? "suspended" : "enabled",
    createdAt: row.createdAt,
    userCount: Number(userMap.get(row.id) ?? 0),
    technicianCount: Number(techMap.get(row.id) ?? 0),
    inspectionCount: Number(inspectionMap.get(row.id) ?? 0),
    lastActivityAt: activityMap.get(row.id) ?? null,
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
    owner: owner ? { userId: owner.id, name: owner.id, email: undefined } : null,
    users: members.map((member) => ({ id: member.id, name: member.id, role: member.role, betaAccessEnabled: member.betaAccessEnabled })),
    recentInspections: inspections.map((inspection) => ({
      ...inspection,
      siteAddress: null,
      technicianName: inspection.technicianId,
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
    eq(usersTable.role, "technician"),
    parsed.data.companyId == null ? undefined : eq(usersTable.companyId, parsed.data.companyId),
    parsed.data.search ? or(ilike(usersTable.clerkUserId, `%${parsed.data.search}%`), ilike(companiesTable.name, `%${parsed.data.search}%`)) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id)).where(where);
  const rows = await db.select({
    id: usersTable.clerkUserId,
    companyId: companiesTable.id,
    companyName: companiesTable.name,
    suspended: companiesTable.accessSuspended,
    lastActiveAt: usersTable.lastSeenAt,
  }).from(usersTable).leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(where).orderBy(desc(usersTable.lastSeenAt), usersTable.id).limit(limit).offset(offset);
  res.json(pageResult(rows.filter((row) => row.companyId != null).map((row) => ({
    id: row.id,
    name: row.id,
    companyId: row.companyId!,
    companyName: row.companyName ?? "",
    status: row.suspended ? "suspended" : "active",
    lastActiveAt: row.lastActiveAt,
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
    createdAt: inspectionsTable.createdAt,
  }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
    .where(and(
      eq(inspectionsTable.companyId, technician.companyId),
      eq(inspectionsTable.technicianId, technician.id),
    ))
    .orderBy(desc(inspectionsTable.createdAt), desc(inspectionsTable.id))
    .limit(MAX_LIMIT);
  res.json({
    id: technician.id,
    name: technician.id,
    companyId: technician.companyId,
    companyName: technician.companyName,
    status: technician.suspended ? "suspended" : "active",
    lastActiveAt: technician.lastActiveAt,
    inspections: inspections.map((inspection) => ({
      id: inspection.id,
      companyId: inspection.companyId,
      companyName: inspection.companyName,
      technicianId: inspection.technicianId,
      technicianName: inspection.technicianName,
      status: inspection.status,
      siteAddress: null,
      createdAt: inspection.createdAt,
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
  const filters = and(
    parsed.data.companyId == null ? undefined : eq(inspectionsTable.companyId, parsed.data.companyId),
    parsed.data.status ? eq(inspectionsTable.status, parsed.data.status) : undefined,
    parsed.data.search ? or(ilike(inspectionsTable.siteAddress, `%${parsed.data.search}%`), ilike(inspectionsTable.technicianId, `%${parsed.data.search}%`)) : undefined,
  );
  const [total] = await db.select({ value: count() }).from(inspectionsTable).where(filters);
  const items = await db.select({
    id: inspectionsTable.id,
    companyId: inspectionsTable.companyId,
    companyName: companiesTable.name,
    technicianId: inspectionsTable.technicianId,
    status: inspectionsTable.status,
    siteAddress: inspectionsTable.siteAddress,
    createdAt: inspectionsTable.createdAt,
  }).from(inspectionsTable).innerJoin(companiesTable, eq(inspectionsTable.companyId, companiesTable.id))
    .where(filters).orderBy(desc(inspectionsTable.createdAt), desc(inspectionsTable.id)).limit(limit).offset(offset);
  res.json(pageResult(items.map((item) => ({
    ...item,
    siteAddress: null,
    technicianName: item.technicianId,
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
      .where(eq(inspectionMediaTable.inspectionId, id)).limit(500),
    db.select({
      id: analysisResultsTable.id, status: analysisResultsTable.status,
      error: analysisResultsTable.failureReason, updatedAt: analysisResultsTable.createdAt,
      analyzedImagePaths: analysisResultsTable.analyzedImagePaths,
      photoOutcomes: analysisResultsTable.photoOutcomes,
    })
      .from(analysisResultsTable).where(eq(analysisResultsTable.inspectionId, id)).orderBy(desc(analysisResultsTable.createdAt)).limit(100),
    db.select({ id: inspectionSyncLogsTable.id, status: inspectionSyncLogsTable.success, message: inspectionSyncLogsTable.errorMessage, createdAt: inspectionSyncLogsTable.syncedAt })
      .from(inspectionSyncLogsTable).where(eq(inspectionSyncLogsTable.inspectionId, id)).orderBy(desc(inspectionSyncLogsTable.syncedAt)).limit(100),
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
  res.json({
    ...item,
    siteAddress: null,
    technicianName: item.technicianId,
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
    analysisStatuses: media.map((entry) => {
      const outcome = analyses.flatMap((analysis) => analysis.photoOutcomes ?? [])
        .find((item) => item.imagePath === entry.storageUrl);
      const analyzed = analyses.some((analysis) => analysis.analyzedImagePaths?.includes(entry.storageUrl));
      const status = outcome?.status ?? (analyzed ? "completed" : analyses[0]?.status ?? "pending");
      return {
        mediaId: entry.id,
        status,
        error: status === "failed" ? "Analysis failed; raw diagnostic text is withheld" : null,
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
      e.created_at
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
      s.synced_at AS created_at
    FROM inspection_sync_logs s
    JOIN companies c ON c.id = s.company_id
    LEFT JOIN inspections si ON si.id = s.inspection_id AND si.company_id = s.company_id
    LEFT JOIN users su ON su.company_id = s.company_id AND su.clerk_user_id = si.technician_id
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
      a.created_at
    FROM analysis_results a
    JOIN companies c ON c.id = a.company_id
    LEFT JOIN inspections ai ON ai.id = a.inspection_id AND ai.company_id = a.company_id
    LEFT JOIN users au ON au.company_id = a.company_id AND au.clerk_user_id = ai.technician_id
    WHERE a.status = 'failed' OR a.analysis_errors > 0
  )
`;

async function countOpenIncidents(): Promise<number> {
  const result = await db.execute(sql`
    ${missionControlIncidentSourceCte}
    SELECT count(*)::integer AS total
    FROM source_events s
    LEFT JOIN mission_control_incidents i ON i.reference = s.reference
    WHERE COALESCE(i.status, 'open') IN ('open', 'acknowledged', 'investigating')
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
    }).from(inspectionSyncLogsTable).innerJoin(companiesTable, eq(inspectionSyncLogsTable.companyId, companiesTable.id))
      .where(and(eq(inspectionSyncLogsTable.id, id), eq(inspectionSyncLogsTable.success, false)));
    if (!row) return undefined;
    const refs = await loadIncidentReferences(row.companyId, row.inspectionId, null);
    return {
      reference: `sync:${id}`, sourceType, sourceId: rawId, companyId: row.companyId,
      ...refs,
      companyName: row.companyName, title: "Field synchronization failed",
      description: `Failed synchronization attempt ${id}; diagnostic text is withheld`,
      severity: "high", createdAt: row.createdAt,
    };
  }
  if (sourceType === "analysis") {
    const [row] = await db.select({
      id: analysisResultsTable.id, companyId: analysisResultsTable.companyId,
      companyName: companiesTable.name, inspectionId: analysisResultsTable.inspectionId,
      createdAt: analysisResultsTable.createdAt,
    }).from(analysisResultsTable).innerJoin(companiesTable, eq(analysisResultsTable.companyId, companiesTable.id))
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
  const [row] = await db.insert(missionControlIncidentsTable).values({
    reference: source.reference,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    companyId: source.companyId,
    inspectionId: source.inspectionId ?? null,
    userId: source.userId ?? null,
    sessionId: source.sessionId ?? null,
    severity: source.severity,
    createdAt: source.createdAt,
  }).onConflictDoNothing({ target: missionControlIncidentsTable.reference }).returning();
  if (row) return row;
  const [existing] = await db.select().from(missionControlIncidentsTable)
    .where(eq(missionControlIncidentsTable.reference, source.reference));
  if (!existing) return undefined;
  if (source.inspectionId != null && existing.inspectionId == null) {
    await db.update(missionControlIncidentsTable).set({ inspectionId: source.inspectionId })
      .where(eq(missionControlIncidentsTable.id, existing.id));
  }
  if (source.userId != null && existing.userId == null) {
    await db.update(missionControlIncidentsTable).set({ userId: source.userId })
      .where(eq(missionControlIncidentsTable.id, existing.id));
  }
  if (source.sessionId != null && existing.sessionId == null) {
    await db.update(missionControlIncidentsTable).set({ sessionId: source.sessionId })
      .where(eq(missionControlIncidentsTable.id, existing.id));
  }
  const [updated] = await db.select().from(missionControlIncidentsTable)
    .where(eq(missionControlIncidentsTable.id, existing.id));
  return updated;
}

function incidentView(source: IncidentSource, stored: typeof missionControlIncidentsTable.$inferSelect) {
  return {
    id: stored.id,
    companyId: source.companyId,
    companyName: source.companyName,
    severity: stored.severity,
    status: stored.status,
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
  const { page, limit, offset } = pageArgs(parsed.data);
  const companyFilter = parsed.data.companyId == null ? sql`TRUE` : sql`s.company_id = ${parsed.data.companyId}`;
  const severityFilter = parsed.data.severity == null ? sql`TRUE` : sql`COALESCE(i.severity, s.severity) = ${parsed.data.severity}`;
  const statusFilter = parsed.data.status == null ? sql`TRUE` : sql`COALESCE(i.status, 'open') = ${parsed.data.status}`;
  const where = sql`${companyFilter} AND ${severityFilter} AND ${statusFilter}`;
  const totalResult = await db.execute(sql`
    ${missionControlIncidentSourceCte}
    SELECT count(*)::integer AS total
    FROM source_events s
    LEFT JOIN mission_control_incidents i ON i.reference = s.reference
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
      COALESCE(i.status, 'open') AS status, i.assigned_to AS "assignedTo",
      i.acknowledged_at AS "acknowledgedAt", s.created_at AS "createdAt",
      COALESCE(i.updated_at, s.created_at) AS "updatedAt"
    FROM source_events s
    LEFT JOIN mission_control_incidents i ON i.reference = s.reference
    WHERE ${where}
    ORDER BY s.created_at DESC, s.reference ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const total = Number((totalResult.rows[0] as { total?: number | string } | undefined)?.total ?? 0);
  const rawRows = dataResult.rows as Array<Omit<IncidentSource, "createdAt"> & {
    createdAt: Date | string;
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
  }));
  const storedRows = await Promise.all(rows.map(persistedIncident));
  res.json(pageResult(rows.flatMap((source, index) => {
    const stored = storedRows[index];
    return stored ? [incidentView(source, stored)] : [];
  }), page, limit, total));
});

router.get("/incidents/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid incident id" });
    return;
  }
  const [stored] = await db.select().from(missionControlIncidentsTable).where(eq(missionControlIncidentsTable.id, id));
  if (!stored) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const source = await loadIncidentSource(stored.sourceType, stored.sourceId);
  if (!source) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  res.json(incidentView(source, stored));
});

router.patch("/incidents/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const parsed = UpdateMissionControlIncidentBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: "Valid incident id and update are required" });
    return;
  }
  const [stored] = await db.select().from(missionControlIncidentsTable).where(eq(missionControlIncidentsTable.id, id));
  if (!stored) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const source = await loadIncidentSource(stored.sourceType, stored.sourceId);
  if (!source) {
    res.status(404).json({ error: "Incident source no longer exists" });
    return;
  }
  const action = parsed.data.action;
  const updates: Partial<typeof missionControlIncidentsTable.$inferInsert> = { updatedAt: new Date() };
  if (action === "acknowledge") {
    updates.status = "acknowledged";
    updates.acknowledgedAt = new Date();
  } else if (action === "assign" && parsed.data.assigneeId) {
    const [assignee] = await db.select({ id: usersTable.clerkUserId }).from(usersTable)
      .where(eq(usersTable.clerkUserId, parsed.data.assigneeId));
    if (!assignee) {
      res.status(400).json({ error: "Assignee user does not exist" });
      return;
    }
    updates.assignedTo = assignee.id;
  } else if (action === "escalate" && parsed.data.severity) {
    const severityRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    const priorSeverity = severityRank[stored.severity];
    if (priorSeverity == null || severityRank[parsed.data.severity] <= priorSeverity) {
      res.status(400).json({ error: "Escalation must increase incident severity" });
      return;
    }
    updates.severity = parsed.data.severity;
  } else {
    res.status(400).json({ error: "Action requires its corresponding fields" });
    return;
  }
  if (parsed.data.note) updates.note = parsed.data.note.slice(0, 1000);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(missionControlIncidentsTable).set(updates)
      .where(eq(missionControlIncidentsTable.id, id)).returning();
    if (!row) return undefined;
    await addAudit(tx, req.user!.clerkUserId, `incident_${action}`, "incident", String(id), {
      sourceReference: stored.reference, note: parsed.data.note ?? null,
    });
    return row;
  });
  if (!updated) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json(incidentView(source, updated));
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
  const filter = parsed.data.status ? eq(missionControlApprovalsTable.status, parsed.data.status) : undefined;
  const [total] = await db.select({ value: count() }).from(missionControlApprovalsTable).where(filter);
  const rows = await db.select().from(missionControlApprovalsTable).where(filter)
    .orderBy(desc(missionControlApprovalsTable.createdAt), desc(missionControlApprovalsTable.id)).limit(limit).offset(offset);
  res.json(pageResult(rows.map((row) => ({
    id: row.id, type: row.type, status: row.status, requestedBy: row.requestedBy,
    request: row.request, note: row.note, decidedBy: row.decidedBy,
    createdAt: row.createdAt, decidedAt: row.decidedAt,
    targetType: row.targetType, targetId: row.targetId, action: row.action,
  })), page, limit, total.value));
});

// Explicit approval request creation is the first step of every reversible
// access action. The creator can never decide their own request.
router.post("/approvals/requests", async (req, res): Promise<void> => {
  const body = req.body as { targetType?: unknown; targetId?: unknown; action?: unknown; reason?: unknown; idempotencyKey?: unknown };
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
  let expectedAccessState: boolean;
  const reason = body.reason.trim();
  const validAction = targetType === "company"
    ? ["suspend", "enable"].includes(action)
    : ["beta_enable", "beta_disable"].includes(action);
  if (!validAction) {
    res.status(400).json({ error: "Unsupported approval action" });
    return;
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
    expectedAccessState = user.betaAccess;
    if (user.clerkUserId === req.user!.clerkUserId && action === "beta_disable") {
      res.status(403).json({ error: "Self-lockout is not permitted" });
      return;
    }
  }
  const type = targetType === "company" ? "company_access" : "user_beta_access";
  const request = `${action} ${targetType} ${targetId}: ${reason}`;
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
         existing.targetId !== targetId || existing.action !== action || existing.reason !== reason)) {
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
    request: approval.request, note: approval.note, decidedBy: approval.decidedBy,
    createdAt: approval.createdAt, decidedAt: approval.decidedAt,
    targetType: approval.targetType, targetId: approval.targetId, action: approval.action,
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
  const result = await db.transaction(async (tx) => {
    const [approval] = await tx.select().from(missionControlApprovalsTable)
      .where(eq(missionControlApprovalsTable.id, id)).for("update");
    if (!approval) return { error: "not_found" as const };
    if (approval.requestedBy === req.user!.clerkUserId) return { error: "self_approval" as const };
    if (approval.status !== "pending") {
      if (approval.status === (parsed.data.decision === "approve" ? "approved" : "rejected")) return { approval };
      return { error: "already_decided" as const };
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
      const [target] = await tx.select().from(usersTable)
        .where(eq(usersTable.clerkUserId, approval.targetId)).for("update");
      if (!target) return { error: "invalid_target" as const };
      if (!["beta_enable", "beta_disable"].includes(approval.action)) return { error: "invalid_action" as const };
      if (target.clerkUserId === req.user!.clerkUserId && approval.action === "beta_disable") return { error: "self_lockout" as const };
      if (approval.expectedAccessState == null || target.betaAccess !== approval.expectedAccessState) {
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
        const [target] = await tx.select().from(usersTable).where(eq(usersTable.clerkUserId, approval.targetId)).for("update");
        if (!target) return { error: "invalid_target" as const };
        if (target.clerkUserId === req.user!.clerkUserId && approval.action === "beta_disable") return { error: "self_lockout" as const };
        if (!["beta_enable", "beta_disable"].includes(approval.action)) return { error: "invalid_action" as const };
        await tx.update(usersTable).set({ betaAccess: approval.action === "beta_enable" })
          .where(eq(usersTable.id, target.id));
        await addAudit(tx, req.user!.clerkUserId, approval.action, "user", approval.targetId, {
          approvalId: approval.id, requestedBy: approval.requestedBy, reason: approval.reason, note,
        });
      } else return { error: "invalid_target" as const };
    }
    await addAudit(tx, req.user!.clerkUserId, `approval_${decisionStatus}`, approval.targetType, approval.targetId, {
      approvalId: approval.id, requestedBy: approval.requestedBy, reason: approval.reason, note,
    });
    return { approval: updated };
  });
  if ("error" in result) {
    if (result.error === "stale_request") {
      res.status(409).json({ error: "Approval is stale; target access changed since the request was created" });
      return;
    }
    const status = result.error === "not_found" ? 404 : result.error === "self_approval" || result.error === "self_lockout" ? 403 : result.error === "invalid_target" || result.error === "invalid_action" ? 409 : 409;
    res.status(status).json({ error: result.error });
    return;
  }
  const approval = result.approval;
  res.json({
    id: approval.id, type: approval.type, status: approval.status, requestedBy: approval.requestedBy,
    request: approval.request, note: approval.note, decidedBy: approval.decidedBy,
    createdAt: approval.createdAt, decidedAt: approval.decidedAt,
    targetType: approval.targetType, targetId: approval.targetId, action: approval.action,
  });
});

export default router;