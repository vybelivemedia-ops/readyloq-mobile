import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  companyFieldIntegrationsTable,
  inspectionSyncLogsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  treatmentLogsTable,
  productsTable,
  type Finding,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { syncInspectionToExternalSystem } from "../services/field-integration";

/** Duplicate taps within this window (seconds) return the cached result. */
const SYNC_COOLDOWN_SECONDS = 60;

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
//
// Idempotency guards:
//   1. Cooldown check — if a successful sync exists within SYNC_COOLDOWN_SECONDS,
//      return the stored result without contacting the external system.
//   2. Advisory lock — pg_try_advisory_xact_lock(inspectionId) prevents two
//      concurrent requests from both passing the cooldown check simultaneously.
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

    // ── Idempotency: run the rest inside a transaction so the advisory lock
    //    and the sync-log insert are atomic. ────────────────────────────────
    const result = await pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        // Advisory lock scoped to this inspection (released when txn ends).
        // If another request already holds it, we bail immediately — the
        // concurrent request will also see the cooldown record and return early.
        const { rows: lockRows } = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock($1) AS locked",
          [inspectionId],
        );
        if (!lockRows[0]?.locked) {
          await client.query("ROLLBACK");
          return { _conflict: true } as const;
        }

        // ── Cooldown: return cached result if last sync was recent. ────────
        const cooldownCutoff = new Date(Date.now() - SYNC_COOLDOWN_SECONDS * 1000);
        const [recentLog] = await db
          .select()
          .from(inspectionSyncLogsTable)
          .where(
            and(
              eq(inspectionSyncLogsTable.inspectionId, inspectionId),
              eq(inspectionSyncLogsTable.companyId, companyId),
            ),
          )
          .orderBy(desc(inspectionSyncLogsTable.syncedAt))
          .limit(1);

        if (recentLog && recentLog.syncedAt >= cooldownCutoff) {
          await client.query("ROLLBACK");
          return { _cached: true, result: recentLog.resultJson } as const;
        }

        // ── Not a duplicate: load data and call the external system. ───────
        await client.query("COMMIT");
        return { _cached: false } as const;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (result._conflict) {
      // Another concurrent request is already syncing — tell the client to retry.
      return res.status(409).json({ error: "Sync already in progress for this inspection" });
    }
    if (result._cached) {
      return res.json({ ...result.result, _idempotent: true });
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

    // Build the summary from findings (the AI narrative lives in the reports
    // table and is not loaded here to keep this route lightweight).
    const reportSummary =
      findings.length > 0
        ? findings
            .slice(0, 5)
            .map((f) => `${f.category}: ${f.description}`)
            .join(". ")
        : "No significant findings detected.";

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

    const syncResult = await syncInspectionToExternalSystem({
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

    // Record successful sync so future duplicate taps return cached result.
    await db.insert(inspectionSyncLogsTable).values({
      companyId,
      inspectionId,
      systemType: config.systemType,
      resultJson: syncResult,
    });

    return res.json(syncResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[integrations/sync]", message);
    return res.status(502).json({ error: message });
  }
});

export default router;
