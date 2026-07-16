/**
 * @platform/smart-vision/privacy — engine + session contracts.
 *
 * PrivacyEngine: lifecycle manager (create, start sessions, destroy).
 * PrivacySession: active session that processes frames.
 * PrivacyFactory: entry point for application code.
 *
 * ARCHITECTURE:
 *   PrivacyFactory.createEngine(deps)   → PrivacyEngine (idle)
 *   engine.startSession(policy, config) → PrivacySession (running)
 *   session.feedFrame(frame)            → PrivacyFrameResult
 *   session.stop()                      → void
 *   engine.destroy()                    → void
 *
 * GOVERNANCE: Zero domain logic. All behaviour injected via deps + policy.
 * See repos/platform/GOVERNANCE.md.
 */

import type { VideoFrame } from "../frame";
import type { ObjectTracker } from "../tracking";
import type { SceneMemory } from "../scene-memory";
import type { PrivacyProvider } from "./provider";
import type { PrivacyRenderer } from "./renderer";
import type { PrivacyHistory } from "./history";
import type { PrivacyPolicy } from "./policy";
import type { PrivacyConfiguration } from "./config";
import type { PrivacyObject, PrivacyFrameResult, PrivacyStatistics } from "./types";
import type { PrivacyEventBus } from "./events";

// ─── Engine state ─────────────────────────────────────────────────────────────

export type PrivacyEngineState =
  | "idle"       // created; no active session
  | "running"    // active session processing frames
  | "stopping"   // teardown in progress
  | "error";     // non-recoverable error

// ─── Dependencies ─────────────────────────────────────────────────────────────

/**
 * Injectable dependencies for the Privacy Engine.
 *
 * Only `provider` is required. All other deps are optional — the engine
 * operates gracefully without them, at reduced capability.
 */
export interface PrivacyEngineDependencies {
  /**
   * The AI inference adapter. Required.
   * Provides privacy-sensitive object detections per frame.
   */
  readonly provider: PrivacyProvider;
  /**
   * Optional visual redaction renderer.
   * When omitted, the engine produces PrivacyMask[] but does not render pixels.
   * Applications can render masks independently.
   */
  readonly renderer?: PrivacyRenderer;
  /**
   * Optional reference to the SmartVision ObjectTracker.
   * When provided, the engine can reuse existing track IDs and positions,
   * avoiding redundant tracking computation.
   */
  readonly objectTracker?: ObjectTracker;
  /**
   * Optional reference to the SmartVision SceneMemory.
   * When provided and config.sceneMemoryEnabled is true, the engine consults
   * scene memory before running inference.
   */
  readonly sceneMemory?: SceneMemory;
}

// ─── PrivacySession ───────────────────────────────────────────────────────────

/**
 * An active Privacy Engine session.
 *
 * One session maps to one continuous visual stream (live video or still images).
 * Applications create sessions via PrivacyEngine.startSession().
 *
 * ORIGINAL MEDIA PRESERVATION:
 *   feedFrame() receives the original frame — it is NEVER mutated.
 *   PrivacyFrameResult.masks   = the redaction instructions.
 *   The renderer (if configured) produces a separate redacted copy.
 *   Applications decide which "layer" to display or store.
 */
export interface PrivacySession {
  /** Unique session identifier, stable for the lifetime of this session. */
  readonly sessionId: string;
  /** The policy active when the session was started (may change via updatePolicy). */
  readonly policy: PrivacyPolicy;
  /** Effective configuration for this session. */
  readonly config: PrivacyConfiguration;
  /** Event bus scoped to this session. */
  readonly events: PrivacyEventBus;

  // ── Frame ingestion ─────────────────────────────────────────────────────────

  /**
   * Process one live video frame through the Privacy Engine pipeline:
   *   1. Stride check — skip inference if within detection stride
   *   2. AI inference (if not skipped)
   *   3. ID association — assign stable PrivacyObjectIds via IoU matching
   *   4. Policy application — determine which objects to redact
   *   5. Mask generation — produce PrivacyMask for each redacted region
   *   6. Rendering — call renderer.render() if configured
   *   7. Event emission
   *   8. History update
   *
   * The original `frame` is never mutated.
   * Returns immediately if the session is stopped or config.liveVideo is false.
   */
  feedFrame(frame: VideoFrame): Promise<PrivacyFrameResult>;

  /**
   * Process a static captured image through the full pipeline.
   * Always runs inference (no stride skipping).
   * Ignores config.liveVideo — respects config.capturedImages instead.
   *
   * The original `frame` is never mutated.
   */
  processImage(frame: VideoFrame): Promise<PrivacyFrameResult>;

  // ── Runtime policy management ───────────────────────────────────────────────

  /**
   * Swap the active privacy policy at runtime.
   * Emits a "privacy.policy_changed" event.
   * Previously detected objects are re-evaluated against the new policy;
   * redaction state may change immediately.
   */
  updatePolicy(policy: PrivacyPolicy): void;

  /**
   * Swap the active renderer at runtime.
   * Emits a "privacy.renderer_changed" event.
   * Destroys the previous renderer.
   */
  updateRenderer(renderer: PrivacyRenderer | null): Promise<void>;

  // ── State inspection ────────────────────────────────────────────────────────

  /**
   * All currently active (tracked) privacy objects.
   * Objects are retained until `maxMissingFrames` elapses without detection.
   */
  getActiveObjects(): readonly PrivacyObject[];

  /** Access the append-only observation history for this session. */
  getHistory(): PrivacyHistory;

  /** Aggregate statistics for this session. */
  getStatistics(): PrivacyStatistics;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Reset the session state: clear tracked objects, history, and statistics.
   * Does not stop or recreate the session — processing continues with fresh state.
   * Emits no lifecycle events (not a stop/start cycle).
   */
  reset(): void;

  /**
   * Stop the session. Releases all internal state.
   * Emits "privacy.session.stopped".
   * After stop(), further feedFrame() calls are no-ops.
   */
  stop(): Promise<void>;
}

// ─── PrivacyEngine ────────────────────────────────────────────────────────────

/**
 * The Privacy Engine manages session lifecycle and event routing.
 *
 * One engine is created per application launch (or per stream context).
 * Multiple sessions can be started sequentially (not concurrently).
 */
export interface PrivacyEngine {
  readonly state: PrivacyEngineState;
  /** Global event bus — receives all events from all sessions. */
  readonly events: PrivacyEventBus;

  /**
   * Start a new privacy session.
   * Initialises the provider, warms up the renderer, and begins processing.
   *
   * Only one active session at a time. The previous session (if any) is
   * stopped before the new one starts.
   */
  startSession(
    policy: PrivacyPolicy,
    config?: Partial<PrivacyConfiguration>,
  ): Promise<PrivacySession>;

  /**
   * Destroy the engine: stop any active session and release all resources.
   * After destroy(), the engine cannot be reused.
   */
  destroy(): Promise<void>;
}

// ─── PrivacyFactory ───────────────────────────────────────────────────────────

/**
 * Entry point for creating a Privacy Engine.
 *
 * Applications call `createPrivacyFactory()` to get a factory, then call
 * `factory.createEngine(deps)` to get an engine ready to start sessions.
 */
export interface PrivacyFactory {
  /**
   * Create a new PrivacyEngine with the given dependencies.
   * The engine is idle until `startSession()` is called.
   */
  createEngine(deps: PrivacyEngineDependencies): PrivacyEngine;
}
