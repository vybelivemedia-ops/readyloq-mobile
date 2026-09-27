/**
 * Enterprise Bridge — canonical structured payload.
 *
 * This is the normalised shape produced by ReadyLoq and consumed by every
 * enterprise adapter (PestPac SOAP, ServSuite REST, FieldRoutes REST).
 * Adapters are responsible for serialising this into their target format.
 */

// ─── Production-hardened types (EnterpriseBridgeProductionService) ────────────

export interface HardenedInspectionPayload {
  /** ReadyLoq inspection ID used for the durable local outbox FK. */
  inspectionId: string;
  /** PestPac/enterprise work-order ID when the inspection originated externally. */
  externalWorkOrderId?: string;
  companyId: string;
  propertyId: string;
  technicianId: string;
  /** ISO 8601 UTC timestamp, e.g. '2026-08-16T14:30:00.000Z' */
  timestamp: string;
  signatures: {
    technicianUserId: string;
    /** Raw SVG or URL of the technician's captured signature */
    technicianSignatureUrl: string;
    /** Raw SVG or URL of the customer's captured signature */
    customerSignatureUrl: string;
    /** ISO 8601 UTC timestamp of the first signature captured */
    signedAt: string;
    /** Schema version of the signature capture workflow */
    signatureVersion: "v1" | "v2";
  };
  measurements: Array<{
    /** Stable ID linking measurements back to findings */
    measurementId: string;
    /**
     * Building element ID (wall, vent, pipe, etc.).
     * Separate namespace from findingId — never compare the two.
     */
    elementId: string;
    widthMm: number;
    heightMm: number;
    /** Confidence score in the range [0, 1] */
    confidence: number;
    surfaceType: string;
  }>;
  aiFindings: Array<{
    findingId: string;
    /** Explicit foreign key to measurements[].measurementId */
    measurementId?: string;
    category: string;
    severity: string;
    aiPrediction: string;
    technicianConfirmed: boolean;
    managerVerified: boolean;
    /** Confidence score in the range [0, 1] */
    confidence: number;
    evidencePhotoUrl: string;
  }>;
}

/**
 * Granular delivery outcome from the production bridge dispatch.
 *
 * DELIVERED          — 2xx received from the external system
 * RETRYABLE_FAILURE  — transient error (5xx, network blip) — safe to retry
 * PERMANENT_FAILURE  — 400/422 malformed payload — dead-letter, do not retry
 * UNAUTHORIZED       — 401/403 or SOAP auth fault — credentials need rotation
 * INVALID_CONFIGURATION — missing endpoint or API key in DB record
 * TIMEOUT            — no response within the per-system deadline
 */
export type DeliveryOutcome =
  | "DELIVERED"
  | "RETRYABLE_FAILURE"
  | "PERMANENT_FAILURE"
  | "UNAUTHORIZED"
  | "INVALID_CONFIGURATION"
  | "TIMEOUT";

/**
 * Discriminated union — each variant carries only the fields relevant to its
 * outcome so callers can switch-narrow without null-checking optionals.
 *
 * Note: httpStatus is optional on UNAUTHORIZED because SOAP auth faults are
 * delivered inside an HTTP 200 body; the status field conveys the semantic
 * outcome regardless of the transport-level code.
 */
export type DispatchResult =
  | { status: "DELIVERED"; httpStatus?: number }
  | { status: "RETRYABLE_FAILURE"; httpStatus?: number; errorCode?: string; errorMessage: string }
  | { status: "PERMANENT_FAILURE"; httpStatus?: number; errorCode?: string; errorMessage: string }
  | { status: "UNAUTHORIZED";      httpStatus?: number; errorCode?: string; errorMessage: string }
  | { status: "INVALID_CONFIGURATION";                                       errorMessage: string }
  | { status: "TIMEOUT";           errorCode?: string;                       errorMessage: string };

// ─── Legacy payload types (FieldRoutes adapter — kept for compat) ─────────────

export interface EnterpriseSyncFinding {
  /** e.g. "RODENT_ACTIVITY_HIGH" — category + severity slug */
  Code: string;
  /** Human-readable description from the AI finding */
  Description: string;
  /** "low" | "medium" | "high" | "critical" */
  Severity: string;
  CustomFields: {
    /** Laser-measured or vision-estimated gap width in millimetres */
    WidthMm?: number;
    /** Laser-measured or vision-estimated gap height in millimetres */
    HeightMm?: number;
    /** Model confidence score 0–1 */
    VerifiedConfidence?: number;
    /** e.g. "concrete_foundation", "wood_frame" */
    SurfaceType?: string;
  };
  /** Signed object-storage URL for the evidence photo */
  AttachmentUrl?: string;
}

export interface EnterpriseSyncPayload {
  /** Inspection ID used as the external work-order correlation key */
  ExternalWorkOrderId: string;
  LocationReference: {
    /** Service address — used to look up the customer record in the CRM */
    PropertyCode: string;
  };
  ServiceDetails: {
    /** Technician user ID within ReadyLoq */
    CompletedByEmployeeId: string;
    /** ISO-8601 date-time when the inspection was completed */
    ServiceDate: string;
    TechnicianName: string;
  };
  InspectionFindings: EnterpriseSyncFinding[];
  /**
   * Compliance sign-off record.
   * technicianSigned is always expected; ownerSigned may be false when
   * ownerNotAvailable is true (technician signed on owner's behalf).
   */
  SignatureAudit: {
    technicianSigned: boolean;
    ownerSigned: boolean;
    /** True when the owner/tenant was absent and the technician acknowledged it */
    ownerNotAvailable: boolean;
    /** ISO-8601 timestamp of the first signature captured — null if unsigned */
    signedAt: string | null;
  };
}
