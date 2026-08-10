/**
 * Executive Intelligence — enterprise-wide KPI aggregation for owners / VPs.
 *
 * All queries are scoped to req.companyId so tenants are fully isolated.
 * Gated at requireRole("owner") — managers and technicians never see this data.
 */
import { Router } from "express";
import { db, opportunitiesTable, inspectionScorecardsTable, inspectionsTable } from "@workspace/db";
import { and, avg, count, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { requireAuth, requireCompany, requireBetaAccess, requireRole } from "../middleware/require-auth";
import { generateDailyExecutiveBriefing } from "../services/briefing";

const router = Router();

router.get(
  "/executive/intelligence",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("owner"),
  async (req, res) => {
    const companyId = getCompanyId(req);

    try {
      const OPEN_STATUSES = ["new", "reviewed", "quoted"] as const;

      // ── 1. Pipeline: open opportunities + estimated value ───────────────────
      const [pipelineRow] = await db
        .select({
          openCount: count(opportunitiesTable.id),
          pipelineValue: sum(opportunitiesTable.estimatedAnnualValue),
        })
        .from(opportunitiesTable)
        .where(
          and(
            eq(opportunitiesTable.companyId, companyId),
            inArray(opportunitiesTable.status, [...OPEN_STATUSES]),
          ),
        );

      // Won opportunities (revenue closed)
      const [wonRow] = await db
        .select({ wonCount: count(opportunitiesTable.id) })
        .from(opportunitiesTable)
        .where(
          and(
            eq(opportunitiesTable.companyId, companyId),
            eq(opportunitiesTable.status, "won"),
          ),
        );

      // ── 2. Scorecards: quality, risk, technician leaderboard ───────────────
      const [scoreRow] = await db
        .select({
          totalScorecards: count(inspectionScorecardsTable.id),
          avgQuality: avg(inspectionScorecardsTable.qualityScore),
          criticalCount: sql<number>`sum(case when ${inspectionScorecardsTable.riskLevel} = 'critical' then 1 else 0 end)`,
          highCount:     sql<number>`sum(case when ${inspectionScorecardsTable.riskLevel} = 'high'     then 1 else 0 end)`,
          mediumCount:   sql<number>`sum(case when ${inspectionScorecardsTable.riskLevel} = 'medium'   then 1 else 0 end)`,
          lowCount:      sql<number>`sum(case when ${inspectionScorecardsTable.riskLevel} = 'low'      then 1 else 0 end)`,
        })
        .from(inspectionScorecardsTable)
        .where(eq(inspectionScorecardsTable.companyId, companyId));

      // Top technicians by average quality score (min 2 inspections)
      const techRows = await db
        .select({
          technicianName: inspectionScorecardsTable.technicianName,
          avgQuality: avg(inspectionScorecardsTable.qualityScore),
          inspectionCount: count(inspectionScorecardsTable.id),
        })
        .from(inspectionScorecardsTable)
        .where(eq(inspectionScorecardsTable.companyId, companyId))
        .groupBy(inspectionScorecardsTable.technicianName)
        .having(sql`count(*) >= 2`)
        .orderBy(sql`avg(${inspectionScorecardsTable.qualityScore}) desc`)
        .limit(5);

      // ── 3. Inspection velocity: completed this month vs last month ──────────
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

      const [velocityRow] = await db
        .select({
          thisMonth:  sql<number>`sum(case when ${inspectionsTable.createdAt} >= ${startOfMonth}::timestamptz then 1 else 0 end)`,
          lastMonth:  sql<number>`sum(case when ${inspectionsTable.createdAt} >= ${startOfLastMonth}::timestamptz and ${inspectionsTable.createdAt} < ${startOfMonth}::timestamptz then 1 else 0 end)`,
        })
        .from(inspectionsTable)
        .where(
          and(
            eq(inspectionsTable.companyId, companyId),
            eq(inspectionsTable.status, "completed"),
          ),
        );

      return res.json({
        success: true,
        metrics: {
          // Pipeline
          pipelineValue:      Number(pipelineRow?.pipelineValue ?? 0),
          openOpportunities:  Number(pipelineRow?.openCount ?? 0),
          wonOpportunities:   Number(wonRow?.wonCount ?? 0),
          // Quality & risk
          totalScorecards:    Number(scoreRow?.totalScorecards ?? 0),
          avgQualityScore:    Math.round(Number(scoreRow?.avgQuality ?? 0)),
          riskDistribution: {
            critical: Number(scoreRow?.criticalCount ?? 0),
            high:     Number(scoreRow?.highCount ?? 0),
            medium:   Number(scoreRow?.mediumCount ?? 0),
            low:      Number(scoreRow?.lowCount ?? 0),
          },
          // Technician leaderboard
          topTechnicians: techRows.map((r) => ({
            name:           r.technicianName || "Unknown",
            avgQuality:     Math.round(Number(r.avgQuality ?? 0)),
            inspectionCount: Number(r.inspectionCount),
          })),
          // Velocity
          inspectionsThisMonth: Number(velocityRow?.thisMonth ?? 0),
          inspectionsLastMonth: Number(velocityRow?.lastMonth ?? 0),
        },
      });
    } catch (error) {
      console.error("executive intelligence error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /executive/inspections?riskLevel=critical|high|medium|low
 *
 * Returns the list of inspections at a given risk level for the owner's company.
 * Joins scorecards → inspections to return site address, technician name,
 * quality score, risk level, and inspection id (for deep-linking).
 */
router.get(
  "/executive/inspections",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("owner"),
  async (req, res) => {
    const companyId = getCompanyId(req);
    const riskLevel = req.query.riskLevel as string | undefined;

    const VALID_RISK_LEVELS = ["critical", "high", "medium", "low"] as const;
    type RiskLevel = (typeof VALID_RISK_LEVELS)[number];

    if (!riskLevel || !VALID_RISK_LEVELS.includes(riskLevel as RiskLevel)) {
      return res.status(400).json({
        error: "riskLevel query param is required and must be one of: critical, high, medium, low",
      });
    }

    try {
      const rows = await db
        .select({
          inspectionId:    inspectionScorecardsTable.inspectionId,
          siteAddress:     inspectionsTable.siteAddress,
          technicianName:  inspectionScorecardsTable.technicianName,
          qualityScore:    inspectionScorecardsTable.qualityScore,
          riskLevel:       inspectionScorecardsTable.riskLevel,
          riskScore:       inspectionScorecardsTable.riskScore,
          scoredAt:        inspectionScorecardsTable.updatedAt,
        })
        .from(inspectionScorecardsTable)
        .innerJoin(
          inspectionsTable,
          eq(inspectionsTable.id, inspectionScorecardsTable.inspectionId),
        )
        .where(
          and(
            eq(inspectionScorecardsTable.companyId, companyId),
            eq(inspectionScorecardsTable.riskLevel, riskLevel as RiskLevel),
          ),
        )
        .orderBy(sql`${inspectionScorecardsTable.riskScore} desc`)
        .limit(100);

      return res.json({
        success: true,
        riskLevel,
        inspections: rows.map((r) => ({
          inspectionId:   r.inspectionId,
          siteAddress:    r.siteAddress,
          technicianName: r.technicianName || "Unknown",
          qualityScore:   r.qualityScore,
          riskLevel:      r.riskLevel,
          riskScore:      r.riskScore,
          scoredAt:       r.scoredAt,
        })),
      });
    } catch (error) {
      console.error("executive inspections error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /executive/quality-trend
 *
 * Returns weekly average quality scores for the past 4 ISO weeks (last 28 days).
 * Weeks with no scored inspections are returned as 0.
 * Scoped to req.companyId — no cross-tenant leakage.
 */
router.get(
  "/executive/quality-trend",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("owner"),
  async (req, res) => {
    const companyId = getCompanyId(req);

    try {
      // Fetch per-week averages for the last 28 days.
      const rows = await db
        .select({
          weekStart: sql<string>`date_trunc('week', ${inspectionScorecardsTable.createdAt})::date`,
          avgQuality: avg(inspectionScorecardsTable.qualityScore),
          count: count(inspectionScorecardsTable.id),
        })
        .from(inspectionScorecardsTable)
        .where(
          and(
            eq(inspectionScorecardsTable.companyId, companyId),
            sql`${inspectionScorecardsTable.createdAt} >= now() - interval '28 days'`,
          ),
        )
        .groupBy(sql`date_trunc('week', ${inspectionScorecardsTable.createdAt})::date`)
        .orderBy(sql`date_trunc('week', ${inspectionScorecardsTable.createdAt})::date`);

      // Build a map keyed by ISO-date string (YYYY-MM-DD Monday of each week).
      const byWeek = new Map<string, number>();
      for (const row of rows) {
        byWeek.set(row.weekStart, Math.round(Number(row.avgQuality ?? 0)));
      }

      // Generate the 4 Monday-anchored week keys covering the past 28 days.
      const now = new Date();
      // Find the Monday of the current ISO week.
      const dayOfWeek = now.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisMonday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday),
      );

      const weeks: Array<{ weekStart: string; label: string; avgQuality: number }> = [];
      for (let i = 3; i >= 0; i--) {
        const monday = new Date(thisMonday.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        const isoDate = monday.toISOString().slice(0, 10); // YYYY-MM-DD
        const label = monday.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        weeks.push({
          weekStart: isoDate,
          label,
          avgQuality: byWeek.get(isoDate) ?? 0,
        });
      }

      return res.json({ success: true, weeks });
    } catch (error) {
      console.error("executive quality-trend error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /executive/briefing/yesterday
 *
 * Returns a structured narrative digest of yesterday's operations:
 * completed inspections, critical-risk count, and new pipeline value.
 * Gated at requireRole("owner") — same scope as the rest of this router.
 */
router.get(
  "/executive/briefing/yesterday",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("owner"),
  async (req, res) => {
    const companyId = getCompanyId(req);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    try {
      const result = await generateDailyExecutiveBriefing(companyId, yesterday);
      return res.json(result);
    } catch (error) {
      console.error("executive briefing error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
