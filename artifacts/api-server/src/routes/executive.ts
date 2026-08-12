/**
 * Executive Intelligence — enterprise-wide KPI aggregation for owners / VPs.
 *
 * All queries are scoped to req.companyId so tenants are fully isolated.
 * Gated at requireRole("owner") — managers and technicians never see this data.
 */
import { Router } from "express";
import { db, opportunitiesTable, inspectionScorecardsTable, inspectionsTable, companiesTable } from "@workspace/db";
import { and, avg, count, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { requireAuth, requireCompany, requireBetaAccess, requireRole } from "../middleware/require-auth";
import { generateDailyExecutiveBriefing } from "../services/briefing";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Escape user-supplied strings before interpolating them into an HTML template.
 * Converts the five HTML-special characters to their named entity equivalents.
 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

      const [wonRow] = await db
        .select({ wonCount: count(opportunitiesTable.id) })
        .from(opportunitiesTable)
        .where(
          and(
            eq(opportunitiesTable.companyId, companyId),
            eq(opportunitiesTable.status, "won"),
          ),
        );

      // Scorecards
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

      // Top technicians
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

      // Velocity
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
      logger.error({ err: error }, "executive intelligence error");
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

    // Optional filters — both scoped to companyId so no cross-tenant leakage.
    const technicianName = typeof req.query.technicianName === "string" && req.query.technicianName.trim()
      ? req.query.technicianName.trim()
      : undefined;

    // Validate `since` as an ISO date string (YYYY-MM-DD or full ISO 8601).
    // Reject anything that cannot be parsed to a real date to avoid DB 500s.
    let since: string | undefined;
    if (typeof req.query.since === "string" && req.query.since.trim()) {
      const raw = req.query.since.trim();
      const parsed = new Date(raw);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: "since query param must be a valid ISO date string (e.g. 2026-07-01)",
        });
      }
      since = parsed.toISOString();
    }

    // Offset-based pagination — page size is fixed at 100 rows.
    // A parallel COUNT(*) query returns the total so the client can show
    // "X of Y" and know when the list is complete.
    const PAGE_SIZE = 100;
    const rawOffset = parseInt(String(req.query.offset ?? "0"), 10);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    try {
      const conditions = [
        eq(inspectionScorecardsTable.companyId, companyId),
        eq(inspectionScorecardsTable.riskLevel, riskLevel as RiskLevel),
        ...(technicianName ? [eq(inspectionScorecardsTable.technicianName, technicianName)] : []),
        ...(since ? [sql`${inspectionScorecardsTable.updatedAt} >= ${since}::timestamptz`] : []),
      ];

      // Run the page query and count query in parallel to minimise latency.
      const [rows, [countRow]] = await Promise.all([
        db
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
            and(
              eq(inspectionsTable.id, inspectionScorecardsTable.inspectionId),
              eq(inspectionsTable.companyId, companyId),
            ),
          )
          .where(and(...conditions))
          .orderBy(
            sql`${inspectionScorecardsTable.riskScore} desc`,
            sql`${inspectionScorecardsTable.id} asc`,
          )
          .limit(PAGE_SIZE)
          .offset(offset),

        db
          .select({ total: count(inspectionScorecardsTable.id) })
          .from(inspectionScorecardsTable)
          .innerJoin(
            inspectionsTable,
            and(
              eq(inspectionsTable.id, inspectionScorecardsTable.inspectionId),
              eq(inspectionsTable.companyId, companyId),
            ),
          )
          .where(and(...conditions)),
      ]);

      const total = Number(countRow?.total ?? 0);
      const hasMore = offset + rows.length < total;

      return res.json({
        success: true,
        riskLevel,
        filters: {
          technicianName: technicianName ?? null,
          since: since ?? null,
        },
        pagination: {
          offset,
          limit: PAGE_SIZE,
          total,
          hasMore,
        },
        // top-level aliases for convenience / backwards compatibility
        total,
        hasMore,
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
      logger.error({ err: error }, "executive inspections error");
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
      logger.error({ err: error }, "executive quality-trend error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /executive/quality-trend/inspections?weekStart=YYYY-MM-DD
 *
 * Returns all inspections scored during the ISO week that begins on weekStart.
 * Scoped to req.companyId — no cross-tenant leakage.
 * Gated at requireRole("owner").
 */
router.get(
  "/executive/quality-trend/inspections",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("owner"),
  async (req, res) => {
    const companyId = getCompanyId(req);

    const weekStartRaw = typeof req.query.weekStart === "string" ? req.query.weekStart.trim() : "";
    if (!weekStartRaw) {
      return res.status(400).json({ error: "weekStart query param is required (YYYY-MM-DD)" });
    }
    const weekStartDate = new Date(weekStartRaw);
    if (isNaN(weekStartDate.getTime())) {
      return res.status(400).json({ error: "weekStart must be a valid ISO date string (e.g. 2026-07-14)" });
    }

    // Compute the exclusive upper bound: weekStart + 7 days.
    const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekStart = weekStartDate.toISOString();
    const weekEnd = weekEndDate.toISOString();

    try {
      const rows = await db
        .select({
          inspectionId:   inspectionScorecardsTable.inspectionId,
          siteAddress:    inspectionsTable.siteAddress,
          technicianName: inspectionScorecardsTable.technicianName,
          qualityScore:   inspectionScorecardsTable.qualityScore,
          riskLevel:      inspectionScorecardsTable.riskLevel,
          scoredAt:       inspectionScorecardsTable.createdAt,
        })
        .from(inspectionScorecardsTable)
        .innerJoin(
          inspectionsTable,
          and(
            eq(inspectionsTable.id, inspectionScorecardsTable.inspectionId),
            eq(inspectionsTable.companyId, companyId),
          ),
        )
        .where(
          and(
            eq(inspectionScorecardsTable.companyId, companyId),
            sql`${inspectionScorecardsTable.createdAt} >= ${weekStart}::timestamptz`,
            sql`${inspectionScorecardsTable.createdAt} < ${weekEnd}::timestamptz`,
          ),
        )
        .orderBy(sql`${inspectionScorecardsTable.qualityScore} asc`);

      return res.json({
        success: true,
        weekStart: weekStartRaw,
        count: rows.length,
        inspections: rows.map((r) => ({
          inspectionId:   r.inspectionId,
          siteAddress:    r.siteAddress,
          technicianName: r.technicianName || "Unknown",
          qualityScore:   r.qualityScore,
          riskLevel:      r.riskLevel,
          scoredAt:       r.scoredAt,
        })),
      });
    } catch (error) {
      logger.error({ err: error }, "executive quality-trend inspections error");
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
      logger.error({ err: error }, "executive briefing error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /executive/intelligence/email-preview
 *
 * Returns a branded HTML email snapshot of the current executive dashboard
 * metrics — pipeline, quality, risk, technician leaderboard, and velocity.
 * Scoped to the owner's company; gated at requireRole("owner").
 */
router.get(
  "/executive/intelligence/email-preview",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("owner"),
  async (req, res) => {
    const companyId = getCompanyId(req);

    try {
      const OPEN_STATUSES = ["new", "reviewed", "quoted"] as const;

      // Company name for branding
      const [companyRow] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));
      const companyName = companyRow?.name ?? "Your Company";
      const companyNameHtml = escapeHtml(companyName);

      // Pipeline
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

      const [wonRow] = await db
        .select({ wonCount: count(opportunitiesTable.id) })
        .from(opportunitiesTable)
        .where(
          and(
            eq(opportunitiesTable.companyId, companyId),
            eq(opportunitiesTable.status, "won"),
          ),
        );

      // Scorecards
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

      // Top technicians
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

      // Velocity
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

      // Derived values
      const pipelineValue = Number(pipelineRow?.pipelineValue ?? 0);
      const openOpportunities = Number(pipelineRow?.openCount ?? 0);
      const wonOpportunities = Number(wonRow?.wonCount ?? 0);
      const totalScorecards = Number(scoreRow?.totalScorecards ?? 0);
      const avgQualityScore = Math.round(Number(scoreRow?.avgQuality ?? 0));
      const critical = Number(scoreRow?.criticalCount ?? 0);
      const high = Number(scoreRow?.highCount ?? 0);
      const medium = Number(scoreRow?.mediumCount ?? 0);
      const low = Number(scoreRow?.lowCount ?? 0);
      const thisMonth = Number(velocityRow?.thisMonth ?? 0);
      const lastMonth = Number(velocityRow?.lastMonth ?? 0);

      const pipelineFormatted =
        pipelineValue >= 1_000_000
          ? `$${(pipelineValue / 1_000_000).toFixed(1)}M`
          : pipelineValue >= 1_000
            ? `$${(pipelineValue / 1_000).toFixed(0)}K`
            : `$${pipelineValue.toLocaleString()}`;

      const velocityDelta =
        lastMonth > 0
          ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
          : null;

      const qualityColor =
        avgQualityScore >= 80 ? "#3FB950"
          : avgQualityScore >= 60 ? "#D29922"
            : "#F85149";

      const techRowsHtml = techRows.length > 0
        ? techRows.map((t, i) => {
          const name = t.technicianName || "Unknown";
          const nameHtml = escapeHtml(name);
          const quality = Math.round(Number(t.avgQuality ?? 0));
          const count2 = Number(t.inspectionCount);
          const qColor = quality >= 80 ? "#3FB950" : quality >= 60 ? "#D29922" : "#F85149";
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          return `
            <tr style="border-bottom:1px solid #30363D;">
              <td style="padding:10px 14px;color:#8B949E;font-size:14px;">${medal}</td>
              <td style="padding:10px 14px;color:#E6EDF3;font-size:14px;">${nameHtml}</td>
              <td style="padding:10px 14px;color:#8B949E;font-size:13px;">${count2} inspection${count2 !== 1 ? "s" : ""}</td>
              <td style="padding:10px 14px;text-align:right;">
                <span style="color:${qColor};font-weight:700;font-size:14px;">${quality}</span>
              </td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="4" style="padding:16px;color:#8B949E;font-size:13px;text-align:center;">No technicians with 2+ scored inspections yet.</td></tr>`;

      const generatedAt = new Date().toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Executive Dashboard — ${companyNameHtml}</title>
</head>
<body style="margin:0;padding:0;background:#0D1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D1117;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-radius:16px 16px 0 0;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="color:#17C4D3;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Executive Intelligence</div>
                    <div style="color:#E6EDF3;font-size:22px;font-weight:800;margin-bottom:4px;">${companyNameHtml}</div>
                    <div style="color:#8B949E;font-size:13px;">Performance snapshot · ${generatedAt}</div>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <div style="background:#17C4D322;border:1px solid #17C4D344;border-radius:10px;padding:8px 14px;display:inline-block;">
                      <span style="color:#17C4D3;font-size:11px;font-weight:700;letter-spacing:0.5px;">READYLOQ</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- KPI Row -->
          <tr>
            <td style="padding:0 0 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="background:#161B22;border:1px solid #30363D;border-top:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Open Pipeline</div>
                    <div style="color:#3FB950;font-size:28px;font-weight:800;margin-bottom:4px;">${pipelineFormatted}</div>
                    <div style="color:#8B949E;font-size:12px;">${openOpportunities} open · ${wonOpportunities} won</div>
                  </td>
                  <td width="50%" style="background:#161B22;border:1px solid #30363D;border-top:none;border-left:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Avg Quality Score</div>
                    <div style="color:${qualityColor};font-size:28px;font-weight:800;margin-bottom:4px;">${avgQualityScore}</div>
                    <div style="color:#8B949E;font-size:12px;">${totalScorecards} scored inspections</div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="background:#161B22;border:1px solid #30363D;border-top:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Critical Risk Sites</div>
                    <div style="color:${critical > 0 ? "#F85149" : "#3FB950"};font-size:28px;font-weight:800;margin-bottom:4px;">${critical}</div>
                    <div style="color:#8B949E;font-size:12px;">${high} high · ${medium} medium</div>
                  </td>
                  <td width="50%" style="background:#161B22;border:1px solid #30363D;border-top:none;border-left:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">This Month</div>
                    <div style="color:#17C4D3;font-size:28px;font-weight:800;margin-bottom:4px;">${thisMonth}</div>
                    <div style="color:#8B949E;font-size:12px;">vs ${lastMonth} last month${velocityDelta !== null ? ` · ${velocityDelta >= 0 ? "▲" : "▼"} ${Math.abs(velocityDelta)}%` : ""}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Risk Distribution -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-top:none;padding:20px 24px;">
              <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:14px;">Risk Distribution</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${[
                    { label: "Critical", count: critical, color: "#F85149" },
                    { label: "High",     count: high,     color: "#E3882A" },
                    { label: "Medium",   count: medium,   color: "#D29922" },
                    { label: "Low",      count: low,      color: "#3FB950" },
                  ].map(seg => `
                  <td style="text-align:center;padding:0 8px;">
                    <div style="color:${seg.color};font-size:22px;font-weight:800;">${seg.count}</div>
                    <div style="color:#8B949E;font-size:11px;margin-top:2px;">${seg.label}</div>
                  </td>`).join("")}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Technician Leaderboard -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-top:none;padding:0;">
              <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:20px 24px 10px;">Top Technicians by Quality</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <thead>
                  <tr style="background:#ffffff06;">
                    <th style="padding:8px 14px;color:#8B949E;font-size:10px;letter-spacing:0.5px;text-align:left;font-weight:600;"></th>
                    <th style="padding:8px 14px;color:#8B949E;font-size:10px;letter-spacing:0.5px;text-align:left;font-weight:600;">TECHNICIAN</th>
                    <th style="padding:8px 14px;color:#8B949E;font-size:10px;letter-spacing:0.5px;text-align:left;font-weight:600;">INSPECTIONS</th>
                    <th style="padding:8px 14px;color:#8B949E;font-size:10px;letter-spacing:0.5px;text-align:right;font-weight:600;">SCORE</th>
                  </tr>
                </thead>
                <tbody>${techRowsHtml}</tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-top:none;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
              <div style="color:#8B949E;font-size:12px;margin-bottom:4px;">This snapshot was generated from live dashboard data.</div>
              <div style="color:#17C4D3;font-size:11px;font-weight:700;letter-spacing:0.5px;">Powered by ReadyLoq</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const subject = `Executive Dashboard Snapshot — ${companyName} · ${generatedAt}`;

      // ── Plain-text format (?format=text) ───────────────────────────────────
      if (req.query.format === "text") {
        const velocityLine =
          velocityDelta !== null
            ? `vs ${lastMonth} last month (${velocityDelta >= 0 ? "▲" : "▼"} ${Math.abs(velocityDelta)}%)`
            : `vs ${lastMonth} last month`;

        const techLines =
          techRows.length > 0
            ? techRows
                .map((t, i) => {
                  const medal = ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
                  const name2 = t.technicianName || "Unknown";
                  const q2 = Math.round(Number(t.avgQuality ?? 0));
                  const c2 = Number(t.inspectionCount);
                  return `  ${medal} ${name2} — score ${q2} (${c2} inspection${c2 !== 1 ? "s" : ""})`;
                })
                .join("\n")
            : "  No technicians with 2+ scored inspections yet.";

        const text = [
          `EXECUTIVE DASHBOARD SNAPSHOT`,
          `${companyName} · ${generatedAt}`,
          ``,
          `── PIPELINE ──────────────────────────────`,
          `Open pipeline:    ${pipelineFormatted}`,
          `Opportunities:    ${openOpportunities} open · ${wonOpportunities} won`,
          ``,
          `── QUALITY & RISK ────────────────────────`,
          `Avg quality score: ${avgQualityScore} (${totalScorecards} scored inspections)`,
          `Risk breakdown:    ${critical} critical · ${high} high · ${medium} medium · ${low} low`,
          ``,
          `── INSPECTION VELOCITY ───────────────────`,
          `This month:  ${thisMonth} completed`,
          `${velocityLine}`,
          ``,
          `── TOP TECHNICIANS ───────────────────────`,
          techLines,
          ``,
          `Generated by ReadyLoq`,
        ].join("\n");

        return res.json({ success: true, text, subject });
      }

      return res.json({ success: true, html, subject });
    } catch (error) {
      logger.error({ err: error }, "executive email-preview error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
