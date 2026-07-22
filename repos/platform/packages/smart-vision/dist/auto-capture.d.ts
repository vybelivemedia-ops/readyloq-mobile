/**
 * @platform/smart-vision — auto-capture triggering contracts.
 *
 * Defines the contract for deciding when a frame is "good enough" to capture
 * automatically. The assessment is advisory and multi-dimensional; consuming
 * applications choose what threshold to act on. No domain rules are embedded.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { FrameTimestamp, VideoFrame } from "./frame";
import type { TrackedRegion } from "./tracking";
import type { FrameQualityReport } from "./quality";
/**
 * Controls how the auto-capture trigger operates.
 *
 * "manual"     — auto-capture is disabled; the operator triggers every shot.
 * "semi_auto"  — system computes readiness and surfaces a suggestion; human confirms.
 * "continuous" — system triggers automatically whenever readiness is satisfied.
 */
export type AutoCaptureMode = "manual" | "semi_auto" | "continuous";
/**
 * Normalised capture readiness: [0, 1].
 * 1.0 = ideal capture moment; 0.0 = definitely not ready.
 * Branded to prevent silent assignment of arbitrary numbers.
 */
export type ReadinessScore = number & {
    readonly __brand: "ReadinessScore";
};
export type BlockerKind = "motion_blur" | "unstable_framing" | "subject_lost" | "low_quality" | "rate_limited" | "cooldown" | "manual_hold";
export interface ReadinessBlocker {
    kind: BlockerKind;
    /** Hard blockers prevent capture regardless of score; soft ones reduce it. */
    severity: "hard" | "soft";
    /** Human-readable detail for diagnostics. Not intended for end-user display. */
    detail: string;
}
export interface CaptureReadiness {
    /** Composite readiness: 0–1. */
    score: ReadinessScore;
    /** True when score meets the configured threshold AND there are no hard blockers. */
    ready: boolean;
    /** Ordered blockers, most severe first. */
    blockers: readonly ReadinessBlocker[];
    /** Soft advisories that reduce score but do not hard-block capture. */
    advisories: readonly string[];
}
/**
 * Camera stability over a rolling window of frames.
 * Stability is the inverse of inter-frame motion variance.
 */
export interface StabilityMeasure {
    /** Stability score: 0–1. 1.0 = perfectly still. */
    score: number;
    /** Mean inter-frame pixel displacement in normalised frame coordinates. */
    meanDisplacement: number;
    /** Number of frames included in this measurement window. */
    windowFrames: number;
}
export interface AutoCaptureConfig {
    mode: AutoCaptureMode;
    /** Readiness threshold to trigger capture: 0–1 (default: 0.8). */
    readinessThreshold: number;
    /** Minimum milliseconds between successive auto-captures. */
    minIntervalMs: number;
    /**
     * Cooldown after any capture (auto or manual) before auto-capture
     * may trigger again, in milliseconds.
     */
    postCaptureCooldownMs: number;
    /** Stability score required before capture may trigger: 0–1. */
    stabilityThreshold: number;
    /** Minimum overall quality score (0–100) required to trigger. */
    minimumQualityScore: number;
    /** Maximum captures per session. Null = unlimited. */
    captureLimit: number | null;
}
/**
 * Full context supplied to the trigger on each assessment call.
 */
export interface AutoCaptureContext {
    frame: VideoFrame;
    quality: FrameQualityReport;
    stability: StabilityMeasure;
    /** Primary tracked subject, if a subject lock is active. */
    primarySubject: TrackedRegion | null;
    /** All currently tracked regions. */
    allSubjects: readonly TrackedRegion[];
    /** Milliseconds elapsed since the last capture (auto or manual). */
    msSinceLastCapture: number;
    /** Total number of captures taken in this session. */
    captureCount: number;
}
/**
 * Evaluates whether the current frame context satisfies auto-capture criteria.
 *
 * `assess` is called per-frame (or at a reduced rate). The caller inspects the
 * returned CaptureReadiness and triggers a capture when `ready === true`.
 *
 * Trigger state (rate-limiting, cooldown, hold) is maintained internally.
 */
export interface AutoCaptureTrigger {
    readonly config: AutoCaptureConfig;
    /**
     * Assess the current frame context.
     * Returns a CaptureReadiness indicating whether capture should be triggered.
     */
    assess(ctx: AutoCaptureContext): CaptureReadiness;
    /**
     * Notify the trigger that a capture just occurred.
     * Resets the rate-limiting and cooldown clocks.
     */
    notifyCaptured(timestamp: FrameTimestamp): void;
    /**
     * Temporarily suspend auto-capture (e.g. while the operator interacts with
     * the camera UI). Causes `assess` to return a `manual_hold` blocker.
     */
    hold(): void;
    /** Resume auto-capture after a hold. */
    resume(): void;
}
export type AutoCaptureEventKind = "autocapture.triggered" | "autocapture.suppressed" | "autocapture.held" | "autocapture.resumed";
export interface AutoCaptureEvent {
    kind: AutoCaptureEventKind;
    timestamp: FrameTimestamp;
    readiness?: CaptureReadiness;
    /** Reason a trigger was suppressed (relevant for "autocapture.suppressed"). */
    suppressReason?: string;
}
//# sourceMappingURL=auto-capture.d.ts.map