/**
 * @platform/smart-vision/live-session — LiveSessionEngine contract.
 *
 * LiveSessionEngine is the top-level entry point for the platform's
 * continuous vision pipeline. Applications create one engine per context
 * (one per camera session, one per stream), inject their dependencies,
 * and call startSession() to begin processing.
 *
 * Architecture:
 *   LiveSessionFactory.createEngine(deps)   → LiveSessionEngine
 *   engine.startSession(config)             → VisionSession
 *   session.feedFrame(frame)                → (async pipeline runs)
 *   session.events.on(...)                  → application receives results
 *
 * The engine coordinates:
 *   - SmartVision pipeline (stability, quality, detection, tracking,
 *     motion prediction, scene memory, zoom, auto-capture)
 *   - Privacy Engine (detection + redaction)
 *   - PerformanceMonitor (adaptive FPS)
 *   - FrameScheduler (frame rate control + drop policy)
 *   - Unified PipelineEventBus (single subscription surface)
 *
 * GOVERNANCE: Zero domain logic. All behaviour injected via dependencies.
 * See repos/platform/GOVERNANCE.md.
 */

import type { DetectionEngine } from "../detection";
import type { ObjectTracker, MotionPredictor } from "../tracking";
import type { SmartZoomController } from "../zoom";
import type { SubjectLockController } from "../zoom";
import type { SmartCropper } from "../crop";
import type { QualityScorer } from "../quality";
import type { AutoCaptureEngine } from "../capture-policy";
import type { GuidanceEngine } from "../guidance";
import type { SceneMemory } from "../scene-memory";
import type { SceneMemoryEngine } from "../scene-memory-engine";
import type { VisionProviderRegistry } from "../vision-provider";
import type { PrivacyProvider } from "../privacy/provider";
import type { PrivacyRenderer } from "../privacy/renderer";
import type { PipelineState } from "./types";
import type { LiveSessionConfig } from "./types";
import type { PipelineEventBus } from "./events";
import type { VisionSession } from "./session";

// ─── Dependencies ─────────────────────────────────────────────────────────────

/**
 * Injectable dependencies for the LiveSessionEngine.
 *
 * All dependencies are optional — the engine degrades gracefully when
 * a dependency is absent. Disabled stages consume no resources.
 *
 * When features.detection is true but no detectionEngine is provided,
 * the detection stage is skipped with a warning event.
 */
export interface LiveSessionDependencies {
  // ── Vision / detection ──────────────────────────────────────────────────────
  /**
   * AI detection engine. Required for detection, tracking, scene memory,
   * zoom, and auto-capture stages (which all depend on detection results).
   */
  readonly detectionEngine?: DetectionEngine;

  // ── Tracking ────────────────────────────────────────────────────────────────
  /** Object tracker for stable cross-frame IDs. */
  readonly objectTracker?: ObjectTracker;
  /** Motion predictor for position extrapolation on non-inference frames. */
  readonly motionPredictor?: MotionPredictor;

  // ── Scene memory ────────────────────────────────────────────────────────────
  /** Scene memory for duplicate suppression and coverage tracking. */
  readonly sceneMemory?: SceneMemory;
  /**
   * Full scene memory engine (multi-registry: objects, spatial, observations,
   * captures, measurements). Used when deeper memory integration is needed.
   * When provided, takes precedence over sceneMemory.
   */
  readonly sceneMemoryEngine?: SceneMemoryEngine;

  // ── Quality ─────────────────────────────────────────────────────────────────
  /** Quality scorer for blur, luminance, and resolution assessment. */
  readonly qualityScorer?: QualityScorer;

  // ── Zoom / crop ─────────────────────────────────────────────────────────────
  /** Smart zoom controller for per-frame zoom adjustment suggestions. */
  readonly zoomController?: SmartZoomController;
  /** Subject lock for fixing zoom on a primary target. */
  readonly subjectLockController?: SubjectLockController;
  /** Smart cropper for pre-capture crop suggestions. */
  readonly smartCropper?: SmartCropper;

  // ── Auto capture ────────────────────────────────────────────────────────────
  /** Auto capture engine for policy-driven trigger decisions. */
  readonly autoCaptureEngine?: AutoCaptureEngine;
  /** Guidance engine for operator directives. */
  readonly guidanceEngine?: GuidanceEngine;

  // ── Privacy ─────────────────────────────────────────────────────────────────
  /**
   * Privacy detection provider. Required when features.privacy is true.
   * Without it, the privacy stage is skipped regardless of the feature flag.
   */
  readonly privacyProvider?: PrivacyProvider;
  /**
   * Privacy renderer. Optional — when absent, masks are emitted via events
   * but pixels are not modified. Applications can render masks independently.
   */
  readonly privacyRenderer?: PrivacyRenderer;

  // ── Provider registry ────────────────────────────────────────────────────────
  /**
   * Optional vision provider registry for multi-provider setups.
   * The engine uses this to select the best available provider per frame.
   */
  readonly providerRegistry?: VisionProviderRegistry;
}

// ─── LiveSessionEngine ────────────────────────────────────────────────────────

/**
 * Manages VisionSession lifecycle.
 *
 * One LiveSessionEngine per application camera context.
 * Multiple sessions may be started sequentially (not concurrently).
 */
export interface LiveSessionEngine {
  /** Current engine state. */
  readonly state: PipelineState;
  /** Global event bus — receives events from all sessions. */
  readonly events: PipelineEventBus;

  /**
   * Start a new VisionSession.
   *
   * Initialises all provided dependencies, warms up the privacy provider (if any),
   * and starts the processing loop. The returned VisionSession is immediately
   * ready to accept frames via feedFrame().
   *
   * Only one active session at a time. If a previous session is running,
   * it is stopped before the new one starts.
   *
   * @param config  Session configuration. Defaults from DEFAULT_LIVE_SESSION_CONFIG
   *                are applied for omitted fields.
   */
  startSession(config?: Partial<LiveSessionConfig>): Promise<VisionSession>;

  /**
   * Destroy the engine and all associated resources.
   * Any active session is stopped first.
   * After destroy(), the engine cannot be reused.
   */
  destroy(): Promise<void>;
}

// ─── LiveSessionFactory ───────────────────────────────────────────────────────

/**
 * Entry point for creating a LiveSessionEngine.
 *
 * Usage:
 *   const factory = createLiveSessionFactory();
 *   const engine  = factory.createEngine(deps);
 *   const session = await engine.startSession(config);
 *   session.feedFrame(frame);
 *   session.events.on("pipeline.frame.processed", handleResult);
 */
export interface LiveSessionFactory {
  /**
   * Create a new LiveSessionEngine with the given dependencies.
   * The engine is idle until startSession() is called.
   */
  createEngine(deps: LiveSessionDependencies): LiveSessionEngine;
}
