import { Router } from "express";
import { db } from "@workspace/db";
import {
  analysisResultsTable,
  inspectionsTable,
  inspectionMediaTable,
  type Finding,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { analyzePhoto } from "../lib/intelligence-ai";
import { objectPathCompanyScope } from "../lib/objectStorage";

const router = Router();

/**
 * Public storage URLs are served from `/api/storage/...` but the canonical
 * object path used by storage + tenant-scope checks is `/objects/...`.
 */
function toStoragePath(url: string): string {
  return url.replace(/^\/api\/storage/, "");
}

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

    // Confidence is stored on a 0–1 scale (matching individual finding confidence
    // and the report/analysis UI, which multiplies by 100 for display).
    const computed =
      overallConfidence ??
      (findings.length > 0
        ? findings.reduce((s: number, f: any) => s + (f.confidence ?? 0), 0) /
          findings.length
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

// POST /analysis/analyze — run REAL vision analysis on captured photos and store one result
router.post("/analyze", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const {
      inspectionId,
      images = [],
      technicianFindings = [],
    } = req.body as {
      inspectionId?: number;
      images?: Array<{ imageUrl: string; label?: string | null }>;
      technicianFindings?: Finding[];
    };
    if (!inspectionId) return res.status(400).json({ error: "inspectionId is required" });

    // The parent inspection must belong to the caller's company.
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    // Only analyze photos that were actually persisted as media for THIS inspection.
    // The client saves inspection_media before requesting analysis.
    const savedMedia = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.inspectionId, inspectionId),
          eq(inspectionMediaTable.companyId, companyId),
        ),
      );
    const savedPaths = new Set(savedMedia.map((m) => toStoragePath(m.url)));

    // Bound the number of real AI calls per request to avoid cost/DoS amplification.
    const MAX_ANALYZE_IMAGES = 40;

    // Run the real vision model on each company-scoped, persisted photo.
    // We NEVER fabricate a placeholder finding: a photo only becomes a finding
    // when the model returns a genuine, content-bearing assessment. Photos whose
    // analysis FAILED (storage/model/parse error) are counted in `analysisErrors`
    // and surfaced to the technician instead of being saved as empty findings.
    const aiFindings: Finding[] = [];
    let nextId = 1;
    let analysisErrors = 0;
    for (const image of images.slice(0, MAX_ANALYZE_IMAGES)) {
      if (!image?.imageUrl) continue;
      const storagePath = toStoragePath(image.imageUrl);
      // Tenant safety: object must live under the caller's company AND be a
      // persisted media row for this inspection.
      if (objectPathCompanyScope(storagePath) !== companyId) continue;
      if (!savedPaths.has(storagePath)) continue;

      const prediction = await analyzePhoto(storagePath);
      if (prediction === null) {
        // Analysis failed for this photo — do NOT persist a placeholder finding.
        analysisErrors++;
        continue;
      }
      // A successful-but-empty assessment (a clean photo with nothing notable)
      // should not create a finding. The prompt makes the model ALWAYS emit a
      // rationale + tags, so those are NOT evidence of a real finding — only a
      // concrete classification (taxonomy category, pest, conducive condition,
      // entry point, or corrective action) counts. A clean photo returns all of
      // these null and is skipped instead of producing an "observation" placeholder.
      const hasContent = !!(
        prediction.category ||
        prediction.possiblePest ||
        prediction.possibleConduciveCondition ||
        prediction.possibleEntryPoint ||
        prediction.suggestedCorrectiveAction
      );
      if (!hasContent) continue;

      const severity =
        prediction.confidence >= 0.7 ? "high" : prediction.confidence >= 0.4 ? "medium" : "low";
      const description =
        prediction.rationale ??
        prediction.possiblePest ??
        prediction.possibleConduciveCondition ??
        prediction.possibleEntryPoint ??
        "AI visual assessment";
      aiFindings.push({
        id: nextId++,
        category: prediction.category ?? "observation",
        description,
        confidence: prediction.confidence,
        severity,
        location: image.label ?? null,
        imageUrl: image.imageUrl,
        treatment: prediction.suggestedCorrectiveAction ?? null,
        exclusionOpportunity: !!prediction.possibleEntryPoint,
        evidenceQuality: null,
      });
    }

    // Merge technician voice findings (renumbered after AI findings).
    const mergedFindings: Finding[] = [
      ...aiFindings,
      ...technicianFindings.map((f) => ({ ...f, id: nextId++ })),
    ];

    // Recommendations: unique, non-empty corrective actions across all findings.
    const recommendations = Array.from(
      new Set(
        mergedFindings
          .map((f) => f.treatment)
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0),
      ),
    );

    // 0–1 scale (see POST /analysis above and the analysis/report UI).
    const overallConfidence =
      mergedFindings.length > 0
        ? mergedFindings.reduce((s, f) => s + (f.confidence ?? 0), 0) /
          mergedFindings.length
        : 0;

    const [row] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        status: "complete",
        findings: mergedFindings,
        recommendations,
        overallConfidence,
      })
      .returning();

    return res.status(201).json({ ...serializeResult(row), analysisErrors });
  } catch (err) {
    return res.status(500).json({ error: "Failed to analyze inspection" });
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
