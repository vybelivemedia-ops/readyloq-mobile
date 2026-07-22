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
const DEFAULT_CONFIG = {
    maxTargets: 8,
    confidenceThreshold: 0.4,
    occlusionToleranceFrames: 5,
    predictWhenOccluded: true,
};
function ts() { return Date.now(); }
export function createObjectTracker(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const tracks = new Map();
    let _activeTracks = [];
    function buildRegion(t, fi) {
        return {
            trackId: t.target.id,
            box: t.box,
            confidence: t.confidence,
            state: t.state,
            frameIndex: fi,
            timestamp: t.timestamp,
        };
    }
    function rebuildActive(fi) {
        _activeTracks = [];
        for (const t of tracks.values()) {
            if (t.state !== "lost" && t.state !== "completed") {
                _activeTracks.push(buildRegion(t, fi));
            }
        }
    }
    return {
        acquire(target) {
            if (tracks.size >= cfg.maxTargets)
                return;
            const existing = tracks.get(target.id);
            if (existing) {
                // Re-seed with updated position (common on each detection frame)
                existing.box = target.initialBox;
                existing.confidence = 0.8;
                existing.state = "tracking";
                existing.invisibleFrames = 0;
                existing.timestamp = Date.now();
            }
            else {
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
        release(trackId) {
            const t = tracks.get(trackId);
            if (t) {
                t.state = "completed";
                tracks.delete(trackId);
            }
        },
        async update(frame) {
            const fi = frame.meta.index;
            const now = Date.now();
            for (const t of tracks.values()) {
                t.invisibleFrames++;
                t.frameIndex = fi;
                t.timestamp = now;
                if (t.state === "acquired") {
                    t.state = "tracking";
                }
                else if (t.state === "tracking") {
                    // After a few invisible frames, mark occluded
                    if (t.invisibleFrames > 1) {
                        t.state = "occluded";
                        t.confidence = Math.max(0.1, t.confidence - 0.1 * t.invisibleFrames);
                    }
                }
                else if (t.state === "occluded") {
                    t.confidence = Math.max(0.05, t.confidence * 0.85);
                    if (t.invisibleFrames >= cfg.occlusionToleranceFrames) {
                        if (t.target.persistent) {
                            // Stay occluded; engine may reacquire
                        }
                        else {
                            t.state = "lost";
                            tracks.delete(t.target.id);
                        }
                    }
                }
            }
            rebuildActive(fi);
            return _activeTracks;
        },
        getRegion(trackId) {
            const t = tracks.get(trackId);
            if (!t)
                return undefined;
            return buildRegion(t, t.frameIndex);
        },
        get activeTracks() {
            return _activeTracks;
        },
        reset() {
            tracks.clear();
            _activeTracks = [];
        },
    };
}
