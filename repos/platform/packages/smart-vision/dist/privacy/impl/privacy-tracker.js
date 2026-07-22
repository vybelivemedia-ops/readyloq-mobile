"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivacyTracker = createPrivacyTracker;
function iou(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    var inter = ix * iy;
    if (inter === 0)
        return 0;
    var union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}
// ─── ID factory ───────────────────────────────────────────────────────────────
var _seq = 0;
function newObjectId() {
    return "pobj-".concat(Date.now(), "-").concat(++_seq);
}
function createPrivacyTracker(opts) {
    var active = new Map();
    var maxMissingFrames = opts.maxMissingFrames, iouThreshold = opts.iouThreshold, maxTrackedObjects = opts.maxTrackedObjects;
    function evictExcess() {
        if (maxTrackedObjects <= 0 || active.size <= maxTrackedObjects)
            return;
        // Evict lowest-confidence first
        var sorted = __spreadArray([], active.values(), true).sort(function (a, b) { return a.confidence - b.confidence; });
        for (var _i = 0, sorted_1 = sorted; _i < sorted_1.length; _i++) {
            var obj = sorted_1[_i];
            if (active.size <= maxTrackedObjects)
                break;
            active.delete(obj.id);
        }
    }
    return {
        updateFromDetections: function (detections, timestamp, frameIndex) {
            var newObjects = [];
            var updatedObjects = [];
            var lostObjects = [];
            // Build candidate list: active objects that are candidates for matching
            var candidates = __spreadArray([], active.values(), true);
            var matched = new Set();
            var detectionMatched = new Set();
            var pairs = [];
            for (var di = 0; di < detections.length; di++) {
                var det = detections[di];
                for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
                    var obj = candidates_1[_i];
                    if (obj.classId !== det.classId)
                        continue;
                    var score = iou(det.box, obj.box);
                    if (score >= iouThreshold) {
                        pairs.push({ detIdx: di, objId: obj.id, score: score });
                    }
                }
            }
            pairs.sort(function (a, b) { return b.score - a.score; });
            for (var _a = 0, pairs_1 = pairs; _a < pairs_1.length; _a++) {
                var _b = pairs_1[_a], detIdx = _b.detIdx, objId = _b.objId, score = _b.score;
                if (matched.has(objId) || detectionMatched.has(detIdx))
                    continue;
                var obj = active.get(objId);
                if (!obj)
                    continue;
                var det = detections[detIdx];
                // Update matched object
                var prevBox = obj.box;
                var prevConf = obj.confidence;
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
            for (var _c = 0, candidates_2 = candidates; _c < candidates_2.length; _c++) {
                var obj = candidates_2[_c];
                if (matched.has(obj.id))
                    continue;
                obj.missingFrames++;
                if (obj.missingFrames > maxMissingFrames) {
                    active.delete(obj.id);
                    lostObjects.push(obj);
                }
            }
            // Unmatched detections: create new objects
            for (var di = 0; di < detections.length; di++) {
                if (detectionMatched.has(di))
                    continue;
                var det = detections[di];
                var newObj = {
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
                active: __spreadArray([], active.values(), true),
                newObjects: newObjects,
                lostObjects: lostObjects,
                updatedObjects: updatedObjects,
            };
        },
        tickMissing: function (frameIndex) {
            var lost = [];
            for (var _i = 0, _a = active.values(); _i < _a.length; _i++) {
                var obj = _a[_i];
                obj.missingFrames++;
                if (obj.missingFrames > maxMissingFrames) {
                    active.delete(obj.id);
                    lost.push(obj);
                }
            }
            return lost;
        },
        getActive: function () {
            return __spreadArray([], active.values(), true);
        },
        reset: function () {
            active.clear();
        },
    };
}
