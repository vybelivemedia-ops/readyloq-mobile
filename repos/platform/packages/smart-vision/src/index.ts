/**
 * @platform/smart-vision
 *
 * Platform vision intelligence — a source-agnostic, domain-agnostic layer of
 * smart camera capabilities that any application can adopt.
 *
 * ─── OWNS ──────────────────────────────────────────────────────────────────
 *
 * Live frame processing        VideoFrame · FrameBuffer · FramePipeline · FrameProcessor
 * Object tracking              ObjectTracker · TrackedRegion · TrackingTarget
 * Motion prediction            MotionPredictor · MotionVector · MotionSample
 * Smart zoom                   SmartZoomController · ZoomCommand · ZoomConstraints
 * Subject locking              SubjectLockController · SubjectLock
 * Smart crop                   SmartCropper · CropSuggestion · CropRule
 * Auto capture                 AutoCaptureTrigger · CaptureReadiness · AutoCaptureConfig
 * Super resolution             SuperResolutionProvider · SuperResolutionRequest/Result
 * Quality scoring              QualityScorer · FrameQualityReport · QualityDimension
 * Device capability            CapabilityNegotiator · VisionCapabilities · NegotiatedVisionConfig
 *
 * ─── DOES NOT OWN ──────────────────────────────────────────────────────────
 *
 * × Pest inspection logic (→ application layer)
 * × Live-streaming / creator logic (→ application layer)
 * × EvidenceItem persistence (→ @platform/camera-core, @platform/sync-engine)
 * × AI analysis of captured frames (→ @platform/ai-core)
 * × Camera provider implementations (→ @platform/camera-core)
 * × AI prompts of any kind (→ application layer)
 *
 * ─── DEPENDENCY GRAPH ──────────────────────────────────────────────────────
 *
 *   smart-vision → camera-core → shared-types → core
 *
 * ─── GOVERNANCE ────────────────────────────────────────────────────────────
 *
 * This package is permanently domain-neutral. Zero pest/creator/product-
 * specific identifiers may appear in any source file. See GOVERNANCE.md.
 */

// ─── Frame processing ─────────────────────────────────────────────────────────
export type {
  VideoFrame,
  FrameMetadata,
  FrameDimensions,
  FrameTimestamp,
  FrameIndex,
  FrameRate,
  PixelFormat,
  FrameProcessor,
  FrameBuffer,
  FramePipeline,
  PipelineResult,
  PipelineStats,
} from "./frame";

// ─── Object tracking + motion prediction ─────────────────────────────────────
export type {
  BoundingBox,
  TrackId,
  TrackState,
  TrackedRegion,
  TrackingTarget,
  TrackingConfig,
  ObjectTracker,
  TrackingEventKind,
  TrackingEvent,
  MotionVector,
  MotionSample,
  MotionPredictor,
} from "./tracking";

// ─── Smart zoom + subject locking ────────────────────────────────────────────
export type {
  ZoomLevel,
  ZoomConstraints,
  ZoomState,
  ZoomCommandKind,
  ZoomCommand,
  SmartZoomConfig,
  SmartZoomController,
  SubjectLock,
  SubjectLockEvent,
  SubjectLockController,
  FocusPoint,
} from "./zoom";

// ─── Smart crop ───────────────────────────────────────────────────────────────
export type {
  AspectRatio,
  CropRect,
  CropRule,
  CropConstraints,
  CropSuggestion,
  SmartCropper,
} from "./crop";

// ─── Auto capture ─────────────────────────────────────────────────────────────
export type {
  AutoCaptureMode,
  ReadinessScore,
  CaptureReadiness,
  ReadinessBlocker,
  BlockerKind,
  StabilityMeasure,
  AutoCaptureConfig,
  AutoCaptureContext,
  AutoCaptureTrigger,
  AutoCaptureEventKind,
  AutoCaptureEvent,
} from "./auto-capture";

// ─── Super resolution ─────────────────────────────────────────────────────────
export { SCALE_MULTIPLIER } from "./super-resolution";
export type {
  ScalePreset,
  UpscaleQuality,
  UpscaleROI,
  SuperResolutionRequest,
  SuperResolutionResult,
  SuperResolutionCapability,
  SuperResolutionProvider,
  SuperResolutionError,
} from "./super-resolution";

// ─── Quality scoring ──────────────────────────────────────────────────────────
export type {
  PlatformQualityDimension,
  QualityDimension,
  QualityAdvisory,
  FrameQualityReport,
  QualityThresholds,
  QualityScorerConfig,
  QualityScorer,
} from "./quality";

// ─── Device capability negotiation ───────────────────────────────────────────
export type {
  ProcessingTier,
  VisionFeatureFlag,
  VisionCapabilities,
  CapabilityProbe,
  CapabilityConstraint,
  NegotiatedVisionConfig,
  CapabilityNegotiator,
} from "./capability";
