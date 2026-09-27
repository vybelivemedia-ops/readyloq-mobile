/**
 * EnterpriseBridgeProductionService
 *
 * Production-hardened dispatch layer for PestPac and ServSuite.
 * Responsibilities:
 *   - Deterministic (key-sorted) SHA-256 payload hashing for tamper-evidence
 *   - Explicit ID-based measurement ↔ finding linkage (no array-index coupling)
 *   - Code field sanitisation (spaces → underscores, strips non-alphanumeric)
 *   - Safe XML serialisation via XMLBuilder + CDATA wrapper (no injection risk)
 *   - SOAP fault body parsing (SOAP faults arrive inside HTTP 200 responses)
 *   - Granular DispatchResult with status + httpStatus + errorCode + errorMessage
 *
 * Credential resolution stays in the router (which owns the DB context). This
 * service receives a pre-resolved ResolvedEnterpriseConfig so it remains a pure
 * transformation + dispatch layer with no DB dependency.
 */

import { XMLBuilder } from "fast-xml-parser";
import * as crypto from "crypto";
import type {
  HardenedInspectionPayload,
  DispatchResult,
} from "../../types/enterprise-payload";
import { ssrfSafeFetch } from "../../lib/ssrf-safe-fetch";

export interface ResolvedEnterpriseConfig {
  targetSystem: "pestpac" | "servsuite";
  /**
   * Base URL for the external system (trailing slash optional).
   * The adapter appends the correct operation path internally:
   *   • PestPac:   <baseUrl>/ImportInspectionResult
   *   • ServSuite: <baseUrl>/workorders
   */
  endpointUrl: string;
  /** Decrypted API key / bearer token resolved from the DB record */
  decryptedApiKey: string;
}

// ─── Normalised work-order shape ──────────────────────────────────────────────

export interface NormalizedWorkOrder {
  /** ReadyLoq company ID — carried through so downstream adapters can route or log. */
  CompanyId: string;
  ExternalWorkOrderId: string;
  LocationReference: {
    PropertyCode: string;
  };
  ServiceDetails: {
    CompletedByEmployeeId: string;
    /** ISO 8601 UTC timestamp from HardenedInspectionPayload.timestamp */
    ServiceDate: string;
  };
  SignatureAudit: {
    TechnicianUserId: string;
    TechnicianSignatureUrl: string;
    CustomerSignatureUrl: string;
    SignedAt: string;
    SignatureVersion: string;
    /**
     * SHA-256 of the canonical inspection payload (signatures excluded).
     * Any post-signing mutation of the inspection data breaks this hash.
     */
    InspectionHash: string;
    /**
     * SHA-256 of the full payload including the signatures block.
     * Proves the signature record was not swapped after the inspection hash
     * was computed.
     */
    PayloadHash: string;
  };
  InspectionFindings: Array<{
    /** Sanitised code slug: CATEGORY_SEVERITY (spaces→_, non-alphanumeric stripped). */
    Code: string;
    Description: string;
    VerificationStatus: {
      /** Confidence score in [0, 1] */
      AiConfidence: number;
      TechnicianConfirmed: boolean;
      ManagerVerified: boolean;
    };
    /** Present only when a linked measurement record exists. */
    CustomFields:
      | { WidthMm: number; HeightMm: number; SurfaceType: string }
      | Record<string, never>;
    AttachmentUrl: string;
  }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EnterpriseBridgeProductionService {
  // ─── Canonical serialisation ────────────────────────────────────────────

  /**
   * Key-sorted JSON serialisation that produces the same string regardless of
   * the order in which object keys were inserted.  Required for a stable hash:
   * JSON.stringify key order is implementation-defined and must not be trusted
   * for cryptographic purposes.
   */
  private static _stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(EnterpriseBridgeProductionService._stableStringify).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value as object).sort();
      const pairs = keys.map(
        (k) =>
          `${JSON.stringify(k)}:${EnterpriseBridgeProductionService._stableStringify(
            (value as Record<string, unknown>)[k],
          )}`,
      );
      return `{${pairs.join(",")}}`;
    }
    return JSON.stringify(value);
  }

  // ─── Cryptographic hashing ───────────────────────────────────────────────

  /**
   * SHA-256 of the canonical inspection payload (signatures excluded).
   * Uses key-sorted serialisation so the hash is stable across runtimes and
   * object construction order.
   *
   * Called with an explicit class reference (not `this`) so a subclass override
   * cannot silently change the hashing algorithm for all callers of normalizePayload.
   */
  static generateInspectionHash(
    payload: Omit<HardenedInspectionPayload, "signatures">,
  ): string {
    const canonical = EnterpriseBridgeProductionService._stableStringify(payload);
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  // ─── Payload normalisation ───────────────────────────────────────────────

  /**
   * Produces the canonical NormalizedWorkOrder consumed by both adapters.
   *
   * Key invariants:
   *   • InspectionHash covers everything except signatures — mutation detector.
   *   • PayloadHash covers the full payload including signatures — proves the
   *     signature block was not swapped after the inspection was hashed.
   *   • Measurement lookup uses measurementId only — never crosses into the
   *     elementId/findingId namespace (different entity types, separate ID spaces).
   *   • Code is sanitised: spaces → underscores, non-alphanumeric chars stripped.
   */
  static normalizePayload(data: HardenedInspectionPayload): NormalizedWorkOrder {
    const { signatures, ...restOfPayload } = data;

    // Two distinct hashes — use the explicit class ref so subclass overrides
    // cannot silently change the algorithm for either.
    const inspectionHash =
      EnterpriseBridgeProductionService.generateInspectionHash(restOfPayload);
    const payloadHash = crypto
      .createHash("sha256")
      .update(EnterpriseBridgeProductionService._stableStringify(data))
      .digest("hex");

    const sanitize = (s: string): string =>
      s.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");

    return {
      CompanyId: data.companyId,
      ExternalWorkOrderId: data.externalWorkOrderId ?? data.inspectionId,
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
        PayloadHash: payloadHash,
      },
      InspectionFindings: data.aiFindings.map((finding) => {
        // Only look up by measurementId — never compare elementId to findingId
        // (they are in separate entity namespaces and will never share an ID).
        const measurement = finding.measurementId
          ? data.measurements.find((m) => m.measurementId === finding.measurementId)
          : undefined;

        return {
          Code: `${sanitize(finding.category)}_${sanitize(finding.severity)}`,
          Description: `AI prediction: '${finding.aiPrediction}'. Confirmed by tech: ${finding.technicianConfirmed}.`,
          VerificationStatus: {
            AiConfidence: finding.confidence,
            TechnicianConfirmed: finding.technicianConfirmed,
            ManagerVerified: finding.managerVerified,
          },
          // Use conditional spread so the key is absent (not {}) when there is
          // no linked measurement — some XML/SOAP parsers treat an empty element
          // differently from an absent one.
          ...(measurement
            ? {
                CustomFields: {
                  WidthMm: measurement.widthMm,
                  HeightMm: measurement.heightMm,
                  SurfaceType: measurement.surfaceType,
                },
              }
            : { CustomFields: {} as Record<string, never> }),
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
  ): Promise<DispatchResult> {
    if (!resolvedConfig.endpointUrl || !resolvedConfig.decryptedApiKey) {
      return {
        status: "INVALID_CONFIGURATION",
        errorMessage: "Integration config is missing endpoint URL or API key.",
      };
    }

    const normalized = EnterpriseBridgeProductionService.normalizePayload(payload);

    try {
      if (resolvedConfig.targetSystem === "pestpac") {
        return await EnterpriseBridgeProductionService._dispatchPestPac(
          resolvedConfig,
          normalized,
        );
      } else {
        return await EnterpriseBridgeProductionService._dispatchServSuite(
          resolvedConfig,
          normalized,
        );
      }
    } catch (error: unknown) {
      return EnterpriseBridgeProductionService._classifyError(error);
    }
  }

  // ─── Private adapter methods ─────────────────────────────────────────────

  private static async _dispatchPestPac(
    cfg: ResolvedEnterpriseConfig,
    normalized: NormalizedWorkOrder,
  ): Promise<DispatchResult> {
    const operationUrl =
      cfg.endpointUrl.replace(/\/$/, "") + "/ImportInspectionResult";

    const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, format: false });
    const serializedWorkOrder = xmlBuilder.build(normalized);

    // apiKey is interpolated as element text — escape XML special chars.
    // serializedWorkOrder is wrapped in CDATA so it is treated as raw data,
    // not parsed XML, regardless of what XMLBuilder produces.
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ImportInspectionResult xmlns="http://tempuri.org/">
      <apiKey>${EnterpriseBridgeProductionService._escapeXml(cfg.decryptedApiKey)}</apiKey>
      <workOrderData><![CDATA[${serializedWorkOrder}]]></workOrderData>
    </ImportInspectionResult>
  </soap:Body>
</soap:Envelope>`;

    const response = await ssrfSafeFetch(operationUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://tempuri.org/ImportInspectionResult",
      },
      body: soapEnvelope,
      signal: AbortSignal.timeout(15_000),
    });

    // Handle HTTP-level auth/validation errors first (some PestPac deployments
    // use HTTP auth in addition to the SOAP apiKey field).
    if (response.status === 401 || response.status === 403) {
      return {
        status: "UNAUTHORIZED",
        httpStatus: response.status,
        errorCode: "HTTP_UNAUTHORIZED",
        errorMessage: "PestPac rejected the request at the HTTP level.",
      };
    }
    if (response.status === 400 || response.status === 422) {
      return {
        status: "PERMANENT_FAILURE",
        httpStatus: response.status,
        errorCode: "HTTP_BAD_REQUEST",
        errorMessage: "PestPac returned a 400/422 — payload is malformed.",
      };
    }

    // SOAP servers always return HTTP 200, even for faults. Read the body and
    // inspect for a <soap:Fault> block to detect auth and validation errors.
    const responseBody = await response.text();
    if (
      responseBody.includes("<soap:Fault>") ||
      responseBody.includes("<faultcode>")
    ) {
      const isAuthFault =
        responseBody.includes("InvalidApiKey") ||
        responseBody.includes("Authentication") ||
        responseBody.includes("Unauthorized");
      return {
        status: isAuthFault ? "UNAUTHORIZED" : "PERMANENT_FAILURE",
        httpStatus: response.status,
        errorCode: "SOAP_FAULT",
        errorMessage: isAuthFault
          ? "PestPac SOAP fault: authentication failed. Rotate the API key."
          : "PestPac SOAP fault: server rejected the payload. Check errorCode for details.",
      };
    }

    return response.status === 200
      ? { status: "DELIVERED", httpStatus: response.status }
      : {
          status: "RETRYABLE_FAILURE",
          httpStatus: response.status,
          errorMessage: `PestPac returned unexpected HTTP ${response.status}.`,
        };
  }

  private static async _dispatchServSuite(
    cfg: ResolvedEnterpriseConfig,
    normalized: NormalizedWorkOrder,
  ): Promise<DispatchResult> {
    const operationUrl =
      cfg.endpointUrl.replace(/\/$/, "") + "/workorders";

    const response = await ssrfSafeFetch(operationUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${cfg.decryptedApiKey}`,
        "Content-Type": "application/json",
        "X-ReadyLoq-Bridge": "v2-hardened",
      },
      body: JSON.stringify(normalized),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403) {
      return {
        status: "UNAUTHORIZED",
        httpStatus: response.status,
        errorCode: "HTTP_UNAUTHORIZED",
        errorMessage: "ServSuite rejected the bearer token.",
      };
    }
    if (response.status === 400 || response.status === 422) {
      return {
        status: "PERMANENT_FAILURE",
        httpStatus: response.status,
        errorCode: "HTTP_BAD_REQUEST",
        errorMessage: "ServSuite returned a 400/422 — payload is malformed.",
      };
    }
    return response.status >= 200 && response.status < 300
      ? { status: "DELIVERED", httpStatus: response.status }
      : {
          status: "RETRYABLE_FAILURE",
          httpStatus: response.status,
          errorMessage: `ServSuite returned unexpected HTTP ${response.status}.`,
        };
  }

  private static _classifyError(error: unknown): DispatchResult {
    if (error instanceof Error) {
      // AbortSignal.timeout() throws DOMException { name: "TimeoutError" }
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return {
          status: "TIMEOUT",
          errorCode: error.name,
          errorMessage: "Request timed out before a response was received.",
        };
      }
      return {
        status: "RETRYABLE_FAILURE",
        errorMessage: error.message,
      };
    }
    return {
      status: "RETRYABLE_FAILURE",
      errorMessage: "An unknown error occurred during dispatch.",
    };
  }

  /** Full XML special-character escaping — prevents injection into SOAP body. */
  private static _escapeXml(unsafe: string): string {
    return (unsafe ?? "").replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case "<":  return "&lt;";
        case ">":  return "&gt;";
        case "&":  return "&amp;";
        case "'":  return "&apos;";
        case '"':  return "&quot;";
        default:   return c;
      }
    });
  }
}
