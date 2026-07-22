/**
 * @platform/smart-vision — smart zoom and subject locking contracts.
 *
 * Smart zoom computes optical/digital zoom adjustments from the visual context
 * (subject size, coverage, proximity to frame edge). Subject locking maintains
 * a stable tracking lock on a designated primary subject across zoom changes.
 *
 * No domain logic — callers decide what constitutes a "subject".
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { BoundingBox, TrackId, TrackedRegion } from "./tracking";
/**
 * Absolute zoom level as a linear multiplier.
 * 1.0 = native (no zoom), 2.0 = 2× magnification, etc.
 * Branded to prevent silent assignment of raw numbers.
 */
export type ZoomLevel = number & {
    readonly __brand: "ZoomLevel";
};
/**
 * Hardware zoom boundaries for the active camera.
 * Populated by the device capability probe.
 */
export interface ZoomConstraints {
    /** Minimum hardware-supported zoom (typically 1.0). */
    minZoom: ZoomLevel;
    /** Maximum optical zoom without digital upscaling. */
    maxOpticalZoom: ZoomLevel;
    /** Maximum achievable zoom including digital processing. */
    maxDigitalZoom: ZoomLevel;
    /** Whether the hardware supports smooth continuous zoom (vs stepped). */
    supportsContinuousZoom: boolean;
    /**
     * Discrete optical stops available on multi-lens hardware.
     * Example: [1, 2, 5] for a triple-lens camera system.
     * Absent on single-lens hardware.
     */
    discreteStops?: readonly ZoomLevel[];
}
export interface ZoomState {
    current: ZoomLevel;
    target: ZoomLevel;
    /** True while the camera is animating toward `target`. */
    isTransitioning: boolean;
    /** True when `current` is at or below `maxOpticalZoom` (no digital degradation). */
    isOptical: boolean;
}
export type ZoomCommandKind = "zoom_to" | "zoom_step" | "zoom_reset" | "zoom_fit";
export interface ZoomCommand {
    kind: ZoomCommandKind;
    /** Absolute target level (used by `zoom_to`). */
    targetLevel?: ZoomLevel;
    /** Relative delta (used by `zoom_step`; negative = zoom out). */
    delta?: number;
    /** Normalised region to fit into the frame (used by `zoom_fit`). */
    fitRegion?: BoundingBox;
    /** Whether to animate the transition (default: true). */
    animate?: boolean;
}
export interface SmartZoomConfig {
    /**
     * Desired fraction of the frame area the primary subject should occupy
     * after zoom is applied. Example: 0.25 = subject fills 25 % of the frame.
     */
    targetCoverage: number;
    /**
     * Tolerance band around `targetCoverage`. A zoom command is only emitted
     * when coverage drifts outside [targetCoverage − tolerance, targetCoverage + tolerance].
     */
    coverageTolerance: number;
    /** Minimum milliseconds between successive zoom commands (rate limiting). */
    minCommandIntervalMs: number;
    /**
     * When true, stay within `maxOpticalZoom` and avoid digital zoom.
     * If the required zoom exceeds the optical limit, the command is clamped.
     */
    preferOptical: boolean;
    /**
     * When true, suppress zoom commands while the primary subject is in motion
     * (as reported by the MotionPredictor velocity). Avoids jitter during motion.
     */
    suppressDuringMotion: boolean;
}
/**
 * Analyses tracked regions and produces ZoomCommands to keep the primary
 * subject well-framed.
 *
 * `analyse` is called once per frame (or at a reduced rate). Returns null
 * when no adjustment is warranted based on the current config and state.
 */
export interface SmartZoomController {
    readonly config: SmartZoomConfig;
    readonly constraints: ZoomConstraints;
    readonly state: ZoomState;
    /**
     * Compute a zoom adjustment for the current frame context.
     *
     * @param primaryRegion  The main subject to optimise for. Null if no subject is tracked.
     * @param allRegions     All currently tracked regions (used for scene-level decisions).
     * @returns A ZoomCommand to apply, or null when the current zoom is satisfactory.
     */
    analyse(primaryRegion: TrackedRegion | null, allRegions: readonly TrackedRegion[]): ZoomCommand | null;
    /**
     * Apply an externally produced zoom state update
     * (e.g. after the user manually adjusts zoom).
     */
    updateState(state: Partial<ZoomState>): void;
}
/**
 * An active subject lock — the camera is tracking and centring on this subject.
 */
export interface SubjectLock {
    trackId: TrackId;
    /** The locked bounding box at the moment of acquisition. */
    acquiredBox: BoundingBox;
    /** The current tracked box, updated each frame. */
    currentBox: BoundingBox;
    /**
     * Lock confidence [0, 1].
     * 1.0 = the subject is clearly in frame and actively followed.
     * Drops toward 0 during occlusion or tracker uncertainty.
     */
    confidence: number;
    acquiredAtMs: number;
}
export type SubjectLockEvent = {
    kind: "lock.acquired";
    lock: SubjectLock;
} | {
    kind: "lock.updated";
    lock: SubjectLock;
} | {
    kind: "lock.degraded";
    lock: SubjectLock;
    reason: string;
} | {
    kind: "lock.released";
    trackId: TrackId;
    reason: string;
};
/**
 * Manages the lifecycle of a primary subject lock.
 *
 * Applications call `acquire` when the user taps a subject (or when the
 * system auto-selects one). The controller emits lifecycle events as the lock
 * state evolves.
 *
 * Only one subject lock may be active at a time. Acquiring a new subject
 * automatically releases the previous lock.
 */
export interface SubjectLockController {
    /** The currently active lock, or null when nothing is locked. */
    readonly activeLock: SubjectLock | null;
    /** Begin tracking `region` as the primary locked subject. */
    acquire(region: TrackedRegion): void;
    /** Explicitly release the current lock. No-op when no lock is active. */
    release(reason?: string): void;
    /**
     * Feed the updated tracked region for the currently locked subject.
     * Call once per frame while a lock is active.
     */
    update(region: TrackedRegion): void;
    /**
     * Subscribe to lock lifecycle events.
     * @returns An unsubscribe function; call it to remove the listener.
     */
    on(listener: (event: SubjectLockEvent) => void): () => void;
}
/**
 * A point in normalised frame coordinates [0, 1] × [0, 1].
 * (0, 0) = top-left corner; (1, 1) = bottom-right corner.
 */
export interface FocusPoint {
    x: number;
    y: number;
    /** How this focus point was produced. */
    origin: "user" | "system";
}
//# sourceMappingURL=zoom.d.ts.map