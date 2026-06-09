import { Router } from "express";
import { db } from "@workspace/db";
import { analysisResultsTable, inspectionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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
    const inspectionId = req.query.inspectionId ? parseInt(req.query.inspectionId as string) : undefined;
    let rows = await db.select().from(analysisResultsTable).orderBy(desc(analysisResultsTable.createdAt));
    if (inspectionId) rows = rows.filter(r => r.inspectionId === inspectionId);
    res.json(rows.map(serializeResult));
  } catch (err) {
    res.status(500).json({ error: "Failed to list analysis results" });
  }
});

// GET /analysis/summary
router.get("/summary", async (req, res) => {
  try {
    const rows = await db.select().from(analysisResultsTable);
    const completed = rows.filter(r => r.status === "complete");
    const allFindings = completed.flatMap(r => (r.findings ?? []) as any[]);

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

    const avgConfidence = completed.length > 0
      ? completed.reduce((sum, r) => sum + (r.overallConfidence ?? 0), 0) / completed.length
      : 0;

    res.json({
      totalAnalyses: completed.length,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      topFindings,
      findingsByCategory,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get summary" });
  }
});

// GET /analysis/:id
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(analysisResultsTable).where(eq(analysisResultsTable.id, id));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(serializeResult(row));
  } catch (err) {
    res.status(500).json({ error: "Failed to get analysis" });
  }
});

// POST /analysis/:id/feedback
router.post("/:id/feedback", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { feedbackStatus, technicianFeedback } = req.body;
    if (!feedbackStatus) return res.status(400).json({ error: "feedbackStatus is required" });
    const [row] = await db.update(analysisResultsTable)
      .set({ feedbackStatus, technicianFeedback: technicianFeedback ?? null })
      .where(eq(analysisResultsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(serializeResult(row));
  } catch (err) {
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

export default router;
