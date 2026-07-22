"use strict";
/**
 * @platform/smart-vision — concrete FrameScheduler implementation.
 *
 * Decouples the hardware camera rate (e.g. 60 fps) from the analysis rate
 * (e.g. 15 fps). Priority-queue backed; adaptive to processing load.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFrameScheduler = createFrameScheduler;
var PRIORITY_RANK = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
    background: 4,
};
function createFrameScheduler(initialTargetFps, options) {
    var _a, _b, _c;
    if (initialTargetFps === void 0) { initialTargetFps = 15; }
    if (options === void 0) { options = {}; }
    var maxQueueDepth = (_a = options.maxQueueDepth) !== null && _a !== void 0 ? _a : 4;
    var dropPolicy = (_b = options.dropPolicy) !== null && _b !== void 0 ? _b : "drop_oldest";
    var detectionStride = (_c = options.detectionStride) !== null && _c !== void 0 ? _c : 3;
    var targetFps = initialTargetFps;
    var minIntervalMs = 1000 / targetFps;
    var lastAcceptedMs = 0;
    var strideCounter = 0;
    var submitted = 0;
    var dropped = 0;
    var queue = [];
    function shouldAcceptFrame() {
        var now = Date.now();
        // Accept if enough time has elapsed since the last accepted frame.
        // Allow 10% slack so real 15fps hardware doesn't constantly miss the window.
        return now - lastAcceptedMs >= minIntervalMs * 0.9;
    }
    function assignPriority(isDetection) {
        return isDetection ? "high" : "normal";
    }
    return {
        get targetFps() { return targetFps; },
        get queueDepth() { return queue.length; },
        get submittedFrames() { return submitted; },
        get droppedFrames() { return dropped; },
        submit: function (frame) {
            var _a, _b, _c, _d;
            submitted++;
            if (!shouldAcceptFrame()) {
                dropped++;
                return;
            }
            lastAcceptedMs = Date.now();
            strideCounter++;
            var isDetectionFrame = strideCounter % detectionStride === 0;
            var priority = assignPriority(isDetectionFrame);
            var deadlineMs = Date.now() + minIntervalMs * 3;
            var scheduled = { frame: frame, priority: priority, deadlineMs: deadlineMs, isDetectionFrame: isDetectionFrame };
            if (queue.length < maxQueueDepth) {
                queue.push(scheduled);
                return;
            }
            // Queue is full — apply drop policy
            switch (dropPolicy) {
                case "drop_oldest":
                    queue.shift();
                    dropped++;
                    queue.push(scheduled);
                    break;
                case "drop_lowest_priority": {
                    var worstIdx = 0;
                    var worstRank = PRIORITY_RANK[(_b = (_a = queue[0]) === null || _a === void 0 ? void 0 : _a.priority) !== null && _b !== void 0 ? _b : "background"];
                    for (var i = 1; i < queue.length; i++) {
                        var rank = PRIORITY_RANK[(_d = (_c = queue[i]) === null || _c === void 0 ? void 0 : _c.priority) !== null && _d !== void 0 ? _d : "background"];
                        if (rank > worstRank) {
                            worstRank = rank;
                            worstIdx = i;
                        }
                    }
                    var incomingRank = PRIORITY_RANK[priority];
                    if (incomingRank > worstRank) {
                        // Incoming is lower priority than everything — drop it
                        dropped++;
                    }
                    else {
                        queue.splice(worstIdx, 1);
                        dropped++;
                        queue.push(scheduled);
                    }
                    break;
                }
                case "drop_incoming":
                    dropped++;
                    break;
            }
        },
        dequeue: function () {
            var _a;
            return (_a = queue.shift()) !== null && _a !== void 0 ? _a : null;
        },
        setTargetFps: function (fps) {
            targetFps = Math.max(1, fps);
            minIntervalMs = 1000 / targetFps;
        },
        reset: function () {
            queue.length = 0;
            submitted = 0;
            dropped = 0;
            lastAcceptedMs = 0;
            strideCounter = 0;
        },
    };
}
