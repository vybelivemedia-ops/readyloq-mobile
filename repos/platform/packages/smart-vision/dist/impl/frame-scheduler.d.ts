/**
 * @platform/smart-vision — concrete FrameScheduler implementation.
 *
 * Decouples the hardware camera rate (e.g. 60 fps) from the analysis rate
 * (e.g. 15 fps). Priority-queue backed; adaptive to processing load.
 */
import type { FrameDropPolicy, FrameScheduler } from "../frame";
export interface FrameSchedulerOptions {
    maxQueueDepth?: number;
    dropPolicy?: FrameDropPolicy;
    /**
     * Run detection every N analysis frames.
     * Between detection frames the tracker extrapolates positions.
     * Default: 3 (matches DEFAULT_SMART_VISION_CONFIG.detectionStrideFrames).
     */
    detectionStride?: number;
}
export declare function createFrameScheduler(initialTargetFps?: number, options?: FrameSchedulerOptions): FrameScheduler;
//# sourceMappingURL=frame-scheduler.d.ts.map