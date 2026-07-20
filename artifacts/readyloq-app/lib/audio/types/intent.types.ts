export interface StructuredInspectionEvent {
  action: string;
  product?: string;
  room?: string;
  pest?: string;
  evidence?: string;
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
