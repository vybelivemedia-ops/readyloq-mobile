/**
 * @platform/smart-vision/live-session — performance monitoring contracts.
 *
 * The PerformanceMonitor tracks frame latency, drop rates, and effective FPS
 * over a rolling window. It emits adaptation decisions when the pipeline
 * cannot sustain the target frame rate, allowing the scheduler to reduce load.
 *
 * GOVERNANCE: No domain-specific thresholds. All values are generic performance
 * metrics. Tuning lives in the application layer or device-core.
 * See repos/platform/GOVERNANCE.md.
 */

import type { PipelineStage } from "./types";

// ─── Performance profile ──────────────────────────────────────────────────────

/**
 * Operational performance tier for the Live Session pipeline.
 *
 * "high_accuracy"  — maximum quality; high CPU/GPU; flagship hardware.
 * "balanced"       — default; good quality at reasonable power; mid-range devices.
 * "low_power"      — minimum latency; extended battery; low-end / wearables.
 */
export type PerformanceProfile =
  | "high_accuracy"
  | "balanced"
  | "low_power";

/**
 * Target FPS values for each performance profile.
 * The PerformanceMonitor uses these as reference when adapting.
 */
export const PROFILE_TARGET_FPS: Readonly<Record<PerformanceProfile, number>> = {
  high_accuracy: 60,
  balanced: 30,
  low_power: 15,
};

// ─── Performance metrics ─────────────────────────────────────────────────────

/**
 * Real-time performance snapshot for the current session.
 * Published periodically via "pipeline.performance.report" events.
 */
export interface PerformanceMetrics {
  /** Effective frames-per-second over the last rolling window. */
  readonly currentFps: number;
  /** Configured target FPS at the time of measurement. */
  readonly targetFps: number;
  /** Average wall-clock latency per frame over the rolling window (ms). */
  readonly averageLatencyMs: number;
  /** 95th-percentile latency (ms). */
  readonly p95LatencyMs: number;
  /** Maximum latency observed in the rolling window (ms). */
  readonly peakLatencyMs: number;
  /** Fraction of frames dropped in the rolling window (0–1). */
  readonly dropRate: number;
  /** Per-stage average latency breakdown. */
  readonly stageLatencies: Partial<Record<PipelineStage, number>>;
  /** How many frames were sampled to produce this report. */
  readonly sampleSize: number;
  /** Active performance profile at the time of measurement. */
  readonly activeProfile: PerformanceProfile;
}

// ─── Adaptation decision ──────────────────────────────────────────────────────

/**
 * A recommendation from the PerformanceMonitor to adjust the pipeline.
 *
 * The monitor emits an AdaptationDecision when sustained metrics fall
 * outside the budget for the current profile.
 */
export interface AdaptationDecision {
  /** Whether to change the performance profile. */
  readonly profileChanged: boolean;
  readonly previousProfile: PerformanceProfile;
  readonly newProfile: PerformanceProfile;
  /** New recommended target FPS (may differ from PROFILE_TARGET_FPS if mid-tier). */
  readonly recommendedFps: number;
  /** Short human-readable reason for the adaptation (for diagnostics). */
  readonly reason: string;
}

// ─── PerformanceMonitor ───────────────────────────────────────────────────────

/**
 * Tracks pipeline performance and recommends adaptive adjustments.
 *
 * Lifecycle:
 *   1. record() — called after every frame completes all stages.
 *   2. getMetrics() — read the current rolling window snapshot.
 *   3. checkAdaptation() — call periodically; returns a decision if adaptation
 *      is warranted, null if the current settings are working.
 *   4. reset() — called on session start / resume.
 */
export interface PerformanceMonitor {
  /**
   * Record the completion of one frame.
   *
   * @param totalLatencyMs  Wall-clock time for all pipeline stages.
   * @param stageLatencies  Per-stage breakdown (stages that ran).
   * @param dropped         Whether this sample represents a dropped frame.
   */
  record(
    totalLatencyMs: number,
    stageLatencies: Partial<Record<PipelineStage, number>>,
    dropped: boolean,
  ): void;

  /** Current performance snapshot over the rolling window. */
  getMetrics(): PerformanceMetrics;

  /**
   * Check whether an adaptation is warranted based on recent metrics.
   * Returns an AdaptationDecision when the monitor recommends a change,
   * null when the current settings are within budget.
   *
   * Called by the pipeline coordinator after each frame.
   */
  checkAdaptation(): AdaptationDecision | null;

  /** Update the current target FPS (e.g. after applying an adaptation). */
  updateTargetFps(fps: number): void;

  /** Update the active profile (drives budget thresholds). */
  updateProfile(profile: PerformanceProfile): void;

  /** Reset all rolling windows. Call on session start and resume. */
  reset(): void;
}
