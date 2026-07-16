/**
 * @platform/smart-vision/live-session — PerformanceMonitor implementation.
 *
 * Tracks pipeline latency, frame rate, and drop rate over a rolling window.
 * Emits adaptation decisions to help the coordinator scale down when the device
 * cannot sustain the configured target FPS.
 */

import type { PipelineStage } from "../types";
import type {
  PerformanceMetrics,
  PerformanceProfile,
  AdaptationDecision,
  PerformanceMonitor,
} from "../performance";
import { PROFILE_TARGET_FPS } from "../performance";

// ─── Constants ────────────────────────────────────────────────────────────────

const WINDOW_SIZE = 60;
const ADAPTATION_INTERVAL_MS = 2000;
const DOWNGRADE_LATENCY_RATIO = 1.5;
const DOWNGRADE_DROP_RATE = 0.2;
const UPGRADE_LATENCY_RATIO = 0.5;
const UPGRADE_DROP_RATE = 0.02;
const MIN_SAMPLES_FOR_ADAPTATION = 10;

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPerformanceMonitor(
  initialTargetFps: number,
  initialProfile: PerformanceProfile,
): PerformanceMonitor {
  let targetFps = initialTargetFps;
  let profile = initialProfile;
  let lastAdaptationMs = 0;
  let totalSamples = 0;
  let droppedSamples = 0;

  // Rolling window of total latencies (ms)
  const latencies: number[] = [];
  // Timestamps of processed (non-dropped) frames for FPS measurement
  const frameTimes: number[] = [];
  // Per-stage latency accumulator (rolling window per stage)
  const stageAccum = new Map<PipelineStage, number[]>();

  function pruneFrameTimes(): void {
    const cutoff = Date.now() - 1000;
    while (frameTimes.length > 0 && (frameTimes[0] ?? 0) < cutoff) {
      frameTimes.shift();
    }
  }

  function computeMetrics(): PerformanceMetrics {
    pruneFrameTimes();
    const sorted = [...latencies].sort((a, b) => a - b);
    const n = sorted.length;
    const avg = n > 0 ? sorted.reduce((s, v) => s + v, 0) / n : 0;
    const p95 = n > 0 ? (sorted[Math.floor(n * 0.95)] ?? sorted[n - 1] ?? 0) : 0;
    const peak = n > 0 ? (sorted[n - 1] ?? 0) : 0;
    const dropRate = totalSamples > 0 ? droppedSamples / totalSamples : 0;

    const stageLatencies: Partial<Record<PipelineStage, number>> = {};
    for (const [stage, arr] of stageAccum) {
      if (arr.length > 0) {
        stageLatencies[stage] = arr.reduce((s, v) => s + v, 0) / arr.length;
      }
    }

    return {
      currentFps: frameTimes.length,
      targetFps,
      averageLatencyMs: avg,
      p95LatencyMs: p95,
      peakLatencyMs: peak,
      dropRate,
      stageLatencies,
      sampleSize: n,
      activeProfile: profile,
    };
  }

  return {
    record(totalLatencyMs, stageLats, dropped) {
      totalSamples++;
      if (dropped) {
        droppedSamples++;
        return;
      }

      frameTimes.push(Date.now());
      latencies.push(totalLatencyMs);
      if (latencies.length > WINDOW_SIZE) latencies.shift();

      for (const [stageKey, ms] of Object.entries(stageLats)) {
        const stage = stageKey as PipelineStage;
        let arr = stageAccum.get(stage);
        if (!arr) {
          arr = [];
          stageAccum.set(stage, arr);
        }
        arr.push(ms);
        if (arr.length > WINDOW_SIZE) arr.shift();
      }
    },

    getMetrics: computeMetrics,

    checkAdaptation() {
      const now = Date.now();
      if (now - lastAdaptationMs < ADAPTATION_INTERVAL_MS) return null;

      const m = computeMetrics();
      if (m.sampleSize < MIN_SAMPLES_FOR_ADAPTATION) return null;

      lastAdaptationMs = now;
      const budget = 1000 / targetFps;

      // ── Downgrade ──────────────────────────────────────────────────────────
      if (m.averageLatencyMs > budget * DOWNGRADE_LATENCY_RATIO || m.dropRate > DOWNGRADE_DROP_RATE) {
        const newProfile: PerformanceProfile =
          profile === "high_accuracy" ? "balanced" : "low_power";
        if (newProfile === profile) return null;
        const previousProfile = profile;
        const newFps = PROFILE_TARGET_FPS[newProfile];
        const decision: AdaptationDecision = {
          profileChanged: true,
          previousProfile,
          newProfile,
          recommendedFps: newFps,
          reason: `Average latency ${m.averageLatencyMs.toFixed(0)} ms exceeds budget ${budget.toFixed(0)} ms (drop rate ${(m.dropRate * 100).toFixed(0)} %)`,
        };
        profile = newProfile;
        return decision;
      }

      // ── Upgrade ────────────────────────────────────────────────────────────
      if (m.averageLatencyMs < budget * UPGRADE_LATENCY_RATIO && m.dropRate < UPGRADE_DROP_RATE) {
        const newProfile: PerformanceProfile =
          profile === "low_power" ? "balanced" : "high_accuracy";
        if (newProfile === profile) return null;
        const previousProfile = profile;
        const newFps = PROFILE_TARGET_FPS[newProfile];
        const decision: AdaptationDecision = {
          profileChanged: true,
          previousProfile,
          newProfile,
          recommendedFps: newFps,
          reason: "Device has headroom; upgrading performance profile",
        };
        profile = newProfile;
        return decision;
      }

      return null;
    },

    updateTargetFps(fps) {
      targetFps = fps;
    },

    updateProfile(p) {
      profile = p;
    },

    reset() {
      latencies.length = 0;
      frameTimes.length = 0;
      stageAccum.clear();
      totalSamples = 0;
      droppedSamples = 0;
      lastAdaptationMs = 0;
    },
  };
}
