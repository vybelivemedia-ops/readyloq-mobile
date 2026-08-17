/**
 * Enterprise Bridge — canonical structured payload.
 *
 * This is the normalised shape produced by ReadyLoq and consumed by every
 * enterprise adapter (PestPac SOAP, ServSuite REST, FieldRoutes REST).
 * Adapters are responsible for serialising this into their target format.
 */

// ─── Production-hardened types (EnterpriseBridgeProductionService) ────────────

export interface HardenedInspectionPayload {
  inspectionId: string;
  companyId: string;
  propertyId: string;
  technicianId: string;
  timestamp: string;
  signatures: {
    technicianUserId: string;
    /** Raw SVG or URL of the technician's captured signature */
    technicianSignatureUrl: string;
    /** Raw SVG or URL of the customer's captured signature */
    customerSignatureUrl: string;
    signedAt: string;
    signatureVersion: string;
  };
  measurements: Array<{
    /** Stable ID linking measurements back to findings */
    measurementId: string;
    /** Finding ID used as a fallback correlation key */
    elementId: string;
    widthMm: number;
    heightMm: number;
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
 * UNAUTHORIZED       — 401/403 — credentials need rotation
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

export interface DispatchResult {
  status: DeliveryOutcome;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
}

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
