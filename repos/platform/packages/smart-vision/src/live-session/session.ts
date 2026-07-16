/**
 * @platform/smart-vision/live-session — VisionSession contract.
 *
 * VisionSession is the primary interface that applications interact with.
 * It accepts frames, exposes the unified PipelineEventBus, and provides
 * real-time statistics and control.
 *
 * Applications do NOT interact with SmartVisionEngine, PrivacyEngine, or
 * individual stage runners directly — everything is mediated through VisionSession.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { VideoFrame, FrameTimestamp } from "../frame";
import type { PipelineState, PipelineStage, LiveSessionConfig } from "./types";
import type { PipelineEventBus } from "./events";
import type { PerformanceMetrics, PerformanceProfile } from "./performance";

// ─── Session statistics ───────────────────────────────────────────────────────

/**
 * Real-time statistics for the active VisionSession.
 * Updated after each processed frame.
 */
export interface SessionStatistics {
  readonly sessionId: string;
  readonly startedAt: FrameTimestamp;
  readonly durationMs: number;

  // ── Frame counts ────────────────────────────────────────────────────────────
  /** Total frames received via feedFrame(). */
  readonly framesAcquired: number;
  /** Frames that completed all pipeline stages. */
  readonly framesProcessed: number;
  /** Frames dropped by the scheduler or due to queue overflow. */
  readonly framesDropped: number;
  /** Frames that ran AI inference (as opposed to tracking extrapolation). */
  readonly framesWithInference: number;

  // ── Rates ───────────────────────────────────────────────────────────────────
  /** Current effective processing FPS over the last rolling window. */
  readonly currentFps: number;
  /** Configured target FPS at session start. */
  readonly targetFps: number;
  /** Fraction of frames dropped (0–1). */
  readonly dropRate: number;

  // ── Latency ─────────────────────────────────────────────────────────────────
  readonly averageLatencyMs: number;
  readonly peakLatencyMs: number;

  // ── Per-stage averages ──────────────────────────────────────────────────────
  readonly stageLatencies: Partial<Record<PipelineStage, number>>;

  // ── Privacy ─────────────────────────────────────────────────────────────────
  readonly totalPrivacyObjectsDetected: number;
  readonly totalPrivacyRedactions: number;

  // ── Capture ─────────────────────────────────────────────────────────────────
  readonly totalCaptures: number;

  // ── Performance ─────────────────────────────────────────────────────────────
  readonly activeProfile: PerformanceProfile;
}

// ─── Session snapshot ─────────────────────────────────────────────────────────

/**
 * Point-in-time view of all live session state.
 * Available via VisionSession.snapshot().
 * Suitable for UI overlays and status panels.
 */
export interface VisionSessionSnapshot {
  readonly sessionId: string;
  readonly state: PipelineState;
  readonly statistics: SessionStatistics;
  readonly performance: PerformanceMetrics;
}

// ─── VisionSession ────────────────────────────────────────────────────────────

/**
 * An active, continuously-processing vision session.
 *
 * Obtained from LiveSessionEngine.startSession(). Applications:
 *   1. Receive frames from their camera and call feedFrame().
 *   2. Subscribe to events on the events bus to consume results.
 *   3. Call pause() / resume() as needed.
 *   4. Call stop() to release resources.
 *
 * Frame flow:
 *   camera → feedFrame() → scheduler → queue → pipeline → events
 *
 * Events surface all stage results — quality scores, detections, tracks,
 * privacy masks, capture decisions, guidance. Applications never need to
 * call the underlying SmartVisionEngine or PrivacyEngine directly.
 */
export interface VisionSession {
  /** Unique session identifier, stable for the lifetime of this session. */
  readonly sessionId: string;
  /** Current pipeline lifecycle state. */
  readonly state: PipelineState;
  /**
   * Unified event bus. Subscribe here to receive all pipeline events.
   * Never subscribe to sub-engine buses directly — they are internal.
   */
  readonly events: PipelineEventBus;
  /** Effective configuration for this session. */
  readonly config: LiveSessionConfig;

  // ── Frame ingestion ─────────────────────────────────────────────────────────

  /**
   * Push a camera frame into the pipeline.
   *
   * Returns immediately (non-blocking). The scheduler decides whether to
   * process or drop. Subscribe to "pipeline.frame.processed" to receive results.
   *
   * Thread safety: safe to call from the camera callback (any thread).
   * The original frame is never mutated by the pipeline.
   */
  feedFrame(frame: VideoFrame): void;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Pause frame processing. Sub-systems remain warm; models stay loaded.
   * Incoming frames are dropped while paused. Emits "pipeline.session.paused".
   */
  pause(reason?: string): void;

  /**
   * Resume a paused session. Emits "pipeline.session.resumed".
   */
  resume(): void;

  /**
   * Stop the session and release all resources.
   * Returns after the current in-flight frame completes.
   * Emits "pipeline.session.stopped".
   * After stop(), feedFrame() calls are no-ops.
   */
  stop(): Promise<void>;

  // ── Configuration ───────────────────────────────────────────────────────────

  /**
   * Update session configuration at runtime.
   * Only performance, targetFps, and frameDropPolicy can be updated mid-session.
   * Feature flags require a new session.
   */
  updateConfig(
    updates: Pick<Partial<LiveSessionConfig>, "targetFps" | "frameDropPolicy" | "maxFrameAgeMs">,
  ): void;

  // ── State inspection ────────────────────────────────────────────────────────

  /** Real-time statistics for this session. */
  getStatistics(): SessionStatistics;

  /** Full point-in-time snapshot of the session. */
  snapshot(): VisionSessionSnapshot;
}
