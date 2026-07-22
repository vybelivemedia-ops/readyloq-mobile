"use strict";
/**
 * @platform/smart-vision/live-session — LiveFrameScheduler implementation.
 *
 * Token-bucket rate limiter. Accepts frames at the target FPS, drops stale
 * frames (age > maxFrameAgeMs), and backs off when the queue is backed up.
 * Always prefers fresh frames — if the queue is non-empty and the next frame
 * is within the token interval, the incoming frame still proceeds to let
 * the caller drop the queued frame instead.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLiveFrameScheduler = createLiveFrameScheduler;
function createLiveFrameScheduler(opts) {
    var targetFps = opts.targetFps;
    var maxFrameAgeMs = opts.maxFrameAgeMs;
    var lastAcceptMs = 0;
    var recentAcceptTimes = [];
    function pruneRecentTimes() {
        var _a;
        var cutoff = Date.now() - 1000;
        while (recentAcceptTimes.length > 0 && ((_a = recentAcceptTimes[0]) !== null && _a !== void 0 ? _a : 0) < cutoff) {
            recentAcceptTimes.shift();
        }
    }
    return {
        get targetFps() {
            return targetFps;
        },
        get maxFrameAgeMs() {
            return maxFrameAgeMs;
        },
        get measuredFps() {
            pruneRecentTimes();
            return recentAcceptTimes.length;
        },
        accept: function (frame, queueDepth) {
            var now = Date.now();
            var frameAge = now - frame.meta.timestamp;
            // 1. Staleness check — drop frames that are too old to be useful.
            if (maxFrameAgeMs > 0 && frameAge > maxFrameAgeMs) {
                return { decision: "drop_stale", frameAgeMs: frameAge, queueDepth: queueDepth };
            }
            // 2. Token bucket — enforce target FPS.
            //    Allow one accepted frame per (1000/targetFps) ms.
            //    If we're within the interval AND there is already a queued frame,
            //    drop the incoming one (the queued frame is fresher in the pipeline).
            var minIntervalMs = 1000 / Math.max(1, targetFps);
            var sinceLast = now - lastAcceptMs;
            if (sinceLast < minIntervalMs && queueDepth > 0) {
                return { decision: "drop_full", frameAgeMs: frameAge, queueDepth: queueDepth };
            }
            // Accept
            lastAcceptMs = now;
            recentAcceptTimes.push(now);
            return { decision: "process", frameAgeMs: frameAge, queueDepth: queueDepth };
        },
        updateTargetFps: function (fps) {
            targetFps = Math.max(1, fps);
        },
        reset: function () {
            lastAcceptMs = 0;
            recentAcceptTimes.length = 0;
        },
    };
}
