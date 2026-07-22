/**
 * @platform/smart-vision — policy-based auto-capture contracts.
 *
 * Supersedes the simple threshold trigger in auto-capture.ts with a
 * pluggable policy architecture. Instead of a single hardcoded decision
 * function, the engine selects a named CapturePolicy that encodes a
 * capture strategy. Applications choose the policy that fits their workflow.
 *
 * BUILT-IN POLICY IDs:
 *   "manual"             — operator triggers every capture; engine never fires
 *   "quality_first"      — waits for high quality even if detection is weak
 *   "confidence_first"   — captures as soon as detection confidence is high,
 *                          tolerating lower image quality
 *   "balanced"           — equal weighting across quality, confidence, stability
 *   "continuous"         — captures at the configured rate as long as the subject
 *                          is present; quality thresholds are relaxed
 *
 * Applications register additional policies with the AutoCaptureEngine.
 * VYBE might add "creator_framing" which weights composition highly.
 * ReadyLoq might add "evidence_first" which weights uniqueness.
 * Neither policy belongs in this file.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { FrameTimestamp, VideoFrame } from "./frame";
import type { TrackedRegion } from "./tracking";
import type { FrameQualityReport } from "./quality";
import type { StabilityMeasure } from "./auto-capture";
import type { DetectionResult, DetectionConfidenceSummary } from "./detection";
import type { DuplicateVerdict } from "./scene-memory";
/**
 * The action the engine recommends after evaluating the current frame.
 *
 * "capture"         — all thresholds met; trigger a capture immediately.
 * "wait"            — conditions are improving; hold and re-evaluate next frame.
 * "skip"            — conditions are permanently not met for this opportunity
 *                     (e.g. subject left frame, capture limit reached).
 * "move_closer"     — guidance: subject too small; re-evaluate after repositioning.
 * "increase_light"  — guidance: exposure too low; wait for lighting improvement.
 * "refocus"         — guidance: sharpness too low; wait for autofocus to settle.
 * "ignore"          — nothing relevant detected; do not capture.
 */
export type CaptureAction = "capture" | "wait" | "skip" | "move_closer" | "increase_light" | "refocus" | "ignore";
/**
 * A single reason contributing to a CaptureDecision.
 *
 * Reasons explain why the action was chosen. A CaptureDecision may have
 * multiple reasons (e.g. action="wait" because both motion and low confidence
 * are blocking).
 */
export interface CaptureReason {
    /**
     * Machine-readable code identifying what drove this reason.
     * Mirrors GuidanceCode where applicable so the UI can correlate them.
     */
    code: "confidence_met" | "quality_met" | "stability_met" | "framing_met" | "all_thresholds_met" | "low_confidence" | "low_quality" | "motion_blur" | "unstable_camera" | "subject_not_detected" | "subject_too_small" | "subject_left_frame" | "poor_lighting" | "out_of_focus" | "duplicate_region" | "rate_limited" | "cooldown_active" | "capture_limit_reached" | "manual_hold" | "policy_manual";
    /** Short diagnostic description. Not for end-user display. */
    detail: string;
    /** Observed value that triggered this reason (e.g. confidence = 0.42). */
    observedValue?: number;
    /** Threshold that was not met (e.g. required = 0.7). */
    requiredValue?: number;
}
/**
 * Dimensional breakdown of the capture readiness score.
 * Each dimension is independently normalised 0–1.
 * The policy computes a composite from these using its own weighting.
 */
export interface CaptureScore {
    /** Detection confidence for the primary subject: 0–1. */
    detectionConfidence: number;
    /** Frame quality (sharpness, exposure, motion): 0–1. */
    frameQuality: number;
    /** Camera stability (inverse of motion): 0–1. */
    stability: number;
    /** Subject framing / coverage of the frame: 0–1. */
    framing: number;
    /** Novelty / uniqueness vs. scene memory: 0–1. */
    novelty: number;
    /**
     * Composite score produced by the policy's weighting function.
     * 0 = definitely do not capture; 1 = ideal capture moment.
     */
    composite: number;
}
/**
 * What caused this CapturePolicy evaluation to run.
 *
 * "frame_tick"    — periodic evaluation on every scheduled analysis frame.
 * "manual_request" — operator explicitly requested a capture.
 * "detection_event" — a new detection entered the frame (spike trigger).
 * "stability_settled" — camera motion dropped below the stability threshold.
 * "subject_locked"  — subject lock was acquired this frame.
 */
export type CaptureTrigger = "frame_tick" | "manual_request" | "detection_event" | "stability_settled" | "subject_locked";
/**
 * Everything the CapturePolicy sees when evaluating a frame.
 * Passed to `CapturePolicy.evaluate()` on every analysis tick.
 */
export interface CapturePolicyContext {
    frame: VideoFrame;
    quality: FrameQualityReport;
    stability: StabilityMeasure;
    /** Latest detection result. Null if detection is not configured or not yet available. */
    detection: DetectionResult | null;
    /** Rolling confidence history for each active classId. */
    confidenceSummaries: readonly DetectionConfidenceSummary[];
    /** Primary locked subject. Null when no lock is active. */
    primarySubject: TrackedRegion | null;
    /** All currently tracked regions. */
    allSubjects: readonly TrackedRegion[];
    /** Result of checking the current frame against scene memory. */
    duplicateVerdict: DuplicateVerdict;
    /** What triggered this evaluation. */
    trigger: CaptureTrigger;
    /** Elapsed ms since the last capture (auto or manual). */
    msSinceLastCapture: number;
    /** Total captures taken in this session so far. */
    captureCount: number;
    /** Whether the session's capture limit has been reached. */
    captureLimitReached: boolean;
    /** Whether the engine is currently in a hold() state. */
    onHold: boolean;
}
/**
 * The outcome of one CapturePolicy evaluation.
 */
export interface CaptureDecision {
    action: CaptureAction;
    score: CaptureScore;
    /** Reasons behind the decision, ordered by importance. */
    reasons: readonly CaptureReason[];
    timestamp: FrameTimestamp;
    /** The policy that produced this decision. */
    policyId: string;
    /**
     * When `action === "capture"`, this is the recommended crop rect for
     * the capture (from the SmartCropper). Null for full-frame captures.
     */
    recommendedCropRect?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
/**
 * A named capture strategy.
 *
 * Applications choose a policy when starting a session. The AutoCaptureEngine
 * calls `evaluate()` on every analysis frame. Policies are stateless across
 * calls (all context is supplied per-call); they may maintain rolling state
 * internally but must reset it via `reset()`.
 */
export interface CapturePolicy {
    readonly id: string;
    /** Human-readable name for UI and diagnostics. */
    readonly name: string;
    /** Short description of the strategy for developer documentation. */
    readonly description: string;
    /**
     * Evaluate the current frame context and return a capture decision.
     * Called once per analysis tick by the AutoCaptureEngine.
     */
    evaluate(ctx: CapturePolicyContext): CaptureDecision;
    /**
     * Reset all internal rolling state.
     * Called when the session restarts or the active policy changes.
     */
    reset(): void;
}
/**
 * Identifiers for the platform's built-in capture policies.
 * Implementations of these policies live in the application layer or a
 * separate platform package; these constants allow type-safe policy selection.
 */
export type BuiltInPolicyId = "manual" | "quality_first" | "confidence_first" | "balanced" | "continuous";
/**
 * Policy selection: either a BuiltInPolicyId string or a fully custom
 * CapturePolicy instance.
 */
export type PolicySelection = BuiltInPolicyId | CapturePolicy;
/**
 * The auto-capture engine orchestrates per-frame policy evaluation.
 *
 * Workflow:
 *   1. Application sets a policy via `setPolicy()`.
 *   2. SmartVisionEngine calls `evaluate()` with the CapturePolicyContext
 *      on every analysis frame.
 *   3. When the returned CaptureDecision.action === "capture", the engine
 *      triggers a capture and calls `notifyCaptured()`.
 *   4. The engine enforces rate-limiting and cooldown periods regardless
 *      of what the policy returns, as a safety layer.
 *
 * The auto-capture engine is the bridge between the frame pipeline and the
 * application's EvidenceIntake / capture storage layer.
 */
export interface AutoCaptureEngine {
    /** Currently active policy. */
    readonly policy: CapturePolicy;
    /** Whether the engine is in a hold() state. */
    readonly isOnHold: boolean;
    /** Total captures triggered in this session. */
    readonly captureCount: number;
    /**
     * Evaluate the current frame against the active policy.
     * Returns the CaptureDecision from the policy (plus rate-limit enforcement).
     */
    evaluate(ctx: CapturePolicyContext): CaptureDecision;
    /**
     * Switch the active capture policy.
     * Calls `reset()` on the current policy before switching.
     */
    setPolicy(policy: PolicySelection | CapturePolicy): void;
    /**
     * Notify the engine that a capture occurred (auto or manual).
     * Resets rate-limit and cooldown clocks; increments `captureCount`.
     */
    notifyCaptured(timestamp: FrameTimestamp): void;
    /**
     * Suspend auto-capture (e.g. while the operator is in a UI menu).
     * Causes all evaluations to return action="wait" with reason="manual_hold".
     */
    hold(): void;
    /** Resume after a hold. */
    resume(): void;
    /**
     * Register a custom policy that can then be selected by id.
     * No-op if a policy with the same id is already registered.
     */
    registerPolicy(policy: CapturePolicy): void;
    /** Reset all state — clears captureCount, clocks, and calls policy.reset(). */
    reset(): void;
}
//# sourceMappingURL=capture-policy.d.ts.map