import { Router } from "express";
import { db } from "@workspace/db";
import {
  reportsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  customerSummariesTable,
  opportunitiesTable,
  type Finding,
} from "@workspace/db";
import { eq, and, desc, inArray, gte, sql } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import {
  generateReportNarrative,
  derivePropertyType,
} from "../lib/report-narrative-ai";
import { logErrorEvent } from "../lib/error-events";
import { buildServerReportHtml } from "../lib/report-html-server";

const router = Router();

/**
 * Safely coerces a raw JSON value (from a DB jsonb column) into a typed
 * Finding array. Entries that are missing required string fields are dropped
 * so malformed DB data never reaches the API response or an insert.
 */
function safeParseFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Finding => {
    if (!item || typeof item !== "object") return false;
    const f = item as Record<string, unknown>;
    return typeof f.category === "string" && typeof f.description === "string";
  });
}

function serializeReport(
  row: typeof reportsTable.$inferSelect,
  pipelineValue?: number | null,
) {
  // Always pass findings through safeParseFindings so that:
  //   - null DB values (legacy rows) become []
  //   - malformed entries (missing category / description) are dropped
  // This makes GET behaviour consistent with the POST write path.
  return {
    ...row,
    findings: safeParseFindings(row.findings),
    recommendations: Array.isArray(row.recommendations)
      ? (row.recommendations as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
    exclusionOpportunities: Array.isArray(row.exclusionOpportunities)
      ? (row.exclusionOpportunities as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
    createdAt: row.createdAt.toISOString(),
    ...(pipelineValue != null ? { pipelineValue } : {}),
  };
}

// GET /reports
// Supports optional server-side filtering via query params:
//   ?severity=high,critical   — filter by one or more severity values
//   ?status=pending,draft     — filter by one or more status values
//   ?since_days=30            — restrict to reports created in the last N days
//   ?opportunities=true       — only reports with at least one exclusion opportunity
// Left-joins the linked opportunity so each report carries `pipelineValue`
// (the auto-populated estimatedAnnualValue from the pricing engine).
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    // Parse optional filter params
    const severityParam      = typeof req.query.severity     === "string" ? req.query.severity     : null;
    const statusParam        = typeof req.query.status       === "string" ? req.query.status       : null;
    const sinceDaysParam     = typeof req.query.since_days   === "string" ? req.query.since_days   : null;
    const opportunitiesParam = typeof req.query.opportunities === "string" ? req.query.opportunities : null;

    const severityValues    = severityParam  ? severityParam.split(",").filter(Boolean)  : null;
    const statusValues      = statusParam    ? statusParam.split(",").filter(Boolean)    : null;
    const sinceDays         = sinceDaysParam ? parseInt(sinceDaysParam, 10)              : null;
    const filterOpportunities = opportunitiesParam === "true";

    // Build WHERE conditions
    const VALID_SEVERITIES = ["low", "medium", "high", "critical"] as const;
    type ReportSeverity = (typeof VALID_SEVERITIES)[number];
    const conditions = [eq(reportsTable.companyId, companyId)];
    if (severityValues?.length) {
      const safe = severityValues.filter((s): s is ReportSeverity =>
        VALID_SEVERITIES.includes(s as ReportSeverity),
      );
      if (safe.length) conditions.push(inArray(reportsTable.severity, safe));
    }
    if (statusValues?.length) {
      conditions.push(inArray(reportsTable.status, statusValues));
    }
    if (sinceDays != null && !isNaN(sinceDays) && sinceDays > 0) {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      conditions.push(gte(reportsTable.createdAt, since));
    }
    if (filterOpportunities) {
      // Only include reports whose exclusion_opportunities JSONB array is non-empty.
      // COALESCE handles legacy NULL rows (treat them as an empty array → length 0).
      conditions.push(
        sql`jsonb_array_length(COALESCE(${reportsTable.exclusionOpportunities}, '[]'::jsonb)) > 0`,
      );
    }

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
      .where(and(...conditions))
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

    let findings: Finding[] = [];
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
        findings = safeParseFindings(latest.findings);
        recommendations = Array.isArray(latest.recommendations)
          ? (latest.recommendations as unknown[]).filter((r): r is string => typeof r === "string")
          : [];
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
    let reportFindings: Finding[] = safeParseFindings(report.findings);
    let reportRecommendations: string[] = Array.isArray(report.recommendations)
      ? (report.recommendations as unknown[]).filter((r): r is string => typeof r === "string")
      : [];
    if (req.body?.refreshFindings === true && latestAnalysis) {
      reportFindings = safeParseFindings(latestAnalysis.findings);
      reportRecommendations = Array.isArray(latestAnalysis.recommendations)
        ? (latestAnalysis.recommendations as unknown[]).filter((r): r is string => typeof r === "string")
        : [];
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

    if (!updated) {
      return res.status(409).json({ error: "Report no longer exists" });
    }
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
