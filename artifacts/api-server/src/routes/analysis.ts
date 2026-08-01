import { Router } from "express";
import { db } from "@workspace/db";
import {
  analysisResultsTable,
  intelligenceRecordsTable,
  inspectionsTable,
  inspectionMediaTable,
  type Finding,
  type InspectionMemory,
  type VideoEvidence,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { analyzePhoto } from "../lib/intelligence-ai";
import { runOpportunitySynthesis } from "../lib/opportunity-ai";
import { runScorecardComputation } from "../lib/scorecard";
import { objectPathCompanyScope, ObjectStorageService } from "../lib/objectStorage";
import { zoomGlassesFrame } from "../lib/glasses-zoom";

const objectStorageService = new ObjectStorageService();
import { logErrorEvent } from "../lib/error-events";
import { computeCoverage, zonesFromFinding } from "../lib/zone-coverage";
import { computeEvidenceSummary } from "../lib/evidence-summary";
import { computeGuidance } from "../lib/guidance-engine";
import { computeInspectionMemory, type PriorVisit } from "../lib/inspection-memory";
import { normalizeAddressKey } from "../lib/property-intelligence";
import { derivePropertyType } from "../lib/report-narrative-ai";

const router = Router();

/**
 * #116 — Background subject crop for phone-camera evidence photos.
 * For each newly-analyzed photo with a real finding, downloads the stored
 * JPEG, runs the Gemini zoom helper to crop to the detected subject, and
 * re-uploads the cropped buffer to a new storage path. Updates the
 * inspectionMedia row URL and zoomSubject so the evidence grid shows the
 * tight crop on the next load. Fire-and-forget from the analyze route —
 * the API response is never delayed or blocked by this function.
 */
async function cropPhonePhotos(
  companyId: number,
  candidates: Array<{ storagePath: string; confidence: number; species: string | null }>,
): Promise<void> {
  for (const { storagePath, confidence, species } of candidates) {
    try {
      const file = await objectStorageService.getObjectEntityFile(storagePath);
      const res  = await objectStorageService.downloadObject(file, 0);
      if (!res.ok) continue;
      const buf  = Buffer.from(await res.arrayBuffer());
      const zoom = await zoomGlassesFrame(buf, confidence, species ?? undefined);
      if (!zoom.cropped) continue;
      const newPath = await objectStorageService.uploadObjectBuffer(
        companyId,
        zoom.buffer,
        "image/jpeg",
      );
      await db
        .update(inspectionMediaTable)
        .set({ url: newPath, zoomSubject: zoom.subject ?? null })
        .where(
          and(
            eq(inspectionMediaTable.companyId, companyId),
            eq(inspectionMediaTable.url, storagePath),
          ),
        );
    } catch { /* background — failures are silently swallowed */ }
  }
}

/**
 * Public storage URLs are served from `/api/storage/...` but the canonical
 * object path used by storage + tenant-scope checks is `/objects/...`.
 */
function toStoragePath(url: string): string {
  return url.replace(/^\/api\/storage/, "");
}

function serializeResult(
  row: typeof analysisResultsTable.$inferSelect,
  memory: InspectionMemory | null = null,
) {
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
    // derived on read from this row's coverage + findings + analyzed photos, plus
    // any Inspection Memory gaps (prior-visit signals not re-covered today) when a
    // single-inspection scope let us compute memory. `memory` is null on the
    // multi-inspection list / feedback / web-create paths, so guidance there is
    // byte-identical to the memory-free behavior.
    guidance: computeGuidance(
      row.coverage,
      row.findings,
      row.analyzedImagePaths,
      memory?.highlights ?? null,
    ),
    // Inspection Memory — prior-visit context + gap highlights for this address.
    // null unless the request is scoped to a single inspection.
    memory,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Gather the PRIOR visits for an inspection: earlier inspections at the SAME
 * normalized address within the SAME company, each reduced to its latest
 * completed analysis row. Company-scoped and same-address-only by construction —
 * the honesty + tenant guardrails for Inspection Memory live here. Returns [] on
 * an empty address key (address-less inspections must never group together) or
 * when there is no prior history.
 */
async function loadPriorVisits(
  companyId: number,
  current: typeof inspectionsTable.$inferSelect,
): Promise<PriorVisit[]> {
  const addressKey = normalizeAddressKey(current.siteAddress ?? "");
  if (!addressKey) return [];

  const inspections = await db
    .select()
    .from(inspectionsTable)
    .where(eq(inspectionsTable.companyId, companyId));

  // Prior = same address key, a DIFFERENT inspection (analyze inserts a new
  // analysis row per run, so the current inspection has many rows — exclude by
  // inspectionId, never by row id), and captured strictly before the current one.
  const currentTs = new Date(current.createdAt).getTime();
  const priorById = new Map<number, typeof inspectionsTable.$inferSelect>();
  for (const insp of inspections) {
    if (insp.id === current.id) continue;
    if (normalizeAddressKey(insp.siteAddress ?? "") !== addressKey) continue;
    if (new Date(insp.createdAt).getTime() >= currentTs) continue;
    priorById.set(insp.id, insp);
  }
  if (priorById.size === 0) return [];

  const rows = await db
    .select()
    .from(analysisResultsTable)
    .where(
      and(
        eq(analysisResultsTable.companyId, companyId),
        eq(analysisResultsTable.status, "complete"),
        inArray(analysisResultsTable.inspectionId, Array.from(priorById.keys())),
      ),
    )
    .orderBy(desc(analysisResultsTable.createdAt));

  // Keep only the latest completed analysis per prior inspection (rows are
  // newest-first, so the first one seen per inspection wins).
  const latestByInspection = new Map<number, typeof analysisResultsTable.$inferSelect>();
  for (const row of rows) {
    if (row.inspectionId == null || latestByInspection.has(row.inspectionId)) continue;
    latestByInspection.set(row.inspectionId, row);
  }

  const visits: PriorVisit[] = [];
  for (const [inspectionId, row] of latestByInspection) {
    visits.push({
      date: priorById.get(inspectionId)?.createdAt ?? row.createdAt,
      findings: (row.findings ?? []) as Finding[],
      recommendations: (row.recommendations ?? []) as string[],
    });
  }
  return visits;
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

    // Single-inspection scope (how mobile loads a live inspection): compute
    // Inspection Memory ONCE from prior visits, then attach per-row memory so the
    // memory-driven guidance survives every react-query refetch and resume — not
    // just the /analyze response. The unfiltered list stays memory-free (it can
    // serialize many inspections; a prior-visit read per row would be wasteful).
    if (inspectionId) {
      const [inspection] = await db
        .select()
        .from(inspectionsTable)
        .where(
          and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
        );
      if (inspection) {
        const priorVisits = await loadPriorVisits(companyId, inspection);
        return res.json(
          rows.map((r) => serializeResult(r, computeInspectionMemory(priorVisits, r))),
        );
      }
    }
    return res.json(rows.map((r) => serializeResult(r)));
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
    // Technician captions (notes written during or after capture) keyed by
    // storage path — passed to the vision model as additional context.
    const captionByPath = new Map<string, string>(
      savedMedia
        .filter((m) => m.caption)
        .map((m) => [toStoragePath(m.url), m.caption as string]),
    );
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
    // #116 — collect newly-analyzed phone-camera photos with real findings for background crop.
    const cropCandidates: Array<{ storagePath: string; confidence: number; species: string | null }> = [];
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

      const technicianNote = captionByPath.get(storagePath) ?? null;
      const prediction = await analyzePhoto(storagePath, technicianNote);
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

      // RLQ-003: confidence-gated species label.
      // ≥0.70 → auto-identified; 0.40–0.69 → possible; <0.40 → unable to identify.
      const confidenceLabel: "identified" | "possible" | "unidentified" =
        prediction.confidence >= 0.70
          ? "identified"
          : prediction.confidence >= 0.40
            ? "possible"
            : "unidentified";
      const displaySpecies: string | null =
        confidenceLabel === "unidentified"
          ? null
          : confidenceLabel === "possible" && prediction.possiblePest
            ? `Possible: ${prediction.possiblePest}`
            : (prediction.possiblePest ?? null);

      // RLQ-002: top-3 candidates from the model; fall back to single-candidate
      // when the model didn't return a candidates array.
      const candidates: Array<{ species: string; confidence: number }> =
        prediction.pestCandidates && prediction.pestCandidates.length > 0
          ? prediction.pestCandidates
          : prediction.possiblePest
            ? [{ species: prediction.possiblePest, confidence: prediction.confidence }]
            : [];

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
        species: displaySpecies,
        lifeStage: prediction.possibleLifeStage ?? null,
        conduciveCondition: prediction.possibleConduciveCondition ?? null,
        harborage: prediction.possibleHarborage ?? null,
        moisture: prediction.possibleMoistureIssue ?? null,
        structuralIssue:
          prediction.possibleStructuralIssue ?? prediction.possibleEntryPoint ?? null,
        zone: prediction.zone ?? null,
        candidates,
        confidenceLabel,
        reviewStatus: "pending",
      });
      // #116 — queue phone-camera photos with genuine findings for background crop.
      if (prediction.confidence >= 0.6) {
        cropCandidates.push({
          storagePath,
          confidence: prediction.confidence,
          species: prediction.possiblePest ?? null,
        });
      }
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

    // #116 — background subject crop for newly-analyzed phone-camera photos.
    if (cropCandidates.length > 0) {
      void cropPhonePhotos(companyId, cropCandidates);
    }

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

    // Inspection Memory: compare this run against prior visits at the same
    // address so the returned guidance can be memory-driven immediately (the
    // mobile live flow re-runs analyze after every few captures and shows the new
    // guidance with no refresh).
    const memory = computeInspectionMemory(await loadPriorVisits(companyId, inspection), row);

    return res.status(201).json({ ...serializeResult(row, memory), analysisErrors });
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

    // Single-analysis fetch is single-inspection scope -> attach Inspection Memory.
    let memory: InspectionMemory | null = null;
    if (row.inspectionId != null) {
      const [inspection] = await db
        .select()
        .from(inspectionsTable)
        .where(
          and(
            eq(inspectionsTable.id, row.inspectionId),
            eq(inspectionsTable.companyId, companyId),
          ),
        );
      if (inspection) {
        memory = computeInspectionMemory(await loadPriorVisits(companyId, inspection), row);
      }
    }
    return res.json(serializeResult(row, memory));
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

// PATCH /analysis/:id/findings/correct — RLQ-001: technician reviews a finding.
// Updates the reviewStatus on the finding in JSONB and stores a feedback record
// in intelligence_records for the training dataset (RLQ-004).
router.patch("/:id/findings/correct", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const { findingId, action, technicianSpecies } = req.body as {
      findingId?: number;
      action?: "accept" | "correct" | "dismiss";
      technicianSpecies?: string;
    };
    if (findingId == null || !action) {
      return res.status(400).json({ error: "findingId and action are required" });
    }
    if (!["accept", "correct", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be accept, correct, or dismiss" });
    }
    if (action === "correct" && !technicianSpecies?.trim()) {
      return res.status(400).json({ error: "technicianSpecies is required when action is correct" });
    }

    const [row] = await db
      .select()
      .from(analysisResultsTable)
      .where(and(eq(analysisResultsTable.id, id), eq(analysisResultsTable.companyId, companyId)));
    if (!row) return res.status(404).json({ error: "Not found" });

    const findings = (row.findings ?? []) as Finding[];
    const idx = findings.findIndex((f) => f.id === findingId);
    if (idx === -1) return res.status(404).json({ error: "Finding not found" });

    const reviewStatus: Finding["reviewStatus"] =
      action === "accept" ? "accepted" : action === "correct" ? "corrected" : "dismissed";

    const updatedFinding: Finding = {
      ...findings[idx],
      reviewStatus,
      technicianSpecies:
        action === "correct"
          ? (technicianSpecies?.trim() ?? null)
          : (findings[idx].technicianSpecies ?? null),
    };
    const updatedFindings = [
      ...findings.slice(0, idx),
      updatedFinding,
      ...findings.slice(idx + 1),
    ];

    const [updated] = await db
      .update(analysisResultsTable)
      .set({ findings: updatedFindings })
      .where(and(eq(analysisResultsTable.id, id), eq(analysisResultsTable.companyId, companyId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

    // RLQ-004: store correction to intelligence_records as a training signal.
    // We capture the FULL original AI prediction snapshot alongside the
    // technician's ground-truth label so the (AI → human) delta is permanently
    // preserved for future model fine-tuning. Best-effort: never blocks the
    // PATCH response, never throws back to the client.
    const userId = req.user?.id;
    if (userId && findings[idx].imageUrl) {
      const f = findings[idx];
      void db
        .insert(intelligenceRecordsTable)
        .values({
          companyId,
          imageUrl: f.imageUrl!,
          // Full immutable snapshot of the AI's original prediction.
          aiPrediction: {
            category: f.category ?? null,
            subcategory: null,
            confidence: f.confidence,
            tags: [],
            possiblePest: f.species ?? null,
            possibleConduciveCondition: f.conduciveCondition ?? null,
            possibleEntryPoint: null,
            suggestedCorrectiveAction: f.treatment ?? null,
            rationale: f.description ?? null,
            possibleLifeStage: f.lifeStage ?? null,
            possibleHarborage: f.harborage ?? null,
            possibleMoistureIssue: f.moisture ?? null,
            possibleStructuralIssue: f.structuralIssue ?? null,
            zone: f.zone ?? null,
            // All AI candidate species for this finding (top-3, sorted by conf).
            pestCandidates: f.candidates ?? [],
          },
          aiConfidence: f.confidence,
          // Ground-truth label after technician review.
          category: action !== "dismiss" ? (f.category ?? null) : null,
          possiblePest:
            action === "correct"
              ? (technicianSpecies?.trim() ?? null)
              : action === "accept"
                ? (f.species ?? null)
                : null,
          correctiveAction: f.treatment ?? null,
          aiCorrected: action === "correct",
          // L2 = technician review (L1 = AI only, L3 = peer-confirmed, L4/L5 = manager).
          verificationLevel: 2,
          createdBy: userId,
        })
        .catch(() => {});
    }

    return res.json(serializeResult(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to correct finding" });
  }
});

export default router;
