/**
 * @platform/smart-vision — concrete FrameScheduler implementation.
 *
 * Decouples the hardware camera rate (e.g. 60 fps) from the analysis rate
 * (e.g. 15 fps). Priority-queue backed; adaptive to processing load.
 */

import type {
  FrameDropPolicy,
  FramePriority,
  FrameScheduler,
  ScheduledFrame,
  VideoFrame,
} from "../frame";

const PRIORITY_RANK: Record<FramePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

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

export function createFrameScheduler(
  initialTargetFps: number = 15,
  options: FrameSchedulerOptions = {},
): FrameScheduler {
  const maxQueueDepth = options.maxQueueDepth ?? 4;
  const dropPolicy: FrameDropPolicy = options.dropPolicy ?? "drop_oldest";
  const detectionStride = options.detectionStride ?? 3;

  let targetFps = initialTargetFps;
  let minIntervalMs = 1000 / targetFps;
  let lastAcceptedMs = 0;
  let strideCounter = 0;
  let submitted = 0;
  let dropped = 0;

  const queue: ScheduledFrame[] = [];

  function shouldAcceptFrame(): boolean {
    const now = Date.now();
    // Accept if enough time has elapsed since the last accepted frame.
    // Allow 10% slack so real 15fps hardware doesn't constantly miss the window.
    return now - lastAcceptedMs >= minIntervalMs * 0.9;
  }

  function assignPriority(isDetection: boolean): FramePriority {
    return isDetection ? "high" : "normal";
  }

  return {
    get targetFps() { return targetFps; },
    get queueDepth() { return queue.length; },
    get submittedFrames() { return submitted; },
    get droppedFrames() { return dropped; },

    submit(frame: VideoFrame): void {
      submitted++;

      if (!shouldAcceptFrame()) {
        dropped++;
        return;
      }

      lastAcceptedMs = Date.now();
      strideCounter++;
      const isDetectionFrame = strideCounter % detectionStride === 0;
      const priority = assignPriority(isDetectionFrame);
      const deadlineMs = Date.now() + minIntervalMs * 3;

      const scheduled: ScheduledFrame = { frame, priority, deadlineMs, isDetectionFrame };

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
          let worstIdx = 0;
          let worstRank = PRIORITY_RANK[queue[0]?.priority ?? "background"];
          for (let i = 1; i < queue.length; i++) {
            const rank = PRIORITY_RANK[queue[i]?.priority ?? "background"];
            if (rank > worstRank) { worstRank = rank; worstIdx = i; }
          }
          const incomingRank = PRIORITY_RANK[priority];
          if (incomingRank > worstRank) {
            // Incoming is lower priority than everything — drop it
            dropped++;
          } else {
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

    dequeue(): ScheduledFrame | null {
      return queue.shift() ?? null;
    },

    setTargetFps(fps: number): void {
      targetFps = Math.max(1, fps);
      minIntervalMs = 1000 / targetFps;
    },

    reset(): void {
      queue.length = 0;
      submitted = 0;
      dropped = 0;
      lastAcceptedMs = 0;
      strideCounter = 0;
    },
  };
}
