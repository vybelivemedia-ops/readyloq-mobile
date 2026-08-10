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

export default router;
