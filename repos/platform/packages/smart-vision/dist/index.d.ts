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
export type { VideoFrame, FrameMetadata, FrameDimensions, FrameTimestamp, FrameIndex, FrameRate, PixelFormat, FrameProcessor, FrameBuffer, FramePipeline, PipelineResult, PipelineStats, FramePriority, ScheduledFrame, FrameDropPolicy, FrameScheduler, } from "./frame";
export type { DetectionModelId, DetectionId, DetectedObject, DetectionResult, DetectionModel, DetectionConfig, ClassMapping, DetectionCapability, DetectionEngine, DetectionConfidenceSummary, } from "./detection";
export type { BoundingBox, TrackId, TrackState, TrackedRegion, TrackingTarget, TrackingConfig, ObjectTracker, TrackingEventKind, TrackingEvent, MotionVector, MotionSample, MotionPredictor, } from "./tracking";
export type { ZoomLevel, ZoomConstraints, ZoomState, ZoomCommandKind, ZoomCommand, SmartZoomConfig, SmartZoomController, SubjectLock, SubjectLockEvent, SubjectLockController, FocusPoint, } from "./zoom";
export type { AspectRatio, CropRect, CropRule, CropConstraints, CropSuggestion, SmartCropper, } from "./crop";
export type { PlatformQualityDimension, QualityDimension, QualityAdvisory, FrameQualityReport, QualityThresholds, QualityScorerConfig, QualityScorer, } from "./quality";
export type { CaptureAction, CaptureReason, CaptureScore, CaptureTrigger, CapturePolicyContext, CaptureDecision, CapturePolicy, BuiltInPolicyId, PolicySelection, AutoCaptureEngine, } from "./capture-policy";
export type { AutoCaptureMode, ReadinessScore, CaptureReadiness, ReadinessBlocker, BlockerKind, StabilityMeasure, AutoCaptureConfig, AutoCaptureContext, AutoCaptureTrigger, AutoCaptureEventKind, AutoCaptureEvent, } from "./auto-capture";
export type { GuidanceCode, GuidanceLevel, GuidanceDirective, GuidanceContext, GuidanceEngine, GuidanceFilter, GuidanceSnapshot, } from "./guidance";
export type { EnhancementStrength, DenoiseConfig, DenoiseProvider, SharpenConfig, SharpenProvider, HDRConfig, HDRProvider, ContrastConfig, ContrastProvider, EnhancementConfig, EnhancementPipeline, } from "./enhancement";
export { SCALE_MULTIPLIER } from "./super-resolution";
export type { ScalePreset, UpscaleQuality, UpscaleROI, SuperResolutionRequest, SuperResolutionResult, SuperResolutionCapability, SuperResolutionProvider, SuperResolutionError, } from "./super-resolution";
export type { ObservationId, AnchorId, NoveltyScore, OverlapScore, ObservationKind, SceneCoordinateSpace, SceneObservation, DuplicateVerdictKind, DuplicateVerdict, CoverageCell, SceneCoverage, NavigationPriority, SceneNavigationHint, SceneAnchor, SceneAnchoring, SceneMemoryConfig, SceneMemoryQuery, SceneSnapshot, SceneMemoryEventKind, SceneMemoryEvent, SceneMemory, SceneMemoryStore, } from "./scene-memory";
export type { ProcessingTier, VisionFeatureFlag, VisionCapabilities, CapabilityProbe, CapabilityConstraint, NegotiatedVisionConfig, CapabilityNegotiator, } from "./capability";
export type { SmartVisionEventKind, SessionStartedEvent, SessionPausedEvent, SessionResumedEvent, SessionStoppedEvent, SessionErrorEvent, FrameProcessedEvent, FrameDroppedEvent, TargetDetectedEvent, TargetLostEvent, TargetUpdatedEvent, TargetLockedEvent, TargetUnlockedEvent, ZoomChangedEvent, ZoomCommandIssuedEvent, QualityChangedEvent, QualityThresholdCrossedEvent, CaptureStartedEvent, CaptureCompletedEvent, CaptureSkippedEvent, CapturePolicyChangedEvent, GuidanceEmittedEvent, SceneCoverageUpdatedEvent, SceneDuplicateDetectedEvent, SmartVisionEvent, SmartVisionEventListener, SmartVisionEventBus, } from "./events";
export { DEFAULT_SMART_VISION_CONFIG } from "./config";
export type { SmartVisionFeatureFlags, BatterySaverProfile, FrameProcessingConfig, AutoCapturePolicyConfig, GuidanceConfig, EnhancementOptions, SuperResolutionOptions, OfflineModeConfig, SmartVisionConfig, } from "./config";
export type { VisionProviderId, VisionAnalysisKind, VisionProviderCapabilities, ObjectDetectionAnalysis, ClassificationLabel, ClassificationAnalysis, TextRegion, OcrAnalysis, PoseKeypoint, PoseSubject, PoseAnalysis, DepthAnalysis, FaceRegion, FaceDetectionAnalysis, SegmentationMask, SegmentationAnalysis, CustomAnalysis, VisionAnalysisResult, VisionAnalysisOptions, VisionProvider, ProviderConstraints, VisionProviderRegistry, } from "./vision-provider";
export { DEFAULT_SCENE_MEMORY_ENGINE_CONFIG } from "./scene-memory-engine";
export type { ObjectRecordId, SpatialZoneId, ObservationRecordId, CaptureRecordId, MeasurementRecordId, ObjectRecord, ObjectRegistry, SpatialZone, SpatialMap, ObservationRecord, ObservationHistoryQuery, ObservationHistory, CaptureRecord, CaptureHistoryQuery, CaptureHistory, MeasurementRecord, MeasurementHistoryQuery, MeasurementHistory, SceneMemoryEngineConfig, SceneMemoryEngineEventKind, SceneMemoryEngineEvent, SceneMemoryEngineListener, SceneMemoryEngine, SceneSummary, } from "./scene-memory-engine";
export type { SmartVisionEngineState, SmartVisionSnapshot, CaptureRequest, CaptureResult, SmartVisionSession, SmartVisionEngine, SmartVisionDependencies, SmartVisionFactory, DeepPartial, } from "./engine";
export { createSmartVisionFactory, } from "./impl/smart-vision-engine";
export { createFrameBuffer, } from "./impl/frame-buffer";
export { createFrameScheduler, } from "./impl/frame-scheduler";
export { createFramePipeline, } from "./impl/frame-pipeline";
export { createQualityScorer, } from "./impl/quality-scorer";
export { createObjectTracker, } from "./impl/object-tracker";
export { createMotionPredictor, } from "./impl/motion-predictor";
export { createGuidanceEngine, } from "./impl/guidance-engine";
export { createAutoCaptureEngine, } from "./impl/auto-capture-engine";
export { createBuiltInPolicy, createManualPolicy, createQualityFirstPolicy, createConfidenceFirstPolicy, createBalancedPolicy, createContinuousPolicy, } from "./impl/capture-policies";
export { createSceneMemory, } from "./impl/scene-memory-impl";
export { createSceneMemoryEngine, } from "./impl/scene-memory-engine-impl";
export { createEventBus, } from "./impl/event-bus";
export { createStabilityEstimator, } from "./impl/stability";
export { DEFAULT_PRIVACY_CONFIGURATION } from "./privacy/config";
export type { PrivacyObjectId, PrivacyZoneId, PrivacyObservationId, PrivacyObject, PrivacyMask, PrivacyZone, PrivacyZoneMode, PrivacyFrameResult, PrivacyStatistics, PrivacyClassStats, } from "./privacy/types";
export type { PrivacyObjectClass, PrivacyDetectionRequest, DetectedPrivacyObject, PrivacyDetectionResult, PrivacyDetector, } from "./privacy/detection";
export type { RedactionType, PrivacyObjectPolicy, PrivacyPolicy, PrivacyPolicyMap, } from "./privacy/policy";
export type { PrivacyRenderInput, PrivacyRenderOutput, PrivacyRenderer, } from "./privacy/renderer";
export type { PrivacyObservation, PrivacyObservationTrigger, PrivacyHistoryQuery, PrivacyHistory, } from "./privacy/history";
export type { PrivacyEventKind, PrivacyEvent, PrivacyEventListener, PrivacyEventBus, PrivacySessionStartedEvent, PrivacySessionStoppedEvent, PrivacySessionErrorEvent, PrivacyDetectedEvent, PrivacyUpdatedEvent, PrivacyLostEvent, PrivacyRedactedEvent, PrivacyRestoredEvent, PrivacyPolicyChangedEvent, PrivacyRendererChangedEvent, PrivacyFrameProcessedEvent, } from "./privacy/events";
export type { PrivacyPerformanceMode, PrivacyConfiguration, } from "./privacy/config";
export type { PrivacyProviderCapabilities, PrivacyProvider, PrivacyProviderRegistry, PrivacyProviderRequirements, } from "./privacy/provider";
export type { PrivacyEngineState, PrivacyEngineDependencies, PrivacySession, PrivacyEngine, PrivacyFactory, } from "./privacy/engine";
export { createPrivacyFactory } from "./privacy/impl/privacy-engine-impl";
export { createPrivacyHistory } from "./privacy/impl/privacy-history-impl";
export { createPrivacyTracker } from "./privacy/impl/privacy-tracker";
export type { PrivacyTrackerOptions, PrivacyObjectTracker, PrivacyTrackerUpdateResult, } from "./privacy/impl/privacy-tracker";
export { DEFAULT_LIVE_SESSION_CONFIG, DEFAULT_LIVE_SESSION_FEATURES } from "./live-session/types";
export type { PipelineState, PipelineStage, PipelineStageResult, PipelineFrameResult, LiveSessionFeatureFlags, LiveSessionConfig, } from "./live-session/types";
export type { PipelineEventKind, PipelineEvent, PipelineEventListener, PipelineEventBus, PipelineSessionStartedEvent, PipelineSessionStoppedEvent, PipelineSessionErrorEvent, PipelineFrameAcquiredEvent, PipelineFrameDroppedEvent, PipelineFrameProcessedEvent, PipelineQualityScoredEvent, PipelineDetectionCompletedEvent, PipelineTrackingUpdatedEvent, PipelineSceneDuplicateDetectedEvent, PipelineZoomChangedEvent, PipelinePrivacyObjectDetectedEvent, PipelinePrivacyRedactedEvent, PipelineCaptureTriggeredEvent, PipelineCaptureSkippedEvent, PipelinePerformanceAdaptedEvent, PipelinePerformanceReportEvent, } from "./live-session/events";
export { PROFILE_TARGET_FPS } from "./live-session/performance";
export type { PerformanceProfile, PerformanceMetrics, AdaptationDecision, PerformanceMonitor, } from "./live-session/performance";
export type { FrameSchedulerDecision, FrameScheduleResult, LiveFrameScheduler, } from "./live-session/scheduler";
export type { PipelineStageDescriptor, PipelineStageRunner, PipelineContext, PipelineCoordinator, } from "./live-session/pipeline";
export type { SessionStatistics, VisionSessionSnapshot, VisionSession, } from "./live-session/session";
export type { LiveSessionDependencies, LiveSessionEngine, LiveSessionFactory, } from "./live-session/engine";
export { createLiveSessionFactory } from "./live-session/impl/live-session-engine";
export { createPipelineEventBus } from "./live-session/impl/pipeline-impl";
//# sourceMappingURL=index.d.ts.map