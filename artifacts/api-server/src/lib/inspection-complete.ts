import {
  db,
  inspectionsTable,
  analysisResultsTable,
  reportsTable,
  customerSummariesTable,
  inspectionMediaTable,
  inspectionScorecardsTable,
  type Finding,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateReportNarrative, derivePropertyType } from "./report-narrative-ai";
import { generateCustomerSummaryBody, SummaryFidelityError } from "./customer-summary-ai";
import { runOpportunitySynthesis } from "./opportunity-ai";
import { runScorecardComputation } from "./scorecard";
import { computeCoverage, zonesFromFinding } from "./zone-coverage";
import { logErrorEvent } from "./error-events";
import { validateFindings } from "../routes/analysis";
import { writePropertyMemory } from "./property-memory-writer";
import { notifyCriticalInspection } from "./push-notifications";

/**
 * Explicit "Complete Inspection" finalization pipeline.
 *
 * The inspection lifecycle keeps an inspection "in progress" (status
 * `pending`) until the technician explicitly completes it. Only then do the
 * heavyweight intelligence outputs get produced:
 *   1. service report (snapshot of the latest verified AI findings)
 *   2. AI report narrative
 *   3. customer summary DRAFT (manager still approves/edits on the web)
 *   4. Opportunity Intelligence synthesis
 *   5. inspection scorecard
 *
 * Every step is best-effort and company-scoped: a single AI failure never
 * un-completes the inspection or blocks the other outputs — it only logs to
 * the error monitor so the manager can regenerate from the web app.
 */

/** Ensure a report exists for the inspection; returns the report row. */
export async function ensureReportForInspection(input: {
  companyId: number;
  inspectionId: number;
}): Promise<typeof reportsTable.$inferSelect | null> {
  const { companyId, inspectionId } = input;
  const [existing] = await db
    .select()
    .from(reportsTable)
    .where(
      and(eq(reportsTable.companyId, companyId), eq(reportsTable.inspectionId, inspectionId)),
    )
    .orderBy(desc(reportsTable.createdAt))
    .limit(1);
  if (existing) return existing;

  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
    );
  if (!inspection) return null;

  // Snapshot the latest verified analysis (may legitimately be empty — an
  // all-clear inspection still gets a report).
  const [latest] = await db
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
  const [findings, invalidFindingCount0] = validateFindings(
    latest?.findings ?? [],
    "ensureReportForInspection",
  );
  if (invalidFindingCount0 > 0) {
    void logErrorEvent("ai", {
      companyId,
      message: `${invalidFindingCount0} malformed finding(s) stripped before report insert`,
      inspectionId,
      context: { stage: "write_validation", endpoint: "ensureReportForInspection" },
    });
  }
  const recommendations = (latest?.recommendations ?? []) as string[];
  const exclusionOpportunities = findings
    .filter((f) => f.exclusionOpportunity)
    .map((f) => `${f.category}: ${f.description}`);

  const [row] = await db
    .insert(reportsTable)
    .values({
      companyId,
      inspectionId,
      title: `Inspection Report — ${inspection.siteAddress}`,
      clientName: inspection.clientName ?? null,
      siteAddress: inspection.siteAddress,
      status: "complete",
      findings,
      recommendations,
      treatmentNotes: null,
      exclusionOpportunities,
      technicianName: inspection.technicianName,
      inspectionDate: inspection.createdAt.toISOString().split("T")[0],
      severity: inspection.severity ?? null,
    })
    .returning();
  return row ?? null;
}

/**
 * Background half of the pipeline: AI narrative, customer summary draft,
 * opportunity synthesis, scorecard. Call with `void` from the route — the
 * technician's completion response is never delayed by AI latency.
 */
export async function runInspectionFinalization(input: {
  companyId: number;
  inspectionId: number;
  reportId: number | null;
  userId?: number;
}): Promise<void> {
  const { companyId, inspectionId, reportId, userId } = input;

  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
    );
  if (!inspection) return;

  const [latestAnalysis] = await db
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
  const [findings, invalidFindingCount] = validateFindings(
    latestAnalysis?.findings ?? [],
    "runInspectionFinalization",
  );
  if (invalidFindingCount > 0) {
    void logErrorEvent("ai", {
      companyId,
      userId,
      message: `${invalidFindingCount} malformed finding(s) stripped before finalization writes`,
      inspectionId,
      context: { stage: "write_validation", endpoint: "runInspectionFinalization" },
    });
  }
  const recommendations = (latestAnalysis?.recommendations ?? []) as string[];

  // 0. Coverage — recompute the authoritative completeness snapshot from the
  // latest run's per-photo zones + current pest types / property type. This
  // catches the case where the technician edited pest types or the property
  // type after the last live analyze; inputs are otherwise identical, so the
  // value the technician saw live matches the finalized value.
  if (latestAnalysis) {
    try {
      const photoZones = (latestAnalysis.photoZones ?? {}) as Record<string, string>;
      const coveredZoneSlugs = [
        ...Object.values(photoZones),
        ...findings.flatMap((f) => zonesFromFinding(f)),
      ];
      const coverage = computeCoverage({
        propertyType: derivePropertyType(inspection.notes),
        pestTypes: (inspection.pestTypes ?? []) as string[],
        coveredZoneSlugs,
      });
      await db
        .update(analysisResultsTable)
        .set({ coverage })
        .where(
          and(
            eq(analysisResultsTable.id, latestAnalysis.id),
            eq(analysisResultsTable.companyId, companyId),
          ),
        );
    } catch {
      void logErrorEvent("ai", {
        companyId,
        userId,
        message: "Complete-inspection: coverage recompute failed",
        inspectionId,
        context: { stage: "complete_coverage" },
      });
    }
  }

  // 1. Report narrative — refresh the report snapshot from the final analysis
  // first so the narrative reflects everything captured, then generate prose.
  if (reportId !== null) {
    try {
      const [report] = await db
        .select()
        .from(reportsTable)
        .where(and(eq(reportsTable.id, reportId), eq(reportsTable.companyId, companyId)));
      if (report) {
        let reportFindings = report.findings ?? [];
        let reportRecommendations = report.recommendations ?? [];
        if (latestAnalysis) {
          reportFindings = findings;
          reportRecommendations = recommendations;
          const exclusionOpportunities = reportFindings
            .filter((f) => f.exclusionOpportunity)
            .map((f) => `${f.category}: ${f.description}`);
          await db
            .update(reportsTable)
            .set({
              findings: reportFindings,
              recommendations: reportRecommendations,
              exclusionOpportunities,
              severity: inspection.severity ?? report.severity ?? null,
            })
            .where(
              and(eq(reportsTable.id, reportId), eq(reportsTable.companyId, companyId)),
            );
        }

        const media = await db
          .select()
          .from(inspectionMediaTable)
          .where(
            and(
              eq(inspectionMediaTable.inspectionId, inspectionId),
              eq(inspectionMediaTable.companyId, companyId),
            ),
          );
        const voiceTranscripts = media
          .filter((m) => m.mediaType === "voice")
          .map((m) => m.caption ?? m.filename ?? "")
          .filter((s) => s.length > 0);
        const photoMedia = media.filter((m) => m.mediaType === "photo");
        const photoLabels = photoMedia
          .map((m) => [m.filename, m.caption].filter(Boolean).join(" — "))
          .filter((s) => s.length > 0);

        const narrative = await generateReportNarrative({
          title: report.title,
          siteAddress: report.siteAddress,
          clientName: report.clientName ?? null,
          technicianName: report.technicianName,
          inspectionDate: report.inspectionDate,
          severity: inspection.severity ?? report.severity ?? null,
          propertyType: derivePropertyType(inspection.notes),
          inspectionType: null,
          pestTypes: (inspection.pestTypes ?? []) as string[],
          fieldNotes: inspection.notes ?? null,
          treatmentNotes: report.treatmentNotes ?? null,
          findings: reportFindings,
          recommendations: reportRecommendations,
          voiceTranscripts,
          photoLabels,
          photoCount: photoMedia.length,
          riskLevel: latestAnalysis?.riskLevel ?? null,
        });
        await db
          .update(reportsTable)
          .set({ aiNarrative: narrative, pdfUrl: `/api/reports/${reportId}/html` })
          .where(and(eq(reportsTable.id, reportId), eq(reportsTable.companyId, companyId)));
      }
    } catch {
      void logErrorEvent("report", {
        companyId,
        userId,
        message: "Complete-inspection: report narrative generation failed",
        inspectionId,
        context: { stage: "complete_narrative" },
      });
    }
  }

  // 2. Customer summary DRAFT — never touches an approved (frozen) summary.
  // Requires a real analysis run: the summary may only restate verified facts.
  if (latestAnalysis) {
    try {
      const [existing] = await db
        .select()
        .from(customerSummariesTable)
        .where(
          and(
            eq(customerSummariesTable.inspectionId, inspectionId),
            eq(customerSummariesTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (!existing || existing.status !== "approved") {
        const body = await generateCustomerSummaryBody({
          siteAddress: inspection.siteAddress,
          technicianName: inspection.technicianName,
          inspectionDate: inspection.createdAt,
          findings,
          recommendations,
        });
        if (existing) {
          await db
            .update(customerSummariesTable)
            .set({ body, updatedAt: new Date() })
            .where(
              and(
                eq(customerSummariesTable.id, existing.id),
                eq(customerSummariesTable.companyId, companyId),
              ),
            );
        } else {
          await db
            .insert(customerSummariesTable)
            .values({ companyId, inspectionId, body, status: "draft" });
        }
      }
    } catch (err) {
      void logErrorEvent("ai", {
        companyId,
        userId,
        message:
          err instanceof SummaryFidelityError
            ? "Complete-inspection: customer summary failed fidelity check"
            : "Complete-inspection: customer summary generation failed",
        inspectionId,
        context: { stage: "complete_customer_summary" },
      });
    }
  }

  // 3 + 4. Opportunity Intelligence and scorecard — the calls that live
  // analysis (draft mode) deliberately deferred until completion.
  try {
    await runOpportunitySynthesis({ companyId, inspectionId, findings });
  } catch {
    void logErrorEvent("ai", {
      companyId,
      userId,
      message: "Complete-inspection: opportunity synthesis failed",
      inspectionId,
      context: { stage: "complete_opportunities" },
    });
  }
  try {
    await runScorecardComputation({
      companyId,
      inspectionId,
      findings,
      recommendations,
      photosAnalyzed: ((latestAnalysis?.analyzedImagePaths ?? []) as string[]).length,
    });
  } catch {
    void logErrorEvent("ai", {
      companyId,
      userId,
      message: "Complete-inspection: scorecard computation failed",
      inspectionId,
      context: { stage: "complete_scorecard" },
    });
  }

  // 5. Critical-risk push notification — fire to all owner tokens for the company
  // when the scorecard lands as critical. Exactly-once delivery is enforced with
  // an atomic UPDATE … WHERE critical_alert_sent = FALSE. Concurrent or retried
  // finalization paths will hit the false branch and skip, so the owner is never
  // spammed. Best-effort: a failure here never blocks completion.
  try {
    // Atomically claim the right to send: flip critical_alert_sent to true only
    // if it is still false (first caller wins). RETURNING gives us the riskLevel
    // so we can skip the push without a second round-trip when uncritical.
    const claimed = await db
      .update(inspectionScorecardsTable)
      .set({ criticalAlertSent: true })
      .where(
        and(
          eq(inspectionScorecardsTable.inspectionId, inspectionId),
          eq(inspectionScorecardsTable.companyId, companyId),
          eq(inspectionScorecardsTable.riskLevel, "critical"),
          eq(inspectionScorecardsTable.criticalAlertSent, false),
        ),
      )
      .returning({ id: inspectionScorecardsTable.id });

    if (claimed.length > 0) {
      // We won the atomic claim — send exactly once.
      await notifyCriticalInspection({
        companyId,
        inspectionId,
        siteAddress: inspection.siteAddress ?? "",
        technicianName: inspection.technicianName ?? null,
      });
    }
  } catch {
    void logErrorEvent("notification", {
      companyId,
      userId,
      message: "Complete-inspection: critical-risk push notification failed",
      inspectionId,
      context: { stage: "complete_push_notification" },
    });
  }

  // 6. Property Memory — recompute and persist the distilled visit history for
  // this address so the "Prior Visit" banner fills in on the next inspection.
  // Recomputes from ALL completed inspections at the address — idempotent on
  // retry.  Best-effort: a failure here never affects the completion state.
  try {
    await writePropertyMemory({
      companyId,
      inspectionId,
      siteAddress: inspection.siteAddress ?? "",
    });
  } catch {
    void logErrorEvent("ai", {
      companyId,
      userId,
      message: "Complete-inspection: property memory write failed",
      inspectionId,
      context: { stage: "complete_property_memory" },
    });
  }
}
