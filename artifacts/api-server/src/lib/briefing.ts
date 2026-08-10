import {
  db,
  inspectionsTable,
  opportunitiesTable,
  salesProposalsTable,
  inspectionScorecardsTable,
  customerSummariesTable,
  usersTable,
  type UserRole,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";

/**
 * Role Briefing — the role-shaped read model over the Inspection
 * Intelligence Record.
 *
 * Every completed inspection already produces one intelligence record as
 * sibling rows keyed by inspectionId (report + narrative, customer summary,
 * opportunities, scorecard, analysis findings). Nothing here duplicates that
 * data: each role's briefing is a different SQL view over the SAME rows,
 * composed at read time.
 *
 * SECURITY: the shape is decided by the DB-sourced role on req.user — never
 * by anything the client sends. A technician's payload physically contains
 * no sales/manager/owner keys, so there is nothing to leak. Deep lists stay
 * on the existing role-gated routes (/opportunities, /proposals,
 * /scorecards, /customer-summaries) — the briefing serves top-N slices and
 * counts only, sized for a mobile dashboard.
 */

const DAY_MS = 86_400_000;

/** Briefing domain constants — centralises the magic numbers used across all sections. */
const STALE_OPPORTUNITY_DAYS    = 14;  // opportunities untouched this long are flagged as stale
const REPORTING_WINDOW_DAYS     = 30;  // standard rolling window for KPI aggregations
const LOW_QUALITY_SCORE_THRESHOLD = 60; // inspections below this score trigger quality alerts

// ─── Payload types (mirrored in lib/api-spec/openapi.yaml) ───────────────────

export interface TechnicianBriefing {
  totalInspections: number;
  completedInspections: number;
  openInspections: number;
  completedThisWeek: number;
  recentInspections: {
    id: number;
    siteAddress: string;
    status: string;
    findingsCount: number;
    createdAt: string;
  }[];
}

export interface SalesBriefing {
  pipeline: {
    new: number;
    reviewed: number;
    quoted: number;
    won: number;
    lost: number;
    dismissed: number;
  };
  openCount: number;
  /** Sum of HUMAN-entered annual values across open opportunities (whole $). */
  pipelineValue: number;
  staleCount: number;
  topOpportunities: {
    id: number;
    inspectionId: number;
    title: string;
    category: string;
    propertyAddress: string;
    priority: number;
    estimatedValueTier: string;
    riskLevel: string | null;
    status: string;
    createdAt: string;
  }[];
  proposals: { draft: number; sent: number; accepted: number; declined: number };
}

export interface ManagerBriefing {
  pendingApprovals: number;
  approvalsQueue: {
    id: number;
    inspectionId: number;
    siteAddress: string;
    createdAt: string;
    ageDays: number;
  }[];
  team: {
    scorecardCount30d: number;
    avgQualityScore30d: number | null;
    highRisk30d: number;
    missedOpportunities30d: number;
    technicians: { technicianName: string; scorecards: number; avgQuality: number }[];
  };
  recentCompletions: {
    id: number;
    siteAddress: string;
    technicianName: string;
    completedAt: string | null;
    findingsCount: number;
  }[];
}

export type OwnerAlertType =
  | "approvals_aging"
  | "quality_low"
  | "high_risk"
  | "stale_pipeline"
  | "share_links_expiring";

export interface OwnerBriefing {
  kpis: {
    completions7d: number;
    completions30d: number;
    openOpportunities: number;
    pipelineValue: number;
    avgQualityScore30d: number | null;
    approvedSummaries30d: number;
  };
  alerts: {
    type: OwnerAlertType;
    severity: "info" | "warning" | "critical";
    message: string;
    count: number;
  }[];
  /** Total active team members in this company (including the owner). */
  teamSize: number;
  /** True when the owner is the only company member — triggers solo command-center UI. */
  isSoloOperator: boolean;
}

export interface RoleBriefing {
  role: UserRole;
  generatedAt: string;
  technician?: TechnicianBriefing;
  sales?: SalesBriefing;
  manager?: ManagerBriefing;
  owner?: OwnerBriefing;
}

// ─── Section builders (all queries are company-scoped SQL aggregates) ────────

const OPEN_OPPORTUNITY_STATUSES = ["new", "reviewed", "quoted"] as const;

async function buildTechnicianSection(companyId: number): Promise<TechnicianBriefing> {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [[counts], recent] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${inspectionsTable.status} = 'completed')::int`,
        completedThisWeek: sql<number>`count(*) filter (where ${inspectionsTable.status} = 'completed' and ${inspectionsTable.completedAt} >= ${weekAgo})::int`,
      })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId)),
    db
      .select({
        id: inspectionsTable.id,
        siteAddress: inspectionsTable.siteAddress,
        status: inspectionsTable.status,
        findingsCount: inspectionsTable.findingsCount,
        createdAt: inspectionsTable.createdAt,
      })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId))
      .orderBy(desc(inspectionsTable.createdAt))
      .limit(5),
  ]);
  const total = counts?.total ?? 0;
  const completed = counts?.completed ?? 0;
  return {
    totalInspections: total,
    completedInspections: completed,
    openInspections: total - completed,
    completedThisWeek: counts?.completedThisWeek ?? 0,
    recentInspections: recent.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

async function buildSalesSection(companyId: number): Promise<SalesBriefing> {
  const staleBefore = new Date(Date.now() - STALE_OPPORTUNITY_DAYS * DAY_MS);
  const [oppCounts, top, proposalCounts] = await Promise.all([
    db
      .select({
        status: opportunitiesTable.status,
        count: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${opportunitiesTable.estimatedAnnualValue}), 0)::int`,
        stale: sql<number>`count(*) filter (where ${opportunitiesTable.status} in ('new', 'reviewed') and ${opportunitiesTable.updatedAt} < ${staleBefore})::int`,
      })
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId))
      .groupBy(opportunitiesTable.status),
    db
      .select({
        id: opportunitiesTable.id,
        inspectionId: opportunitiesTable.inspectionId,
        title: opportunitiesTable.title,
        category: opportunitiesTable.category,
        propertyAddress: opportunitiesTable.propertyAddress,
        priority: opportunitiesTable.priority,
        estimatedValueTier: opportunitiesTable.estimatedValueTier,
        riskLevel: opportunitiesTable.riskLevel,
        status: opportunitiesTable.status,
        createdAt: opportunitiesTable.createdAt,
      })
      .from(opportunitiesTable)
      .where(
        and(
          eq(opportunitiesTable.companyId, companyId),
          inArray(opportunitiesTable.status, [...OPEN_OPPORTUNITY_STATUSES]),
        ),
      )
      .orderBy(desc(opportunitiesTable.priority), desc(opportunitiesTable.createdAt))
      .limit(5),
    db
      .select({
        status: salesProposalsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(salesProposalsTable)
      .where(eq(salesProposalsTable.companyId, companyId))
      .groupBy(salesProposalsTable.status),
  ]);

  const pipeline = { new: 0, reviewed: 0, quoted: 0, won: 0, lost: 0, dismissed: 0 };
  let pipelineValue = 0;
  let staleCount = 0;
  for (const row of oppCounts) {
    if (row.status in pipeline) pipeline[row.status as keyof typeof pipeline] = row.count;
    if ((OPEN_OPPORTUNITY_STATUSES as readonly string[]).includes(row.status)) {
      pipelineValue += row.value;
    }
    staleCount += row.stale;
  }
  const proposals = { draft: 0, sent: 0, accepted: 0, declined: 0 };
  for (const row of proposalCounts) {
    if (row.status in proposals) proposals[row.status as keyof typeof proposals] = row.count;
  }

  return {
    pipeline,
    openCount: pipeline.new + pipeline.reviewed + pipeline.quoted,
    pipelineValue,
    staleCount,
    topOpportunities: top.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
    proposals,
  };
}

async function buildManagerSection(companyId: number): Promise<ManagerBriefing> {
  const monthAgo = new Date(Date.now() - REPORTING_WINDOW_DAYS * DAY_MS);
  const now = Date.now();
  const [queue, [pending], [teamAgg], perTech, recentCompletions] = await Promise.all([
    db
      .select({
        id: customerSummariesTable.id,
        inspectionId: customerSummariesTable.inspectionId,
        siteAddress: inspectionsTable.siteAddress,
        createdAt: customerSummariesTable.createdAt,
      })
      .from(customerSummariesTable)
      .innerJoin(
        inspectionsTable,
        and(
          eq(customerSummariesTable.inspectionId, inspectionsTable.id),
          eq(inspectionsTable.companyId, companyId), // tenant guard: ensures the joined row belongs to this company
        ),
      )
      .where(
        and(
          eq(customerSummariesTable.companyId, companyId),
          eq(customerSummariesTable.status, "draft"),
        ),
      )
      .orderBy(asc(customerSummariesTable.createdAt))
      .limit(10),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerSummariesTable)
      .where(
        and(
          eq(customerSummariesTable.companyId, companyId),
          eq(customerSummariesTable.status, "draft"),
        ),
      ),
    db
      .select({
        scorecardCount: sql<number>`count(*)::int`,
        avgQuality: sql<number | null>`round(avg(${inspectionScorecardsTable.qualityScore}))::int`,
        highRisk: sql<number>`count(*) filter (where ${inspectionScorecardsTable.riskLevel} in ('high', 'critical'))::int`,
        missed: sql<number>`coalesce(sum(jsonb_array_length(${inspectionScorecardsTable.missedOpportunities})), 0)::int`,
      })
      .from(inspectionScorecardsTable)
      .where(
        and(
          eq(inspectionScorecardsTable.companyId, companyId),
          gte(inspectionScorecardsTable.createdAt, monthAgo),
        ),
      ),
    db
      .select({
        technicianName: inspectionScorecardsTable.technicianName,
        scorecards: sql<number>`count(*)::int`,
        avgQuality: sql<number>`round(avg(${inspectionScorecardsTable.qualityScore}))::int`,
      })
      .from(inspectionScorecardsTable)
      .where(
        and(
          eq(inspectionScorecardsTable.companyId, companyId),
          gte(inspectionScorecardsTable.createdAt, monthAgo),
          ne(inspectionScorecardsTable.technicianName, ""),
        ),
      )
      .groupBy(inspectionScorecardsTable.technicianName)
      .orderBy(sql`count(*) desc`)
      .limit(5),
    db
      .select({
        id: inspectionsTable.id,
        siteAddress: inspectionsTable.siteAddress,
        technicianName: inspectionsTable.technicianName,
        completedAt: inspectionsTable.completedAt,
        findingsCount: inspectionsTable.findingsCount,
      })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.companyId, companyId), eq(inspectionsTable.status, "completed")))
      .orderBy(desc(inspectionsTable.completedAt))
      .limit(5),
  ]);

  return {
    pendingApprovals: pending?.count ?? 0,
    approvalsQueue: queue.map((q) => ({
      id: q.id,
      inspectionId: q.inspectionId,
      siteAddress: q.siteAddress,
      createdAt: q.createdAt.toISOString(),
      ageDays: Math.floor((now - q.createdAt.getTime()) / DAY_MS),
    })),
    team: {
      scorecardCount30d: teamAgg?.scorecardCount ?? 0,
      avgQualityScore30d: teamAgg?.avgQuality ?? null,
      highRisk30d: teamAgg?.highRisk ?? 0,
      missedOpportunities30d: teamAgg?.missed ?? 0,
      technicians: perTech,
    },
    recentCompletions: recentCompletions.map((r) => ({
      ...r,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    })),
  };
}

async function buildOwnerSection(companyId: number): Promise<OwnerBriefing> {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const monthAgo = new Date(Date.now() - REPORTING_WINDOW_DAYS * DAY_MS);
  const staleBefore = new Date(Date.now() - STALE_OPPORTUNITY_DAYS * DAY_MS);
  const approvalsAgingBefore = new Date(Date.now() - 3 * DAY_MS);
  const nowDate = new Date();
  const weekAhead = new Date(Date.now() + 7 * DAY_MS);

  const [[insp], [opp], [quality], [summaries], [staleValued], [expiring], [team]] = await Promise.all([
    db
      .select({
        completions7d: sql<number>`count(*) filter (where ${inspectionsTable.completedAt} >= ${weekAgo})::int`,
        completions30d: sql<number>`count(*) filter (where ${inspectionsTable.completedAt} >= ${monthAgo})::int`,
      })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.companyId, companyId), eq(inspectionsTable.status, "completed"))),
    db
      .select({
        openCount: sql<number>`count(*)::int`,
        pipelineValue: sql<number>`coalesce(sum(${opportunitiesTable.estimatedAnnualValue}), 0)::int`,
      })
      .from(opportunitiesTable)
      .where(
        and(
          eq(opportunitiesTable.companyId, companyId),
          inArray(opportunitiesTable.status, [...OPEN_OPPORTUNITY_STATUSES]),
        ),
      ),
    db
      .select({
        avgQuality: sql<number | null>`round(avg(${inspectionScorecardsTable.qualityScore}))::int`,
        lowQuality: sql<number>`count(*) filter (where ${inspectionScorecardsTable.qualityScore} < ${LOW_QUALITY_SCORE_THRESHOLD})::int`,
        highRisk: sql<number>`count(*) filter (where ${inspectionScorecardsTable.riskLevel} in ('high', 'critical'))::int`,
      })
      .from(inspectionScorecardsTable)
      .where(
        and(
          eq(inspectionScorecardsTable.companyId, companyId),
          gte(inspectionScorecardsTable.createdAt, monthAgo),
        ),
      ),
    db
      .select({
        approved30d: sql<number>`count(*) filter (where ${customerSummariesTable.status} = 'approved' and ${customerSummariesTable.approvedAt} >= ${monthAgo})::int`,
        agingDrafts: sql<number>`count(*) filter (where ${customerSummariesTable.status} = 'draft' and ${customerSummariesTable.createdAt} < ${approvalsAgingBefore})::int`,
      })
      .from(customerSummariesTable)
      .where(eq(customerSummariesTable.companyId, companyId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opportunitiesTable)
      .where(
        and(
          eq(opportunitiesTable.companyId, companyId),
          inArray(opportunitiesTable.status, ["new", "reviewed"]),
          isNotNull(opportunitiesTable.estimatedAnnualValue),
          lt(opportunitiesTable.updatedAt, staleBefore),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerSummariesTable)
      .where(
        and(
          eq(customerSummariesTable.companyId, companyId),
          eq(customerSummariesTable.status, "approved"),
          isNotNull(customerSummariesTable.shareExpiresAt),
          gte(customerSummariesTable.shareExpiresAt, nowDate),
          lte(customerSummariesTable.shareExpiresAt, weekAhead),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.companyId, companyId)),
  ]);

  const alerts: OwnerBriefing["alerts"] = [];
  const agingDrafts = summaries?.agingDrafts ?? 0;
  if (agingDrafts > 0) {
    alerts.push({
      type: "approvals_aging",
      severity: "warning",
      message: `${agingDrafts} customer summar${agingDrafts === 1 ? "y" : "ies"} waiting over 3 days for approval`,
      count: agingDrafts,
    });
  }
  const highRisk = quality?.highRisk ?? 0;
  if (highRisk > 0) {
    alerts.push({
      type: "high_risk",
      severity: "critical",
      message: `${highRisk} inspection${highRisk === 1 ? "" : "s"} scored high or critical risk in the last 30 days`,
      count: highRisk,
    });
  }
  const lowQuality = quality?.lowQuality ?? 0;
  if (lowQuality > 0) {
    alerts.push({
      type: "quality_low",
      severity: "warning",
      message: `${lowQuality} inspection${lowQuality === 1 ? "" : "s"} scored below ${LOW_QUALITY_SCORE_THRESHOLD} quality in the last ${REPORTING_WINDOW_DAYS} days`,
      count: lowQuality,
    });
  }
  const staleValuedCount = staleValued?.count ?? 0;
  if (staleValuedCount > 0) {
    alerts.push({
      type: "stale_pipeline",
      severity: "warning",
      message: `${staleValuedCount} priced opportunit${staleValuedCount === 1 ? "y" : "ies"} untouched for 2+ weeks`,
      count: staleValuedCount,
    });
  }
  const expiringCount = expiring?.count ?? 0;
  if (expiringCount > 0) {
    alerts.push({
      type: "share_links_expiring",
      severity: "info",
      message: `${expiringCount} customer share link${expiringCount === 1 ? "" : "s"} expiring within 7 days`,
      count: expiringCount,
    });
  }

  const teamSize = team?.count ?? 1;
  return {
    kpis: {
      completions7d: insp?.completions7d ?? 0,
      completions30d: insp?.completions30d ?? 0,
      openOpportunities: opp?.openCount ?? 0,
      pipelineValue: opp?.pipelineValue ?? 0,
      avgQualityScore30d: quality?.avgQuality ?? null,
      approvedSummaries30d: summaries?.approved30d ?? 0,
    },
    alerts,
    teamSize,
    isSoloOperator: teamSize <= 1,
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Build the briefing for one authenticated user. The role comes from the DB
 * row loaded by requireAuth — the client cannot influence the shape. Each
 * role receives ONLY its own section (strict views, not cumulative).
 */
export async function buildBriefing(role: UserRole, companyId: number): Promise<RoleBriefing> {
  const briefing: RoleBriefing = { role, generatedAt: new Date().toISOString() };
  switch (role) {
    case "technician":
      briefing.technician = await buildTechnicianSection(companyId);
      break;
    case "sales":
      briefing.sales = await buildSalesSection(companyId);
      break;
    case "manager":
      briefing.manager = await buildManagerSection(companyId);
      break;
    case "owner":
      briefing.owner = await buildOwnerSection(companyId);
      break;
  }
  return briefing;
}
