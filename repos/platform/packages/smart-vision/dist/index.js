"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPipelineEventBus = exports.createLiveSessionFactory = exports.PROFILE_TARGET_FPS = exports.DEFAULT_LIVE_SESSION_FEATURES = exports.DEFAULT_LIVE_SESSION_CONFIG = exports.createPrivacyTracker = exports.createPrivacyHistory = exports.createPrivacyFactory = exports.DEFAULT_PRIVACY_CONFIGURATION = exports.createStabilityEstimator = exports.createEventBus = exports.createSceneMemoryEngine = exports.createSceneMemory = exports.createContinuousPolicy = exports.createBalancedPolicy = exports.createConfidenceFirstPolicy = exports.createQualityFirstPolicy = exports.createManualPolicy = exports.createBuiltInPolicy = exports.createAutoCaptureEngine = exports.createGuidanceEngine = exports.createMotionPredictor = exports.createObjectTracker = exports.createQualityScorer = exports.createFramePipeline = exports.createFrameScheduler = exports.createFrameBuffer = exports.createSmartVisionFactory = exports.DEFAULT_SCENE_MEMORY_ENGINE_CONFIG = exports.DEFAULT_SMART_VISION_CONFIG = exports.SCALE_MULTIPLIER = void 0;
// ─── Super resolution ─────────────────────────────────────────────────────────
var super_resolution_1 = require("./super-resolution");
Object.defineProperty(exports, "SCALE_MULTIPLIER", { enumerable: true, get: function () { return super_resolution_1.SCALE_MULTIPLIER; } });
// ─── Configuration ────────────────────────────────────────────────────────────
var config_1 = require("./config");
Object.defineProperty(exports, "DEFAULT_SMART_VISION_CONFIG", { enumerable: true, get: function () { return config_1.DEFAULT_SMART_VISION_CONFIG; } });
// ─── Scene memory engine (first-class scene understanding) ────────────────────
var scene_memory_engine_1 = require("./scene-memory-engine");
Object.defineProperty(exports, "DEFAULT_SCENE_MEMORY_ENGINE_CONFIG", { enumerable: true, get: function () { return scene_memory_engine_1.DEFAULT_SCENE_MEMORY_ENGINE_CONFIG; } });
// ─── Concrete implementations ─────────────────────────────────────────────────
// Factory functions that return ready-to-use instances of all platform contracts.
// Applications import these to wire up the engine without depending on internals.
var smart_vision_engine_1 = require("./impl/smart-vision-engine");
Object.defineProperty(exports, "createSmartVisionFactory", { enumerable: true, get: function () { return smart_vision_engine_1.createSmartVisionFactory; } });
var frame_buffer_1 = require("./impl/frame-buffer");
Object.defineProperty(exports, "createFrameBuffer", { enumerable: true, get: function () { return frame_buffer_1.createFrameBuffer; } });
var frame_scheduler_1 = require("./impl/frame-scheduler");
Object.defineProperty(exports, "createFrameScheduler", { enumerable: true, get: function () { return frame_scheduler_1.createFrameScheduler; } });
var frame_pipeline_1 = require("./impl/frame-pipeline");
Object.defineProperty(exports, "createFramePipeline", { enumerable: true, get: function () { return frame_pipeline_1.createFramePipeline; } });
var quality_scorer_1 = require("./impl/quality-scorer");
Object.defineProperty(exports, "createQualityScorer", { enumerable: true, get: function () { return quality_scorer_1.createQualityScorer; } });
var object_tracker_1 = require("./impl/object-tracker");
Object.defineProperty(exports, "createObjectTracker", { enumerable: true, get: function () { return object_tracker_1.createObjectTracker; } });
var motion_predictor_1 = require("./impl/motion-predictor");
Object.defineProperty(exports, "createMotionPredictor", { enumerable: true, get: function () { return motion_predictor_1.createMotionPredictor; } });
var guidance_engine_1 = require("./impl/guidance-engine");
Object.defineProperty(exports, "createGuidanceEngine", { enumerable: true, get: function () { return guidance_engine_1.createGuidanceEngine; } });
var auto_capture_engine_1 = require("./impl/auto-capture-engine");
Object.defineProperty(exports, "createAutoCaptureEngine", { enumerable: true, get: function () { return auto_capture_engine_1.createAutoCaptureEngine; } });
var capture_policies_1 = require("./impl/capture-policies");
Object.defineProperty(exports, "createBuiltInPolicy", { enumerable: true, get: function () { return capture_policies_1.createBuiltInPolicy; } });
Object.defineProperty(exports, "createManualPolicy", { enumerable: true, get: function () { return capture_policies_1.createManualPolicy; } });
Object.defineProperty(exports, "createQualityFirstPolicy", { enumerable: true, get: function () { return capture_policies_1.createQualityFirstPolicy; } });
Object.defineProperty(exports, "createConfidenceFirstPolicy", { enumerable: true, get: function () { return capture_policies_1.createConfidenceFirstPolicy; } });
Object.defineProperty(exports, "createBalancedPolicy", { enumerable: true, get: function () { return capture_policies_1.createBalancedPolicy; } });
Object.defineProperty(exports, "createContinuousPolicy", { enumerable: true, get: function () { return capture_policies_1.createContinuousPolicy; } });
var scene_memory_impl_1 = require("./impl/scene-memory-impl");
Object.defineProperty(exports, "createSceneMemory", { enumerable: true, get: function () { return scene_memory_impl_1.createSceneMemory; } });
var scene_memory_engine_impl_1 = require("./impl/scene-memory-engine-impl");
Object.defineProperty(exports, "createSceneMemoryEngine", { enumerable: true, get: function () { return scene_memory_engine_impl_1.createSceneMemoryEngine; } });
var event_bus_1 = require("./impl/event-bus");
Object.defineProperty(exports, "createEventBus", { enumerable: true, get: function () { return event_bus_1.createEventBus; } });
var stability_1 = require("./impl/stability");
Object.defineProperty(exports, "createStabilityEstimator", { enumerable: true, get: function () { return stability_1.createStabilityEstimator; } });
// ─── Privacy Engine ───────────────────────────────────────────────────────────
// Re-export all privacy contracts from the sub-module barrel.
// Concrete implementations: import from "./privacy/impl".
var config_2 = require("./privacy/config");
Object.defineProperty(exports, "DEFAULT_PRIVACY_CONFIGURATION", { enumerable: true, get: function () { return config_2.DEFAULT_PRIVACY_CONFIGURATION; } });
var privacy_engine_impl_1 = require("./privacy/impl/privacy-engine-impl");
Object.defineProperty(exports, "createPrivacyFactory", { enumerable: true, get: function () { return privacy_engine_impl_1.createPrivacyFactory; } });
var privacy_history_impl_1 = require("./privacy/impl/privacy-history-impl");
Object.defineProperty(exports, "createPrivacyHistory", { enumerable: true, get: function () { return privacy_history_impl_1.createPrivacyHistory; } });
var privacy_tracker_1 = require("./privacy/impl/privacy-tracker");
Object.defineProperty(exports, "createPrivacyTracker", { enumerable: true, get: function () { return privacy_tracker_1.createPrivacyTracker; } });
// ─── Live Session Engine ──────────────────────────────────────────────────────
var types_1 = require("./live-session/types");
Object.defineProperty(exports, "DEFAULT_LIVE_SESSION_CONFIG", { enumerable: true, get: function () { return types_1.DEFAULT_LIVE_SESSION_CONFIG; } });
Object.defineProperty(exports, "DEFAULT_LIVE_SESSION_FEATURES", { enumerable: true, get: function () { return types_1.DEFAULT_LIVE_SESSION_FEATURES; } });
var performance_1 = require("./live-session/performance");
Object.defineProperty(exports, "PROFILE_TARGET_FPS", { enumerable: true, get: function () { return performance_1.PROFILE_TARGET_FPS; } });
var live_session_engine_1 = require("./live-session/impl/live-session-engine");
Object.defineProperty(exports, "createLiveSessionFactory", { enumerable: true, get: function () { return live_session_engine_1.createLiveSessionFactory; } });
var pipeline_impl_1 = require("./live-session/impl/pipeline-impl");
Object.defineProperty(exports, "createPipelineEventBus", { enumerable: true, get: function () { return pipeline_impl_1.createPipelineEventBus; } });
