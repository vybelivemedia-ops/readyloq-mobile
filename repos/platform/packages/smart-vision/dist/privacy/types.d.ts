/**
 * @platform/smart-vision/privacy — core types.
 *
 * Brand types, stable-ID privacy objects, redaction masks, static zones,
 * per-frame results, and session-level statistics.
 *
 * GOVERNANCE: Zero application-specific identifiers.
 * See repos/platform/GOVERNANCE.md.
 */
import type { BoundingBox, TrackId } from "../tracking";
import type { FrameIndex, FrameTimestamp } from "../frame";
import type { PrivacyObjectClass } from "./detection";
import type { RedactionType } from "./policy";
/** Stable identity for a tracked privacy-sensitive object across frames. */
export type PrivacyObjectId = string & {
    readonly _brand: "PrivacyObjectId";
};
/** Identifier for a statically-defined privacy zone. */
export type PrivacyZoneId = string & {
    readonly _brand: "PrivacyZoneId";
};
/** Identifier for one entry in the PrivacyHistory log. */
export type PrivacyObservationId = string & {
    readonly _brand: "PrivacyObservationId";
};
/**
 * A privacy-sensitive object detected and tracked across frames.
 *
 * The engine assigns a stable `id` that persists as long as the object is
 * visible. When the object leaves the frame, it is evicted after the
 * configured missing-frame threshold and a "privacy.lost" event is emitted.
 */
export interface PrivacyObject {
    /** Stable identity across frames. Never recycled within a session. */
    readonly id: PrivacyObjectId;
    /** Generic computer-vision class. Application-layer meaning is injected externally. */
    readonly classId: PrivacyObjectClass;
    /** Normalised bounding box within the current frame (0–1 each dimension). */
    box: BoundingBox;
    /** Detection confidence 0–1. Updated on every inference frame. */
    confidence: number;
    /**
     * Optional link to the SmartVision ObjectTracker track for this object.
     * Null when privacy tracking is decoupled from the main tracker.
     */
    readonly trackId: TrackId | null;
    readonly firstSeenAt: FrameTimestamp;
    lastSeenAt: FrameTimestamp;
    lastSeenFrame: FrameIndex;
    /** Whether the policy currently requires this object to be redacted. */
    redacted: boolean;
    /** The redaction type applied (null = not redacted or policy says preserve). */
    redactionType: RedactionType | null;
    /** How many inference frames this object has been continuously tracked. */
    trackLength: number;
    /** How many frames in a row the object was not detected (0 when visible). */
    missingFrames: number;
}
/**
 * A redaction instruction for a single region of a single frame.
 *
 * The PrivacyRenderer consumes an array of masks and produces the final
 * redacted output. The original frame is never mutated.
 */
export interface PrivacyMask {
    /** The PrivacyObject this mask was produced for. */
    readonly objectId: PrivacyObjectId;
    /** Class of the object being redacted (for logging/analytics). */
    readonly classId: PrivacyObjectClass;
    /** The region to redact, normalised 0–1. */
    readonly box: BoundingBox;
    readonly redactionType: RedactionType;
    /**
     * Strength 0–1.
     * For blur: controls sigma. For pixelate: controls block-size scale.
     * For solid_mask / black_box: ignored (opaque by definition).
     */
    readonly strength: number;
    /** Padding added around the raw detection box, normalised 0–1. */
    readonly padding: number;
    readonly timestamp: FrameTimestamp;
    readonly frameIndex: FrameIndex;
}
/**
 * A statically-defined region that always (or never) triggers redaction,
 * independent of any AI detection result.
 *
 * Use cases:
 *   - A permanent "always redact this corner" rule for a known address plate location.
 *   - A "never redact inside this box" safe zone for reference objects.
 */
export interface PrivacyZone {
    readonly id: PrivacyZoneId;
    /** Human-readable label for diagnostics. Never shown to end users directly. */
    readonly label: string;
    /** Normalised region (0–1 each dimension). */
    readonly region: BoundingBox;
    /** How the engine treats this zone. */
    readonly mode: PrivacyZoneMode;
    /** If mode is "always_redact", the redaction to apply. */
    readonly redactionType?: RedactionType;
    readonly strength?: number;
}
/**
 * "always_redact"   — redact this region on every frame regardless of detection.
 * "never_redact"    — suppress any detection-based redaction inside this region.
 * "detect_and_redact" — run detection; redact only if an object is detected here.
 */
export type PrivacyZoneMode = "always_redact" | "never_redact" | "detect_and_redact";
/**
 * The complete output from processing one video frame through the Privacy Engine.
 *
 * Original frame preservation contract:
 *   originalFrame  — the raw, unmodified input (reference only; never mutated)
 *   masks          — the redaction instructions derived from the policy
 *   renderedOutput — the rendered copy produced by the PrivacyRenderer (null if
 *                    no renderer is configured or rendering was skipped)
 *
 * Applications choose which layer to display.
 */
export interface PrivacyFrameResult {
    readonly frameIndex: FrameIndex;
    readonly timestamp: FrameTimestamp;
    /** All currently active and tracked privacy objects (including non-redacted). */
    readonly activeObjects: readonly PrivacyObject[];
    /** Masks to apply to this frame (one per redacted object + zone). */
    readonly masks: readonly PrivacyMask[];
    /**
     * True if AI inference was skipped this frame (tracking extrapolated positions).
     * False = fresh detection results.
     */
    readonly skippedInference: boolean;
    /** Inference latency in ms (0 if skippedInference). */
    readonly inferenceMs: number;
    /** Total pipeline latency for this frame in ms. */
    readonly totalMs: number;
}
/**
 * Aggregate statistics for a PrivacySession.
 * Useful for performance monitoring, compliance auditing, and session summaries.
 */
export interface PrivacyStatistics {
    readonly sessionId: string;
    readonly durationMs: number;
    /** Total frames fed to the session. */
    readonly totalFrames: number;
    /** Frames on which inference ran. */
    readonly inferenceFrames: number;
    /** Frames on which tracking extrapolated (no inference). */
    readonly trackedFrames: number;
    /** Frames skipped entirely (paused, stopped, over budget). */
    readonly skippedFrames: number;
    /** Total distinct privacy objects detected (not frame-duplicates). */
    readonly uniqueObjectsDetected: number;
    /** Total redactions applied (summed across all frames). */
    readonly totalRedactions: number;
    /** Per-class breakdown. */
    readonly byClass: Partial<Record<PrivacyObjectClass, PrivacyClassStats>>;
    readonly averageInferenceMs: number;
    readonly averageObjectsPerFrame: number;
    readonly peakObjectsInFrame: number;
}
export interface PrivacyClassStats {
    readonly detected: number;
    readonly redacted: number;
    readonly averageConfidence: number;
}
//# sourceMappingURL=types.d.ts.map