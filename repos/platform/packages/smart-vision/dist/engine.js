"use strict";
/**
 * @platform/smart-vision — SmartVisionEngine orchestrator.
 *
 * SmartVisionEngine is the single top-level entry point for all smart-vision
 * capabilities. Applications create one engine per session via
 * SmartVisionFactory.create(), feed it frames, and consume events.
 *
 * The engine wires together:
 *   FramePipeline     — buffers, schedules, and routes frames
 *   DetectionEngine   — runs AI inference on scheduled frames
 *   ObjectTracker     — associates detections across frames
 *   MotionPredictor   — extrapolates positions for occluded targets
 *   SmartZoomCtrl     — computes zoom adjustments per frame
 *   SmartCropper      — suggests crop for each capture
 *   QualityScorer     — scores frames across multiple quality dimensions
 *   AutoCaptureEngine — applies policy-based capture decisions
 *   GuidanceEngine    — emits generic operator directives
 *   SceneMemory       — tracks processed regions; detects duplicates
 *   EnhancementPipeline — applies post-capture enhancements
 *   SmartVisionEventBus — publishes all state changes
 *
 * GOVERNANCE: The engine itself contains zero domain logic. All domain-specific
 * behaviour is injected by the application via SmartVisionDependencies.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
