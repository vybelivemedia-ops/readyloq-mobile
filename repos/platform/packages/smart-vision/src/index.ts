/**
 * @platform/smart-vision
 *
 * Platform vision intelligence — a source-agnostic, domain-agnostic OS-level
 * layer of smart camera capabilities that any application can adopt.
 *
 * Applications plug in detection models, capture policies, and guidance
 * renderers; the engine handles everything else.
 *
 * ─── OWNS ───────────────────────────────────────────────────────────────────
 *
 * Live frame processing        VideoFrame · FrameBuffer · FramePipeline · FrameScheduler
 * AI detection                 DetectionEngine · DetectedObject · DetectionResult
 * Object tracking              ObjectTracker · TrackedRegion · MotionPredictor
 * Smart zoom + subject lock    SmartZoomController · SubjectLockController
 * Smart crop                   SmartCropper · CropSuggestion
 * Quality engine               QualityScorer · FrameQualityReport (sharpness, exposure, motion, framing…)
 * Capture policies             AutoCaptureEngine · CapturePolicy · CaptureDecision
 * AI guidance                  GuidanceEngine · GuidanceDirective · GuidanceCode
 * Image enhancement            DenoiseProvider · SharpenProvider · HDRProvider · ContrastProvider
 * Super resolution             SuperResolutionProvider
 * Scene memory                 SceneMemory · DuplicateVerdict · SceneCoverage
 * Event bus                    SmartVisionEventBus · SmartVisionEvent (22 typed events)
 * Configuration                SmartVisionConfig · DEFAULT_SMART_VISION_CONFIG
 * Engine orchestrator          SmartVisionEngine · SmartVisionSession · SmartVisionFactory
 *
 * ─── DOES NOT OWN ───────────────────────────────────────────────────────────
 *
 * × Domain detection models — pest/person/product/sports (→ application layer)
 * × AI prompts of any kind (→ application layer)
 * × Domain-specific guidance copy (→ application layer maps GuidanceCode)
 * × EvidenceItem persistence (→ @platform/camera-core, @platform/sync-engine)
 * × AI post-capture analysis (→ @platform/ai-core)
 * × Camera provider implementations (→ @platform/camera-core)
 *
 * ─── DEPENDENCY GRAPH ───────────────────────────────────────────────────────
 *
 *   smart-vision → camera-core → shared-types → core
 *
 * ─── GOVERNANCE ─────────────────────────────────────────────────────────────
 *
 * Permanently domain-neutral. Zero pest/creator/product-specific identifiers
 * in any source file. See repos/platform/GOVERNANCE.md.
 */

// ─── Frame processing + scheduling ───────────────────────────────────────────
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
  FramePriority,
  ScheduledFrame,
  FrameDropPolicy,
  FrameScheduler,
} from "./frame";

// ─── AI detection ─────────────────────────────────────────────────────────────
export type {
  DetectionModelId,
  DetectionId,
  DetectedObject,
  DetectionResult,
  DetectionModel,
  DetectionConfig,
  ClassMapping,
  DetectionCapability,
  DetectionEngine,
  DetectionConfidenceSummary,
} from "./detection";

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

// ─── Quality engine ───────────────────────────────────────────────────────────
export type {
  PlatformQualityDimension,
  QualityDimension,
  QualityAdvisory,
  FrameQualityReport,
  QualityThresholds,
  QualityScorerConfig,
  QualityScorer,
} from "./quality";

// ─── Capture policies (policy-based auto-capture) ─────────────────────────────
export type {
  CaptureAction,
  CaptureReason,
  CaptureScore,
  CaptureTrigger,
  CapturePolicyContext,
  CaptureDecision,
  CapturePolicy,
  BuiltInPolicyId,
  PolicySelection,
  AutoCaptureEngine,
} from "./capture-policy";

// ─── Auto-capture trigger (simple threshold-based, kept for compat) ───────────
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

// ─── AI guidance ─────────────────────────────────────────────────────────────
export type {
  GuidanceCode,
  GuidanceLevel,
  GuidanceDirective,
  GuidanceContext,
  GuidanceEngine,
  GuidanceFilter,
  GuidanceSnapshot,
} from "./guidance";

// ─── Image enhancement ────────────────────────────────────────────────────────
export type {
  EnhancementStrength,
  DenoiseConfig,
  DenoiseProvider,
  SharpenConfig,
  SharpenProvider,
  HDRConfig,
  HDRProvider,
  ContrastConfig,
  ContrastProvider,
  EnhancementConfig,
  EnhancementPipeline,
} from "./enhancement";

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

// ─── Scene memory ─────────────────────────────────────────────────────────────
export type {
  ObservationId,
  AnchorId,
  NoveltyScore,
  OverlapScore,
  ObservationKind,
  SceneCoordinateSpace,
  SceneObservation,
  DuplicateVerdictKind,
  DuplicateVerdict,
  CoverageCell,
  SceneCoverage,
  NavigationPriority,
  SceneNavigationHint,
  SceneAnchor,
  SceneAnchoring,
  SceneMemoryConfig,
  SceneMemoryQuery,
  SceneSnapshot,
  SceneMemoryEventKind,
  SceneMemoryEvent,
  SceneMemory,
  SceneMemoryStore,
} from "./scene-memory";

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

// ─── Typed event bus ──────────────────────────────────────────────────────────
export type {
  SmartVisionEventKind,
  SessionStartedEvent,
  SessionPausedEvent,
  SessionResumedEvent,
  SessionStoppedEvent,
  SessionErrorEvent,
  FrameProcessedEvent,
  FrameDroppedEvent,
  TargetDetectedEvent,
  TargetLostEvent,
  TargetUpdatedEvent,
  TargetLockedEvent,
  TargetUnlockedEvent,
  ZoomChangedEvent,
  ZoomCommandIssuedEvent,
  QualityChangedEvent,
  QualityThresholdCrossedEvent,
  CaptureStartedEvent,
  CaptureCompletedEvent,
  CaptureSkippedEvent,
  CapturePolicyChangedEvent,
  GuidanceEmittedEvent,
  SceneCoverageUpdatedEvent,
  SceneDuplicateDetectedEvent,
  SmartVisionEvent,
  SmartVisionEventListener,
  SmartVisionEventBus,
} from "./events";

// ─── Configuration ────────────────────────────────────────────────────────────
export { DEFAULT_SMART_VISION_CONFIG } from "./config";
export type {
  SmartVisionFeatureFlags,
  BatterySaverProfile,
  FrameProcessingConfig,
  AutoCapturePolicyConfig,
  GuidanceConfig,
  EnhancementOptions,
  SuperResolutionOptions,
  OfflineModeConfig,
  SmartVisionConfig,
} from "./config";

// ─── Engine orchestrator ──────────────────────────────────────────────────────
export type {
  SmartVisionEngineState,
  SmartVisionSnapshot,
  CaptureRequest,
  CaptureResult,
  SmartVisionSession,
  SmartVisionEngine,
  SmartVisionDependencies,
  SmartVisionFactory,
  DeepPartial,
} from "./engine";
