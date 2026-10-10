import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionsTable,
  inspectionMediaTable,
  analysisResultsTable,
  reportsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

const router = Router();

// GET /analytics/dashboard
router.get("/dashboard", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspections = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId))
      .orderBy(desc(inspectionsTable.createdAt));
    const analyses = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    const reports = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.companyId, companyId));
    const media = await db
      .select()
      .from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.companyId, companyId));

    const total = inspections.length;
    const photosCaptured = media.filter((m) => m.mediaType === "photo" || m.mediaType === "image").length;
    const videosCaptured = media.filter((m) => m.mediaType === "video").length;
    const completed = inspections.filter((i) => i.status === "completed").length;
    const open = inspections.filter((i) => i.status !== "completed").length;

    const avgFindings =
      total > 0 ? inspections.reduce((s, i) => s + i.findingsCount, 0) / total : 0;

    const completedAnalyses = analyses.filter((a) => a.status === "complete");
    const avgConfidence =
      completedAnalyses.length > 0
        ? completedAnalyses.reduce((s, a) => s + (a.overallConfidence ?? 0), 0) /
          completedAnalyses.length
        : 0;

    // Top pest types
    const pestMap: Record<string, number> = {};
    for (const insp of inspections) {
      for (const p of (insp.pestTypes ?? []) as string[]) {
        pestMap[p] = (pestMap[p] ?? 0) + 1;
      }
    }
    const topPestTypes = Object.entries(pestMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([pestType, count]) => ({ pestType, count }));

    // Recent activity
    const recentActivity = inspections.slice(0, 10).map((insp) => ({
      id: insp.id,
      type: insp.status === "completed" ? "inspection_completed" : "inspection_created",
      description: `Inspection at ${insp.siteAddress}`,
      technicianName: insp.technicianName,
      siteAddress: insp.siteAddress,
      createdAt: insp.createdAt.toISOString(),
    }));

    // By status
    const statusMap: Record<string, number> = {};
    for (const i of inspections) {
      statusMap[i.status] = (statusMap[i.status] ?? 0) + 1;
    }
    const inspectionsByStatus = Object.entries(statusMap).map(([status, count]) => ({
      status,
      count,
    }));

    // Monthly (last 6 months)
    const now = new Date();
    const monthlyInspections = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString("en-US", { month: "short" });
      const count = inspections.filter((insp) => {
        const cd = new Date(insp.createdAt);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      }).length;
      return { date: d.toISOString().slice(0, 7), value: count, label };
    });

    return res.json({
      totalInspections: total,
      completedInspections: completed,
      openInspections: open,
      avgFindingsPerInspection: Math.round(avgFindings * 10) / 10,
      totalReports: reports.length,
      photosCaptured,
      videosCaptured,
      aiAnalysesCompleted: completedAnalyses.length,
      avgAiConfidence: Math.round(avgConfidence * 10) / 10,
      topPestTypes,
      recentActivity,
      inspectionsByStatus,
      monthlyInspections,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get dashboard" });
  }
});

// GET /analytics/trends
router.get("/trends", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const period = (req.query.period as string) || "30d";
    const inspections = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId))
      .orderBy(inspectionsTable.createdAt);

    const now = new Date();
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const filtered = inspections.filter((i) => new Date(i.createdAt) >= cutoff);

    // Group by day
    const dayMap: Record<string, number> = {};
    for (const insp of filtered) {
      const day = new Date(insp.createdAt).toISOString().slice(0, 10);
      dayMap[day] = (dayMap[day] ?? 0) + 1;
    }

    const trends = Object.entries(dayMap).map(([date, value]) => ({
      date,
      value,
      category: null,
      label: null,
    }));
    return res.json(trends);
  } catch (err) {
    return res.status(500).json({ error: "Failed to get trends" });
  }
});

// GET /analytics/technicians
router.get("/technicians", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspections = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId));
    const analyses = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));

    const techMap: Record<
      string,
      {
        name: string;
        id: string | null;
        inspections: typeof inspections;
        confidences: number[];
      }
    > = {};

    for (const insp of inspections) {
      if (!techMap[insp.technicianName]) {
        techMap[insp.technicianName] = {
          name: insp.technicianName,
          id: insp.technicianId,
          inspections: [],
          confidences: [],
        };
      }
      techMap[insp.technicianName].inspections.push(insp);
    }

    for (const a of analyses.filter((a) => a.status === "complete")) {
      const insp = inspections.find((i) => i.id === a.inspectionId);
      if (insp && techMap[insp.technicianName]) {
        techMap[insp.technicianName].confidences.push(a.overallConfidence ?? 0);
      }
    }

    const result = Object.values(techMap)
      .map((t) => {
        const total = t.inspections.length;
        const completed = t.inspections.filter((i) => i.status === "completed").length;
        const avgFindings =
          total > 0 ? t.inspections.reduce((s, i) => s + i.findingsCount, 0) / total : 0;
        const avgConf =
          t.confidences.length > 0
            ? t.confidences.reduce((a, b) => a + b, 0) / t.confidences.length
            : 0;

        let badge = null;
        if (avgConf >= 0.85) badge = "Expert";
        else if (avgConf >= 0.7) badge = "Senior";
        else if (total >= 5) badge = "Field Tech";

        return {
          technicianName: t.name,
          technicianId: t.id,
          inspectionCount: total,
          avgFindingsPerInspection: Math.round(avgFindings * 10) / 10,
          avgAiConfidence: Math.round(avgConf * 100) / 100,
          completionRate: total > 0 ? Math.round((completed / total) * 100) / 100 : 0,
          badge,
        };
      })
      .sort((a, b) => b.inspectionCount - a.inspectionCount);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "Failed to get technician performance" });
  }
});

// GET /analytics/risk
router.get("/risk", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspections = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId))
      .orderBy(desc(inspectionsTable.createdAt));
    const analyses = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));

    const completed = analyses.filter((a) => a.status === "complete");
    const avgConf =
      completed.length > 0
        ? completed.reduce((s, a) => s + (a.overallConfidence ?? 0), 0) / completed.length
        : 0;

    const criticalCount = inspections.filter((i) => i.severity === "critical").length;
    const highCount = inspections.filter((i) => i.severity === "high").length;
    // avgConf is 0–1; convert to percentage so lower confidence adds up to +100 risk.
    const riskScore = Math.min(
      100,
      criticalCount * 15 + highCount * 8 + (100 - avgConf * 100),
    );

    let overallRisk = "low";
    if (riskScore >= 60) overallRisk = "critical";
    else if (riskScore >= 40) overallRisk = "high";
    else if (riskScore >= 20) overallRisk = "medium";

    // Risk by pest type
    const pestMap: Record<string, { total: number; critical: number; high: number }> = {};
    for (const insp of inspections) {
      for (const pest of (insp.pestTypes ?? []) as string[]) {
        if (!pestMap[pest]) pestMap[pest] = { total: 0, critical: 0, high: 0 };
        pestMap[pest].total++;
        if (insp.severity === "critical") pestMap[pest].critical++;
        else if (insp.severity === "high") pestMap[pest].high++;
      }
    }

    const riskByPestType = Object.entries(pestMap)
      .map(([pestType, v]) => {
        let riskLevel = "low";
        if (v.critical > 0) riskLevel = "critical";
        else if (v.high > 1) riskLevel = "high";
        else if (v.high > 0 || v.total > 3) riskLevel = "medium";
        return { pestType, riskLevel, count: v.total };
      })
      .sort((a, b) => b.count - a.count);

    // Risk trend (last 6 months)
    const now = new Date();
    const riskTrend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthInspections = inspections.filter((insp) => {
        const cd = new Date(insp.createdAt);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      });
      const monthRisk = monthInspections.filter(
        (i) => i.severity === "critical" || i.severity === "high",
      ).length;
      return { date: d.toISOString().slice(0, 7), value: monthRisk, category: null, label: null };
    });

    // High risk sites
    const highRiskSites = inspections
      .filter((i) => i.severity === "critical" || i.severity === "high")
      .slice(0, 5)
      .map((i) => ({
        siteAddress: i.siteAddress,
        riskScore: i.severity === "critical" ? 90 : 65,
        lastInspected: i.createdAt.toISOString(),
      }));

    return res.json({
      overallRisk,
      riskScore: Math.round(riskScore),
      riskByPestType,
      riskTrend,
      highRiskSites,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get risk data" });
  }
});

export default router;
