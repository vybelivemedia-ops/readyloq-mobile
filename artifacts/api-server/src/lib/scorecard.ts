import {
  db,
  inspectionsTable,
  inspectionScorecardsTable,
  type Finding,
  type ScorecardComponents,
  type MissedOpportunity,
  type ScorecardRiskLevel,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { deriveOppType, isDocumented, OPP_LABEL } from "./finding-mapping";
import { logErrorEvent } from "./error-events";

/**
 * Inspection Scorecard engine — the management lens over each analysis run.
 *
 * 100% deterministic: every number here is arithmetic over stored verified
 * findings. NO AI is involved anywhere in this file, so the same inputs
 * always produce the same scorecard (reproducible coaching data, immune to
 * model drift).
 *
 * Runs fire-and-forget after each analysis run (see routes/analysis.ts),
 * exactly like opportunity synthesis: failures log and are swallowed — the
 * technician's flow is never disturbed.
 */

/** Photos at/above this count earn full photo-coverage credit. */
const PHOTO_BASELINE = 8;

const SEVERITY_RISK_WEIGHT: Record<string, number> = {
  high: 25,
  medium: 10,
  low: 3,
};

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface ScorecardResult {
  qualityScore: number;
  components: ScorecardComponents;
  missedOpportunities: MissedOpportunity[];
  riskScore: number;
  riskLevel: ScorecardRiskLevel;
}

/**
 * Pure computation — exported separately so tests can verify determinism
 * without touching the database.
 */
export function computeScorecard(input: {
  findings: Finding[];
  recommendations: string[];
  photosAnalyzed: number;
}): ScorecardResult {
  const { findings, recommendations, photosAnalyzed } = input;

  const photoCoverage = clamp100((photosAnalyzed / PHOTO_BASELINE) * 100);

  // A clean inspection (photos taken, nothing found) is GOOD work, not a
  // zero: evidence/confidence/coverage default to full credit when there are
  // no findings but photos were captured.
  const hasFindings = findings.length > 0;
  const cleanCredit = photosAnalyzed > 0 ? 100 : 0;

  const evidenceQuality = hasFindings
    ? clamp100(
        (findings.filter((f) => typeof f.imageUrl === "string" && f.imageUrl.length > 0).length /
          findings.length) *
          100,
      )
    : cleanCredit;

  const avgConfidence = hasFindings
    ? clamp100(
        (findings.reduce((s, f) => s + (f.confidence ?? 0), 0) / findings.length) * 100,
      )
    : cleanCredit;

  // Missed opportunities: findings that map to a service type where NO
  // matching recommendation was documented (same deterministic keyword
  // mapping the management intelligence view uses).
  const missedOpportunities: MissedOpportunity[] = [];
  let mappedCount = 0;
  for (const f of findings) {
    const type = deriveOppType(f);
    if (!type) continue;
    mappedCount += 1;
    if (!isDocumented(type, recommendations)) {
      missedOpportunities.push({
        findingId: f.id,
        serviceType: OPP_LABEL[type],
        description: f.description,
        severity: f.severity,
      });
    }
  }
  const recommendationCoverage =
    mappedCount === 0
      ? hasFindings
        ? 100
        : cleanCredit
      : clamp100(((mappedCount - missedOpportunities.length) / mappedCount) * 100);

  const components: ScorecardComponents = {
    photoCoverage,
    evidenceQuality,
    avgConfidence,
    recommendationCoverage,
  };
  const qualityScore = clamp100(
    (photoCoverage + evidenceQuality + avgConfidence + recommendationCoverage) / 4,
  );

  // Risk snapshot: severity-weighted sum, frozen at computation time. Bands
  // match the company-wide analytics risk bands.
  const riskScore = Math.min(
    100,
    findings.reduce((s, f) => s + (SEVERITY_RISK_WEIGHT[f.severity] ?? 0), 0),
  );
  const riskLevel: ScorecardRiskLevel =
    riskScore >= 60 ? "critical" : riskScore >= 40 ? "high" : riskScore >= 20 ? "medium" : "low";

  return { qualityScore, components, missedOpportunities, riskScore, riskLevel };
}

/**
 * Entry point. Call fire-and-forget (`void runScorecardComputation(...)`)
 * after an analysis run persists — never awaited on the technician's path.
 * Upserts: re-analysis refreshes the inspection's single scorecard row.
 */
export async function runScorecardComputation(input: {
  companyId: number;
  inspectionId: number;
  findings: Finding[];
  recommendations: string[];
  photosAnalyzed: number;
}): Promise<void> {
  const { companyId, inspectionId } = input;
  try {
    const [inspection] = await db
      .select({ technicianName: inspectionsTable.technicianName })
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      )
      .limit(1);
    if (!inspection) return;

    const result = computeScorecard(input);

    await db
      .insert(inspectionScorecardsTable)
      .values({
        companyId,
        inspectionId,
        technicianName: inspection.technicianName,
        qualityScore: result.qualityScore,
        components: result.components,
        missedOpportunities: result.missedOpportunities,
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        findingsCount: input.findings.length,
        photosAnalyzed: input.photosAnalyzed,
      })
      .onConflictDoUpdate({
        target: inspectionScorecardsTable.inspectionId,
        set: {
          technicianName: inspection.technicianName,
          qualityScore: result.qualityScore,
          components: result.components,
          missedOpportunities: result.missedOpportunities,
          riskScore: result.riskScore,
          riskLevel: result.riskLevel,
          findingsCount: input.findings.length,
          photosAnalyzed: input.photosAnalyzed,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Never let scorecard computation disturb the inspection flow.
    void logErrorEvent("ai", {
      companyId,
      message: "Scorecard computation failed",
      context: { stage: "scorecard", inspectionId },
    });
  }
}
