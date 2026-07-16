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
import type { PrivacyObject, PrivacyObjectId } from "../types";

// ─── IoU helper ───────────────────────────────────────────────────────────────

interface Box { x: number; y: number; width: number; height: number }

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

// ─── ID factory ───────────────────────────────────────────────────────────────

let _seq = 0;
function newObjectId(): PrivacyObjectId {
  return `pobj-${Date.now()}-${++_seq}` as PrivacyObjectId;
}

// ─── Tracker state ───────────────────────────────────────────────────────────

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

// ─── createPrivacyTracker ─────────────────────────────────────────────────────

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
  updateFromDetections(
    detections: readonly DetectedPrivacyObject[],
    timestamp: FrameTimestamp,
    frameIndex: FrameIndex,
  ): PrivacyTrackerUpdateResult;

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

export function createPrivacyTracker(opts: PrivacyTrackerOptions): PrivacyObjectTracker {
  const active = new Map<PrivacyObjectId, PrivacyObject>();
  const { maxMissingFrames, iouThreshold, maxTrackedObjects } = opts;

  function evictExcess(): void {
    if (maxTrackedObjects <= 0 || active.size <= maxTrackedObjects) return;
    // Evict lowest-confidence first
    const sorted = [...active.values()].sort((a, b) => a.confidence - b.confidence);
    for (const obj of sorted) {
      if (active.size <= maxTrackedObjects) break;
      active.delete(obj.id);
    }
  }

  return {
    updateFromDetections(
      detections: readonly DetectedPrivacyObject[],
      timestamp: FrameTimestamp,
      frameIndex: FrameIndex,
    ): PrivacyTrackerUpdateResult {
      const newObjects: PrivacyObject[] = [];
      const updatedObjects: PrivacyObject[] = [];
      const lostObjects: PrivacyObject[] = [];

      // Build candidate list: active objects that are candidates for matching
      const candidates = [...active.values()];
      const matched = new Set<PrivacyObjectId>();
      const detectionMatched = new Set<number>();

      // Greedy matching: sort all (detection, candidate) pairs by IoU desc
      type Match = { detIdx: number; objId: PrivacyObjectId; score: number };
      const pairs: Match[] = [];

      for (let di = 0; di < detections.length; di++) {
        const det = detections[di]!;
        for (const obj of candidates) {
          if (obj.classId !== det.classId) continue;
          const score = iou(det.box, obj.box);
          if (score >= iouThreshold) {
            pairs.push({ detIdx: di, objId: obj.id, score });
          }
        }
      }

      pairs.sort((a, b) => b.score - a.score);

      for (const { detIdx, objId, score } of pairs) {
        if (matched.has(objId) || detectionMatched.has(detIdx)) continue;
        const obj = active.get(objId);
        if (!obj) continue;
        const det = detections[detIdx]!;

        // Update matched object
        const prevBox = obj.box;
        const prevConf = obj.confidence;
        obj.box = det.box;
        obj.confidence = det.confidence;
        obj.lastSeenAt = timestamp;
        obj.lastSeenFrame = frameIndex;
        obj.missingFrames = 0;
        obj.trackLength++;

        if (
          Math.abs(obj.confidence - prevConf) > 0.01 ||
          Math.abs(obj.box.x - prevBox.x) > 0.005 ||
          Math.abs(obj.box.y - prevBox.y) > 0.005
        ) {
          updatedObjects.push(obj);
        }

        matched.add(objId);
        detectionMatched.add(detIdx);
      }

      // Unmatched active objects: increment missing frames; evict if threshold exceeded
      for (const obj of candidates) {
        if (matched.has(obj.id)) continue;
        obj.missingFrames++;
        if (obj.missingFrames > maxMissingFrames) {
          active.delete(obj.id);
          lostObjects.push(obj);
        }
      }

      // Unmatched detections: create new objects
      for (let di = 0; di < detections.length; di++) {
        if (detectionMatched.has(di)) continue;
        const det = detections[di]!;
        const newObj: PrivacyObject = {
          id: newObjectId(),
          classId: det.classId,
          box: det.box,
          confidence: det.confidence,
          trackId: null,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          lastSeenFrame: frameIndex,
          redacted: false,
          redactionType: null,
          trackLength: 1,
          missingFrames: 0,
        };
        active.set(newObj.id, newObj);
        newObjects.push(newObj);
      }

      evictExcess();

      return {
        active: [...active.values()],
        newObjects,
        lostObjects,
        updatedObjects,
      };
    },

    tickMissing(frameIndex: FrameIndex): readonly PrivacyObject[] {
      const lost: PrivacyObject[] = [];
      for (const obj of active.values()) {
        obj.missingFrames++;
        if (obj.missingFrames > maxMissingFrames) {
          active.delete(obj.id);
          lost.push(obj);
        }
      }
      return lost;
    },

    getActive(): readonly PrivacyObject[] {
      return [...active.values()];
    },

    reset(): void {
      active.clear();
    },
  };
}
