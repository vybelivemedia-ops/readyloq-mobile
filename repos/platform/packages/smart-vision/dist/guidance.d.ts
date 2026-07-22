/**
 * @platform/smart-vision — real-time operator guidance contracts.
 *
 * The guidance engine evaluates the current vision state and emits generic,
 * domain-neutral directives that tell the operator HOW to improve the shot —
 * not WHAT they are looking for.
 *
 * DOMAIN BOUNDARY:
 *   Platform guidance codes are signal-level observations:
 *     ✓ "move_closer"      — subject occupies too little of the frame
 *     ✓ "hold_steady"      — motion blur detected
 *     ✓ "increase_lighting" — exposure too low
 *     ✓ "subject_left_frame" — tracking lost
 *
 *   NOT platform guidance (application layer):
 *     ✗ "Check under the sink"
 *     ✗ "Look for German roaches"
 *     ✗ "Frame the speaker for the audience"
 *
 *   Applications map GuidanceCode values to domain-specific copy and display
 *   them in the appropriate language and context.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { BoundingBox } from "./tracking";
import type { FrameTimestamp, VideoFrame } from "./frame";
import type { FrameQualityReport } from "./quality";
import type { DetectionResult } from "./detection";
import type { TrackedRegion } from "./tracking";
import type { StabilityMeasure } from "./auto-capture";
/**
 * Generic operator guidance codes.
 *
 * Each code represents a physical / optical state that the operator can
 * act on. Applications localise and contextualise these codes.
 *
 * Applications may extend this with their own codes:
 *   type AppCode = GuidanceCode | "calibrate_sensor" | "rotate_device";
 */
export type GuidanceCode = "move_closer" | "move_back" | "recenter_subject" | "rotate_device" | "hold_steady" | "excessive_motion" | "refocus" | "too_close_for_focus" | "increase_lighting" | "reduce_glare" | "backlit_subject" | "subject_not_detected" | "subject_left_frame" | "low_confidence" | "target_locked" | "ready_to_capture" | "already_captured" | "capture_limit_reached";
/**
 * Urgency/severity of a guidance directive.
 *
 * "info"    — positive feedback or soft suggestion (e.g. "target_locked").
 * "warning" — quality degraded; capture may proceed but imperfectly.
 * "critical" — capture blocked until condition is resolved.
 */
export type GuidanceLevel = "info" | "warning" | "critical";
/**
 * A single guidance message emitted by the GuidanceEngine.
 *
 * Applications render the directive as an overlay, haptic, audio cue, or
 * mapped domain-specific text — based on the `code` and `level`.
 *
 * The `message` field is a raw English fallback for diagnostics; applications
 * should never display it directly to end users.
 */
export interface GuidanceDirective {
    code: GuidanceCode;
    level: GuidanceLevel;
    /**
     * Normalised region of the frame this directive is about.
     * Null for frame-wide directives (e.g. "hold_steady", "increase_lighting").
     */
    region: BoundingBox | null;
    timestamp: FrameTimestamp;
    /**
     * Raw English diagnostic message — for logging and developer inspection.
     * Applications must localise and contextualise for end users.
     */
    message: string;
    /**
     * Machine-readable supplementary data for the application layer.
     * Examples: { currentCoverage: 0.08, minimumCoverage: 0.15 }
     *           { confidence: 0.42, required: 0.7 }
     *           { stabilityScore: 0.3 }
     * The platform defines no fixed keys here; the producing engine sets them.
     */
    payload?: Record<string, number | string | boolean>;
}
/**
 * All inputs the GuidanceEngine needs to evaluate the current frame.
 */
export interface GuidanceContext {
    frame: VideoFrame;
    quality: FrameQualityReport;
    stability: StabilityMeasure;
    /** Latest detection result. Null when detection is disabled or not yet available. */
    detection: DetectionResult | null;
    /** Primary locked subject region. Null when no subject lock is active. */
    primarySubject: TrackedRegion | null;
    /** All currently tracked regions. */
    allSubjects: readonly TrackedRegion[];
    /** Whether the auto-capture engine is actively running. */
    autoCaptureActive: boolean;
    /** Total captures taken in this session. */
    captureCount: number;
    /** Whether the most recent scene-memory check returned "duplicate". */
    isDuplicate: boolean;
    /** Whether the session capture limit has been reached. */
    captureLimitReached: boolean;
}
/**
 * Evaluates the current vision context and produces a prioritised list of
 * GuidanceDirectives for the operator.
 *
 * `evaluate` is called per-frame (or at a reduced cadence). Returns directives
 * ordered by descending level severity (critical → warning → info).
 * Returns an empty array when no guidance is warranted.
 *
 * The engine is stateless between calls — all context is supplied per-call.
 * Implementations are free to maintain rolling state internally (e.g. to
 * suppress a repeated "hold_steady" from firing every frame).
 */
export interface GuidanceEngine {
    /**
     * Evaluate the current frame context and return guidance directives.
     * Ordered: critical first, then warnings, then informational.
     */
    evaluate(ctx: GuidanceContext): readonly GuidanceDirective[];
    /**
     * Reset any internal state (debounce timers, repeat-suppression counters).
     * Call on session restart or when the primary subject changes.
     */
    reset(): void;
}
/**
 * Utility type for application-layer guidance filtering.
 *
 * Applications can suppress specific codes (e.g. "already_captured" during
 * manual capture mode) or map codes to UI variants.
 */
export interface GuidanceFilter {
    /** Guidance codes to completely suppress. */
    suppress?: readonly GuidanceCode[];
    /** Override the level for specific codes. */
    levelOverride?: Partial<Record<GuidanceCode, GuidanceLevel>>;
    /**
     * Minimum level to surface to the user.
     * Directives below this level are filtered out.
     */
    minimumLevel?: GuidanceLevel;
}
/**
 * A timestamped snapshot of one guidance evaluation pass.
 * Maintained by the SmartVisionEngine for session-level analytics.
 */
export interface GuidanceSnapshot {
    timestamp: FrameTimestamp;
    directives: readonly GuidanceDirective[];
    /** The dominant code at this moment (critical > warning > info; first alphabetically on tie). */
    dominant: GuidanceCode | null;
}
//# sourceMappingURL=guidance.d.ts.map