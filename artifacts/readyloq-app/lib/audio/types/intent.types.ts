export interface StructuredInspectionEvent {
  action: string;
  product?: string;
  room?: string;
  pest?: string;
  evidence?: string;
  confidence: number;
  rawText: string;
}

export interface VisionContext {
  detectedPest?: string;
  detectedRoom?: string;
  detectedProduct?: string;
}
