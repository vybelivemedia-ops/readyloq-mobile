/**
 * @platform/smart-vision — object tracking and motion prediction contracts.
 *
 * Domain-agnostic: tracks regions of interest within a live frame stream.
 * No pest logic, no creator logic, no application-specific categories.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { FrameIndex, FrameTimestamp, VideoFrame } from "./frame";
/**
 * Axis-aligned bounding box in normalised frame coordinates.
 * All values in [0, 1]: (x, y) is the top-left corner.
 */
export interface BoundingBox {
    /** Left edge [0, 1]. */
    x: number;
    /** Top edge [0, 1]. */
    y: number;
    width: number;
    height: number;
}
/** Stable identifier for a single tracked entity across frames. */
export type TrackId = string & {
    readonly __brand: "TrackId";
};
/**
 * Lifecycle state of a tracked region.
 *
 * State machine:
 *   → acquired   (first detection)
 *   → tracking   (actively following)
 *   → occluded   (temporarily hidden; predictor extrapolates position)
 *   → lost       (track dropped; may reacquire if persistent=true)
 *   → completed  (intentionally released by the application)
 */
export type TrackState = "acquired" | "tracking" | "occluded" | "lost" | "completed";
/**
 * A single tracked region at a specific frame.
 *
 * Confidence is [0, 1]. Implementations must NOT apply a hard cut-off that
 * silently discards regions — callers decide the threshold to act on.
 */
export interface TrackedRegion {
    trackId: TrackId;
    box: BoundingBox;
    /** Tracker's confidence that this box correctly covers the target: 0–1. */
    confidence: number;
    state: TrackState;
    frameIndex: FrameIndex;
    timestamp: FrameTimestamp;
}
/**
 * A request to begin tracking a region of interest.
 *
 * `category` is a free string defined by the caller — the tracker never
 * interprets it. Examples: "primary-subject", "area-of-interest", "zone-A".
 */
export interface TrackingTarget {
    id: TrackId;
    /** Initial bounding box at the frame where tracking was requested. */
    initialBox: BoundingBox;
    /**
     * Caller-defined label — informational only; never interpreted by the tracker.
     * Must not embed domain-specific identifiers in the platform layer.
     */
    category: string;
    /** If true, the tracker attempts to reacquire after a `lost` event. */
    persistent: boolean;
}
export interface TrackingConfig {
    /** Maximum number of simultaneously active tracks. */
    maxTargets: number;
    /**
     * Minimum confidence to consider a region "reliably tracked".
     * Regions below this threshold are reported as `occluded` rather than
     * `tracking`, but are never silently dropped.
     */
    confidenceThreshold: number;
    /**
     * Number of consecutive frames a region may be undetected before the track
     * transitions from `occluded` to `lost`. 0 = transition immediately.
     */
    occlusionToleranceFrames: number;
    /**
     * Whether to use the MotionPredictor to fill in occluded frames.
     * When false, occluded tracks hold their last known box.
     */
    predictWhenOccluded: boolean;
}
/**
 * Core object tracking interface.
 *
 * Lifecycle:
 *   acquire(target) → update(frame) per frame → release(trackId) when done.
 *
 * The tracker is stateful and maintains history across `update` calls.
 * Implementations may use any algorithm (CSRT, KCF, DeepSORT, etc.); the
 * interface is algorithm-agnostic.
 */
export interface ObjectTracker {
    /** Declare a new tracking target beginning at its initial region. */
    acquire(target: TrackingTarget): void;
    /** Release a tracked target; its TrackId becomes invalid after this call. */
    release(trackId: TrackId): void;
    /**
     * Advance the tracker with a new frame.
     * Returns updated regions for all active tracks, including occluded ones.
     */
    update(frame: VideoFrame): Promise<readonly TrackedRegion[]>;
    /** Return the most-recent region for a specific track. */
    getRegion(trackId: TrackId): TrackedRegion | undefined;
    /** Snapshot of all active tracks at the last `update` call. */
    readonly activeTracks: readonly TrackedRegion[];
    /** Release all tracks and clear all internal state. */
    reset(): void;
}
export type TrackingEventKind = "track.acquired" | "track.updated" | "track.occluded" | "track.lost" | "track.reacquired" | "track.completed";
export interface TrackingEvent {
    kind: TrackingEventKind;
    trackId: TrackId;
    region?: TrackedRegion;
    timestamp: FrameTimestamp;
    /** Implementation-specific diagnostic detail (e.g. confidence, algorithm). */
    detail?: string;
}
/**
 * 2-D motion vector in normalised frame-coordinate units per frame.
 *
 * Coordinate conventions:
 *   +dx = rightward, −dx = leftward
 *   +dy = downward,  −dy = upward  (standard raster convention)
 */
export interface MotionVector {
    dx: number;
    dy: number;
    /** Magnitude: √(dx² + dy²). Derived; implementors should not accept this as input. */
    magnitude: number;
    /** Direction in radians, measured clockwise from the positive x-axis. */
    angle: number;
    /** Speed in normalised coordinate units per millisecond. */
    velocityPerMs: number;
}
/** A historical position observation fed to the motion predictor. */
export interface MotionSample {
    box: BoundingBox;
    timestamp: FrameTimestamp;
}
/**
 * Predicts the next position of a tracked target from its motion history.
 *
 * Implementations may use linear extrapolation, polynomial regression, or
 * Kalman filtering — the interface is algorithm-agnostic.
 */
export interface MotionPredictor {
    /**
     * Feed a new observation for a track (call once per frame per active track).
     * The predictor maintains its own rolling window; older samples are evicted.
     */
    observe(trackId: TrackId, sample: MotionSample): void;
    /**
     * Predict the bounding box at `lookaheadMs` milliseconds into the future.
     * Returns null when there is insufficient history or the trackId is unknown.
     */
    predict(trackId: TrackId, lookaheadMs: number): BoundingBox | null;
    /**
     * Instantaneous velocity of a track at its most recent observation.
     * Returns null when there is insufficient history.
     */
    velocity(trackId: TrackId): MotionVector | null;
    /**
     * Reset history for a specific track, or all tracks when trackId is omitted.
     */
    reset(trackId?: TrackId): void;
}
//# sourceMappingURL=tracking.d.ts.map