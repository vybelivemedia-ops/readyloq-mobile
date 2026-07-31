export interface StructuredInspectionEvent {
  action: string;
  product?: string;
  room?: string;
  pest?: string;
  evidence?: string;
  /** Severity level extracted from the transcript ("minor", "high severity", "critical", etc.). */
  severity?: "low" | "medium" | "high" | "critical";
  confidence: number;
  rawText: string;
  /** True when the transcript contains spatial/deictic language ("this", "here", etc.). */
  isSpatial?: boolean;
  /**
   * The vision-identified object the technician is spatially referring to.
   * Populated from VisionContext.detectedObject when isSpatial is true.
   */
  visionTarget?: string;
  /** URI of the camera frame captured at the instant this voice command fired. */
  imageUri?: string;
  /**
   * True when the voice command is a photo-capture trigger
   * ("take a photo", "snap", "capture", etc.).
   * The FAIE handler fires takePhoto() and skips the notes append.
   */
  capturePhoto?: boolean;
  /**
   * The inspection form field the technician explicitly addressed via a
   * routing prefix ("client name is…", "site address is…", etc.).
   * When set, the FAIE handler writes fieldValue to that field directly
   * instead of appending to the notes log.
   */
  targetField?: "clientName" | "siteAddress" | "notes" | "pestType" | "baitStation";
  /**
   * The extracted value for targetField, with the routing prefix stripped.
   * Only present when targetField is set.
   */
  fieldValue?: string;
  /**
   * Application equipment detected in the transcript (e.g. "B&G sprayer",
   * "bait gun", "bulb duster"). When set, the FAIE handler cross-references
   * the technician's daily route assignments to verify correct product usage
   * against label standards for the active target pest.
   */
  equipment?: string;
}

export interface VisionContext {
  detectedPest?: string;
  detectedRoom?: string;
  detectedProduct?: string;
  /**
   * Spatially-identified object currently visible in the camera frame
   * (e.g. "wall gap", "door sweep", "grease trap").
   * Populated by the vision pipeline or smart-vision detections.
   */
  detectedObject?: string;
  /** Epoch-ms timestamp of the most recent context update. */
  timestamp?: number;
  /** URI of the frame used to derive this context. */
  imageUri?: string;
}
