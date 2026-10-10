import { Router, type IRouter } from "express";
import {
  db,
  inspectionScorecardsTable,
  inspectionsTable,
  analysisResultsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

/**
 * Inspection Scorecards — management-only coaching data.
 *
 * SECURITY: mounted behind `requireAuth + requireCompany +
 * requireRole("manager")` (see routes/index.ts). Technicians NEVER see their
 * own scorecards — quality scoring is a coaching tool for management, not a
 * leaderboard pushed at the crew.
 *
 * Everything served here is deterministic math over stored findings; no AI.
 */

const router: IRouter = Router();

function serialize(row: typeof inspectionScorecardsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /scorecards — newest first, joined with inspection context.
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technician =
      typeof req.query.technician === "string" && req.query.technician.trim().length > 0
        ? req.query.technician.trim()
        : undefined;

    const conditions = [eq(inspectionScorecardsTable.companyId, companyId)];
    if (technician) {
      conditions.push(eq(inspectionScorecardsTable.technicianName, technician));
    }

    const rows = await db
      .select({
        scorecard: inspectionScorecardsTable,
        siteAddress: inspectionsTable.siteAddress,
        inspectionDate: inspectionsTable.createdAt,
      })
      .from(inspectionScorecardsTable)
      .innerJoin(
        inspectionsTable,
        eq(inspectionScorecardsTable.inspectionId, inspectionsTable.id),
      )
      .where(and(...conditions))
      .orderBy(desc(inspectionScorecardsTable.createdAt))
      .limit(200);

    return res.json(
      rows.map((r) => ({
        ...serialize(r.scorecard),
        siteAddress: r.siteAddress,
        inspectionDate: r.inspectionDate.toISOString(),
      })),
    );
  } catch {
    return res.status(500).json({ error: "Failed to list scorecards" });
  }
});

// GET /scorecards/summary — deterministic aggregates for the management
// intelligence dashboard: team quality, per-technician coaching stats,
// missed-service counts, and property-pattern counts from stored findings.
router.get("/summary", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const [scorecards, analyses] = await Promise.all([
      db
        .select()
        .from(inspectionScorecardsTable)
        .where(eq(inspectionScorecardsTable.companyId, companyId)),
      db
        .select({
          inspectionId: analysisResultsTable.inspectionId,
          findings: analysisResultsTable.findings,
          recommendations: analysisResultsTable.recommendations,
          createdAt: analysisResultsTable.createdAt,
        })
        .from(analysisResultsTable)
        .where(eq(analysisResultsTable.companyId, companyId))
        .orderBy(desc(analysisResultsTable.createdAt))
        .limit(200),
    ]);

    const count = scorecards.length;
    const avg = (nums: number[]) =>
      nums.length === 0 ? 0 : Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);

    const avgQuality = avg(scorecards.map((s) => s.qualityScore));
    const avgRisk = avg(scorecards.map((s) => s.riskScore));

    const riskDistribution: Record<string, number> = {};
    const byTechnician = new Map<
      string,
      { inspections: number; qualitySum: number; missedOpportunities: number }
    >();
    const missedByService: Record<string, number> = {};
    for (const s of scorecards) {
      riskDistribution[s.riskLevel] = (riskDistribution[s.riskLevel] ?? 0) + 1;
      const name = s.technicianName || "Unknown";
      const entry = byTechnician.get(name) ?? {
        inspections: 0,
        qualitySum: 0,
        missedOpportunities: 0,
      };
      entry.inspections += 1;
      entry.qualitySum += s.qualityScore;
      entry.missedOpportunities += s.missedOpportunities.length;
      byTechnician.set(name, entry);
      for (const m of s.missedOpportunities) {
        missedByService[m.serviceType] = (missedByService[m.serviceType] ?? 0) + 1;
      }
    }
    const technicians = Array.from(byTechnician.entries())
      .map(([technicianName, v]) => ({
        technicianName,
        inspections: v.inspections,
        avgQuality: Math.round(v.qualitySum / v.inspections),
        missedOpportunities: v.missedOpportunities,
      }))
      .sort((a, b) => b.inspections - a.inspections);

    // Property patterns: deterministic counts over stored findings (latest
    // analysis run per inspection only — reruns must not double-count).
    const seen = new Set<number>();
    const conduciveCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    for (const a of analyses) {
      if (seen.has(a.inspectionId)) continue;
      seen.add(a.inspectionId);
      for (const f of a.findings ?? []) {
        const condition = (f.conduciveCondition ?? "").trim();
        if (condition) conduciveCounts[condition] = (conduciveCounts[condition] ?? 0) + 1;
      }
      for (const r of a.recommendations ?? []) {
        const rec = r.trim();
        if (rec) serviceCounts[rec] = (serviceCounts[rec] ?? 0) + 1;
      }
    }
    const topN = (counts: Record<string, number>, n: number) =>
      Object.entries(counts)
        .map(([label, occurrences]) => ({ label, occurrences }))
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, n);

    return res.json({
      totalScorecards: count,
      avgQuality,
      avgRisk,
      riskDistribution,
      technicians,
      missedByService,
      topConduciveConditions: topN(conduciveCounts, 10),
      topRecommendedServices: topN(serviceCounts, 10),
    });
  } catch {
    return res.status(500).json({ error: "Failed to compute scorecard summary" });
  }
});

// GET /scorecards/inspection/:inspectionId — the inspection's scorecard.
router.get("/inspection/:inspectionId", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = parseInt(req.params.inspectionId);
    if (Number.isNaN(inspectionId)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select()
      .from(inspectionScorecardsTable)
      .where(
        and(
          eq(inspectionScorecardsTable.inspectionId, inspectionId),
          eq(inspectionScorecardsTable.companyId, companyId),
        ),
      )
      .limit(1);
    if (!row) return res.status(404).json({ error: "Scorecard not found" });
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to load scorecard" });
  }
});

export default router;
