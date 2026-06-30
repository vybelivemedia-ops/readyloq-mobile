import { Router } from "express";
import { db } from "@workspace/db";
import {
  reportsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import {
  generateReportNarrative,
  derivePropertyType,
} from "../lib/report-narrative-ai";
import { logErrorEvent } from "../lib/error-events";

const router = Router();

function serializeReport(row: typeof reportsTable.$inferSelect) {
  return {
    ...row,
    findings: row.findings ?? [],
    recommendations: row.recommendations ?? [],
    exclusionOpportunities: row.exclusionOpportunities ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /reports
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.companyId, companyId))
      .orderBy(desc(reportsTable.createdAt));
    return res.json(rows.map(serializeReport));
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
        );
      const latest = analyses[analyses.length - 1];
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
      );
    const riskLevel: string | null = analyses[analyses.length - 1]?.riskLevel ?? null;

    const narrative = await generateReportNarrative({
      title: report.title,
      siteAddress: report.siteAddress,
      clientName: report.clientName ?? null,
      technicianName: report.technicianName,
      inspectionDate: report.inspectionDate,
      severity: report.severity ?? null,
      propertyType: derivePropertyType(inspection.notes),
      inspectionType: null,
      pestTypes: (inspection.pestTypes ?? []) as string[],
      fieldNotes: inspection.notes ?? null,
      treatmentNotes: report.treatmentNotes ?? null,
      findings: report.findings ?? [],
      recommendations: report.recommendations ?? [],
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
