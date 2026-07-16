/**
 * @platform/smart-vision/live-session — frame scheduler contracts.
 *
 * The LiveFrameScheduler is the first gate in the pipeline. It decides
 * whether each incoming frame should be processed, deferred, or dropped.
 *
 * Design goals:
 *   - Prefer fresh frames over queued frames.
 *   - Never allow latency to accumulate.
 *   - Drop stale frames immediately.
 *   - Throttle to the target FPS budget.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { VideoFrame, FrameTimestamp } from "../frame";

// ─── Scheduler decision ───────────────────────────────────────────────────────

/**
 * What the scheduler decided to do with an incoming frame.
 *
 * "process"     — enqueue the frame for pipeline processing.
 * "drop_stale"  — frame is too old to process (exceeds maxFrameAgeMs).
 * "drop_full"   — queue is full and drop policy resolved to discard this frame.
 * "drop_paused" — session is paused; all incoming frames are dropped.
 */
export type FrameSchedulerDecision =
  | "process"
  | "drop_stale"
  | "drop_full"
  | "drop_paused";

// ─── Scheduler result ─────────────────────────────────────────────────────────

export interface FrameScheduleResult {
  readonly decision: FrameSchedulerDecision;
  /** Effective age of the frame in ms at the time of the decision. */
  readonly frameAgeMs: number;
  /** Number of frames in the queue at the time of the decision. */
  readonly queueDepth: number;
}

// ─── LiveFrameScheduler ───────────────────────────────────────────────────────

/**
 * Controls whether each incoming frame enters the processing pipeline.
 *
 * The scheduler is the first component that runs for every frame — it must
 * be synchronous and near-zero latency. All expensive work happens downstream.
 *
 * Rate limiting: the scheduler maintains an internal token-bucket that
 * throttles acceptance to the configured `targetFps`. Frames that arrive
 * within the same time slot are deduplicated (oldest dropped).
 */
export interface LiveFrameScheduler {
  /**
   * Evaluate an incoming frame.
   *
   * @param frame       The frame to evaluate.
   * @param queueDepth  Current number of frames waiting to be processed.
   * @returns           A FrameScheduleResult indicating what to do.
   */
  accept(frame: VideoFrame, queueDepth: number): FrameScheduleResult;

  /**
   * Update the target FPS (called by PerformanceMonitor during adaptation).
   * Takes effect immediately on the next accept() call.
   */
  updateTargetFps(fps: number): void;

  /** Current configured target FPS. */
  readonly targetFps: number;

  /**
   * Maximum allowed frame age in ms. Frames older than this are dropped as
   * stale regardless of queue depth or token availability.
   * 0 = no staleness check.
   */
  readonly maxFrameAgeMs: number;

  /** Approximate effective FPS measured over the last second. */
  readonly measuredFps: number;

  /** Reset internal token bucket and FPS counter. Call on session resume. */
  reset(): void;
}
