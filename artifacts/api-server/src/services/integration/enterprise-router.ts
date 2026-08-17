/**
 * Enterprise Adapter Router
 *
 * Receives an InspectionFinalizedEvent, loads all required data from the DB,
 * builds the canonical EnterpriseSyncPayload, and dispatches to the correct
 * adapter based on the company's configured system type.
 *
 *   pestpac   → PestPac SOAP/XML (WorkWave Route Manager)
 *   servsuite → ServSuite REST/JSON
 *   fieldroutes → FieldRoutes REST (existing text-note adapter, kept for compat)
 *
 * All errors are caught and logged — never thrown to the caller. The finalization
 * pipeline that invokes this is best-effort; a sync failure never un-completes
 * an inspection.
 */

import {
  db,
  companyFieldIntegrationsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
  inspectionSyncLogsTable,
  type Finding,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import type { InspectionFinalizedEvent } from "../../lib/enterprise-event-bus";
import type {
  EnterpriseSyncFinding,
  EnterpriseSyncPayload,
  HardenedInspectionPayload,
  DeliveryOutcome,
} from "../../types/enterprise-payload";
import { EnterpriseBridgeProductionService } from "./enterprise-bridge-production";
import { sendPestPacSOAP } from "./adapters/pestPacSoapAdapter";
import { sendServSuiteREST } from "./adapters/servsuiteAdapter";
import { syncInspectionToExternalSystem } from "../field-integration";

export class EnterpriseAdapterRouter {
  /**
   * Main entry point — called by the enterprise event bus listener.
   * Loads inspection + config, builds the structured payload, dispatches.
   */
  static async dispatch(event: InspectionFinalizedEvent): Promise<void> {
    const { companyId, inspectionId } = event;

    // Load integration config — bail silently if not configured.
    const [config] = await db
      .select()
      .from(companyFieldIntegrationsTable)
      .where(eq(companyFieldIntegrationsTable.companyId, companyId))
      .limit(1);

    if (!config || !config.enabled) return;

    // Load inspection + analysis + media in parallel.
    const [inspectionRows, analysisRows, mediaRows] = await Promise.all([
      db
        .select()
        .from(inspectionsTable)
        .where(
          and(
            eq(inspectionsTable.id, inspectionId),
            eq(inspectionsTable.companyId, companyId),
          ),
        )
        .limit(1),
      db
        .select()
        .from(analysisResultsTable)
        .where(
          and(
            eq(analysisResultsTable.inspectionId, inspectionId),
            eq(analysisResultsTable.companyId, companyId),
          ),
        )
        .orderBy(desc(analysisResultsTable.createdAt))
        .limit(1),
      db
        .select()
        .from(inspectionMediaTable)
        .where(
          and(
            eq(inspectionMediaTable.inspectionId, inspectionId),
            eq(inspectionMediaTable.companyId, companyId),
          ),
        ),
    ]);

    const inspection = inspectionRows[0];
    if (!inspection) return;

    const analysis = analysisRows[0];
    const rawFindings = (analysis?.findings ?? []) as Finding[];

    // Build structured InspectionFindings — attach measurements and evidence photos.
    const inspectionFindings: EnterpriseSyncFinding[] = rawFindings.map((f) => {
      // measurementEstimate stores imperial units from vision model estimates.
      // Convert to mm for the enterprise payload (1 in = 25.4 mm, 1 ft = 304.8 mm).
      const meas = f.measurementEstimate;
      const widthMm =
        meas?.gapWidthIn != null ? Math.round(meas.gapWidthIn * 25.4) : undefined;
      const heightMm =
        meas?.heightFt != null ? Math.round(meas.heightFt * 304.8) : undefined;

      const evidenceMedia = mediaRows.find((m) => m.url === f.imageUrl);

      const code = [
        (f.category ?? "UNKNOWN").toUpperCase().replace(/\s+/g, "_"),
        (f.severity ?? "LOW").toUpperCase(),
      ].join("_");

      return {
        Code: code,
        Description: f.description ?? f.category ?? "Finding detected",
        Severity: f.severity ?? "low",
        CustomFields: {
          ...(widthMm !== undefined && { WidthMm: widthMm }),
          ...(heightMm !== undefined && { HeightMm: heightMm }),
          ...(meas?.confidence !== undefined && { VerifiedConfidence: meas.confidence }),
        },
        ...(evidenceMedia?.url && { AttachmentUrl: evidenceMedia.url }),
      };
    });

    const insp = inspection as Record<string, unknown>;

    // ── Legacy payload (FieldRoutes adapter unchanged) ────────────────────
    const legacyPayload: EnterpriseSyncPayload = {
      ExternalWorkOrderId: String(inspection.id),
      LocationReference: {
        PropertyCode: inspection.siteAddress ?? "",
      },
      ServiceDetails: {
        CompletedByEmployeeId: inspection.technicianId ?? config.accountId,
        ServiceDate: (inspection.completedAt ?? inspection.createdAt).toISOString(),
        TechnicianName: inspection.technicianName ?? "",
      },
      InspectionFindings: inspectionFindings,
      SignatureAudit: {
        technicianSigned: !!insp["technicianSignature"],
        ownerSigned: !!insp["ownerSignature"],
        ownerNotAvailable: !!(insp["ownerNotAvailable"] ?? false),
        signedAt: (insp["signedAt"] as Date | null)?.toISOString() ?? null,
      },
    };

    // ── Hardened payload (PestPac + ServSuite production bridge) ──────────
    // Build measurements from findings that have a measurementEstimate so the
    // ID-based matcher in normalizePayload has entries to resolve against.
    const hardenedMeasurements: HardenedInspectionPayload["measurements"] = rawFindings
      .filter((f) => f.measurementEstimate != null)
      .map((f) => {
        const meas = f.measurementEstimate!;
        return {
          measurementId: `finding-${f.id}-meas`,
          elementId: String(f.id),
          widthMm: meas.gapWidthIn != null ? Math.round(meas.gapWidthIn * 25.4) : 0,
          heightMm: meas.heightFt != null ? Math.round(meas.heightFt * 304.8) : 0,
          confidence: meas.confidence,
          surfaceType: "",
        };
      });

    const signedAt = (insp["signedAt"] as Date | null)?.toISOString() ?? new Date().toISOString();

    const hardenedPayload: HardenedInspectionPayload = {
      inspectionId: String(inspection.id),
      companyId: String(companyId),
      propertyId: inspection.siteAddress ?? String(inspection.id),
      technicianId: inspection.technicianId ?? String(config.accountId ?? ""),
      timestamp: (inspection.completedAt ?? inspection.createdAt).toISOString(),
      signatures: {
        technicianUserId: inspection.technicianId ?? "",
        technicianSignatureUrl: (insp["technicianSignature"] as string | null) ?? "",
        customerSignatureUrl: (insp["ownerSignature"] as string | null) ?? "",
        signedAt,
        signatureVersion: "v1",
      },
      measurements: hardenedMeasurements,
      aiFindings: rawFindings.map((f) => ({
        findingId: String(f.id),
        measurementId: f.measurementEstimate != null ? `finding-${f.id}-meas` : undefined,
        category: f.category,
        severity: f.severity,
        aiPrediction: f.description,
        // reviewStatus "accepted" or "corrected" means the technician confirmed it
        technicianConfirmed:
          f.reviewStatus === "accepted" || f.reviewStatus === "corrected",
        managerVerified: false, // populated by future manager-review workflow
        confidence: f.confidence,
        evidencePhotoUrl: f.imageUrl ?? "",
      })),
    };

    let outcome: DeliveryOutcome | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      if (config.systemType === "pestpac" || config.systemType === "servsuite") {
        outcome = await EnterpriseBridgeProductionService.dispatchToSystem(
          {
            targetSystem: config.systemType,
            endpointUrl: config.apiBaseUrl ?? "",
            decryptedApiKey: config.apiKey ?? "",
          },
          hardenedPayload,
        );
        success = outcome === "DELIVERED";
        if (!success) {
          errorMessage = `Delivery outcome: ${outcome}`;
        }
      } else if (config.systemType === "fieldroutes") {
        // FieldRoutes uses the existing text-note adapter which is already
        // tested and handles the dual-token auth correctly via apiToken.
        const photos = mediaRows
          .filter((m) => (m.mediaType === "photo" || m.mediaType === "image") && m.url)
          .map((m) => ({
            url: m.url!,
            caption: m.caption ?? null,
            severity: (rawFindings.find((f) => f.imageUrl === m.url)?.severity ?? "low") as string,
          }));

        const pestsFound = [
          ...new Set(
            rawFindings
              .filter((f) => f.category === "Pest Activity" || f.possiblePest)
              .map((f) => f.possiblePest ?? f.category)
              .filter((v): v is string => !!v),
          ),
        ];

        const summary =
          rawFindings.length > 0
            ? rawFindings
                .slice(0, 5)
                .map((f) => `${f.category}: ${f.description}`)
                .join(". ")
            : "No significant findings detected.";

        await syncInspectionToExternalSystem({
          externalSystem: "fieldroutes",
          accountId: config.accountId,
          apiKey: config.apiKey,
          apiToken: config.apiToken,
          apiBaseUrl: config.apiBaseUrl,
          findings: inspectionFindings.map((f, i) => ({
            category: rawFindings[i]?.category ?? f.Code,
            severity: f.Severity,
            evidencePhotoUrl: f.AttachmentUrl ?? null,
            ...(Object.keys(f.CustomFields).length > 0 && {
              measurements: {
                ...(f.CustomFields.WidthMm !== undefined && { widthMm: f.CustomFields.WidthMm }),
                ...(f.CustomFields.HeightMm !== undefined && { heightMm: f.CustomFields.HeightMm }),
                ...(f.CustomFields.VerifiedConfidence !== undefined && {
                  confidence: f.CustomFields.VerifiedConfidence,
                }),
                ...(f.CustomFields.SurfaceType !== undefined && {
                  surfaceType: f.CustomFields.SurfaceType,
                }),
              },
            }),
          })),
          signatureAudit: legacyPayload.SignatureAudit,
          inspectionDate: (inspection.completedAt ?? inspection.createdAt)
            .toISOString()
            .split("T")[0],
          reportSummary: summary,
          photos,
          treatmentConditions: {
            pestsFound,
            chemicalsUsed: [],
            notes: inspection.notes ?? null,
          },
        });
        success = true;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Enterprise sync failed";
      logger.error(
        { companyId, inspectionId, system: config.systemType, error: errorMessage },
        "[EnterpriseAdapterRouter] dispatch failed",
      );
    }

    // Always write a sync log so owners can see auto-trigger attempts.
    await db
      .insert(inspectionSyncLogsTable)
      .values({
        companyId,
        inspectionId,
        systemType: config.systemType,
        success,
        errorMessage,
        resultJson: success
          ? {
              dispatched: true,
              system: config.systemType,
              findingCount: inspectionFindings.length,
              at: new Date().toISOString(),
              trigger: "auto",
            }
          : null,
      })
      .catch((logErr) => {
        logger.error({ logErr }, "[EnterpriseAdapterRouter] failed to write sync log");
      });
  }
}
