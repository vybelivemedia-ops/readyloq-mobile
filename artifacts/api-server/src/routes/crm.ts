import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { getEnvCRMAdapter } from "../services/integration/crmFactory";
import type { InspectionPayload } from "../types/integration";

const router = Router();

/**
 * GET /api/crm/clients
 * Fetch all clients from the configured CRM (FieldRoutes or PestPac).
 * Requires manager role (gated in routes/index.ts).
 */
router.get("/clients", async (req, res) => {
  const adapter = getEnvCRMAdapter();
  if (!adapter) {
    return res.status(503).json({
      error: "No CRM configured. Set FIELDROUTES_API_KEY / FIELDROUTES_API_TOKEN or PESTPAC_API_KEY.",
    });
  }

  try {
    const clients = await adapter.fetchClients();
    return res.json({ clients });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `CRM request failed: ${message}` });
  }
});

/**
 * POST /api/crm/inspections/:inspectionId/push
 * Push a completed ReadyLoq inspection to the configured CRM as a service note.
 * Requires manager role (gated in routes/index.ts).
 *
 * Body: { clientId: string }
 *   clientId — the CRM's customer ID to attach the note to
 */
router.post("/inspections/:inspectionId/push", async (req, res) => {
  const adapter = getEnvCRMAdapter();
  if (!adapter) {
    return res.status(503).json({
      error: "No CRM configured. Set FIELDROUTES_API_KEY / FIELDROUTES_API_TOKEN or PESTPAC_API_KEY.",
    });
  }

  const companyId = getCompanyId(req);
  const { inspectionId } = req.params;
  const { clientId } = req.body as { clientId?: string };
  const inspectionIdNum = parseInt(inspectionId, 10);

  if (!clientId) {
    return res.status(400).json({ error: "clientId is required in the request body." });
  }
  if (isNaN(inspectionIdNum)) {
    return res.status(400).json({ error: "Invalid inspectionId." });
  }

  // Load the inspection (company-scoped)
  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(and(eq(inspectionsTable.id, inspectionIdNum), eq(inspectionsTable.companyId, companyId)))
    .limit(1);

  if (!inspection) {
    return res.status(404).json({ error: "Inspection not found." });
  }

  // Load the latest analysis result for findings
  const [result] = await db
    .select()
    .from(analysisResultsTable)
    .where(eq(analysisResultsTable.inspectionId, inspectionIdNum))
    .limit(1);

  // Load media URLs
  const media = await db
    .select({ url: inspectionMediaTable.url })
    .from(inspectionMediaTable)
    .where(eq(inspectionMediaTable.inspectionId, inspectionIdNum));

  const findings = extractFindings(result?.findings);
  const mediaUrls = media.map((m) => m.url).filter(Boolean) as string[];

  const payload: InspectionPayload = {
    inspectionId,
    clientId,
    timestamp: inspection.createdAt?.toISOString() ?? new Date().toISOString(),
    findings,
    mediaUrls,
  };

  try {
    const success = await adapter.pushInspection(payload);
    return res.json({ success, inspectionId, clientId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `CRM push failed: ${message}` });
  }
});

/**
 * GET /api/crm/status
 * Quick health-check — confirms which CRM provider is active without making
 * a live API call. Safe to poll from the mobile settings screen.
 */
router.get("/status", (_req, res) => {
  const hasFieldRoutes =
    !!process.env.FIELDROUTES_API_KEY && !!process.env.FIELDROUTES_API_TOKEN;
  const hasPestPac = !!process.env.PESTPAC_API_KEY;

  if (hasFieldRoutes) {
    return res.json({ configured: true, provider: "fieldroutes" });
  }
  if (hasPestPac) {
    return res.json({ configured: true, provider: "pestpac" });
  }
  return res.json({ configured: false, provider: null });
});

function extractFindings(
  raw: unknown,
): InspectionPayload["findings"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      zone: String(f.zone ?? f.location ?? ""),
      species: String(f.species ?? f.pest ?? ""),
      severity: String(f.severity ?? f.confidence ?? ""),
      notes: String(f.notes ?? f.description ?? ""),
    }));
}

export default router;
