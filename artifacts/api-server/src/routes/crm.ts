import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  companyFieldIntegrationsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { getCRMAdapter } from "../services/integration/crmFactory";
import { isSafeBaseUrl, validateBaseUrlDns } from "../lib/ssrf-guard";
import type { CRMAdapter, InspectionPayload } from "../types/integration";

const router = Router();

type CompanyCRMAdapterResult =
  | { adapter: CRMAdapter }
  | { status: number; error: string };

async function getCompanyCRMAdapter(companyId: number): Promise<CompanyCRMAdapterResult> {
  const [config] = await db
    .select()
    .from(companyFieldIntegrationsTable)
    .where(eq(companyFieldIntegrationsTable.companyId, companyId))
    .limit(1);

  if (!config || !config.enabled) {
    return { status: 503, error: "No active CRM configured for this company." };
  }
  if (config.systemType === "servsuite") {
    return { status: 422, error: "This CRM operation is not supported for this provider." };
  }
  if (config.apiBaseUrl && !isSafeBaseUrl(config.apiBaseUrl)) {
    return { status: 422, error: "The stored CRM API base URL is not permitted." };
  }
  if (config.apiBaseUrl) {
    const dnsError = await validateBaseUrlDns(config.apiBaseUrl, true);
    if (dnsError) return { status: 422, error: dnsError };
  }
  if (config.systemType === "fieldroutes" && !config.apiToken) {
    return { status: 422, error: "FieldRoutes integration is missing its authentication token." };
  }

  return {
    adapter: getCRMAdapter(
      config.systemType,
      config.apiKey,
      config.apiBaseUrl ?? undefined,
      config.apiToken ?? undefined,
    ),
  };
}

/**
 * GET /api/crm/clients
 * Fetch all clients from the configured CRM (FieldRoutes or PestPac).
 * Requires manager role (gated in routes/index.ts).
 */
router.get("/clients", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const result = await getCompanyCRMAdapter(companyId);
    if (!("adapter" in result)) return res.status(result.status).json({ error: result.error });
    const clients = await result.adapter.fetchClients();
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
  const companyId = getCompanyId(req);
  const adapterResult = await getCompanyCRMAdapter(companyId);
  if (!("adapter" in adapterResult)) {
    return res.status(adapterResult.status).json({ error: adapterResult.error });
  }
  const adapter = adapterResult.adapter;
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
    .where(and(
      eq(analysisResultsTable.inspectionId, inspectionIdNum),
      eq(analysisResultsTable.companyId, companyId),
    ))
    .limit(1);

  // Load media URLs
  const media = await db
    .select({ url: inspectionMediaTable.url })
    .from(inspectionMediaTable)
    .where(and(
      eq(inspectionMediaTable.inspectionId, inspectionIdNum),
      eq(inspectionMediaTable.companyId, companyId),
    ));

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
router.get("/status", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [config] = await db
      .select({
        systemType: companyFieldIntegrationsTable.systemType,
        enabled: companyFieldIntegrationsTable.enabled,
      })
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId))
      .limit(1);

    if (config?.enabled) {
      return res.json({ configured: true, provider: config.systemType });
    }
    return res.json({ configured: false, provider: null });
  } catch {
    return res.status(500).json({ error: "Failed to fetch CRM status." });
  }
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
