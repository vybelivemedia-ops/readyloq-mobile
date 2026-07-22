/**
 * @platform/smart-vision — concrete ObjectTracker implementation.
 *
 * Lightweight centroid tracker. Each `acquire()` call registers a target with
 * an initial bounding box. On each `update()` call the tracker holds the last
 * known position and increments an "invisible" counter. After
 * `occlusionToleranceFrames` consecutive invisible frames the track transitions
 * to "lost". Callers (the SmartVisionEngine) re-seed the tracker by calling
 * `acquire()` with updated detection boxes on each detection frame.
 *
 * Design rationale: true optical-flow tracking in pure JS is too slow for the
 * 15-fps budget. This tracker relies on the DetectionEngine for periodic
 * position refreshes and uses dead-reckoning (via MotionPredictor) between
 * detection frames. Applications needing pixel-level optical flow should
 * provide a native-module-backed ObjectTracker via SmartVisionDependencies.
 */
import type { ObjectTracker, TrackingConfig } from "../tracking";
export declare function createObjectTracker(config?: Partial<TrackingConfig>): ObjectTracker;
//# sourceMappingURL=object-tracker.d.ts.map