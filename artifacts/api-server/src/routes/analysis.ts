import { Router } from "express";
import { db } from "@workspace/db";
import {
  analysisResultsTable,
  inspectionsTable,
  inspectionMediaTable,
  type Finding,
  type VideoEvidence,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { analyzePhoto } from "../lib/intelligence-ai";
import { runOpportunitySynthesis } from "../lib/opportunity-ai";
import { runScorecardComputation } from "../lib/scorecard";
import { objectPathCompanyScope } from "../lib/objectStorage";
import { logErrorEvent } from "../lib/error-events";
import { computeCoverage, zonesFromFinding } from "../lib/zone-coverage";
import { computeEvidenceSummary } from "../lib/evidence-summary";
import { computeGuidance } from "../lib/guidance-engine";
import { derivePropertyType } from "../lib/report-narrative-ai";

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
    videoEvidence: row.videoEvidence ?? [],
    photoZones: row.photoZones ?? {},
    coverage: row.coverage ?? null,
    // Live evidence tally for the AI Inspection Engine — derived on read from
    // this row's own findings + videos, so it is always fresh and never stale.
    evidence: computeEvidenceSummary(row.findings, row.videoEvidence),
    // Live Guidance Engine — the single highest-priority NEXT inspection task,
    // derived on read from this row's coverage + findings + analyzed photos.
    guidance: computeGuidance(row.coverage, row.findings, row.analyzedImagePaths),
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
      videos = [],
      draft = false,
    } = req.body as {
      inspectionId?: number;
      images?: Array<{ imageUrl: string; label?: string | null }>;
      technicianFindings?: Finding[];
      videos?: Array<{
        url: string;
        filename?: string | null;
        durationSec?: number | null;
        label?: string | null;
      }>;
      draft?: boolean;
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
    // Video evidence must correspond to a persisted row that was actually saved
    // as a video — never accept a photo (or voice) URL submitted under videos[].
    const savedVideoPaths = new Set(
      savedMedia.filter((m) => m.mediaType === "video").map((m) => toStoragePath(m.url)),
    );

    // Video evidence: record metadata for any persisted, company-scoped video so
    // the analysis result reflects the FULL set of evidence reviewed. We do NOT
    // run vision analysis on video and NEVER derive findings from it — each entry
    // is marked `frameAnalysisStatus: "pending"`, the forward hook for future
    // per-frame video analysis. Same tenant guards as photos: the object must be
    // under the caller's company AND a persisted media row for this inspection.
    const videoEvidence: VideoEvidence[] = [];
    for (const v of videos) {
      if (!v?.url) continue;
      const storagePath = toStoragePath(v.url);
      if (objectPathCompanyScope(storagePath) !== companyId) continue;
      if (!savedVideoPaths.has(storagePath)) continue;
      videoEvidence.push({
        url: v.url,
        filename: v.filename ?? null,
        durationSec: v.durationSec ?? null,
        label: v.label ?? null,
        frameAnalysisStatus: "pending",
      });
    }

    // Bound the number of real AI calls per request to avoid cost/DoS amplification.
    const MAX_ANALYZE_IMAGES = 40;

    // Live-inspection reuse: the workspace re-runs analysis after every few
    // captures, so we carry over the previous run's verified per-photo results
    // instead of re-sending already-assessed photos to the model. Findings are
    // copied VERBATIM (real prior detections, never regenerated) and clean
    // photos recorded in `analyzedImagePaths` are skipped entirely. Only photos
    // the model has never successfully assessed trigger a new vision call.
    const [previousRun] = await db
      .select()
      .from(analysisResultsTable)
      .where(
        and(
          eq(analysisResultsTable.companyId, companyId),
          eq(analysisResultsTable.inspectionId, inspectionId),
        ),
      )
      .orderBy(desc(analysisResultsTable.createdAt))
      .limit(1);
    const previouslyAnalyzed = new Set(
      ((previousRun?.analyzedImagePaths ?? []) as string[]).map(toStoragePath),
    );
    const previousFindingByPath = new Map<string, Finding>();
    for (const f of (previousRun?.findings ?? []) as Finding[]) {
      if (f.imageUrl) previousFindingByPath.set(toStoragePath(f.imageUrl), f);
    }
    // Per-photo zone classifications carried over for already-assessed photos,
    // so clean photos (which produce no finding) keep counting toward coverage.
    const previousPhotoZones = (previousRun?.photoZones ?? {}) as Record<string, string>;

    // Run the real vision model on each company-scoped, persisted photo.
    // We NEVER fabricate a placeholder finding: a photo only becomes a finding
    // when the model returns a genuine, content-bearing assessment. Photos whose
    // analysis FAILED (storage/model/parse error) are counted in `analysisErrors`
    // and surfaced to the technician instead of being saved as empty findings.
    const aiFindings: Finding[] = [];
    const analyzedImagePaths: string[] = [];
    const photoZones: Record<string, string> = {};
    let nextId = 1;
    let analysisErrors = 0;
    for (const image of images.slice(0, MAX_ANALYZE_IMAGES)) {
      if (!image?.imageUrl) continue;
      const storagePath = toStoragePath(image.imageUrl);
      // Tenant safety: object must live under the caller's company AND be a
      // persisted media row for this inspection.
      if (objectPathCompanyScope(storagePath) !== companyId) continue;
      if (!savedPaths.has(storagePath)) continue;

      // Already assessed in a previous run: carry the verified result over.
      if (previouslyAnalyzed.has(storagePath)) {
        analyzedImagePaths.push(storagePath);
        const priorZone = previousPhotoZones[storagePath];
        if (priorZone) photoZones[storagePath] = priorZone;
        const prior = previousFindingByPath.get(storagePath);
        if (prior) aiFindings.push({ ...prior, id: nextId++ });
        continue;
      }

      const prediction = await analyzePhoto(storagePath);
      if (prediction === null) {
        // Analysis failed for this photo — do NOT persist a placeholder finding
        // and do NOT mark it analyzed, so the next run retries it.
        analysisErrors++;
        continue;
      }
      analyzedImagePaths.push(storagePath);
      // Record the zone BEFORE the clean-photo skip below: a clean photo still
      // covers its zone even though it never becomes a finding. `prediction.zone`
      // is already validated against the taxonomy (or null) by parsePrediction.
      if (prediction.zone) photoZones[storagePath] = prediction.zone;
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
        prediction.suggestedCorrectiveAction ||
        prediction.possibleLifeStage ||
        prediction.possibleHarborage ||
        prediction.possibleMoistureIssue ||
        prediction.possibleStructuralIssue
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
        species: prediction.possiblePest ?? null,
        lifeStage: prediction.possibleLifeStage ?? null,
        conduciveCondition: prediction.possibleConduciveCondition ?? null,
        harborage: prediction.possibleHarborage ?? null,
        moisture: prediction.possibleMoistureIssue ?? null,
        structuralIssue:
          prediction.possibleStructuralIssue ?? prediction.possibleEntryPoint ?? null,
        zone: prediction.zone ?? null,
      });
    }

    // Late-flagged duplicate safety: the mobile pixel-dedupe pass runs
    // asynchronously, so a photo analyzed in a prior run can be flagged
    // `duplicateOf` AFTER that run and then dropped from this run's submitted
    // `images[]`. Without carrying it forward, its already-verified finding and
    // per-photo zone would silently vanish and coverage could regress. Carry
    // over every previously-analyzed photo that is still a saved,
    // company-scoped media row but wasn't resubmitted this run.
    const handledPaths = new Set(analyzedImagePaths);
    for (const rawPath of (previousRun?.analyzedImagePaths ?? []) as string[]) {
      const storagePath = toStoragePath(rawPath);
      if (handledPaths.has(storagePath)) continue;
      if (!savedPaths.has(storagePath)) continue;
      if (objectPathCompanyScope(storagePath) !== companyId) continue;
      handledPaths.add(storagePath);
      analyzedImagePaths.push(storagePath);
      const priorZone = previousPhotoZones[storagePath];
      if (priorZone) photoZones[storagePath] = priorZone;
      const prior = previousFindingByPath.get(storagePath);
      if (prior) aiFindings.push({ ...prior, id: nextId++ });
    }

    // Surface per-photo vision failures to the Beta Center error monitor so we
    // can spot model/storage flakiness during the closed beta (best-effort).
    if (analysisErrors > 0) {
      void logErrorEvent("ai", {
        companyId,
        userId: req.user?.id,
        message: `AI photo analysis failed for ${analysisErrors} photo(s)`,
        inspectionId,
        context: { failedPhotos: analysisErrors, stage: "vision_model" },
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

    // Risk level is DERIVED deterministically from finding severities (which
    // are themselves derived from model confidence) — never invented: the
    // worst severity across all findings sets the level; no findings, no risk.
    const riskLevel = mergedFindings.some((f) => f.severity === "high")
      ? "high"
      : mergedFindings.some((f) => f.severity === "medium")
        ? "medium"
        : mergedFindings.length > 0
          ? "low"
          : null;

    // Live completeness: union the per-photo AI zones (incl. clean photos) with
    // the attribute-derived zones from every finding, then score against the
    // property-type + pest-overlay required set. Property type comes from the
    // inspection notes (same source finalization uses); pest overlays from the
    // inspection's declared pest types.
    const coveredZoneSlugs = [
      ...Object.values(photoZones),
      ...mergedFindings.flatMap((f) => zonesFromFinding(f)),
    ];
    const coverage = computeCoverage({
      propertyType: derivePropertyType(inspection.notes),
      pestTypes: (inspection.pestTypes ?? []) as string[],
      coveredZoneSlugs,
    });

    const [row] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        status: "complete",
        findings: mergedFindings,
        recommendations,
        videoEvidence,
        analyzedImagePaths,
        photoZones,
        coverage,
        overallConfidence,
        riskLevel,
      })
      .returning();

    // Opportunity Intelligence + Scorecard are DEFERRED for draft (in-progress)
    // analyses — the mobile live-capture flow passes `draft: true` and these run
    // once, at explicit inspection completion (see /inspections/:id/complete).
    // Default (web app) behavior is unchanged: fire-and-forget on analyze.
    if (!draft) {
      // Opportunity Intelligence: mine the verified findings for business
      // opportunities in the background. Fire-and-forget — the technician's
      // response is never delayed or widened by it, and failures only log.
      void runOpportunitySynthesis({
        companyId,
        inspectionId,
        findings: mergedFindings,
      });

      // Inspection Scorecard: deterministic quality/missed-opportunity/risk
      // snapshot for management. Same fire-and-forget contract.
      void runScorecardComputation({
        companyId,
        inspectionId,
        findings: mergedFindings,
        recommendations,
        photosAnalyzed: analyzedImagePaths.length,
      });
    }

    return res.status(201).json({ ...serializeResult(row), analysisErrors });
  } catch (err) {
    void logErrorEvent("ai", {
      companyId: req.user?.companyId ?? 0,
      userId: req.user?.id,
      message: "Inspection analysis request failed",
      context: { stage: "analyze_route" },
    });
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
