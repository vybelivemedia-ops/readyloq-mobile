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
function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const inter = ix * iy;
    if (inter === 0)
        return 0;
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}
// ─── ID factory ───────────────────────────────────────────────────────────────
let _seq = 0;
function newObjectId() {
    return `pobj-${Date.now()}-${++_seq}`;
}
export function createPrivacyTracker(opts) {
    const active = new Map();
    const { maxMissingFrames, iouThreshold, maxTrackedObjects } = opts;
    function evictExcess() {
        if (maxTrackedObjects <= 0 || active.size <= maxTrackedObjects)
            return;
        // Evict lowest-confidence first
        const sorted = [...active.values()].sort((a, b) => a.confidence - b.confidence);
        for (const obj of sorted) {
            if (active.size <= maxTrackedObjects)
                break;
            active.delete(obj.id);
        }
    }
    return {
        updateFromDetections(detections, timestamp, frameIndex) {
            const newObjects = [];
            const updatedObjects = [];
            const lostObjects = [];
            // Build candidate list: active objects that are candidates for matching
            const candidates = [...active.values()];
            const matched = new Set();
            const detectionMatched = new Set();
            const pairs = [];
            for (let di = 0; di < detections.length; di++) {
                const det = detections[di];
                for (const obj of candidates) {
                    if (obj.classId !== det.classId)
                        continue;
                    const score = iou(det.box, obj.box);
                    if (score >= iouThreshold) {
                        pairs.push({ detIdx: di, objId: obj.id, score });
                    }
                }
            }
            pairs.sort((a, b) => b.score - a.score);
            for (const { detIdx, objId, score } of pairs) {
                if (matched.has(objId) || detectionMatched.has(detIdx))
                    continue;
                const obj = active.get(objId);
                if (!obj)
                    continue;
                const det = detections[detIdx];
                // Update matched object
                const prevBox = obj.box;
                const prevConf = obj.confidence;
                obj.box = det.box;
                obj.confidence = det.confidence;
                obj.lastSeenAt = timestamp;
                obj.lastSeenFrame = frameIndex;
                obj.missingFrames = 0;
                obj.trackLength++;
                if (Math.abs(obj.confidence - prevConf) > 0.01 ||
                    Math.abs(obj.box.x - prevBox.x) > 0.005 ||
                    Math.abs(obj.box.y - prevBox.y) > 0.005) {
                    updatedObjects.push(obj);
                }
                matched.add(objId);
                detectionMatched.add(detIdx);
            }
            // Unmatched active objects: increment missing frames; evict if threshold exceeded
            for (const obj of candidates) {
                if (matched.has(obj.id))
                    continue;
                obj.missingFrames++;
                if (obj.missingFrames > maxMissingFrames) {
                    active.delete(obj.id);
                    lostObjects.push(obj);
                }
            }
            // Unmatched detections: create new objects
            for (let di = 0; di < detections.length; di++) {
                if (detectionMatched.has(di))
                    continue;
                const det = detections[di];
                const newObj = {
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
        tickMissing(frameIndex) {
            const lost = [];
            for (const obj of active.values()) {
                obj.missingFrames++;
                if (obj.missingFrames > maxMissingFrames) {
                    active.delete(obj.id);
                    lost.push(obj);
                }
            }
            return lost;
        },
        getActive() {
            return [...active.values()];
        },
        reset() {
            active.clear();
        },
    };
}
