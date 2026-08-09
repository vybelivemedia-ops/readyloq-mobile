import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  inspectionsTable,
  analysisResultsTable,
  opportunitiesTable,
  opportunityEventsTable,
  opportunitySettingsTable,
  OPPORTUNITY_CATEGORIES,
  type Finding,
  type Opportunity,
  type OpportunityCategory,
  type OpportunitySettings,
  type OpportunityValueTier,
} from "@workspace/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { logErrorEvent } from "./error-events";
import { calculateEstimatedAnnualValue } from "./pricing";
import type { OpportunityRiskLevel } from "@workspace/db";

/**
 * Opportunity Intelligence — background synthesis engine.
 *
 * Runs fire-and-forget after each analysis run (see routes/analysis.ts). It
 * mines VERIFIED findings for business opportunities and writes them to the
 * hidden Opportunity Log. Technicians never see any of this: a synthesis
 * failure is logged and swallowed, and the analyze response is never widened.
 *
 * No fabrication:
 * - Every candidate must cite finding IDs from THIS run's findings; candidates
 *   whose IDs don't resolve to real findings are rejected before insert.
 * - Value is a tier (low/medium/high), never an invented dollar figure.
 * - Pest-trend context handed to the model is computed deterministically from
 *   stored findings (SQL aggregation), not generated.
 * - Below the company's confidence threshold → discarded.
 *
 * Dedupe: candidates are fingerprinted (category + normalized title). A match
 * against an OPEN opportunity at the same address strengthens it (merged
 * evidence, max confidence) instead of duplicating it.
 */

const MODEL = "gpt-5.4";

const OPEN_STATUSES = ["new", "reviewed", "quoted"] as const;

const VALUE_TIERS: OpportunityValueTier[] = ["low", "medium", "high"];

const SYSTEM_PROMPT =
  "You are a pest-control operations analyst reviewing VERIFIED inspection findings " +
  "to identify legitimate business opportunities for the service company. You only " +
  "work from the evidence provided — you never invent problems, never exaggerate, and " +
  "never estimate prices. Every opportunity you propose must cite the specific finding " +
  "IDs that justify it. If the evidence supports no opportunities, return an empty list. " +
  "Respond with a single JSON object only.";

interface CandidateOpportunity {
  category: OpportunityCategory;
  title: string;
  rationale: string;
  evidenceFindingIds: number[];
  estimatedValueTier: OpportunityValueTier;
  confidence: number;
}

/**
 * Deterministic risk level from the CURRENTLY cited findings (pure math, the
 * AI never sets risk): worst severity wins; 2+ high-severity findings =
 * critical.
 */
export function computeOpportunityRisk(cited: Finding[]): OpportunityRiskLevel {
  const highs = cited.filter((f) => f.severity === "high").length;
  if (highs >= 2) return "critical";
  if (highs === 1) return "high";
  if (cited.some((f) => f.severity === "medium")) return "medium";
  return "low";
}

const SEVERITY_PRIORITY_WEIGHT: Record<string, number> = {
  high: 1,
  medium: 0.6,
  low: 0.3,
};

/**
 * Deterministic management priority 0–100. The AI never ranks its own output
 * — that would let it promote its weakest ideas. Weights: severity 35% /
 * confidence 25% / value tier 25% / recurrence 15% (full recurrence weight
 * once the opportunity has evidence from 2+ analysis runs).
 */
export function computeOpportunityPriority(input: {
  cited: Finding[];
  confidence: number;
  tier: OpportunityValueTier;
  occurrences: number;
}): number {
  const severity = input.cited.reduce(
    (max, f) => Math.max(max, SEVERITY_PRIORITY_WEIGHT[f.severity] ?? 0),
    0,
  );
  const tierWeight = input.tier === "high" ? 1 : input.tier === "medium" ? 2 / 3 : 1 / 3;
  const recurrence = input.occurrences >= 2 ? 1 : 0;
  const score =
    100 *
    (0.35 * severity +
      0.25 * clampConfidence(input.confidence) +
      0.25 * tierWeight +
      0.15 * recurrence);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function opportunityFingerprint(category: string, title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return `${category}|${normalized}`;
}

async function getSettings(companyId: number): Promise<OpportunitySettings> {
  const [existing] = await db
    .select()
    .from(opportunitySettingsTable)
    .where(eq(opportunitySettingsTable.companyId, companyId))
    .limit(1);
  if (existing) return existing;
  return {
    id: 0,
    companyId,
    enabled: true,
    minConfidence: 0.5,
    enabledCategories: null,
    updatedAt: new Date(),
  };
}

/**
 * Deterministic pest-trend context: species occurrence counts across all
 * stored findings at this property (SQL/JS aggregation over real rows — the
 * model receives math, not vibes).
 */
async function propertySpeciesTrend(
  companyId: number,
  siteAddress: string,
): Promise<{ species: string; occurrences: number; inspections: number }[]> {
  const inspections = await db
    .select({ id: inspectionsTable.id })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.siteAddress, siteAddress),
      ),
    );
  const ids = inspections.map((i) => i.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      inspectionId: analysisResultsTable.inspectionId,
      findings: analysisResultsTable.findings,
    })
    .from(analysisResultsTable)
    .where(
      and(
        eq(analysisResultsTable.companyId, companyId),
        inArray(analysisResultsTable.inspectionId, ids),
      ),
    )
    .orderBy(desc(analysisResultsTable.createdAt))
    .limit(50);
  // Latest analysis run per inspection only — reruns of the same inspection
  // must not double-count the same evidence as a "trend".
  const seen = new Set<number>();
  const counts = new Map<string, { occurrences: number; inspections: Set<number> }>();
  for (const row of rows) {
    if (seen.has(row.inspectionId)) continue;
    seen.add(row.inspectionId);
    for (const f of row.findings ?? []) {
      const species = (f.species ?? "").trim().toLowerCase();
      if (!species) continue;
      const entry = counts.get(species) ?? { occurrences: 0, inspections: new Set<number>() };
      entry.occurrences += 1;
      entry.inspections.add(row.inspectionId);
      counts.set(species, entry);
    }
  }
  return Array.from(counts.entries())
    .map(([species, v]) => ({
      species,
      occurrences: v.occurrences,
      inspections: v.inspections.size,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 10);
}

function findingsForPrompt(findings: Finding[]) {
  return findings.map((f) => ({
    id: f.id,
    category: f.category,
    description: f.description,
    severity: f.severity,
    confidence: f.confidence,
    species: f.species ?? null,
    lifeStage: f.lifeStage ?? null,
    conduciveCondition: f.conduciveCondition ?? null,
    harborage: f.harborage ?? null,
    moisture: f.moisture ?? null,
    structuralIssue: f.structuralIssue ?? null,
    treatment: f.treatment ?? null,
  }));
}

function userPrompt(input: {
  findings: Finding[];
  openOpportunities: Opportunity[];
  trend: { species: string; occurrences: number; inspections: number }[];
}): string {
  return [
    "VERIFIED FINDINGS from the latest inspection analysis run (the ONLY evidence you may use):",
    JSON.stringify(findingsForPrompt(input.findings)),
    "",
    "OPEN OPPORTUNITIES already logged at this property (do NOT re-propose these; if new",
    "evidence supports one of them, simply skip it — the system strengthens matches automatically):",
    JSON.stringify(
      input.openOpportunities.map((o) => ({ category: o.category, title: o.title })),
    ),
    "",
    "PROPERTY PEST TREND (deterministic counts from stored findings across past inspections):",
    JSON.stringify(input.trend),
    "",
    "Identify business opportunities for the pest-control company. Categories (use exact strings):",
    '- "revenue": clear paid-work opportunity evidenced by the findings',
    '- "additional_service": a service line beyond the current job (e.g. exclusion work, sanitation program)',
    '- "structural": structural deficiency repair evidenced by a structuralIssue finding',
    '- "conducive_condition": correction of a conducive condition evidenced by findings',
    '- "property_risk": a documented risk to the property worth escalating',
    '- "pest_trend": recurring pattern supported by the PROPERTY PEST TREND data above',
    '- "preventative": preventative maintenance opportunity evidenced by findings',
    "",
    'Return a JSON object: { "opportunities": [ ... ] } where each item has EXACTLY:',
    '- "category": one category string from the list above',
    '- "title": short specific label (max 80 chars), e.g. "Crawl-space moisture remediation"',
    '- "rationale": 1-2 plain-language sentences explaining the business case, grounded in the cited findings',
    '- "evidenceFindingIds": non-empty array of finding IDs from VERIFIED FINDINGS that justify it',
    '- "estimatedValueTier": "low", "medium", or "high" — relative job size, NEVER a dollar amount',
    '- "confidence": 0 to 1 — how strongly the cited evidence supports this opportunity',
    "",
    "Rules:",
    "- Every opportunity MUST cite at least one finding ID from the list above.",
    "- pest_trend opportunities MUST be supported by the trend data (2+ inspections).",
    "- Do not propose an opportunity the evidence does not support. An empty list is a good answer.",
    "- Never mention prices, dollar amounts, or quotes in title or rationale.",
  ].join("\n");
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Parse + ground the model output. Anything that fails validation is dropped
 * silently — a rejected candidate simply doesn't exist.
 *
 * Exported for unit-testing the fallback tier / grounding logic without
 * needing a live DB or OpenAI call.
 */
export function parseCandidates(raw: string, validFindingIds: Set<number>): CandidateOpportunity[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { opportunities?: unknown })?.opportunities;
  if (!Array.isArray(list)) return [];
  const out: CandidateOpportunity[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const category = typeof o.category === "string" ? o.category : "";
    if (!OPPORTUNITY_CATEGORIES.includes(category as OpportunityCategory)) continue;
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
    const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
    if (!title || !rationale) continue;
    // Belt-and-braces anti-fabrication: value must be a tier, so any dollar
    // figure in the text is invented pricing. Reject, don't strip — a
    // candidate built around a fabricated number isn't trustworthy.
    if (/\$\s*\d|\d+\s*(?:dollars|usd)\b/i.test(`${title} ${rationale}`)) continue;
    // Apply a "medium" fallback when the AI omits or returns an unrecognised
    // tier — this ensures calculateEstimatedAnnualValue is always called on
    // insert and estimatedAnnualValue is never left null (which would cause
    // pipeline totals to show $0).
    const rawTier = typeof o.estimatedValueTier === "string" ? o.estimatedValueTier : "";
    const tier: OpportunityValueTier = VALUE_TIERS.includes(rawTier as OpportunityValueTier)
      ? (rawTier as OpportunityValueTier)
      : "medium";
    // Grounding gate: only IDs that resolve to real findings from this run
    // survive; a candidate left with no verified evidence is rejected.
    const evidenceFindingIds = Array.isArray(o.evidenceFindingIds)
      ? o.evidenceFindingIds
          .filter((id): id is number => typeof id === "number" && validFindingIds.has(id))
      : [];
    if (evidenceFindingIds.length === 0) continue;
    out.push({
      category: category as OpportunityCategory,
      title,
      rationale,
      evidenceFindingIds: Array.from(new Set(evidenceFindingIds)),
      estimatedValueTier: tier as OpportunityValueTier,
      confidence: clampConfidence(o.confidence),
    });
  }
  return out;
}

/** One-shot async sleep used by the synthesis retry path. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt the AI completion once. On network/rate-limit error, wait
 * RETRY_DELAY_MS and try once more. Throws on the second failure so the
 * caller can log it distinctly from "AI returned an empty list".
 */
async function callAiWithRetry(
  messages: Parameters<typeof openai.chat.completions.create>[0]["messages"],
): Promise<string | null> {
  const RETRY_DELAY_MS = 1_500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages,
      });
      return completion.choices[0]?.message?.content ?? null;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        console.warn(
          `[opportunity-synthesis] AI call failed on attempt 1, retrying in ${RETRY_DELAY_MS}ms:`,
          err instanceof Error ? err.message : String(err),
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

/**
 * Core synthesis logic. Throws on any failure (AI call, DB error, etc.) so
 * callers that need to surface failures — such as batch catch-up endpoints —
 * can count and report them accurately.
 *
 * The fire-and-forget wrapper `runOpportunitySynthesis` below catches and logs
 * these throws so they never disturb the inspection path.
 */
export async function runOpportunitySynthesisCore(input: {
  companyId: number;
  inspectionId: number;
  findings: Finding[];
}): Promise<void> {
  const { companyId, inspectionId, findings } = input;

  if (findings.length === 0) return;

  const settings = await getSettings(companyId);
  if (!settings.enabled) return;

  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
    )
    .limit(1);
  if (!inspection) return;
  const siteAddress = inspection.siteAddress;

  const [openOpportunities, trend] = await Promise.all([
    db
      .select()
      .from(opportunitiesTable)
      .where(
        and(
          eq(opportunitiesTable.companyId, companyId),
          eq(opportunitiesTable.propertyAddress, siteAddress),
          inArray(opportunitiesTable.status, [...OPEN_STATUSES]),
        ),
      ),
    propertySpeciesTrend(companyId, siteAddress),
  ]);

  // callAiWithRetry throws on both-attempt failure — the throw propagates to
  // the caller so batch endpoints can count it as a real failure.
  const raw = await callAiWithRetry([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt({ findings, openOpportunities, trend }) },
  ]);
  if (!raw) {
    console.info(
      `[opportunity-synthesis] AI returned empty content — no opportunities written`,
      { companyId, inspectionId },
    );
    return;
  }

  const validIds = new Set(findings.map((f) => f.id));
  let candidates = parseCandidates(raw, validIds);

  // Company tuning: confidence threshold + category allow-list.
  candidates = candidates.filter((c) => c.confidence >= settings.minConfidence);
  if (settings.enabledCategories) {
    const allowed = new Set(settings.enabledCategories);
    candidates = candidates.filter((c) => allowed.has(c.category));
  }
  if (candidates.length === 0) {
    console.info(
      `[opportunity-synthesis] AI returned ${parseCandidates(raw, validIds).length} candidate(s) before filtering, 0 after threshold/category filter — no opportunities written`,
      { companyId, inspectionId, minConfidence: settings.minConfidence },
    );
    return;
  }

  const findingById = new Map(findings.map((f) => [f.id, f]));
  const openByFingerprint = new Map(
    openOpportunities.map((o) => [o.fingerprint, o] as const),
  );

  for (const candidate of candidates) {
    const fingerprint = opportunityFingerprint(candidate.category, candidate.title);
    const evidenceImagePaths = Array.from(
      new Set(
        candidate.evidenceFindingIds
          .map((id) => findingById.get(id)?.imageUrl)
          .filter((u): u is string => typeof u === "string" && u.length > 0),
      ),
    );
    const citedFindings = candidate.evidenceFindingIds
      .map((id) => findingById.get(id))
      .filter((f): f is Finding => f !== undefined);
    const strengthen = async (existing: Opportunity) => {
      // Strengthen: the row's evidence is REPLACED with this run's findings
      // so evidenceFindingIds always resolves against the row's (updated)
      // inspectionId — finding IDs are run-local, so merging IDs across
      // runs would corrupt the trail. Prior evidence stays resolvable in
      // the immutable event history ({inspectionId, findingIds} per event).
      // Image paths ARE merged: they're globally unique storage paths.
      const mergedPaths = Array.from(
        new Set([...existing.evidenceImagePaths, ...evidenceImagePaths]),
      );
      // Recurrence for priority: 1 (original run) + prior strengthens + this
      // one — deterministic count over the immutable event history.
      const [strengthenCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunityEventsTable)
        .where(
          and(
            eq(opportunityEventsTable.companyId, companyId),
            eq(opportunityEventsTable.opportunityId, existing.id),
            eq(opportunityEventsTable.action, "strengthened"),
          ),
        );
      const occurrences = 2 + (strengthenCount?.count ?? 0);
      const newConfidence = Math.max(existing.confidence, candidate.confidence);
      const [updated] = await db
        .update(opportunitiesTable)
        .set({
          evidenceFindingIds: candidate.evidenceFindingIds,
          evidenceImagePaths: mergedPaths,
          confidence: newConfidence,
          rationale: candidate.rationale,
          // Recomputed from the NEW run's cited findings (old IDs are
          // run-local and unresolvable). Tier is never updated on
          // strengthen, so the tier weight stays at the original tier.
          riskLevel: computeOpportunityRisk(citedFindings),
          priority: computeOpportunityPriority({
            cited: citedFindings,
            confidence: newConfidence,
            tier: existing.estimatedValueTier,
            occurrences,
          }),
          inspectionId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(opportunitiesTable.id, existing.id),
            eq(opportunitiesTable.companyId, companyId),
          ),
        )
        .returning();
      if (updated) {
        openByFingerprint.set(fingerprint, updated);
        await db.insert(opportunityEventsTable).values({
          companyId,
          opportunityId: existing.id,
          userId: null,
          action: "strengthened",
          detail: { inspectionId, findingIds: candidate.evidenceFindingIds },
        });
      }
    };

    const existing = openByFingerprint.get(fingerprint);
    if (existing) {
      await strengthen(existing);
      continue;
    }

    try {
      const opportunityRisk = computeOpportunityRisk(citedFindings);
      const [created] = await db
        .insert(opportunitiesTable)
        .values({
          companyId,
          inspectionId,
          propertyAddress: siteAddress,
          category: candidate.category,
          title: candidate.title,
          rationale: candidate.rationale,
          fingerprint,
          evidenceFindingIds: candidate.evidenceFindingIds,
          evidenceImagePaths,
          estimatedValueTier: candidate.estimatedValueTier,
          estimatedAnnualValue: calculateEstimatedAnnualValue({
            // siteAddress often embeds facility type (e.g. "Montague Restaurant",
            // "Wortman Apts", "Medical Plaza") — keyword matching covers most cases.
            propertyType: inspection.siteAddress,
            tier: candidate.estimatedValueTier,
            riskLevel: opportunityRisk,
          }),
          confidence: candidate.confidence,
          riskLevel: opportunityRisk,
          priority: computeOpportunityPriority({
            cited: citedFindings,
            confidence: candidate.confidence,
            tier: candidate.estimatedValueTier,
            occurrences: 1,
          }),
          status: "new",
        })
        .returning();
      if (created) {
        openByFingerprint.set(fingerprint, created);
        await db.insert(opportunityEventsTable).values({
          companyId,
          opportunityId: created.id,
          userId: null,
          action: "created",
          detail: { inspectionId, findingIds: candidate.evidenceFindingIds },
        });
      }
    } catch (insertErr) {
      // Unique violation on opportunities_open_fingerprint_idx: a concurrent
      // run inserted the same open opportunity between our read and this
      // insert. Re-read the winner and strengthen it instead.
      const isUniqueViolation =
        typeof insertErr === "object" &&
        insertErr !== null &&
        (insertErr as { code?: string }).code === "23505";
      const cause = (insertErr as { cause?: { code?: string } })?.cause;
      if (!isUniqueViolation && cause?.code !== "23505") throw insertErr;
      const [winner] = await db
        .select()
        .from(opportunitiesTable)
        .where(
          and(
            eq(opportunitiesTable.companyId, companyId),
            eq(opportunitiesTable.propertyAddress, siteAddress),
            eq(opportunitiesTable.fingerprint, fingerprint),
            inArray(opportunitiesTable.status, [...OPEN_STATUSES]),
          ),
        )
        .limit(1);
      if (winner) await strengthen(winner);
    }
  }
}

/**
 * Fire-and-forget wrapper. Call as `void runOpportunitySynthesis(...)` after
 * an analysis run persists — never awaited on the technician's path. Catches
 * all errors from `runOpportunitySynthesisCore` and logs them without
 * propagating, so a synthesis failure never disturbs the inspection response.
 *
 * For batch/catch-up paths that need to surface real failures, call
 * `runOpportunitySynthesisCore` directly instead.
 */
export async function runOpportunitySynthesis(input: {
  companyId: number;
  inspectionId: number;
  findings: Finding[];
}): Promise<void> {
  const { companyId, inspectionId } = input;
  try {
    await runOpportunitySynthesisCore(input);
  } catch (err) {
    // Never let opportunity mining disturb the inspection flow.
    // Log with enough detail to distinguish an AI call error from a DB/parse
    // error, and surface the error message so ops can triage without a stack
    // trace hunt.
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[opportunity-synthesis] ERROR — synthesis failed for inspectionId=${inspectionId} companyId=${companyId}: ${errMessage}`,
    );
    void logErrorEvent("ai", {
      companyId,
      message: "Opportunity synthesis failed",
      context: { stage: "opportunity_synthesis", inspectionId, error: errMessage },
    });
  }
}
