import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { appendProcessingMilestone } from "../lib/inspection-processing-events";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  analysisResultsTable,
  analysisProviderAttemptsTable,
  intelligenceRecordsTable,
  inspectionsTable,
  inspectionMediaTable,
  type Finding,
  type AiPrediction,
  type InspectionMemory,
  type VideoEvidence,
} from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import {
  regenerateFindingAfterTechnicianCorrection,
} from "../lib/intelligence-ai";
import type { PhotoAnalysisOutcome } from "../lib/intelligence-ai";
import { assessQueuedPhoto } from "../lib/photo-analysis-queue";
import { runOpportunitySynthesis } from "../lib/opportunity-ai";
import { runScorecardComputation } from "../lib/scorecard";
import { objectPathCompanyScope, ObjectStorageService } from "../lib/objectStorage";
import { zoomGlassesFrame } from "../lib/glasses-zoom";
import { FindingSchema } from "@workspace/api-zod";

// ---------------------------------------------------------------------------
// Write-boundary Finding validation
// ---------------------------------------------------------------------------

/**
 * The generated OpenAPI Finding schema is used at the write boundary.
 * Client submissions are rejected explicitly before work begins. Malformed AI
 * output and legacy persisted entries remain tolerant: they are stripped and
 * logged so existing inspections can still be read and finalized safely.
 * safeParseFindings() in reports.ts remains an independent read-side safety net.
 */
const findingSchema = FindingSchema;

/**
 * Validates an array of raw findings against findingSchema. Invalid entries
 * are stripped and logged; valid entries are returned as typed Finding[].
 * Returns [validFindings, invalidCount] — callers may log the count to the
 * error monitor when invalidCount > 0.
 */
export function validateFindings(
  raw: unknown,
  context: string,
): [Finding[], number] {
  if (!Array.isArray(raw)) return [[], 0];
  const valid: Finding[] = [];
  let invalidCount = 0;
  for (const item of raw) {
    const result = findingSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data as Finding);
    } else {
      invalidCount++;
      // Log the first failing field for diagnostics without flooding output.
      const first = result.error.issues[0];
      logger.error(
        { context, message: first?.message, path: first?.path?.join(".") },
        "[analysis] Invalid finding stripped",
      );
    }
  }
  return [valid, invalidCount];
}

type FindingValidationIssue = {
  index: number;
  path: (string | number)[];
  message: string;
};

/**
 * Client-provided finding arrays are all-or-nothing. This intentionally differs
 * from validateFindings(), which remains tolerant for AI output and legacy
 * persisted rows.
 */
function validateClientFindings(
  raw: unknown,
  errorLabel: "Invalid findings" | "Invalid technician findings",
): { findings: Finding[]; issues: FindingValidationIssue[] } | {
  response: {
    error: string;
    code: "INVALID_FINDINGS";
    issues: FindingValidationIssue[];
  };
} {
  const issues: FindingValidationIssue[] = [];
  if (!Array.isArray(raw)) {
    issues.push({ index: 0, path: [], message: "Expected an array" });
  } else {
    raw.forEach((item, index) => {
      const result = findingSchema.safeParse(item);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const issuePath = issue.path as (string | number)[];
          if (issue.code === "unrecognized_keys" && "keys" in issue) {
            for (const key of issue.keys) {
              issues.push({
                index,
                path: [...issuePath, key],
                message: issue.message,
              });
            }
          } else {
            issues.push({ index, path: issuePath, message: issue.message });
          }
        }
      }
    });
  }
  if (issues.length > 0) {
    return { response: { error: errorLabel, code: "INVALID_FINDINGS", issues } };
  }
  return {
    findings: (raw as unknown[]).map((item) => findingSchema.parse(item) as Finding),
    issues: [],
  };
}

const objectStorageService = new ObjectStorageService();
import { logErrorEvent } from "../lib/error-events";
import { computeCoverage, zonesFromFinding } from "../lib/zone-coverage";
import { computeEvidenceSummary } from "../lib/evidence-summary";
import { computeGuidance } from "../lib/guidance-engine";
import { computeInspectionMemory, type PriorVisit } from "../lib/inspection-memory";
import { normalizeAddressKey } from "../lib/property-intelligence";
import { derivePropertyType } from "../lib/report-narrative-ai";

const router = Router();
type SharedAnalysisResponse = { status: number; body: unknown };
const inFlightAnalyses = new Map<string, Promise<SharedAnalysisResponse>>();
type PersistedPhotoOutcome = {
  imagePath: string;
  status: PhotoAnalysisOutcome["status"];
};

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
  const normalized = url.replace(/^\/api\/storage/, "").trim();
  if (!normalized.startsWith("https://storage.googleapis.com/")) {
    return normalized;
  }

  try {
    const objectPath = new URL(normalized).pathname;
    const entityPathIndex = objectPath.indexOf("/objects/");
    return entityPathIndex >= 0 ? objectPath.slice(entityPathIndex) : objectPath;
  } catch {
    return normalized;
  }
}

/**
 * JSON.stringify preserves insertion order, which makes it unsuitable for
 * identifying equivalent request payloads assembled by different callers.
 * Canonicalize objects recursively while retaining array order (image order is
 * meaningful because the first occurrence supplies the finding label).
 */
function stableCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableCanonicalize(entry)]),
    );
  }
  return value;
}

function analysisPayloadKey(payload: {
  inspectionId: number;
  images: Array<{ imageUrl: string; label?: string | null }>;
  technicianFindings: Finding[];
  videos: Array<{
    url: string;
    filename?: string | null;
    durationSec?: number | null;
    label?: string | null;
  }>;
  draft: boolean;
}): string {
  // Include both the submitted URL and its canonical storage path. The former
  // is part of the response shape, while the latter is the effective media
  // identity used for tenant/media eligibility and provider work.
  const effectivePayload = {
    inspectionId: payload.inspectionId,
    images: payload.images.map((image) => ({
      imageUrl: image?.imageUrl ?? null,
      storagePath:
        typeof image?.imageUrl === "string" ? toStoragePath(image.imageUrl) : null,
      label: image?.label ?? null,
    })),
    technicianFindings: payload.technicianFindings,
    videos: payload.videos.map((video) => ({
      url: video?.url ?? null,
      storagePath: typeof video?.url === "string" ? toStoragePath(video.url) : null,
      filename: video?.filename ?? null,
      durationSec: video?.durationSec ?? null,
      label: video?.label ?? null,
    })),
    draft: payload.draft,
  };
  return createHash("sha256")
    .update(JSON.stringify(stableCanonicalize(effectivePayload)))
    .digest("hex");
}

const MAX_PROVIDER_ATTEMPTS_PER_MEDIA = 3;
const PROVIDER_ATTEMPT_LEASE_MS = 180_000;
const DEFAULT_DAILY_PROVIDER_CALL_LIMIT_PER_COMPANY = 100;
const DEFAULT_DAILY_PROVIDER_CALL_LIMIT_PLATFORM = 1_000;
const MAX_DAILY_PROVIDER_CALL_LIMIT = 1_000_000;

type ProviderAttemptClaim =
  | { kind: "claimed"; token: string }
  | { kind: "recovered"; prediction: AiPrediction }
  | { kind: "busy" }
  | { kind: "budget_exhausted" }
  | { kind: "exhausted" };

class DailyProviderBudgetExhausted extends Error {}

function configuredDailyProviderLimit(
  name: "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PER_COMPANY" | "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PLATFORM",
  fallback: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer between 0 and ${MAX_DAILY_PROVIDER_CALL_LIMIT}`);
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit > MAX_DAILY_PROVIDER_CALL_LIMIT) {
    throw new Error(`${name} must be an integer between 0 and ${MAX_DAILY_PROVIDER_CALL_LIMIT}`);
  }
  return limit;
}

async function reserveDailyProviderCall(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  scopeId: number,
  dailyLimit: number,
): Promise<boolean> {
  const reservation = await tx.execute(sql`
    INSERT INTO analysis_provider_daily_budgets
      (scope_id, budget_date, consumed_calls, daily_limit)
    SELECT
      ${scopeId},
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
      1,
      ${dailyLimit}
    WHERE ${dailyLimit} > 0
    ON CONFLICT (scope_id, budget_date) DO UPDATE
      SET consumed_calls = analysis_provider_daily_budgets.consumed_calls + 1
      WHERE analysis_provider_daily_budgets.consumed_calls
        < analysis_provider_daily_budgets.daily_limit
    RETURNING scope_id
  `);
  return reservation.rows.length > 0;
}

/**
 * Atomically claim a photo attempt and reserve both company and platform daily
 * budgets before provider work. All writes are in one PostgreSQL transaction,
 * so a quota denial rolls back the media claim and concurrent workers cannot
 * oversubscribe either daily window. Once committed, a reservation is never
 * refunded: a crash after reservation but before the provider call consumes it.
 */
async function claimProviderAttempt(
  companyId: number,
  inspectionId: number,
  mediaPath: string,
): Promise<ProviderAttemptClaim> {
  const token = randomUUID();
  const companyLimit = configuredDailyProviderLimit(
    "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PER_COMPANY",
    DEFAULT_DAILY_PROVIDER_CALL_LIMIT_PER_COMPANY,
  );
  const platformLimit = configuredDailyProviderLimit(
    "ANALYSIS_DAILY_PROVIDER_PHOTO_LIMIT_PLATFORM",
    DEFAULT_DAILY_PROVIDER_CALL_LIMIT_PLATFORM,
  );
  try {
    return await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        INSERT INTO analysis_provider_attempts
          (company_id, inspection_id, media_path, attempt_count, state, lease_until, lease_token, updated_at)
        VALUES (
          ${companyId}, ${inspectionId}, ${mediaPath}, 1, 'leased',
          NOW() + (${PROVIDER_ATTEMPT_LEASE_MS} * INTERVAL '1 millisecond'), ${token}, NOW()
        )
        ON CONFLICT (company_id, inspection_id, media_path) DO UPDATE
        SET attempt_count = analysis_provider_attempts.attempt_count + 1,
            state = 'leased',
            lease_until = NOW() + (${PROVIDER_ATTEMPT_LEASE_MS} * INTERVAL '1 millisecond'),
            lease_token = ${token},
            updated_at = NOW()
        WHERE analysis_provider_attempts.state NOT IN ('completed', 'provider_succeeded')
          AND analysis_provider_attempts.attempt_count < ${MAX_PROVIDER_ATTEMPTS_PER_MEDIA}
          AND (
            analysis_provider_attempts.state <> 'leased'
            OR analysis_provider_attempts.lease_until <= NOW()
          )
        RETURNING attempt_count
      `);
      if (result.rows.length === 0) {
        const [existing] = await tx
          .select()
          .from(analysisProviderAttemptsTable)
          .where(
            and(
              eq(analysisProviderAttemptsTable.companyId, companyId),
              eq(analysisProviderAttemptsTable.inspectionId, inspectionId),
              eq(analysisProviderAttemptsTable.mediaPath, mediaPath),
            ),
          )
          .limit(1);
        if (
          existing?.providerResult &&
          (existing.state === "provider_succeeded" || existing.state === "completed")
        ) {
          return { kind: "recovered" as const, prediction: existing.providerResult };
        }
        if (
          existing?.state === "leased" &&
          existing.leaseUntil &&
          existing.leaseUntil.getTime() > Date.now()
        ) {
          return { kind: "busy" as const };
        }
        return { kind: "exhausted" as const };
      }

      if (!(await reserveDailyProviderCall(tx, companyId, companyLimit))) {
        throw new DailyProviderBudgetExhausted();
      }
      // scope id zero is reserved for the platform-wide daily ceiling.
      if (!(await reserveDailyProviderCall(tx, 0, platformLimit))) {
        throw new DailyProviderBudgetExhausted();
      }
      await appendProcessingMilestone(tx, {
        companyId, inspectionId, eventType: "analysis.attempt_started",
        sourceType: "analysis_provider_attempts",
        sourceId: providerAttemptSourceId(inspectionId, mediaPath, Number(result.rows[0]!.attempt_count)),
        actor: "system:analysis",
      });
      return { kind: "claimed" as const, token };
    });
  } catch (error) {
    // Throwing inside the transaction rolls back both the per-media attempt
    // claim and any partial budget reservation.
    if (error instanceof DailyProviderBudgetExhausted) {
      return { kind: "budget_exhausted" };
    }
    throw error;
  }
}

async function claimOrRecoverProviderOutcome(
  companyId: number,
  inspectionId: number,
  mediaPath: string,
  deadlineAt: number,
): Promise<ProviderAttemptClaim> {
  do {
    const claim = await claimProviderAttempt(companyId, inspectionId, mediaPath);
    if (claim.kind !== "busy") return claim;
    if (Date.now() >= deadlineAt) return claim;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadlineAt);
  return { kind: "busy" };
}

async function persistProviderSuccess(
  companyId: number,
  inspectionId: number,
  mediaPath: string,
  token: string,
  prediction: AiPrediction,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
    UPDATE analysis_provider_attempts
    SET state = 'provider_succeeded',
        provider_result = ${JSON.stringify(prediction)}::jsonb,
        lease_until = NULL,
        lease_token = NULL,
        updated_at = NOW()
    WHERE company_id = ${companyId}
      AND inspection_id = ${inspectionId}
      AND media_path = ${mediaPath}
      AND lease_token = ${token}
      AND state = 'leased'
    RETURNING attempt_count
  `);
    if (result.rows.length) await appendProcessingMilestone(tx, {
      companyId, inspectionId, eventType: "analysis.attempt_succeeded",
      sourceType: "analysis_provider_attempts",
      sourceId: providerAttemptSourceId(inspectionId, mediaPath, Number(result.rows[0]!.attempt_count)),
      actor: "system:analysis",
    });
    return result.rows.length > 0;
  });
}

function providerAttemptSourceId(inspectionId: number, mediaPath: string, attempt: number) {
  // The source has a composite primary key. Hash the private path rather than
  // exposing it in Mission Control; the ordinal distinguishes legitimate retries.
  return `${inspectionId}:${createHash("sha256").update(mediaPath).digest("hex")}:${attempt}`;
}
async function failProviderAttempt(
  companyId: number,
  inspectionId: number,
  mediaPath: string,
  token: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
    UPDATE analysis_provider_attempts
    SET state = 'failed',
        lease_until = NULL,
        lease_token = NULL,
        updated_at = NOW()
    WHERE company_id = ${companyId}
      AND inspection_id = ${inspectionId}
      AND media_path = ${mediaPath}
      AND lease_token = ${token}
      AND state = 'leased'
    RETURNING attempt_count
  `);
    if (result.rows.length) await appendProcessingMilestone(tx, {
      companyId, inspectionId, eventType: "analysis.attempt_failed",
      sourceType: "analysis_provider_attempts",
      sourceId: providerAttemptSourceId(inspectionId, mediaPath, Number(result.rows[0]!.attempt_count)),
      actor: "system:analysis",
    });
  });
}

function findingFromPrediction(
  prediction: AiPrediction,
  imageUrl: string,
  location: string | null,
  id: number,
): Finding | null {
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
  if (!hasContent) return null;

  const severity =
    prediction.confidence >= 0.7 ? "high" : prediction.confidence >= 0.4 ? "medium" : "low";
  const confidenceLabel: "identified" | "possible" | "unidentified" =
    prediction.confidence >= 0.7
      ? "identified"
      : prediction.confidence >= 0.4
        ? "possible"
        : "unidentified";
  const displaySpecies =
    confidenceLabel === "unidentified"
      ? null
      : confidenceLabel === "possible" && prediction.possiblePest
        ? `Possible: ${prediction.possiblePest}`
        : (prediction.possiblePest ?? null);
  const candidates =
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

  return {
    id,
    category: prediction.category ?? "observation",
    description,
    confidence: prediction.confidence,
    severity,
    location,
    imageUrl,
    treatment: prediction.suggestedCorrectiveAction ?? null,
    exclusionOpportunity: !!prediction.possibleEntryPoint,
    evidenceQuality: null,
    species: displaySpecies,
    lifeStage: prediction.possibleLifeStage ?? null,
    conduciveCondition: prediction.possibleConduciveCondition ?? null,
    harborage: prediction.possibleHarborage ?? null,
    moisture: prediction.possibleMoistureIssue ?? null,
    structuralIssue: prediction.possibleStructuralIssue ?? prediction.possibleEntryPoint ?? null,
    zone: prediction.zone ?? null,
    candidates,
    confidenceLabel,
    reviewStatus: "pending",
  };
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
    photoOutcomes: row.photoOutcomes ?? [],
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
    const allFindings = completed.flatMap((r) => (r.findings ?? []) as Array<{ category: string }>);

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
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    let clientFindings: Finding[] = [];
    if (Object.prototype.hasOwnProperty.call(rawBody, "findings")) {
      const validation = validateClientFindings(rawBody.findings, "Invalid findings");
      if ("response" in validation) return res.status(400).json(validation.response);
      clientFindings = validation.findings;
    }
    const {
      inspectionId,
      recommendations = [],
      overallConfidence,
    } = rawBody as {
      inspectionId?: number;
      recommendations?: string[];
      overallConfidence?: number;
    };
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
      (clientFindings.length > 0
        ? clientFindings.reduce((s: number, f: Finding) => s + (f.confidence ?? 0), 0) /
          clientFindings.length
        : 0);

    const [row] = await db
      .insert(analysisResultsTable)
      .values({
        companyId,
        inspectionId,
        status: "complete",
        findings: clientFindings,
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
  let sharedKey: string | null = null;
  let sharedPromise: Promise<SharedAnalysisResponse> | undefined;
  let resolveShared: ((value: SharedAnalysisResponse) => void) | undefined;
  let rejectShared: ((reason?: unknown) => void) | undefined;
  let sharedSettled = false;
  try {
    const companyId = getCompanyId(req);
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const {
      inspectionId,
      images = [],
      videos = [],
      draft = false,
    } = rawBody as {
      inspectionId?: number;
      images?: Array<{ imageUrl: string; label?: string | null }>;
      videos?: Array<{
        url: string;
        filename?: string | null;
        durationSec?: number | null;
        label?: string | null;
      }>;
      draft?: boolean;
    };
    let technicianFindings: Finding[] = [];
    if (Object.prototype.hasOwnProperty.call(rawBody, "technicianFindings")) {
      const validation = validateClientFindings(
        rawBody.technicianFindings,
        "Invalid technician findings",
      );
      if ("response" in validation) return res.status(400).json(validation.response);
      technicianFindings = validation.findings;
    }
    if (inspectionId) {
      const payloadHash = analysisPayloadKey({
        inspectionId,
        images,
        technicianFindings,
        videos,
        draft,
      });
      sharedKey = `${companyId}:${inspectionId}:${payloadHash}`;
      const existing = inFlightAnalyses.get(sharedKey);
      if (existing) {
        const shared = await existing;
        return res.status(shared.status).json(shared.body);
      }

      sharedPromise = new Promise<SharedAnalysisResponse>((resolve, reject) => {
        resolveShared = (value) => {
          sharedSettled = true;
          resolve(value);
        };
        rejectShared = (reason) => {
          sharedSettled = true;
          reject(reason);
        };
      });
      inFlightAnalyses.set(sharedKey, sharedPromise);
      // Capture the first response body so simultaneous callers receive the
      // exact same persisted analysis result rather than starting provider work
      // again. This is intentionally process-local; persistence remains the
      // analysis result row itself.
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        resolveShared?.({ status: res.statusCode, body });
        return originalJson(body);
      }) as typeof res.json;
      void sharedPromise.then(
        () => {
          if (sharedKey && inFlightAnalyses.get(sharedKey) === sharedPromise) {
            inFlightAnalyses.delete(sharedKey);
          }
        },
        () => {
          if (sharedKey && inFlightAnalyses.get(sharedKey) === sharedPromise) {
            inFlightAnalyses.delete(sharedKey);
          }
        },
      );
    }
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
    // Mobile registers captured photos as "image"; older clients and other
    // capture paths register them as "photo". Both are persisted image evidence.
    // A video or other media type must never be accepted as an image.
    const savedPaths = new Set(
      savedMedia
        .filter((m) => m.mediaType === "photo" || m.mediaType === "image")
        .map((m) => toStoragePath(m.url)),
    );
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
    // analysis did not complete (ordinary failure, deadline deferral, or
    // exhausted provider throttling) is counted in `analysisErrors` and
    // surfaced to the technician instead of being saved as empty findings.
    const aiFindings: Finding[] = [];
    const analyzedImagePaths: string[] = [];
    const photoOutcomes: PersistedPhotoOutcome[] = [];
    const photoZones: Record<string, string> = {};
    let nextId = 1;
    let analysisErrors = 0;
    // #116 — collect newly-analyzed phone-camera photos with real findings for background crop.
    const cropCandidates: Array<{ storagePath: string; confidence: number; species: string | null }> = [];
    type PendingPhoto = {
      image: { imageUrl: string; label?: string | null };
      storagePath: string;
      technicianNote: string | null;
    };
    const pendingPhotos: PendingPhoto[] = [];
    // Validate and deduplicate BEFORE applying the provider cap. Invalid
    // entries and repeated paths therefore cannot crowd valid unique photos
    // out of the first 40.
    const eligibleImages: Array<{
      image: { imageUrl: string; label?: string | null };
      storagePath: string;
    }> = [];
    const eligiblePaths = new Set<string>();
    for (const image of images) {
      if (!image?.imageUrl) continue;
      const storagePath = toStoragePath(image.imageUrl);
      // Tenant safety: object must live under the caller's company AND be a
      // persisted media row for this inspection.
      if (objectPathCompanyScope(storagePath) !== companyId) continue;
      if (!savedPaths.has(storagePath)) continue;
      if (eligiblePaths.has(storagePath)) continue;
      eligiblePaths.add(storagePath);
      eligibleImages.push({ image, storagePath });
    }
    // Mobile retries submit only unresolved paths. In a draft live inspection,
    // include previously assessed photos that are still registered as evidence
    // so the newest result does not erase their findings and zone coverage.
    // Non-draft explicit submissions retain their requested-photo semantics.
    if (draft) {
      for (const storagePath of previouslyAnalyzed) {
        if (eligiblePaths.has(storagePath) || !savedPaths.has(storagePath)) continue;
        eligiblePaths.add(storagePath);
        eligibleImages.push({ image: { imageUrl: storagePath }, storagePath });
      }
    }

    const newEligibleImages: typeof eligibleImages = [];
    for (const { image, storagePath } of eligibleImages) {
      // Already assessed in a previous run: carry the verified result over.
      if (previouslyAnalyzed.has(storagePath)) {
        photoOutcomes.push({ imagePath: storagePath, status: "completed" });
        analyzedImagePaths.push(storagePath);
        const priorZone = previousPhotoZones[storagePath];
        if (priorZone) photoZones[storagePath] = priorZone;
        const prior = previousFindingByPath.get(storagePath);
        if (prior) aiFindings.push({ ...prior, id: nextId++ });
        continue;
      }
      newEligibleImages.push({ image, storagePath });
    }

    // The cap bounds real provider calls, not already-completed carry-over.
    // Apply it only after eligible photos have been partitioned by cache state.
    const cappedImages = newEligibleImages.slice(0, MAX_ANALYZE_IMAGES);
    const overflowImages = newEligibleImages.slice(MAX_ANALYZE_IMAGES);
    for (const { image, storagePath } of cappedImages) {
      const technicianNote = captionByPath.get(storagePath) ?? null;
      pendingPhotos.push({ image, storagePath, technicianNote });
    }

    // Provider-safe parallelism: three workers are enough to make a 12-photo
    // inspection substantially faster without producing a burst of 12 calls.
    // analyzePhoto enforces each call's deadline and provider-aware 429 backoff;
    // every worker also shares this hard whole-job deadline.
    const ANALYSIS_CONCURRENCY = 3;
    const ANALYSIS_JOB_TIMEOUT_MS = 120_000;
    const PHOTO_TIMEOUT_MS = 35_000;
    const jobDeadlineAt = Date.now() + ANALYSIS_JOB_TIMEOUT_MS;
    const predictions = new Array<PhotoAnalysisOutcome>(pendingPhotos.length);
    let nextPendingIndex = 0;
    const worker = async () => {
      while (Date.now() < jobDeadlineAt) {
        const index = nextPendingIndex++;
        if (index >= pendingPhotos.length) return;
        const photo = pendingPhotos[index];
        // Claim immediately before provider work. A concurrent request waits
        // for the lease holder's durable result instead of saving a terminal
        // deferred outcome for work that is still underway.
        const claim = await claimOrRecoverProviderOutcome(
          companyId,
          inspectionId,
          photo.storagePath,
          jobDeadlineAt,
        );
        if (claim.kind === "recovered") {
          predictions[index] = { status: "completed", prediction: claim.prediction };
          continue;
        }
        if (claim.kind === "busy") {
          predictions[index] = { status: "deferred", prediction: null };
          continue;
        }
        if (claim.kind === "budget_exhausted") {
          // Company/platform quota has run out for the DB's current UTC day.
          // Do not retry locally; a later request after the window resets may.
          predictions[index] = { status: "deferred", prediction: null };
          continue;
        }
        if (claim.kind === "exhausted") {
          predictions[index] = { status: "rate_limited", prediction: null };
          continue;
        }

        // A completed provider result is written durably before the analysis
        // result insert. If later persistence fails, another request can
        // recover this exact assessment without spending another provider call.
        predictions[index] = await assessQueuedPhoto(
          photo.storagePath, photo.technicianNote, jobDeadlineAt, PHOTO_TIMEOUT_MS,
        );
        if (predictions[index].status === "completed") {
          await persistProviderSuccess(
            companyId,
            inspectionId,
            photo.storagePath,
            claim.token,
            predictions[index].prediction,
          );
        } else {
          await failProviderAttempt(companyId, inspectionId, photo.storagePath, claim.token);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(ANALYSIS_CONCURRENCY, pendingPhotos.length) },
        () => worker(),
      ),
    );

    // Materialize in request order so finding IDs and persisted arrays remain
    // deterministic even though provider calls complete out of order.
    for (let index = 0; index < pendingPhotos.length; index++) {
      const { image, storagePath } = pendingPhotos[index];
      const outcome = predictions[index] ?? { status: "deferred", prediction: null };
      photoOutcomes.push({ imagePath: storagePath, status: outcome.status });
      if (outcome.status !== "completed") {
        // Non-successful photos are never marked analyzed and therefore retry
        // on a later live-inspection run. No placeholder finding is created.
        analysisErrors++;
        continue;
      }
      const prediction = outcome.prediction;
      analyzedImagePaths.push(storagePath);
      // Record the zone BEFORE the clean-photo skip below: a clean photo still
      // covers its zone even though it never becomes a finding. `prediction.zone`
      // is already validated against the taxonomy (or null) by parsePrediction.
      if (prediction.zone) photoZones[storagePath] = prediction.zone;
      const finding = findingFromPrediction(
        prediction,
        image.imageUrl,
        image.label ?? null,
        nextId,
      );
      if (finding) {
        aiFindings.push(finding);
        nextId++;
      }
      // #116 — queue phone-camera photos with genuine findings for background crop.
      if (finding && prediction.confidence >= 0.6) {
        cropCandidates.push({
          storagePath,
          confidence: prediction.confidence,
          species: prediction.possiblePest ?? null,
        });
      }
    }

    for (const { storagePath } of overflowImages) {
      // These are valid media, but deliberately outside this request's bounded
      // provider budget. Keep them retryable and make the aggregate status
      // honest rather than silently dropping them.
      photoOutcomes.push({ imagePath: storagePath, status: "deferred" });
      analysisErrors++;
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
      photoOutcomes.push({ imagePath: storagePath, status: "completed" });
      analyzedImagePaths.push(storagePath);
      const priorZone = previousPhotoZones[storagePath];
      if (priorZone) photoZones[storagePath] = priorZone;
      const prior = previousFindingByPath.get(storagePath);
      if (prior) aiFindings.push({ ...prior, id: nextId++ });
    }

    // Surface non-completed per-photo vision work to the Beta Center error
    // monitor so we can spot model/storage flakiness during the closed beta.
    if (analysisErrors > 0) {
      void logErrorEvent("ai", {
        companyId,
        userId: req.user?.id,
        message: `AI photo analysis did not complete for ${analysisErrors} photo(s)`,
        inspectionId,
        context: { failedPhotos: analysisErrors, stage: "vision_model" },
      });
    }

    // Merge technician voice findings (renumbered after AI findings).
    const rawMerged: Finding[] = [
      ...aiFindings,
      ...technicianFindings.map((f) => ({ ...f, id: nextId++ })),
    ];

    // Validate every finding at the write boundary before touching the DB.
    // Both server-built AI findings and client-submitted technician findings
    // are checked. Invalid entries are stripped and logged; the analysis still
    // saves with whatever valid findings remain.
    const [mergedFindings, mergedInvalidCount] = validateFindings(rawMerged, "POST /analysis/analyze");
    if (mergedInvalidCount > 0) {
      void logErrorEvent("ai", {
        companyId,
        userId: req.user?.id,
        message: `${mergedInvalidCount} malformed finding(s) stripped before DB insert`,
        inspectionId,
        context: { stage: "write_validation", endpoint: "POST /analysis/analyze" },
      });
    }

    // Recommendations contributed by this request's findings.
    const requestRecommendations = Array.from(
      new Set(
        mergedFindings
          .map((f) => f.treatment)
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0),
      ),
    );

    const row = await db.transaction(async (tx) => {
      // Serialize the read/merge/write on the inspection, across API processes.
      // READ COMMITTED gives the following SELECT the prior transaction's
      // committed row after this advisory lock is acquired.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(${companyId}::int, ${inspectionId}::int)
      `);
      const [latest] = await tx
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
      const durableSuccesses = await tx
        .select()
        .from(analysisProviderAttemptsTable)
        .where(
          and(
            eq(analysisProviderAttemptsTable.companyId, companyId),
            eq(analysisProviderAttemptsTable.inspectionId, inspectionId),
            inArray(analysisProviderAttemptsTable.state, ["provider_succeeded", "completed"]),
          ),
        );

      // Re-read after provider work: evidence may have been removed while the
      // model was running. Neither prior snapshots nor durable provider success
      // may resurrect a deleted/unregistered photo.
      const currentMedia = await tx.select().from(inspectionMediaTable).where(and(
        eq(inspectionMediaTable.companyId, companyId),
        eq(inspectionMediaTable.inspectionId, inspectionId),
        inArray(inspectionMediaTable.mediaType, ["photo", "image"]),
      ));
      const currentPhotoPaths = new Set(currentMedia.map((media) => toStoragePath(media.url)));
      const latestFindings = (latest?.findings ?? []) as Finding[];
      const combinedFindingCandidates: Finding[] = [...latestFindings, ...mergedFindings]
        .filter((finding) => !finding.imageUrl || currentPhotoPaths.has(toStoragePath(finding.imageUrl)));
      const mergedAnalyzedPaths = new Set<string>(
        [
          ...((latest?.analyzedImagePaths ?? []) as string[]),
          ...analyzedImagePaths,
        ].map(toStoragePath).filter((path) => currentPhotoPaths.has(path)),
      );
      const mergedPhotoZones: Record<string, string> = {
        ...((latest?.photoZones ?? {}) as Record<string, string>),
        ...photoZones,
      };
      for (const path of Object.keys(mergedPhotoZones)) {
        if (!currentPhotoPaths.has(toStoragePath(path))) delete mergedPhotoZones[path];
      }
      const mergedPhotoOutcomes = new Map<string, PersistedPhotoOutcome["status"]>();
      for (const outcome of (latest?.photoOutcomes ?? []) as PersistedPhotoOutcome[]) {
        const path = toStoragePath(outcome.imagePath);
        if (currentPhotoPaths.has(path)) mergedPhotoOutcomes.set(path, outcome.status);
      }
      for (const outcome of photoOutcomes) {
        const path = toStoragePath(outcome.imagePath);
        if (currentPhotoPaths.has(path)) mergedPhotoOutcomes.set(path, outcome.status);
      }

      // Include recoverable successes even if their originating request died
      // before it could build an analysis row. This also closes the earlier
      // window where independently completed provider paths were not committed
      // as one inspection snapshot.
      const durableSuccessPaths: string[] = [];
      for (const success of durableSuccesses) {
        const storagePath = toStoragePath(success.mediaPath);
        if (!currentPhotoPaths.has(storagePath)) continue;
        durableSuccessPaths.push(storagePath);
        mergedAnalyzedPaths.add(storagePath);
        mergedPhotoOutcomes.set(storagePath, "completed");
        const prediction = success.providerResult as AiPrediction | null;
        if (prediction?.zone) mergedPhotoZones[storagePath] = prediction.zone;
        const hasFindingForPath = combinedFindingCandidates.some(
          (finding) => finding.imageUrl && toStoragePath(finding.imageUrl) === storagePath,
        );
        if (prediction && !hasFindingForPath) {
          const restored = findingFromPrediction(prediction, storagePath, null, nextId++);
          if (restored) {
            const [validRestoredFindings] = validateFindings(
              [restored],
              "POST /analysis/analyze durable provider recovery",
            );
            combinedFindingCandidates.push(...validRestoredFindings);
          }
        }
      }

      // Merge request-specific technician evidence with the latest committed
      // inspection evidence, removing only exact duplicates (identity excludes
      // transient display IDs). Reassign IDs after the deterministic merge.
      const mergedFindingKeys = new Set<string>();
      const finalFindings: Finding[] = [];
      for (const finding of combinedFindingCandidates) {
        const { id: _id, ...identity } = finding;
        const key = JSON.stringify(
          stableCanonicalize({
            ...identity,
            imageUrl: finding.imageUrl ? toStoragePath(finding.imageUrl) : null,
          }),
        );
        if (mergedFindingKeys.has(key)) continue;
        mergedFindingKeys.add(key);
        finalFindings.push({ ...finding, id: finalFindings.length + 1 });
      }

      const finalPhotoOutcomes: PersistedPhotoOutcome[] = Array.from(
        mergedPhotoOutcomes,
        ([imagePath, outcomeStatus]) => ({ imagePath, status: outcomeStatus }),
      );
      const completedPhotoCount = finalPhotoOutcomes.filter(
        (photo) => photo.status === "completed",
      ).length;
      const unsuccessfulPhotoCount = finalPhotoOutcomes.length - completedPhotoCount;
      const finalStatus =
        finalPhotoOutcomes.length === 0 || unsuccessfulPhotoCount === 0
          ? "complete"
          : completedPhotoCount === 0
            ? "failed"
            : "partial";
      const finalAnalysisErrors = unsuccessfulPhotoCount;
      const finalRecommendations = Array.from(
        new Set([
          ...((latest?.recommendations ?? []) as string[]),
          ...requestRecommendations,
          ...finalFindings
            .map((finding) => finding.treatment)
            .filter((treatment): treatment is string =>
              typeof treatment === "string" && treatment.trim().length > 0,
            ),
        ]),
      );
      const finalOverallConfidence =
        finalFindings.length > 0
          ? finalFindings.reduce((sum, finding) => sum + (finding.confidence ?? 0), 0) /
            finalFindings.length
          : 0;
      const finalRiskLevel = finalFindings.some((finding) => finding.severity === "high")
        ? "high"
        : finalFindings.some((finding) => finding.severity === "medium")
          ? "medium"
          : finalFindings.length > 0
            ? "low"
            : null;
      const coveredZoneSlugs = [
        ...Object.values(mergedPhotoZones),
        ...finalFindings.flatMap((finding) => zonesFromFinding(finding)),
      ];
      const finalCoverage = computeCoverage({
        propertyType: derivePropertyType(inspection.notes),
        pestTypes: (inspection.pestTypes ?? []) as string[],
        coveredZoneSlugs,
      });
      const finalVideoEvidence = Array.from(
        new Map(
          [
            ...((latest?.videoEvidence ?? []) as VideoEvidence[]),
            ...videoEvidence,
          ].map((video) => [
            JSON.stringify(stableCanonicalize(video)),
            video,
          ]),
        ).values(),
      );
      const finalFailureReason =
        finalPhotoOutcomes.length > 0 && completedPhotoCount === 0
          ? "Photos could not be processed by the AI analysis service. This is usually a temporary issue — retrying the inspection sync should resolve it."
          : null;

      const [inserted] = await tx
        .insert(analysisResultsTable)
        .values({
          companyId,
          inspectionId,
          status: finalStatus,
          findings: finalFindings,
          recommendations: finalRecommendations,
          videoEvidence: finalVideoEvidence,
          analyzedImagePaths: Array.from(mergedAnalyzedPaths),
          photoZones: mergedPhotoZones,
          coverage: finalCoverage,
          overallConfidence: finalOverallConfidence,
          riskLevel: finalRiskLevel,
          photoOutcomes: finalPhotoOutcomes,
          // Persist the failure count so GET endpoints can surface it to the
          // summary screen without relying on the ephemeral POST response.
          analysisErrors: finalAnalysisErrors,
          failureReason: finalFailureReason,
        })
        .returning();

      if (!inserted) throw new Error("Failed to persist analysis result");
      await appendProcessingMilestone(tx, {
        companyId, inspectionId, eventType: "analysis.result_saved",
        sourceType: "analysis_results", sourceId: inserted.id,
        actor: "system:analysis", occurredAt: inserted.createdAt,
      });
      // The analysis row and terminal guard state commit together. If insertion
      // fails or the transaction rolls back, provider_succeeded remains
      // recoverable and the next request can persist the stored assessment.
      if (durableSuccessPaths.length > 0) {
        await tx
          .update(analysisProviderAttemptsTable)
          .set({
            state: "completed",
            leaseUntil: null,
            leaseToken: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(analysisProviderAttemptsTable.companyId, companyId),
              eq(analysisProviderAttemptsTable.inspectionId, inspectionId),
              eq(analysisProviderAttemptsTable.state, "provider_succeeded"),
              inArray(
                analysisProviderAttemptsTable.mediaPath,
                durableSuccessPaths,
              ),
            ),
          );
      }
      return inserted;
    });

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
        findings: (row.findings ?? []) as Finding[],
      });

      // Inspection Scorecard: deterministic quality/missed-opportunity/risk
      // snapshot for management. Same fire-and-forget contract.
      void runScorecardComputation({
        companyId,
        inspectionId,
        findings: (row.findings ?? []) as Finding[],
        recommendations: (row.recommendations ?? []) as string[],
        photosAnalyzed: (row.analyzedImagePaths ?? []).length,
      });

    }

    // Inspection Memory: compare this run against prior visits at the same
    // address so the returned guidance can be memory-driven immediately (the
    // mobile live flow re-runs analyze after every few captures and shows the new
    // guidance with no refresh).
    const memory = computeInspectionMemory(await loadPriorVisits(companyId, inspection), row);

    return res.status(201).json({
      ...serializeResult(row, memory),
      analysisErrors: row.analysisErrors ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "[analysis] Inspection analysis request failed");
    void logErrorEvent("ai", {
      companyId: req.user?.companyId ?? 0,
      userId: req.user?.id,
      message: "Inspection analysis request failed",
      context: { stage: "analyze_route" },
    });
    return res.status(500).json({ error: "Failed to analyze inspection" });
  } finally {
    // Normally the wrapped json() settles the shared promise. If an
    // unexpected throw happens before any response is reached, reject it so
    // simultaneous callers cannot wait forever; the rejection handler also
    // removes the key from the process-local map.
    if (sharedPromise && !sharedSettled) {
      rejectShared?.(new Error("Inspection analysis did not produce a response"));
    }
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
    const { findingId, action, technicianSpecies, updateStrategy: rawUpdateStrategy, notes } = req.body as {
      findingId?: number;
      action?: "accept" | "correct" | "dismiss";
      technicianSpecies?: string;
      updateStrategy?: "keep_existing" | "ai_regenerate";
      notes?: string;
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
    const updateStrategy = rawUpdateStrategy ?? "keep_existing";
    if (!["keep_existing", "ai_regenerate"].includes(updateStrategy)) {
      return res.status(400).json({ error: "updateStrategy must be keep_existing or ai_regenerate" });
    }
    if (action !== "correct" && updateStrategy !== "keep_existing") {
      return res.status(400).json({ error: "updateStrategy only applies when action is correct" });
    }
    if (notes !== undefined && typeof notes !== "string") {
      return res.status(400).json({ error: "notes must be a string" });
    }
    if (typeof notes === "string" && notes.length > 1000) {
      return res.status(400).json({ error: "notes must be 1000 characters or fewer" });
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
    const correctionNotes = typeof notes === "string" ? notes.trim() : "";
    const regenerated =
      action === "correct" && updateStrategy === "ai_regenerate"
        ? await regenerateFindingAfterTechnicianCorrection({
            category: findings[idx].category,
            description: findings[idx].description,
            treatment: findings[idx].treatment,
            location: findings[idx].location,
            correctedSpecies: technicianSpecies!.trim(),
            technicianNotes: correctionNotes || null,
          })
        : null;
    if (action === "correct" && updateStrategy === "ai_regenerate" && !regenerated) {
      return res.status(502).json({
        error: "Could not regenerate the corrected finding. Please try again.",
      });
    }

    const updatedFinding: Finding = {
      ...findings[idx],
      reviewStatus,
      technicianSpecies:
        action === "correct"
          ? (technicianSpecies?.trim() ?? null)
          : (findings[idx].technicianSpecies ?? null),
      technicianCorrectionNotes:
        action === "correct"
          ? (correctionNotes || null)
          : (findings[idx].technicianCorrectionNotes ?? null),
      description: regenerated?.description ?? findings[idx].description,
      treatment: regenerated ? regenerated.treatment : findings[idx].treatment,
    };
    const rawUpdatedFindings = [
      ...findings.slice(0, idx),
      updatedFinding,
      ...findings.slice(idx + 1),
    ];

    // Apply the same write-boundary guard used by POST /analysis so that
    // pre-existing invalid findings (stored before validation was added) are
    // stripped and a structurally invalid correction payload can never reach
    // the database.
    const [updatedFindings] = validateFindings(
      rawUpdatedFindings,
      "PATCH /analysis/:id/findings/correct",
    );

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
          imageUrl: f.imageUrl as string,
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
          correctiveAction: updatedFinding.treatment ?? null,
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
