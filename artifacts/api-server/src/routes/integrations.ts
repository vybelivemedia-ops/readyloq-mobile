import { Router } from "express";
import { db } from "@workspace/db";
import {
  companyFieldIntegrationsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  treatmentLogsTable,
  productsTable,
  type Finding,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { syncInspectionToExternalSystem } from "../services/field-integration";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const configInputSchema = z.object({
  systemType: z.enum(["pestpac", "fieldroutes"]),
  accountId: z.string().min(1),
  apiKey: z.string().min(1),
  apiBaseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
});

// ─── GET /api/integrations/config ────────────────────────────────────────────
// Returns current integration type and account ID for this company.
// The api_key is intentionally omitted from the response.
router.get("/config", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [row] = await db
      .select({
        id: companyFieldIntegrationsTable.id,
        systemType: companyFieldIntegrationsTable.systemType,
        accountId: companyFieldIntegrationsTable.accountId,
        apiBaseUrl: companyFieldIntegrationsTable.apiBaseUrl,
        enabled: companyFieldIntegrationsTable.enabled,
        updatedAt: companyFieldIntegrationsTable.updatedAt,
      })
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId))
      .limit(1);

    if (!row) return res.json({ configured: false });
    return res.json({ configured: true, integration: row });
  } catch {
    return res.status(500).json({ error: "Failed to fetch integration config" });
  }
});

// ─── PUT /api/integrations/config ────────────────────────────────────────────
// Upsert the integration config. Owner-only. The api_key is stored server-side
// and never returned.
router.put("/config", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const parsed = configInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid config", issues: parsed.error.issues });
    }
    const { systemType, accountId, apiKey, apiBaseUrl, enabled } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: companyFieldIntegrationsTable.id })
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId))
      .limit(1);

    if (existing) {
      await db
        .update(companyFieldIntegrationsTable)
        .set({
          systemType,
          accountId,
          apiKey,
          apiBaseUrl: apiBaseUrl ?? null,
          enabled: enabled ?? true,
          updatedAt: now,
        })
        .where(eq(companyFieldIntegrationsTable.companyId, companyId));
    } else {
      await db.insert(companyFieldIntegrationsTable).values({
        companyId,
        systemType,
        accountId,
        apiKey,
        apiBaseUrl: apiBaseUrl ?? null,
        enabled: enabled ?? true,
      });
    }

    return res.json({ configured: true, systemType, accountId });
  } catch {
    return res.status(500).json({ error: "Failed to save integration config" });
  }
});

// ─── DELETE /api/integrations/config ─────────────────────────────────────────
router.delete("/config", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    await db
      .delete(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId));
    return res.json({ configured: false });
  } catch {
    return res.status(500).json({ error: "Failed to remove integration config" });
  }
});

// ─── POST /api/integrations/sync ─────────────────────────────────────────────
// Packages a finalized inspection and pushes it to the external system.
// The route reads the api_key from the DB — it is never accepted from the client.
const syncInputSchema = z.object({
  inspectionId: z.number().int().positive(),
});

router.post("/sync", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const parsed = syncInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    }
    const { inspectionId } = parsed.data;

    // Load integration config (includes api_key — server-side only).
    const [config] = await db
      .select()
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId))
      .limit(1);
    if (!config || !config.enabled) {
      return res.status(422).json({ error: "No active field-service integration configured" });
    }

    // Load inspection — enforce tenant isolation.
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      )
      .limit(1);
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });
    if (inspection.status !== "complete" && inspection.status !== "completed") {
      return res.status(422).json({ error: "Inspection is not yet finalized" });
    }

    // Load analysis + media in parallel.
    const [analyses, media, logs] = await Promise.all([
      db
        .select()
        .from(analysisResultsTable)
        .where(
          and(
            eq(analysisResultsTable.inspectionId, inspectionId),
            eq(analysisResultsTable.companyId, companyId),
          ),
        ),
      db
        .select()
        .from(inspectionMediaTable)
        .where(
          and(
            eq(inspectionMediaTable.inspectionId, inspectionId),
            eq(inspectionMediaTable.companyId, companyId),
          ),
        ),
      db
        .select({ productId: treatmentLogsTable.productId })
        .from(treatmentLogsTable)
        .where(
          and(
            eq(treatmentLogsTable.inspectionId, inspectionId),
            eq(treatmentLogsTable.companyId, companyId),
          ),
        ),
    ]);

    // Resolve product names for the chemicals-used payload.
    const productIds = [...new Set(logs.map((l) => l.productId).filter((id): id is number => id != null))];
    const products = productIds.length > 0
      ? await db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable).where(inArray(productsTable.id, productIds))
      : [];

    const analysis = analyses[0];
    const findings = (analysis?.findings ?? []) as Finding[];
    const narrative = analysis?.narrative ?? "";

    // Build the summary — prefer the AI narrative, fall back to a structured list.
    const reportSummary =
      narrative ||
      (findings.length > 0
        ? findings
            .slice(0, 5)
            .map((f) => `${f.category}: ${f.description}`)
            .join(". ")
        : "No significant findings detected.");

    const photos = media
      .filter((m) => m.mediaType === "photo" && m.url)
      .map((m) => ({
        url: m.url,
        caption: m.caption ?? null,
        severity: (findings.find((f) => f.imageUrl === m.url)?.severity ?? "low") as string,
      }));

    const pestsFound = [
      ...new Set(
        findings
          .filter((f) => f.category === "Pest Activity" || f.possiblePest)
          .map((f) => f.possiblePest ?? f.category)
          .filter(Boolean) as string[],
      ),
    ];

    const productNameById = new Map(products.map((p) => [p.id, p.name]));
    const chemicalsUsed = [
      ...new Set(
        logs.map((l) => l.productId != null ? productNameById.get(l.productId) : null).filter((n): n is string => n != null),
      ),
    ];

    const result = await syncInspectionToExternalSystem({
      externalSystem: config.systemType,
      accountId: config.accountId,
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      inspectionDate:
        (inspection.completedAt ?? inspection.createdAt).toISOString().split("T")[0],
      reportSummary,
      photos,
      treatmentConditions: {
        pestsFound,
        chemicalsUsed,
        temperature: null,
        notes: inspection.notes ?? null,
      },
    });

    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[integrations/sync]", message);
    return res.status(502).json({ error: message });
  }
});

export default router;
