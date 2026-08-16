/**
 * Enterprise Bridge — canonical structured payload.
 *
 * This is the normalised shape produced by ReadyLoq and consumed by every
 * enterprise adapter (PestPac SOAP, ServSuite REST, FieldRoutes REST).
 * Adapters are responsible for serialising this into their target format.
 */

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
