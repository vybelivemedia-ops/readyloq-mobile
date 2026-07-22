"use strict";
/**
 * @platform/smart-vision — VisionProvider abstraction.
 *
 * Instead of binding the SmartVisionEngine to a single DetectionEngine, this
 * module defines a pluggable VisionProvider interface. Any backend that can
 * analyse a VideoFrame and return structured results qualifies as a provider:
 *
 *   On-device          CoreML, TFLite, ONNX Runtime, MediaPipe
 *   Remote API         OpenAI Vision, Gemini Vision, Azure CV, Rekognition
 *   Custom             Enterprise models, domain-specific runtimes
 *
 * The engine asks: "Who can analyse this frame for object_detection?"
 * The registry returns the highest-priority healthy provider.
 * The engine doesn't care how the result was produced.
 *
 * ─── Relationship to DetectionEngine ───────────────────────────────────────
 *
 * `DetectionEngine` (detection.ts) remains for backward compatibility and
 * for callers that want the narrower, detection-only contract.
 * `ObjectDetectionProvider` (below) bridges the two: a DetectionEngine can
 * trivially implement ObjectDetectionProvider by wrapping its `detect()` call.
 *
 * GOVERNANCE: Analysis result types are domain-neutral. classId values in
 * ObjectDetectionAnalysis are application-defined integers — the platform
 * never assigns meaning to them. See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
