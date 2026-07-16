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

import type { VideoFrame, FrameTimestamp, FrameDimensions } from "./frame";
import type { DetectionEngine, DetectionResult } from "./detection";
import type { ObjectTracker, TrackedRegion } from "./tracking";
import type { MotionPredictor } from "./tracking";
import type { SmartZoomController, ZoomState } from "./zoom";
import type { SubjectLockController, SubjectLock } from "./zoom";
import type { SmartCropper } from "./crop";
import type { QualityScorer, FrameQualityReport } from "./quality";
import type { AutoCaptureEngine, CaptureDecision, CapturePolicy } from "./capture-policy";
import type { GuidanceEngine, GuidanceDirective } from "./guidance";
import type { SceneMemory, SceneCoverage, SceneObservation } from "./scene-memory";
import type { EnhancementPipeline } from "./enhancement";
import type { SuperResolutionProvider } from "./super-resolution";
import type { SmartVisionEventBus, SmartVisionEvent } from "./events";
import type { SmartVisionConfig } from "./config";
import type { VisionCapabilities, NegotiatedVisionConfig } from "./capability";
import type { StabilityMeasure } from "./auto-capture";
import type { CropSuggestion, CropRule } from "./crop";

// ─── Engine state ─────────────────────────────────────────────────────────────

export type SmartVisionEngineState =
  | "idle"       // created but not started
  | "starting"   // warming up models, allocating resources
  | "running"    // actively processing frames
  | "paused"     // frame ingestion suspended; resources held
  | "stopping"   // teardown in progress
  | "error";     // non-recoverable error; must recreate

// ─── Session snapshot ─────────────────────────────────────────────────────────

/**
 * Point-in-time view of all live engine state.
 * Available at any time via SmartVisionEngine.snapshot().
 * Used for UI rendering (overlays, status panels) and diagnostics.
 */
export interface SmartVisionSnapshot {
  sessionId: string;
  timestamp: FrameTimestamp;
  engineState: SmartVisionEngineState;
  /** Most recent quality report. Null before the first frame is processed. */
  quality: FrameQualityReport | null;
  /** Most recent detection result. Null when detection is off or not yet run. */
  detection: DetectionResult | null;
  /** All currently tracked regions. */
  trackedRegions: readonly TrackedRegion[];
  /** Current subject lock state. */
  subjectLock: SubjectLock | null;
  /** Current zoom state. */
  zoom: ZoomState | null;
  /** Latest capture decision. Null before the first policy evaluation. */
  lastDecision: CaptureDecision | null;
  /** Latest guidance directives. */
  guidance: readonly GuidanceDirective[];
  /** Scene coverage summary. */
  coverage: SceneCoverage | null;
  /** Current camera stability. */
  stability: StabilityMeasure | null;
  /** Total captures in this session. */
  captureCount: number;
  /** Frames processed since session start. */
  processedFrames: number;
  /** Frames dropped since session start. */
  droppedFrames: number;
  /** Current effective analysis FPS. */
  currentFps: number;
}

// ─── Capture request / result ─────────────────────────────────────────────────

/**
 * Application-initiated capture request (manual trigger).
 *
 * When the operator taps the capture button, the application calls
 * SmartVisionSession.requestCapture(). The engine evaluates the current
 * frame immediately using the active policy with trigger="manual_request".
 */
export interface CaptureRequest {
  /** Optional crop rule override for this capture. */
  cropRule?: CropRule;
  /**
   * Application-defined label for the resulting evidence item.
   * The engine passes this through to CaptureCompletedEvent.evidenceId.
   */
  label?: string;
  /**
   * Force capture even if policy returns a non-capture action.
   * Use with care — forces a capture regardless of quality or confidence.
   */
  force?: boolean;
}

export interface CaptureResult {
  decision: CaptureDecision;
  crop: CropSuggestion | null;
  /** Enhanced frame (if AI enhancement is enabled). Null otherwise. */
  enhancedFrame: VideoFrame | null;
  /** Upscaled frame (if super-resolution is enabled). Null otherwise. */
  upscaledFrame: VideoFrame | null;
  captureIndex: number;
}

// ─── Live session ─────────────────────────────────────────────────────────────

/**
 * An active SmartVision processing session.
 *
 * Obtained from SmartVisionEngine.start(). The session holds all live state
 * and accepts incoming frames. Stop it with `stop()` to release resources.
 */
export interface SmartVisionSession {
  readonly sessionId: string;
  readonly config: SmartVisionConfig;
  readonly capabilities: NegotiatedVisionConfig;

  // ── Frame ingestion ───────────────────────────────────────────────────────

  /**
   * Feed a raw video frame into the engine.
   *
   * The engine schedules the frame through the pipeline according to
   * `config.frameProcessing.analysisTargetFps`. Frames that arrive faster
   * than the analysis rate are buffered or dropped per the FrameDropPolicy.
   *
   * Returns immediately — processing is asynchronous. Subscribe to
   * "sv.frame.processed" on the event bus to receive results.
   */
  feedFrame(frame: VideoFrame): void;

  // ── Manual capture ────────────────────────────────────────────────────────

  /**
   * Trigger a capture immediately, bypassing the normal auto-capture cadence.
   *
   * The engine still evaluates the policy (with trigger="manual_request")
   * and returns a CaptureResult. Pass `force: true` to override policy rejection.
   */
  requestCapture(request?: CaptureRequest): Promise<CaptureResult>;

  // ── Pause / resume ────────────────────────────────────────────────────────

  /**
   * Pause frame processing. The session remains open; models stay warm.
   * Publish "sv.session.paused". Call resume() to continue.
   */
  pause(reason?: string): void;
  /** Resume a paused session. Publishes "sv.session.resumed". */
  resume(): void;

  // ── Policy management ─────────────────────────────────────────────────────

  /** Switch the active capture policy at runtime. */
  setPolicy(policy: CapturePolicy | string): void;

  // ── Live state ────────────────────────────────────────────────────────────

  /** Current point-in-time snapshot of all engine state. */
  snapshot(): SmartVisionSnapshot;

  /** Subscribe to scene memory observations (read-only view). */
  queryObservations(options?: { kinds?: string[]; limit?: number }): readonly SceneObservation[];

  // ── Stop ──────────────────────────────────────────────────────────────────

  /**
   * Stop the session and release all resources.
   * After calling stop(), the session cannot be reused. Create a new one
   * via SmartVisionEngine.start().
   */
  stop(): Promise<void>;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * SmartVisionEngine — the top-level orchestrator.
 *
 * Applications create one engine instance per device camera session.
 * Multiple simultaneous engines (e.g. front + rear cameras) are supported
 * as long as the device has sufficient resources.
 *
 * Lifecycle:
 *   SmartVisionFactory.create(deps, config)
 *     → SmartVisionEngine (idle)
 *       → .start() → SmartVisionSession (running)
 *         → .feedFrame() per camera callback
 *         → .requestCapture() on manual trigger
 *         → .stop() when done
 *     → .destroy() to release the engine itself
 */
export interface SmartVisionEngine {
  readonly state: SmartVisionEngineState;
  readonly events: SmartVisionEventBus;
  readonly config: SmartVisionConfig;

  /**
   * Start a new session with the current configuration.
   * Warms up all configured models and allocates pipeline resources.
   * Resolves when the engine is ready to accept frames.
   *
   * Only one session may be active at a time. Call the previous session's
   * stop() before starting a new one.
   */
  start(): Promise<SmartVisionSession>;

  /**
   * Update the engine configuration at runtime.
   * Changes take effect on the next frame after the update.
   * Feature flag changes that require model warm-up/teardown are applied
   * asynchronously; the session continues at reduced capability during transition.
   */
  updateConfig(partial: DeepPartial<SmartVisionConfig>): void;

  /**
   * Release all engine resources.
   * Stops any active session first, then tears down all models and pipelines.
   * After destroy(), this engine instance cannot be reused.
   */
  destroy(): Promise<void>;
}

// ─── Dependencies (DI container) ─────────────────────────────────────────────

/**
 * All injectable dependencies the SmartVisionEngine requires.
 *
 * Applications supply concrete implementations for the sub-systems they use.
 * All dependencies are optional — the engine degrades gracefully when a
 * sub-system is absent (e.g. no DetectionEngine → no auto-capture decisions
 * based on confidence; no EnhancementPipeline → raw captures).
 *
 * This is the primary extension point. ReadyLoq injects pest-detection models;
 * VYBE injects person/face/product tracking models. The engine itself remains
 * domain-agnostic.
 */
export interface SmartVisionDependencies {
  /** AI model for per-frame object detection. Required for confidence-based capture. */
  detectionEngine?: DetectionEngine;
  /** Object tracking across frames. Required for subject locking. */
  objectTracker?: ObjectTracker;
  /** Motion predictor for occluded targets. */
  motionPredictor?: MotionPredictor;
  /** Smart zoom controller. Required for smart-zoom feature. */
  zoomController?: SmartZoomController;
  /** Subject lock controller. Required for subject-locking feature. */
  subjectLockController?: SubjectLockController;
  /** Smart crop engine. Required for smart-crop feature. */
  cropper?: SmartCropper;
  /** Quality scorer. Required for quality scoring feature. */
  qualityScorer?: QualityScorer;
  /** Auto-capture engine (implements policy evaluation). Required for auto-capture. */
  autoCaptureEngine?: AutoCaptureEngine;
  /** Guidance engine. Required for real-time operator directives. */
  guidanceEngine?: GuidanceEngine;
  /** Scene memory. Required for duplicate detection and coverage tracking. */
  sceneMemory?: SceneMemory;
  /** Post-capture enhancement pipeline. */
  enhancementPipeline?: EnhancementPipeline;
  /** Super-resolution provider for final captured frames. */
  superResolutionProvider?: SuperResolutionProvider;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates SmartVisionEngine instances.
 *
 * The factory negotiates the final NegotiatedVisionConfig from the device
 * capabilities and the requested SmartVisionConfig, then wires the
 * dependencies into the engine.
 *
 * Usage:
 *   const engine = SmartVisionFactory.create(deps, capabilities, config);
 *   const session = await engine.start();
 *   cameraCallback = (frame) => session.feedFrame(frame);
 */
export interface SmartVisionFactory {
  create(
    deps: SmartVisionDependencies,
    capabilities: VisionCapabilities,
    config?: Partial<SmartVisionConfig>,
  ): SmartVisionEngine;
}

// ─── Utility types ────────────────────────────────────────────────────────────

/**
 * Recursive partial — used by SmartVisionEngine.updateConfig().
 * Allows partial deep updates without requiring full object replacement.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
