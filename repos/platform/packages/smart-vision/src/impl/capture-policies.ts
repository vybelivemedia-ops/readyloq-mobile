/**
 * @platform/smart-vision — built-in CapturePolicy implementations.
 *
 * Five strategies covering common capture workflows:
 *   manual           — operator-only; engine never auto-captures
 *   quality_first    — waits for high image quality before capturing
 *   confidence_first — captures as soon as detection confidence is high
 *   balanced         — equal weighting across all five dimensions
 *   continuous       — captures at configured rate intervals (relaxed quality)
 *
 * Applications can register additional policies via AutoCaptureEngine.registerPolicy().
 */

import type {
  BuiltInPolicyId,
  CaptureAction,
  CaptureDecision,
  CapturePolicy,
  CapturePolicyContext,
  CaptureReason,
  CaptureScore,
} from "../capture-policy";
import type { FrameTimestamp } from "../frame";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): FrameTimestamp { return Date.now() as FrameTimestamp; }

function primaryConfidence(ctx: CapturePolicyContext): number {
  // Use the primary subject confidence if available; fall back to first summary
  return ctx.primarySubject?.confidence ??
    (ctx.confidenceSummaries[0] as { mean?: number } | undefined)?.mean ?? 0;
}

function subjectFraming(ctx: CapturePolicyContext): number {
  if (!ctx.primarySubject) return 0;
  const { width, height } = ctx.primarySubject.box;
  // Coverage of the frame area — clamp to [0, 1]
  return Math.min(1, width * height / 0.25); // normalised: 25 % frame area = 1.0
}

function makeScore(
  ctx: CapturePolicyContext,
  composite: number,
): CaptureScore {
  return {
    detectionConfidence: primaryConfidence(ctx),
    frameQuality: ctx.quality.overall / 100,
    stability: ctx.stability.score,
    framing: subjectFraming(ctx),
    novelty: ctx.duplicateVerdict.novelty,
    composite: Math.max(0, Math.min(1, composite)),
  };
}

function waitDecision(
  ctx: CapturePolicyContext,
  policyId: string,
  reasons: CaptureReason[],
  composite: number = 0,
  action: CaptureAction = "wait",
): CaptureDecision {
  return { action, score: makeScore(ctx, composite), reasons, timestamp: now(), policyId };
}

function captureDecision(
  ctx: CapturePolicyContext,
  policyId: string,
  composite: number,
): CaptureDecision {
  return {
    action: "capture",
    score: makeScore(ctx, composite),
    reasons: [{ code: "all_thresholds_met", detail: "All policy thresholds satisfied" }],
    timestamp: now(),
    policyId,
  };
}

// ─── manual ──────────────────────────────────────────────────────────────────

export function createManualPolicy(): CapturePolicy {
  return {
    id: "manual" satisfies BuiltInPolicyId,
    name: "Manual",
    description: "Auto-capture disabled. Operator triggers every capture.",
    evaluate(ctx: CapturePolicyContext): CaptureDecision {
      return waitDecision(ctx, "manual", [{ code: "policy_manual", detail: "Manual-only policy" }], 0);
    },
    reset() { /* stateless */ },
  };
}

// ─── quality_first ────────────────────────────────────────────────────────────

const QUALITY_FIRST_THRESHOLD = 0.75;
const QUALITY_FIRST_STABILITY = 0.75;

export function createQualityFirstPolicy(
  opts: { qualityThreshold?: number; stabilityThreshold?: number } = {},
): CapturePolicy {
  const qt = opts.qualityThreshold ?? QUALITY_FIRST_THRESHOLD;
  const st = opts.stabilityThreshold ?? QUALITY_FIRST_STABILITY;

  return {
    id: "quality_first" satisfies BuiltInPolicyId,
    name: "Quality First",
    description: "Waits for high image quality and stability, even if detection confidence is low.",
    evaluate(ctx: CapturePolicyContext): CaptureDecision {
      const quality = ctx.quality.overall / 100;
      const stability = ctx.stability.score;
      const reasons: CaptureReason[] = [];

      if (ctx.onHold) return waitDecision(ctx, "quality_first", [{ code: "manual_hold", detail: "Engine on hold" }]);
      if (ctx.captureLimitReached) return waitDecision(ctx, "quality_first", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");

      if (stability < st) {
        reasons.push({ code: "unstable_camera", detail: `Stability ${stability.toFixed(2)} < ${st}`, observedValue: stability, requiredValue: st });
      }
      if (quality < qt) {
        reasons.push({ code: "low_quality", detail: `Quality ${(quality * 100).toFixed(0)} < ${(qt * 100).toFixed(0)}`, observedValue: quality, requiredValue: qt });
      }

      const composite = (quality * 0.6 + stability * 0.4);
      if (reasons.length > 0) return waitDecision(ctx, "quality_first", reasons, composite);
      return captureDecision(ctx, "quality_first", composite);
    },
    reset() { /* stateless */ },
  };
}

// ─── confidence_first ─────────────────────────────────────────────────────────

const CONFIDENCE_FIRST_THRESHOLD = 0.7;
const CONFIDENCE_FIRST_QUALITY_MIN = 0.45;

export function createConfidenceFirstPolicy(
  opts: { confidenceThreshold?: number; qualityMin?: number } = {},
): CapturePolicy {
  const ct = opts.confidenceThreshold ?? CONFIDENCE_FIRST_THRESHOLD;
  const qMin = opts.qualityMin ?? CONFIDENCE_FIRST_QUALITY_MIN;

  return {
    id: "confidence_first" satisfies BuiltInPolicyId,
    name: "Confidence First",
    description: "Captures as soon as detection confidence is high, tolerating lower image quality.",
    evaluate(ctx: CapturePolicyContext): CaptureDecision {
      const conf = primaryConfidence(ctx);
      const quality = ctx.quality.overall / 100;
      const reasons: CaptureReason[] = [];

      if (ctx.onHold) return waitDecision(ctx, "confidence_first", [{ code: "manual_hold", detail: "Engine on hold" }]);
      if (ctx.captureLimitReached) return waitDecision(ctx, "confidence_first", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");

      if (conf < ct) {
        if (conf === 0) {
          reasons.push({ code: "subject_not_detected", detail: "No detection available", observedValue: conf, requiredValue: ct });
        } else {
          reasons.push({ code: "low_confidence", detail: `Confidence ${conf.toFixed(2)} < ${ct}`, observedValue: conf, requiredValue: ct });
        }
      }
      if (quality < qMin) {
        reasons.push({ code: "low_quality", detail: `Quality ${(quality * 100).toFixed(0)} < ${(qMin * 100).toFixed(0)}`, observedValue: quality, requiredValue: qMin });
      }

      const composite = (conf * 0.7 + quality * 0.3);
      if (reasons.length > 0) return waitDecision(ctx, "confidence_first", reasons, composite);
      return captureDecision(ctx, "confidence_first", composite);
    },
    reset() { /* stateless */ },
  };
}

// ─── balanced ─────────────────────────────────────────────────────────────────

const BALANCED_THRESHOLD = 0.65;
const BALANCED_WEIGHTS = { quality: 0.25, confidence: 0.30, stability: 0.25, framing: 0.10, novelty: 0.10 };

export function createBalancedPolicy(
  opts: { threshold?: number } = {},
): CapturePolicy {
  const threshold = opts.threshold ?? BALANCED_THRESHOLD;

  return {
    id: "balanced" satisfies BuiltInPolicyId,
    name: "Balanced",
    description: "Equal-weighted combination of quality, confidence, stability, framing, and novelty.",
    evaluate(ctx: CapturePolicyContext): CaptureDecision {
      if (ctx.onHold) return waitDecision(ctx, "balanced", [{ code: "manual_hold", detail: "Engine on hold" }]);
      if (ctx.captureLimitReached) return waitDecision(ctx, "balanced", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");

      const conf = primaryConfidence(ctx);
      const quality = ctx.quality.overall / 100;
      const stability = ctx.stability.score;
      const framing = subjectFraming(ctx);
      const novelty = ctx.duplicateVerdict.novelty;

      const composite =
        quality   * BALANCED_WEIGHTS.quality   +
        conf      * BALANCED_WEIGHTS.confidence +
        stability * BALANCED_WEIGHTS.stability  +
        framing   * BALANCED_WEIGHTS.framing    +
        novelty   * BALANCED_WEIGHTS.novelty;

      const reasons: CaptureReason[] = [];
      if (composite < threshold) {
        if (quality < 0.5) reasons.push({ code: "low_quality", detail: `Quality ${(quality * 100).toFixed(0)}`, observedValue: quality });
        if (conf < 0.5)    reasons.push({ code: "low_confidence", detail: `Confidence ${conf.toFixed(2)}`, observedValue: conf });
        if (stability < 0.5) reasons.push({ code: "unstable_camera", detail: `Stability ${stability.toFixed(2)}`, observedValue: stability });
        if (reasons.length === 0) reasons.push({ code: "low_quality", detail: `Composite ${composite.toFixed(2)} < ${threshold}`, observedValue: composite, requiredValue: threshold });
        return waitDecision(ctx, "balanced", reasons, composite);
      }

      return captureDecision(ctx, "balanced", composite);
    },
    reset() { /* stateless */ },
  };
}

// ─── continuous ───────────────────────────────────────────────────────────────

const CONTINUOUS_MIN_QUALITY = 0.35;
const CONTINUOUS_INTERVAL_MS = 3000;

export function createContinuousPolicy(
  opts: { minQuality?: number; intervalMs?: number } = {},
): CapturePolicy {
  const minQuality = opts.minQuality ?? CONTINUOUS_MIN_QUALITY;
  const intervalMs = opts.intervalMs ?? CONTINUOUS_INTERVAL_MS;

  return {
    id: "continuous" satisfies BuiltInPolicyId,
    name: "Continuous",
    description: "Captures at regular intervals while quality and presence thresholds are met.",
    evaluate(ctx: CapturePolicyContext): CaptureDecision {
      if (ctx.onHold) return waitDecision(ctx, "continuous", [{ code: "manual_hold", detail: "Engine on hold" }]);
      if (ctx.captureLimitReached) return waitDecision(ctx, "continuous", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");

      const quality = ctx.quality.overall / 100;
      if (quality < minQuality) {
        return waitDecision(ctx, "continuous", [{ code: "low_quality", detail: `Quality ${(quality * 100).toFixed(0)} < ${(minQuality * 100).toFixed(0)}`, observedValue: quality, requiredValue: minQuality }], quality);
      }

      const elapsed = ctx.msSinceLastCapture;
      if (elapsed < intervalMs) {
        return waitDecision(ctx, "continuous", [{ code: "rate_limited", detail: `${Math.ceil(intervalMs - elapsed)}ms remaining`, observedValue: elapsed, requiredValue: intervalMs }], quality, "wait");
      }

      const composite = quality * 0.6 + ctx.stability.score * 0.4;
      return captureDecision(ctx, "continuous", composite);
    },
    reset() { /* stateless */ },
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const BUILT_IN_FACTORIES: Record<BuiltInPolicyId, () => CapturePolicy> = {
  manual: createManualPolicy,
  quality_first: createQualityFirstPolicy,
  confidence_first: createConfidenceFirstPolicy,
  balanced: createBalancedPolicy,
  continuous: createContinuousPolicy,
};

export function createBuiltInPolicy(id: BuiltInPolicyId): CapturePolicy {
  const factory = BUILT_IN_FACTORIES[id];
  return factory();
}
