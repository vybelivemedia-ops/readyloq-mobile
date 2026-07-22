/**
 * @platform/smart-vision/privacy — IoU-based privacy object tracker.
 *
 * Assigns stable PrivacyObjectIds to detected objects across frames using
 * greedy IoU matching. Operates independently of the SmartVision ObjectTracker
 * so the Privacy Engine can be used standalone or alongside the main engine.
 *
 * When the SmartVision ObjectTracker is injected as a dependency, applications
 * can optionally bridge track IDs between the two systems.
 */
import type { FrameIndex, FrameTimestamp } from "../../frame";
import type { DetectedPrivacyObject } from "../detection";
import type { PrivacyObject } from "../types";
export interface PrivacyTrackerUpdateResult {
    /** All currently active tracked objects (including newly-created and previously-seen). */
    readonly active: readonly PrivacyObject[];
    /** Objects first detected this update call. */
    readonly newObjects: readonly PrivacyObject[];
    /** Objects evicted because missingFrames exceeded the threshold. */
    readonly lostObjects: readonly PrivacyObject[];
    /** Objects whose position or confidence changed this update. */
    readonly updatedObjects: readonly PrivacyObject[];
}
export interface PrivacyTrackerOptions {
    readonly maxMissingFrames: number;
    readonly iouThreshold: number;
    readonly maxTrackedObjects: number;
}
export interface PrivacyObjectTracker {
    /**
     * Update from a fresh detection batch (call on inference frames).
     * Returns the tracker state after matching + eviction.
     */
    updateFromDetections(detections: readonly DetectedPrivacyObject[], timestamp: FrameTimestamp, frameIndex: FrameIndex): PrivacyTrackerUpdateResult;
    /**
     * Tick the missing-frame counter without new detections (non-inference frames).
     * Evicts objects that have been missing too long.
     * Returns newly-lost objects.
     */
    tickMissing(frameIndex: FrameIndex): readonly PrivacyObject[];
    /** All currently active tracked objects. */
    getActive(): readonly PrivacyObject[];
    /** Clear all tracked state. */
    reset(): void;
}
export declare function createPrivacyTracker(opts: PrivacyTrackerOptions): PrivacyObjectTracker;
//# sourceMappingURL=privacy-tracker.d.ts.map