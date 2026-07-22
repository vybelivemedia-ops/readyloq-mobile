/**
 * @platform/smart-vision/live-session — LiveFrameScheduler implementation.
 *
 * Token-bucket rate limiter. Accepts frames at the target FPS, drops stale
 * frames (age > maxFrameAgeMs), and backs off when the queue is backed up.
 * Always prefers fresh frames — if the queue is non-empty and the next frame
 * is within the token interval, the incoming frame still proceeds to let
 * the caller drop the queued frame instead.
 */
import type { LiveFrameScheduler } from "../scheduler";
export declare function createLiveFrameScheduler(opts: {
    targetFps: number;
    maxFrameAgeMs: number;
}): LiveFrameScheduler;
//# sourceMappingURL=scheduler-impl.d.ts.map