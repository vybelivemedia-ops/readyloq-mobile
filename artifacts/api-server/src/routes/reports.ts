import { Router } from "express";
import { db } from "@workspace/db";
import {
  reportsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  customerSummariesTable,
  opportunitiesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import {
  generateReportNarrative,
  derivePropertyType,
} from "../lib/report-narrative-ai";
import { logErrorEvent } from "../lib/error-events";
import { buildServerReportHtml } from "../lib/report-html-server";

const router = Router();

function serializeReport(
  row: typeof reportsTable.$inferSelect,
  pipelineValue?: number | null,
) {
  return {
    ...row,
    findings: row.findings ?? [],
    recommendations: row.recommendations ?? [],
    exclusionOpportunities: row.exclusionOpportunities ?? [],
    createdAt: row.createdAt.toISOString(),
    ...(pipelineValue != null ? { pipelineValue } : {}),
  };
}

// GET /reports
// Left-joins the linked opportunity so each report carries `pipelineValue`
// (the auto-populated estimatedAnnualValue from the pricing engine).
// The client uses this for the owner home screen KPI strip without a separate
// /opportunities request.
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select({
        report: reportsTable,
        pipelineValue: opportunitiesTable.estimatedAnnualValue,
      })
      .from(reportsTable)
      .leftJoin(
        opportunitiesTable,
        and(
          eq(opportunitiesTable.inspectionId, reportsTable.inspectionId),
          eq(opportunitiesTable.companyId, reportsTable.companyId),
        ),
      )
      .where(eq(reportsTable.companyId, companyId))
      .orderBy(desc(reportsTable.createdAt));
    return res.json(rows.map((r) => serializeReport(r.report, r.pipelineValue)));
  } catch (err) {
    return res.status(500).json({ error: "Failed to list reports" });
  }
});

// POST /reports
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { inspectionId, title, treatmentNotes, includePhotos, includeAiFindings } =
      req.body;
    if (!inspectionId || !title)
      return res.status(400).json({ error: "inspectionId and title are required" });

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    let findings: any[] = [];
    let recommendations: string[] = [];
    if (includeAiFindings !== false) {
      const analyses = await db
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
      const latest = analyses[0];
      if (latest) {
        findings = (latest.findings ?? []) as any[];
        recommendations = (latest.recommendations ?? []) as string[];
      }
    }

    const exclusionOpportunities = findings
      .filter((f) => f.exclusionOpportunity)
      .map((f) => `${f.category}: ${f.description}`);

    const [row] = await db
      .insert(reportsTable)
      .values({
        companyId,
        inspectionId,
        title,
        clientName: inspection.clientName ?? null,
        siteAddress: inspection.siteAddress,
        status: "complete",
        findings,
        recommendations,
        treatmentNotes: treatmentNotes ?? null,
        exclusionOpportunities,
        technicianName: inspection.technicianName,
        inspectionDate: inspection.createdAt.toISOString().split("T")[0],
        severity: inspection.severity ?? null,
      })
      .returning();

    return res.status(201).json(serializeReport(row));
  } catch (err) {
    void logErrorEvent("report", {
      companyId: req.user?.companyId ?? 0,
      userId: req.user?.id,
      message: "Failed to generate report",
      context: { stage: "create_report" },
    });
    return res.status(500).json({ error: "Failed to generate report" });
  }
});

// GET /reports/:id
router.get("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)));
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json(serializeReport(row));
  } catch (err) {
    return res.status(500).json({ error: "Failed to get report" });
  }
});

// POST /reports/:id/generate-narrative
// Generate (or regenerate) the AI narrative report. Every record consumed here
// is re-checked against companyId — we never trust report.inspectionId alone —
// so no cross-tenant data can leak into the prompt or the stored narrative.
router.post("/:id/generate-narrative", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid report id" });

    const [report] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)));
    if (!report) return res.status(404).json({ error: "Not found" });

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, report.inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      );
    // The narrative is generated from an existing report+inspection. If the
    // company-scoped inspection cannot be found, the report references data we
    // can't read — fail loudly rather than producing an incomplete narrative.
    if (!inspection) {
      return res
        .status(409)
        .json({ error: "Report's inspection is unavailable; cannot generate narrative" });
    }

    const media = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.inspectionId, report.inspectionId),
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

    const analyses = await db
      .select()
      .from(analysisResultsTable)
      .where(
        and(
          eq(analysisResultsTable.companyId, companyId),
          eq(analysisResultsTable.inspectionId, report.inspectionId),
        ),
      )
      .orderBy(desc(analysisResultsTable.createdAt))
      .limit(1);
    const latestAnalysis = analyses[0];
    const riskLevel: string | null = latestAnalysis?.riskLevel ?? null;

    // Live report builder: re-snapshot findings/recommendations from the
    // inspection's latest AI analysis so the narrative always reflects the
    // most recent detections instead of the snapshot taken at report creation.
    let reportFindings = report.findings ?? [];
    let reportRecommendations = report.recommendations ?? [];
    if (req.body?.refreshFindings === true && latestAnalysis) {
      reportFindings = latestAnalysis.findings ?? [];
      reportRecommendations = latestAnalysis.recommendations ?? [];
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
        .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)));
    }

    const narrative = await generateReportNarrative({
      title: report.title,
      siteAddress: report.siteAddress,
      clientName: report.clientName ?? null,
      technicianName: report.technicianName,
      inspectionDate: report.inspectionDate,
      severity:
        req.body?.refreshFindings === true
          ? (inspection.severity ?? report.severity ?? null)
          : (report.severity ?? null),
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
      riskLevel,
    });

    const [updated] = await db
      .update(reportsTable)
      .set({ aiNarrative: narrative })
      .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)))
      .returning();

    return res.json(serializeReport(updated));
  } catch (err) {
    void logErrorEvent("report", {
      companyId: req.user?.companyId ?? 0,
      userId: req.user?.id,
      message: "Failed to generate AI report narrative",
      context: { stage: "generate_narrative" },
    });
    return res.status(502).json({ error: "Failed to generate AI report" });
  }
});

// POST /reports/:id/share
// Returns a share URL if the inspection has an approved customer summary with a
// share token; 404 if no approved, shareable summary exists yet.
router.post("/:id/share", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid report id" });

    const [report] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)));
    if (!report) return res.status(404).json({ error: "Not found" });

    const [summary] = await db
      .select()
      .from(customerSummariesTable)
      .where(
        and(
          eq(customerSummariesTable.inspectionId, report.inspectionId),
          eq(customerSummariesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!summary?.shareToken) {
      return res.status(404).json({ error: "No approved summary available for sharing yet" });
    }

    const baseUrl = process.env.PUBLIC_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
    return res.json({ shareUrl: `${baseUrl}/share/summary/${summary.shareToken}` });
  } catch {
    return res.status(500).json({ error: "Failed to generate share URL" });
  }
});

// GET /reports/:id/html
// Returns a standalone, print-ready HTML page for the inspection report.
// pdfUrl on the report record is set to /api/reports/:id/html after finalization
// so technicians and managers can share a persistent browser-viewable URL.
router.get("/:id/html", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send("Invalid report id");

    const [report] = await db
      .select()
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)));
    if (!report) return res.status(404).send("Report not found");

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, report.inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      );
    if (!inspection) return res.status(404).send("Inspection not found");

    const html = buildServerReportHtml(report, inspection);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(html);
  } catch {
    return res.status(500).send("Failed to render report");
  }
});

// DELETE /reports/:id
router.delete("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    await db
      .delete(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.companyId, companyId)));
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete report" });
  }
});

export default router;
