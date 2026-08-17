/**
 * EnterpriseBridgeProductionService
 *
 * Production-hardened dispatch layer for PestPac and ServSuite.
 * Responsibilities:
 *   - Cryptographic payload hashing for tamper-evidence (SignatureAudit)
 *   - Explicit ID-based measurement ↔ finding linkage (no array-index coupling)
 *   - Safe XML serialisation via XMLBuilder (no string interpolation injection risk)
 *   - Granular DeliveryOutcome classification (DELIVERED / RETRYABLE_FAILURE /
 *     PERMANENT_FAILURE / UNAUTHORIZED / INVALID_CONFIGURATION / TIMEOUT)
 *
 * Credential resolution intentionally stays in the router (which owns the DB
 * context). This service receives a pre-resolved ResolvedEnterpriseConfig so it
 * remains a pure transformation + dispatch layer with no DB dependency.
 */

import { XMLBuilder } from "fast-xml-parser";
import * as crypto from "crypto";
import type { HardenedInspectionPayload, DeliveryOutcome } from "../../types/enterprise-payload";

export interface ResolvedEnterpriseConfig {
  targetSystem: "pestpac" | "servsuite";
  /** Fully-qualified endpoint URL for the external system */
  endpointUrl: string;
  /** Decrypted API key / bearer token resolved from the DB record */
  decryptedApiKey: string;
}

export class EnterpriseBridgeProductionService {
  // ─── Cryptographic hashing ───────────────────────────────────────────────

  /**
   * SHA-256 of the canonical inspection payload (signatures excluded).
   * Bound into SignatureAudit so any post-signing mutation breaks the hash.
   */
  static generateInspectionHash(
    payload: Omit<HardenedInspectionPayload, "signatures">,
  ): string {
    const canonical = JSON.stringify(payload);
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  // ─── Payload normalisation ───────────────────────────────────────────────

  /**
   * Produces the canonical normalised form consumed by both adapters.
   * Uses explicit measurementId / elementId matching — never array-index coupling.
   */
  static normalizePayload(data: HardenedInspectionPayload) {
    const { signatures, ...restOfPayload } = data;
    const inspectionHash = this.generateInspectionHash(restOfPayload);

    return {
      ExternalWorkOrderId: data.inspectionId,
      LocationReference: {
        PropertyCode: data.propertyId,
      },
      ServiceDetails: {
        CompletedByEmployeeId: data.technicianId,
        ServiceDate: data.timestamp,
      },
      SignatureAudit: {
        TechnicianUserId: signatures.technicianUserId,
        TechnicianSignatureUrl: signatures.technicianSignatureUrl,
        CustomerSignatureUrl: signatures.customerSignatureUrl,
        SignedAt: signatures.signedAt,
        SignatureVersion: signatures.signatureVersion,
        InspectionHash: inspectionHash,
        PayloadHash: inspectionHash,
      },
      InspectionFindings: data.aiFindings.map((finding) => {
        // Explicit ID-based lookup — never positional array indexing.
        const measurement = data.measurements.find(
          (m) =>
            m.measurementId === finding.measurementId ||
            m.elementId === finding.findingId,
        );

        return {
          Code: `${finding.category.toUpperCase()}_${finding.severity.toUpperCase()}`,
          Description: `AI prediction: '${finding.aiPrediction}'. Confirmed by tech: ${finding.technicianConfirmed}.`,
          VerificationStatus: {
            AiConfidence: finding.confidence,
            TechnicianConfirmed: finding.technicianConfirmed,
            ManagerVerified: finding.managerVerified,
          },
          CustomFields: measurement
            ? {
                WidthMm: measurement.widthMm,
                HeightMm: measurement.heightMm,
                SurfaceType: measurement.surfaceType,
              }
            : {},
          AttachmentUrl: finding.evidencePhotoUrl,
        };
      }),
    };
  }

  // ─── Dispatch ────────────────────────────────────────────────────────────

  /**
   * Dispatches the normalised payload to PestPac or ServSuite.
   *
   * @param resolvedConfig  Pre-resolved DB config (credentials injected by router)
   * @param payload         Fully-populated HardenedInspectionPayload
   */
  static async dispatchToSystem(
    resolvedConfig: ResolvedEnterpriseConfig,
    payload: HardenedInspectionPayload,
  ): Promise<DeliveryOutcome> {
    if (!resolvedConfig.endpointUrl || !resolvedConfig.decryptedApiKey) {
      return "INVALID_CONFIGURATION";
    }

    const normalized = this.normalizePayload(payload);

    try {
      if (resolvedConfig.targetSystem === "pestpac") {
        return await this._dispatchPestPac(resolvedConfig, normalized);
      } else {
        return await this._dispatchServSuite(resolvedConfig, normalized);
      }
    } catch (error: unknown) {
      return this._classifyError(error);
    }
  }

  // ─── Private adapter methods ─────────────────────────────────────────────

  private static async _dispatchPestPac(
    cfg: ResolvedEnterpriseConfig,
    normalized: ReturnType<typeof EnterpriseBridgeProductionService.normalizePayload>,
  ): Promise<DeliveryOutcome> {
    // XMLBuilder serialises the normalised payload object — no string interpolation.
    const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, format: false });
    const serializedWorkOrder = xmlBuilder.build(normalized);

    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ImportInspectionResult xmlns="http://tempuri.org/">
      <apiKey>${this._escapeXml(cfg.decryptedApiKey)}</apiKey>
      <workOrderData>${serializedWorkOrder}</workOrderData>
    </ImportInspectionResult>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetch(cfg.endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://tempuri.org/ImportInspectionResult",
      },
      body: soapEnvelope,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) return "UNAUTHORIZED";
    if (response.status === 400 || response.status === 422) return "PERMANENT_FAILURE";
    return response.status === 200 ? "DELIVERED" : "RETRYABLE_FAILURE";
  }

  private static async _dispatchServSuite(
    cfg: ResolvedEnterpriseConfig,
    normalized: ReturnType<typeof EnterpriseBridgeProductionService.normalizePayload>,
  ): Promise<DeliveryOutcome> {
    const response = await fetch(cfg.endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.decryptedApiKey}`,
        "Content-Type": "application/json",
        "X-ReadyLoq-Bridge": "v2-hardened",
      },
      body: JSON.stringify(normalized),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403) return "UNAUTHORIZED";
    if (response.status === 400 || response.status === 422) return "PERMANENT_FAILURE";
    return response.status >= 200 && response.status < 300
      ? "DELIVERED"
      : "RETRYABLE_FAILURE";
  }

  private static _classifyError(error: unknown): DeliveryOutcome {
    if (error instanceof Error) {
      const name = error.name;
      // AbortSignal.timeout() throws a TimeoutError (DOMException name="TimeoutError")
      if (name === "TimeoutError" || name === "AbortError") return "TIMEOUT";
    }
    return "RETRYABLE_FAILURE";
  }

  /** Full XML special-character escaping (prevents injection into SOAP body). */
  private static _escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "&": return "&amp;";
        case "'": return "&apos;";
        case '"': return "&quot;";
        default: return c;
      }
    });
  }
}
