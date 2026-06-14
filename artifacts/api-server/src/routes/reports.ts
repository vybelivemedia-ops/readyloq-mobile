import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable, inspectionsTable, analysisResultsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

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
