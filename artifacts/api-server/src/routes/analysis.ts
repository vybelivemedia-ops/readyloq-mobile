import { Router } from "express";
import { db } from "@workspace/db";
import { analysisResultsTable, inspectionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

const router = Router();

function serializeResult(row: typeof analysisResultsTable.$inferSelect) {
  return {
    ...row,
    findings: row.findings ?? [],
    recommendations: row.recommendations ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /analysis
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = req.query.inspectionId
      ? parseInt(req.query.inspectionId as string)
      : undefined;
    let rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId))
      .orderBy(desc(analysisResultsTable.createdAt));
    if (inspectionId) rows = rows.filter((r) => r.inspectionId === inspectionId);
    return res.json(rows.map(serializeResult));
  } catch (err) {
    return res.status(500).json({ error: "Failed to list analysis results" });
  }
});

// GET /analysis/summary
router.get("/summary", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));
    const completed = rows.filter((r) => r.status === "complete");
    const allFindings = completed.flatMap((r) => (r.findings ?? []) as any[]);

    const categoryMap: Record<string, number> = {};
    for (const f of allFindings) {
      categoryMap[f.category] = (categoryMap[f.category] ?? 0) + 1;
    }

    const topFindings = Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    const total = allFindings.length;
    const findingsByCategory = Object.entries(categoryMap).map(([category, count]) => ({
      category,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

    const avgConfidence =
      completed.length > 0
        ? completed.reduce((sum, r) => sum + (r.overallConfidence ?? 0), 0) / completed.length
        : 0;

    return res.json({
      totalAnalyses: completed.length,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      topFindings,
      findingsByCategory,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get summary" });
  }
});

// POST /analysis — create analysis result from real inspection captures
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const {
      inspectionId,
      findings = [],
      recommendations = [],
      overallConfidence,
    } = req.body;
    if (!inspectionId) return res.status(400).json({ error: "inspectionId is required" });

    // Child write: the parent inspection must belong to the caller's company.
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    const computed =
      overallConfidence ??
      (findings.length > 0
        ? Math.round(
            findings.reduce(
              (s: number, f: any) => s + (f.confidence ?? 0) * 100,
              0,
            ) / findings.length,
          )
        : 0);

    const [row] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        status: "complete",
        findings,
        recommendations,
        overallConfidence: computed,
      })
      .returning();

    return res.status(201).json(serializeResult(row));
  } catch (err) {
    return res.status(500).json({ error: "Failed to create analysis result" });
  }
});

// GET /analysis/:id
router.get("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(analysisResultsTable)
      .where(and(eq(analysisResultsTable.id, id), eq(analysisResultsTable.companyId, companyId)));
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json(serializeResult(row));
  } catch (err) {
    return res.status(500).json({ error: "Failed to get analysis" });
  }
});

// POST /analysis/:id/feedback
router.post("/:id/feedback", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const { feedbackStatus, technicianFeedback } = req.body;
    if (!feedbackStatus) return res.status(400).json({ error: "feedbackStatus is required" });
    const [row] = await db
      .update(analysisResultsTable)
      .set({ feedbackStatus, technicianFeedback: technicianFeedback ?? null })
      .where(and(eq(analysisResultsTable.id, id), eq(analysisResultsTable.companyId, companyId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json(serializeResult(row));
  } catch (err) {
    return res.status(500).json({ error: "Failed to submit feedback" });
  }
});

export default router;
