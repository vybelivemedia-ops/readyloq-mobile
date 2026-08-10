/**
 * Daily Executive Briefing Service
 *
 * Aggregates yesterday's telemetry (completed inspections + risk counts +
 * new pipeline value) into a structured narrative digest for owners / VPs.
 *
 * NOTE: riskLevel lives on inspectionScorecardsTable, not inspectionReportsTable.
 *       companyId is always an integer throughout the schema.
 */
import {
  db,
  inspectionScorecardsTable,
  inspectionsTable,
  opportunitiesTable,
} from "@workspace/db";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";

export interface DailyBriefingPayload {
  date: string;
  summary: string;
  inspectionsCount: number;
  criticalRiskCount: number;
  newOpportunities: number;
  pipelineAdded: number;
  recommendation: string;
}

export async function generateDailyExecutiveBriefing(
  companyId: number,
  targetDate: Date,
): Promise<{ success: true; briefing: DailyBriefingPayload }> {
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // ── 1. Yesterday's completed inspections ──────────────────────────────────
  const [inspectionRow] = await db
    .select({ totalInspections: count(inspectionsTable.id) })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.status, "completed"),
        gte(inspectionsTable.createdAt, startOfDay),
        lt(inspectionsTable.createdAt, endOfDay),
      ),
    );

  // ── 2. Critical-risk count from scorecards (joined on completion date) ────
  const [riskRow] = await db
    .select({
      criticalRisks: sql<number>`
        sum(case when ${inspectionScorecardsTable.riskLevel} = 'critical' then 1 else 0 end)
      `,
    })
    .from(inspectionScorecardsTable)
    .innerJoin(
      inspectionsTable,
      eq(inspectionsTable.id, inspectionScorecardsTable.inspectionId),
    )
    .where(
      and(
        eq(inspectionScorecardsTable.companyId, companyId),
        gte(inspectionsTable.createdAt, startOfDay),
        lt(inspectionsTable.createdAt, endOfDay),
      ),
    );

  // ── 3. New opportunities created yesterday ────────────────────────────────
  const [oppRow] = await db
    .select({
      newPipelineValue: sql<number>`coalesce(sum(${opportunitiesTable.estimatedAnnualValue}), 0)`,
      newOpportunities: count(opportunitiesTable.id),
    })
    .from(opportunitiesTable)
    .where(
      and(
        eq(opportunitiesTable.companyId, companyId),
        gte(opportunitiesTable.createdAt, startOfDay),
        lt(opportunitiesTable.createdAt, endOfDay),
      ),
    );

  // ── 4. Synthesise ─────────────────────────────────────────────────────────
  const totalInspections = Number(inspectionRow?.totalInspections ?? 0);
  const criticalRisks = Number(riskRow?.criticalRisks ?? 0);
  const newPipelineValue = Number(oppRow?.newPipelineValue ?? 0);
  const newOpportunities = Number(oppRow?.newOpportunities ?? 0);

  const inspectionWord = totalInspections === 1 ? "inspection" : "inspections";
  const alertPhrase =
    criticalRisks > 0
      ? ` with ${criticalRisks} critical risk alert${criticalRisks === 1 ? "" : "s"} flagged`
      : " with no critical risk alerts";

  const briefing: DailyBriefingPayload = {
    date: targetDate.toISOString().split("T")[0],
    summary: `Yesterday your team completed ${totalInspections} ${inspectionWord}${alertPhrase}. New pipeline value added: $${newPipelineValue.toLocaleString()}.`,
    inspectionsCount: totalInspections,
    criticalRiskCount: criticalRisks,
    newOpportunities,
    pipelineAdded: newPipelineValue,
    recommendation:
      criticalRisks > 0
        ? "Prioritize reviewing the critical-risk sites flagged by Quinn before the day begins."
        : "Operations ran within normal quality thresholds — no critical compliance violations yesterday.",
  };

  return { success: true, briefing };
}
