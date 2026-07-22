/**
 * @platform/smart-vision/live-session — frame scheduler contracts.
 *
 * The LiveFrameScheduler is the first gate in the pipeline. It decides
 * whether each incoming frame should be processed, deferred, or dropped.
 *
 * Design goals:
 *   - Prefer fresh frames over queued frames.
 *   - Never allow latency to accumulate.
 *   - Drop stale frames immediately.
 *   - Throttle to the target FPS budget.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
export {};
