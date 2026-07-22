/**
 * @platform/smart-vision/live-session — LiveFrameScheduler implementation.
 *
 * Token-bucket rate limiter. Accepts frames at the target FPS, drops stale
 * frames (age > maxFrameAgeMs), and backs off when the queue is backed up.
 * Always prefers fresh frames — if the queue is non-empty and the next frame
 * is within the token interval, the incoming frame still proceeds to let
 * the caller drop the queued frame instead.
 */
export function createLiveFrameScheduler(opts) {
    let targetFps = opts.targetFps;
    const maxFrameAgeMs = opts.maxFrameAgeMs;
    let lastAcceptMs = 0;
    const recentAcceptTimes = [];
    function pruneRecentTimes() {
        const cutoff = Date.now() - 1000;
        while (recentAcceptTimes.length > 0 && (recentAcceptTimes[0] ?? 0) < cutoff) {
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
        accept(frame, queueDepth) {
            const now = Date.now();
            const frameAge = now - frame.meta.timestamp;
            // 1. Staleness check — drop frames that are too old to be useful.
            if (maxFrameAgeMs > 0 && frameAge > maxFrameAgeMs) {
                return { decision: "drop_stale", frameAgeMs: frameAge, queueDepth };
            }
            // 2. Token bucket — enforce target FPS.
            //    Allow one accepted frame per (1000/targetFps) ms.
            //    If we're within the interval AND there is already a queued frame,
            //    drop the incoming one (the queued frame is fresher in the pipeline).
            const minIntervalMs = 1000 / Math.max(1, targetFps);
            const sinceLast = now - lastAcceptMs;
            if (sinceLast < minIntervalMs && queueDepth > 0) {
                return { decision: "drop_full", frameAgeMs: frameAge, queueDepth };
            }
            // Accept
            lastAcceptMs = now;
            recentAcceptTimes.push(now);
            return { decision: "process", frameAgeMs: frameAge, queueDepth };
        },
        updateTargetFps(fps) {
            targetFps = Math.max(1, fps);
        },
        reset() {
            lastAcceptMs = 0;
            recentAcceptTimes.length = 0;
        },
    };
}
