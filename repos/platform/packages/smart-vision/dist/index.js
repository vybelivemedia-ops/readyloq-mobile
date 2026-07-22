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
// ─── Super resolution ─────────────────────────────────────────────────────────
export { SCALE_MULTIPLIER } from "./super-resolution";
// ─── Configuration ────────────────────────────────────────────────────────────
export { DEFAULT_SMART_VISION_CONFIG } from "./config";
// ─── Scene memory engine (first-class scene understanding) ────────────────────
export { DEFAULT_SCENE_MEMORY_ENGINE_CONFIG } from "./scene-memory-engine";
// ─── Concrete implementations ─────────────────────────────────────────────────
// Factory functions that return ready-to-use instances of all platform contracts.
// Applications import these to wire up the engine without depending on internals.
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
// ─── Privacy Engine ───────────────────────────────────────────────────────────
// Re-export all privacy contracts from the sub-module barrel.
// Concrete implementations: import from "./privacy/impl".
export { DEFAULT_PRIVACY_CONFIGURATION } from "./privacy/config";
export { createPrivacyFactory } from "./privacy/impl/privacy-engine-impl";
export { createPrivacyHistory } from "./privacy/impl/privacy-history-impl";
export { createPrivacyTracker } from "./privacy/impl/privacy-tracker";
// ─── Live Session Engine ──────────────────────────────────────────────────────
export { DEFAULT_LIVE_SESSION_CONFIG, DEFAULT_LIVE_SESSION_FEATURES } from "./live-session/types";
export { PROFILE_TARGET_FPS } from "./live-session/performance";
export { createLiveSessionFactory } from "./live-session/impl/live-session-engine";
export { createPipelineEventBus } from "./live-session/impl/pipeline-impl";
