import { Router } from "express";
import type { PoolClient } from "pg";
import { db, pool } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  companyFieldIntegrationsTable,
  inspectionSyncLogsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  treatmentLogsTable,
  productsTable,
  type Finding,
  type FieldIntegrationSystem,
} from "@workspace/db";
import { eq, and, inArray, desc, isNotNull } from "drizzle-orm";
import { z } from "zod/v4";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { syncInspectionToExternalSystem, probeIntegrationCredentials } from "../services/field-integration";
import { sendServSuiteREST } from "../services/integration/adapters/servsuiteAdapter";
import type { EnterpriseSyncFinding, EnterpriseSyncPayload } from "../types/enterprise-payload";

/** Duplicate taps within this window (seconds) return the cached result. */
const SYNC_COOLDOWN_SECONDS = 60;

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const configInputSchema = z.object({
  systemType: z.enum(["pestpac", "fieldroutes", "servsuite"]),
  accountId: z.string().min(1),
  apiKey: z.string().min(1),
  // FieldRoutes requires both apiKey (authenticationKey) and apiToken
  // (authenticationToken). Ignored for PestPac and ServSuite.
  apiToken: z.string().optional(),
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
    const { systemType, accountId, apiKey, apiToken, apiBaseUrl, enabled } = parsed.data;
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
          apiToken: apiToken ?? null,
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
        apiToken: apiToken ?? null,
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
  // Captured after the inspection passes tenant validation — used by the catch
  // block to safely write a failure log.  Must remain null until both the
  // inspection and config are confirmed tenant-owned so the catch block never
  // logs a foreign inspectionId.
  let validatedSyncCtx: {
    companyId: number;
    inspectionId: number;
    systemType: FieldIntegrationSystem;
  } | null = null;

  // Session-level advisory lock bookkeeping.  Declared here so the finally
  // block can release the lock and the connection regardless of how the try
  // block exits (return, throw, or normal fall-through).
  let poolClient: PoolClient | null = null;
  let sessionLockHeld = false;
  let sessionLockKey: number | null = null;

  try {
    const companyId = getCompanyId(req);
    const parsed = syncInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    }
    const { inspectionId } = parsed.data;
    // Record the key before the lock attempt so the finally block can clean up
    // even if pool.connect() succeeds but the unlock query later throws.
    sessionLockKey = inspectionId;

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

    // ── Both inspection and config are now confirmed tenant-owned. ────────────
    // Record this so the catch block can safely write a failure log.
    validatedSyncCtx = { companyId, inspectionId, systemType: config.systemType };

    // ── Idempotency: acquire a session-level advisory lock so that exclusivity
    //    spans the full critical section — cooldown check → external call →
    //    success-log write.  Unlike pg_try_advisory_xact_lock, a session lock
    //    is NOT released at transaction end; it persists until pg_advisory_unlock
    //    is called explicitly (see the finally block below).  This prevents a
    //    second concurrent request from slipping past the cooldown guard after
    //    the first request's transaction has already committed.
    poolClient = await pool.connect();
    const { rows: lockRows } = await poolClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [inspectionId],
    );
    if (!lockRows[0]?.locked) {
      // Another concurrent request already holds the session lock — tell the
      // client to retry once the ongoing sync completes.
      return res.status(409).json({ error: "Sync already in progress for this inspection" });
    }
    sessionLockHeld = true;

    // ── Cooldown: return cached result only for recent *successful* syncs.
    //    Failed attempts must remain retryable immediately so the owner
    //    can correct transient external-system errors without waiting.
    const cooldownCutoff = new Date(Date.now() - SYNC_COOLDOWN_SECONDS * 1000);
    const [recentSuccess] = await db
      .select()
      .from(inspectionSyncLogsTable)
      .where(
        and(
          eq(inspectionSyncLogsTable.inspectionId, inspectionId),
          eq(inspectionSyncLogsTable.companyId, companyId),
          eq(inspectionSyncLogsTable.success, true),
          isNotNull(inspectionSyncLogsTable.resultJson),
        ),
      )
      .orderBy(desc(inspectionSyncLogsTable.syncedAt))
      .limit(1);

    if (recentSuccess && recentSuccess.syncedAt >= cooldownCutoff) {
      return res.json({ ...(recentSuccess.resultJson as Record<string, unknown>), _idempotent: true });
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
      .filter((m) => (m.mediaType === "photo" || m.mediaType === "image") && m.url)
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

    // ── Structured Enterprise Bridge fields ────────────────────────────────
    // Stamped laser measurements live in inspection_media.captureMetadata
    // (laserMeasurement blob); AI vision estimates live on the finding itself
    // (measurementEstimate). Prefer the stamped sensor value when both exist.
    const mediaByUrl = new Map(media.filter((m) => m.url).map((m) => [m.url, m]));
    const structuredFindings = findings.map((f) => {
      let measurements:
        | { widthMm?: number; heightMm?: number; confidence?: number; surfaceType?: string }
        | undefined;

      const meta = f.imageUrl ? mediaByUrl.get(f.imageUrl)?.captureMetadata : undefined;
      const laser = meta && typeof meta === "object"
        ? (meta as Record<string, unknown>).laserMeasurement as
            | { value?: number; unit?: string; metadata?: { heightInches?: number; confidence?: number } }
            | undefined
        : undefined;

      if (laser && typeof laser === "object") {
        const toMm = (v: number, unit?: string): number =>
          unit === "mm" ? v : unit === "cm" ? v * 10 : unit === "m" ? v * 1000 : v * 25.4; // default inches
        const widthMm = typeof laser.value === "number" ? Math.round(toMm(laser.value, laser.unit)) : undefined;
        const heightMm =
          typeof laser.metadata?.heightInches === "number"
            ? Math.round(laser.metadata.heightInches * 25.4)
            : undefined;
        if (widthMm !== undefined || heightMm !== undefined) {
          measurements = {
            ...(widthMm !== undefined && { widthMm }),
            ...(heightMm !== undefined && { heightMm }),
            ...(typeof laser.metadata?.confidence === "number" && { confidence: laser.metadata.confidence }),
          };
        }
      }
      if (!measurements && f.measurementEstimate) {
        const est = f.measurementEstimate;
        const widthMm = est.gapWidthIn != null ? Math.round(est.gapWidthIn * 25.4) : undefined;
        const heightMm = est.heightFt != null ? Math.round(est.heightFt * 304.8) : undefined;
        if (widthMm !== undefined || heightMm !== undefined) {
          measurements = {
            ...(widthMm !== undefined && { widthMm }),
            ...(heightMm !== undefined && { heightMm }),
            confidence: est.confidence,
          };
        }
      }
      if (measurements && f.structuralIssue) {
        measurements.surfaceType = f.structuralIssue;
      }

      return {
        category: f.category,
        severity: f.severity,
        evidencePhotoUrl: f.imageUrl ?? null,
        ...(measurements && { measurements }),
      };
    });

    const signatureAudit = {
      technicianSigned: !!inspection.technicianSignature,
      ownerSigned: !!inspection.ownerSignature,
      ownerNotAvailable: inspection.ownerNotAvailable ?? false,
      signedAt: inspection.signedAt?.toISOString() ?? null,
    };

    // ServSuite doesn't use the legacy text-note SyncPayload — dispatch through
    // its structured Enterprise Bridge adapter instead.
    const syncServSuiteManual = async (): Promise<Record<string, unknown>> => {
      const enterpriseFindings: EnterpriseSyncFinding[] = structuredFindings.map((sf, i) => {
        const f = findings[i];
        const code = [
          (f?.category ?? "UNKNOWN").toUpperCase().replace(/\s+/g, "_"),
          (f?.severity ?? "LOW").toUpperCase(),
        ].join("_");
        return {
          Code: code,
          Description: f?.description ?? f?.category ?? "Finding detected",
          Severity: sf.severity ?? "low",
          CustomFields: {
            ...(sf.measurements?.widthMm !== undefined && { WidthMm: sf.measurements.widthMm }),
            ...(sf.measurements?.heightMm !== undefined && { HeightMm: sf.measurements.heightMm }),
            ...(sf.measurements?.confidence !== undefined && { VerifiedConfidence: sf.measurements.confidence }),
            ...(sf.measurements?.surfaceType !== undefined && { SurfaceType: sf.measurements.surfaceType }),
          },
          ...(sf.evidencePhotoUrl && { AttachmentUrl: sf.evidencePhotoUrl }),
        };
      });

      const payload: EnterpriseSyncPayload = {
        ExternalWorkOrderId: String(inspection.id),
        LocationReference: { PropertyCode: inspection.siteAddress ?? "" },
        ServiceDetails: {
          CompletedByEmployeeId: inspection.technicianId ?? config.accountId,
          ServiceDate: (inspection.completedAt ?? inspection.createdAt).toISOString(),
          TechnicianName: inspection.technicianName ?? "",
        },
        InspectionFindings: enterpriseFindings,
        SignatureAudit: signatureAudit,
      };

      await sendServSuiteREST(payload, {
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
      });

      return {
        success: true,
        externalSystem: "servsuite",
        dispatched: true,
        findingCount: enterpriseFindings.length,
        at: new Date().toISOString(),
        trigger: "manual",
      };
    };

    const syncResult = config.systemType === "servsuite"
      ? await syncServSuiteManual()
      : await syncInspectionToExternalSystem({
      externalSystem: config.systemType,
      accountId: config.accountId,
      apiKey: config.apiKey,
      apiToken: config.apiToken,
      apiBaseUrl: config.apiBaseUrl,
      findings: structuredFindings,
      signatureAudit,
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
      success: true,
      errorMessage: null,
      resultJson: syncResult,
    });

    return res.json(syncResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    logger.error({ message }, "[integrations/sync] error");

    // Best-effort failure log. Only written when validatedSyncCtx is set,
    // meaning the inspection was positively tenant-validated before the error
    // occurred.  This prevents the catch block from logging a foreign
    // inspectionId when the error is raised before tenant validation.
    if (validatedSyncCtx) {
      await db
        .insert(inspectionSyncLogsTable)
        .values({
          ...validatedSyncCtx,
          success: false,
          errorMessage: message,
          resultJson: null,
        })
        .catch(() => {
          // Swallow — must not mask the original error.
        });
    }

    return res.status(502).json({ error: message });
  } finally {
    // Always release the session advisory lock and return the connection to the
    // pool — regardless of whether the handler returned normally, returned with
    // a 4xx/5xx, or threw an exception.  The lock must be released explicitly
    // because session locks are NOT auto-released at transaction end.
    if (poolClient) {
      if (sessionLockHeld && sessionLockKey !== null) {
        await poolClient
          .query("SELECT pg_advisory_unlock($1)", [sessionLockKey])
          .catch(() => {
            // Swallow — the connection is about to be returned anyway; the
            // lock will be released when the underlying socket closes.
          });
      }
      poolClient.release();
    }
  }
});

// ─── POST /api/integrations/test ─────────────────────────────────────────────
// Probes the stored credentials against the external system's auth endpoint.
// Owner-only. Reads the api_key from the DB — no credential accepted from the
// client. Returns { ok, reason?, message? } where reason is "auth_failed" or
// "network_error" when ok is false.
router.post("/test", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [config] = await db
      .select()
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId))
      .limit(1);

    if (!config) {
      return res.status(422).json({ ok: false, reason: "network_error", message: "No integration configured for this company." });
    }

    const result = await probeIntegrationCredentials(
      config.systemType,
      config.apiKey,
      config.accountId,
      config.apiBaseUrl,
      config.apiToken,
    );

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "[integrations/test] probe error");
    return res.json({ ok: false, reason: "network_error", message: "Probe failed — could not reach the external system." });
  }
});

// ─── GET /api/integrations/sync-history/export ───────────────────────────────
// Returns the complete sync log as a downloadable CSV (no row cap).
// Scoped to the owner's company. Optional ?inspectionId=N to filter.
router.get("/sync-history/export", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const inspectionIdRaw = req.query["inspectionId"];
    const inspectionId =
      inspectionIdRaw !== undefined ? Number(inspectionIdRaw) : undefined;

    if (inspectionId !== undefined && (!Number.isInteger(inspectionId) || inspectionId <= 0)) {
      return res.status(400).json({ error: "Invalid inspectionId" });
    }

    const conditions = [eq(inspectionSyncLogsTable.companyId, companyId)];
    if (inspectionId !== undefined) {
      conditions.push(eq(inspectionSyncLogsTable.inspectionId, inspectionId));
    }

    // No .limit() — return the complete history for support escalations.
    const logs = await db
      .select({
        id: inspectionSyncLogsTable.id,
        inspectionId: inspectionSyncLogsTable.inspectionId,
        systemType: inspectionSyncLogsTable.systemType,
        success: inspectionSyncLogsTable.success,
        errorMessage: inspectionSyncLogsTable.errorMessage,
        syncedAt: inspectionSyncLogsTable.syncedAt,
        resultJson: inspectionSyncLogsTable.resultJson,
        siteAddress: inspectionsTable.siteAddress,
      })
      .from(inspectionSyncLogsTable)
      .leftJoin(
        inspectionsTable,
        and(
          eq(inspectionSyncLogsTable.inspectionId, inspectionsTable.id),
          eq(inspectionsTable.companyId, companyId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(inspectionSyncLogsTable.syncedAt));

    // Build CSV — neutralize formula-injection prefixes to prevent spreadsheet
    // apps from evaluating cells that start with =, +, -, or @.
    const csvEscape = (value: string | null | undefined): string => {
      let s = value ?? "";
      // Prefix potentially dangerous leading characters with a tab so
      // spreadsheet apps treat the cell as text.
      if (s.length > 0 && /^[=+\-@]/.test(s)) {
        s = "\t" + s;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };

    const SYSTEM_LABELS: Record<string, string> = {
      pestpac: "PestPac",
      fieldroutes: "FieldRoutes",
      servsuite: "ServSuite",
    };
    const systemLabel = (type: string) => SYSTEM_LABELS[type] ?? type;

    const header = "Timestamp,System,Result,Error Message";
    const rows = logs.map((e) =>
      [
        csvEscape(e.syncedAt instanceof Date ? e.syncedAt.toISOString() : String(e.syncedAt ?? "")),
        csvEscape(systemLabel(e.systemType)),
        csvEscape(e.success ? "Success" : "Failed"),
        csvEscape(e.errorMessage),
      ].join(","),
    );

    const csv = [header, ...rows].join("\n");
    const filename = inspectionId
      ? `sync-log-inspection-${inspectionId}.csv`
      : `sync-log-company-${companyId}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch {
    return res.status(500).json({ error: "Failed to export sync history" });
  }
});

// ─── GET /api/integrations/sync-history ──────────────────────────────────────
// Returns the sync log for the owner's company, newest first.
// Optional query param ?inspectionId=N to filter to a single inspection.
router.get("/sync-history", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const inspectionIdRaw = req.query["inspectionId"];
    const inspectionId =
      inspectionIdRaw !== undefined ? Number(inspectionIdRaw) : undefined;

    if (inspectionId !== undefined && (!Number.isInteger(inspectionId) || inspectionId <= 0)) {
      return res.status(400).json({ error: "Invalid inspectionId" });
    }

    const conditions = [eq(inspectionSyncLogsTable.companyId, companyId)];
    if (inspectionId !== undefined) {
      conditions.push(eq(inspectionSyncLogsTable.inspectionId, inspectionId));
    }

    const logs = await db
      .select({
        id: inspectionSyncLogsTable.id,
        inspectionId: inspectionSyncLogsTable.inspectionId,
        systemType: inspectionSyncLogsTable.systemType,
        success: inspectionSyncLogsTable.success,
        errorMessage: inspectionSyncLogsTable.errorMessage,
        syncedAt: inspectionSyncLogsTable.syncedAt,
        resultJson: inspectionSyncLogsTable.resultJson,
        siteAddress: inspectionsTable.siteAddress,
      })
      .from(inspectionSyncLogsTable)
      .leftJoin(
        inspectionsTable,
        // Scope the join to the same company so a foreign inspection row
        // (same ID, different company) can never leak its siteAddress.
        and(
          eq(inspectionSyncLogsTable.inspectionId, inspectionsTable.id),
          eq(inspectionsTable.companyId, companyId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(inspectionSyncLogsTable.syncedAt))
      .limit(100);

    return res.json({ logs });
  } catch {
    return res.status(500).json({ error: "Failed to fetch sync history" });
  }
});

export default router;
