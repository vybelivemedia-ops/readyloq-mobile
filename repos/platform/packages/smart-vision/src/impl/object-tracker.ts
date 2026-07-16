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

import type {
  BoundingBox,
  ObjectTracker,
  TrackId,
  TrackedRegion,
  TrackingConfig,
  TrackingTarget,
} from "../tracking";
import type { FrameIndex, FrameTimestamp, VideoFrame } from "../frame";

const DEFAULT_CONFIG: TrackingConfig = {
  maxTargets: 8,
  confidenceThreshold: 0.4,
  occlusionToleranceFrames: 5,
  predictWhenOccluded: true,
};

interface Track {
  target: TrackingTarget;
  box: BoundingBox;
  confidence: number;
  state: TrackedRegion["state"];
  frameIndex: number;
  timestamp: number;
  invisibleFrames: number;
}

function ts(): FrameTimestamp { return Date.now() as FrameTimestamp; }

export function createObjectTracker(
  config: Partial<TrackingConfig> = {},
): ObjectTracker {
  const cfg: TrackingConfig = { ...DEFAULT_CONFIG, ...config };
  const tracks = new Map<TrackId, Track>();
  let _activeTracks: TrackedRegion[] = [];

  function buildRegion(t: Track, fi: FrameIndex): TrackedRegion {
    return {
      trackId: t.target.id,
      box: t.box,
      confidence: t.confidence,
      state: t.state,
      frameIndex: fi,
      timestamp: t.timestamp as FrameTimestamp,
    };
  }

  function rebuildActive(fi: FrameIndex): void {
    _activeTracks = [];
    for (const t of tracks.values()) {
      if (t.state !== "lost" && t.state !== "completed") {
        _activeTracks.push(buildRegion(t, fi));
      }
    }
  }

  return {
    acquire(target: TrackingTarget): void {
      if (tracks.size >= cfg.maxTargets) return;
      const existing = tracks.get(target.id);
      if (existing) {
        // Re-seed with updated position (common on each detection frame)
        existing.box = target.initialBox;
        existing.confidence = 0.8;
        existing.state = "tracking";
        existing.invisibleFrames = 0;
        existing.timestamp = Date.now();
      } else {
        tracks.set(target.id, {
          target,
          box: target.initialBox,
          confidence: 0.8,
          state: "acquired",
          frameIndex: 0,
          timestamp: Date.now(),
          invisibleFrames: 0,
        });
      }
    },

    release(trackId: TrackId): void {
      const t = tracks.get(trackId);
      if (t) {
        t.state = "completed";
        tracks.delete(trackId);
      }
    },

    async update(frame: VideoFrame): Promise<readonly TrackedRegion[]> {
      const fi = frame.meta.index;
      const now = Date.now();

      for (const t of tracks.values()) {
        t.invisibleFrames++;
        t.frameIndex = fi;
        t.timestamp = now;

        if (t.state === "acquired") {
          t.state = "tracking";
        } else if (t.state === "tracking") {
          // After a few invisible frames, mark occluded
          if (t.invisibleFrames > 1) {
            t.state = "occluded";
            t.confidence = Math.max(0.1, t.confidence - 0.1 * t.invisibleFrames);
          }
        } else if (t.state === "occluded") {
          t.confidence = Math.max(0.05, t.confidence * 0.85);
          if (t.invisibleFrames >= cfg.occlusionToleranceFrames) {
            if (t.target.persistent) {
              // Stay occluded; engine may reacquire
            } else {
              t.state = "lost";
              tracks.delete(t.target.id);
            }
          }
        }
      }

      rebuildActive(fi);
      return _activeTracks;
    },

    getRegion(trackId: TrackId): TrackedRegion | undefined {
      const t = tracks.get(trackId);
      if (!t) return undefined;
      return buildRegion(t, t.frameIndex as FrameIndex);
    },

    get activeTracks(): readonly TrackedRegion[] {
      return _activeTracks;
    },

    reset(): void {
      tracks.clear();
      _activeTracks = [];
    },
  };
}
