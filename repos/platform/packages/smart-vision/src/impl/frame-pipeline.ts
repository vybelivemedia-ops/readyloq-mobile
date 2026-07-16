/**
 * @platform/smart-vision — concrete FramePipeline implementation.
 * Ordered chain of FrameProcessors; isolates errors per processor.
 */

import type {
  FrameIndex,
  FramePipeline,
  FrameProcessor,
  PipelineResult,
  PipelineStats,
  VideoFrame,
} from "../frame";

export function createFramePipeline(): FramePipeline {
  const processors: FrameProcessor[] = [];

  let processedFrames = 0;
  let droppedFrames = 0;
  let latencySum = 0;
  let peakLatencyMs = 0;
  let fpsWindowStart = Date.now();
  let fpsWindowCount = 0;
  let currentFps = 0;

  const stats: PipelineStats = {
    get processedFrames() { return processedFrames; },
    get droppedFrames() { return droppedFrames; },
    get averageLatencyMs() { return processedFrames > 0 ? latencySum / processedFrames : 0; },
    get peakLatencyMs() { return peakLatencyMs; },
    get currentFps() { return currentFps; },
  };

  return {
    use(processor: FrameProcessor): void {
      if (!processors.some(p => p.id === processor.id)) {
        processors.push(processor);
      }
    },

    remove(processorId: string): void {
      const idx = processors.findIndex(p => p.id === processorId);
      if (idx >= 0) processors.splice(idx, 1);
    },

    async run(frame: VideoFrame): Promise<PipelineResult> {
      const start = Date.now();
      const processorTimings: Record<string, number> = {};
      const warnings: string[] = [];

      for (const processor of [...processors]) {
        const t0 = Date.now();
        try {
          await processor.process(frame);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          warnings.push(`${processor.id}: ${msg}`);
        }
        processorTimings[processor.id] = Date.now() - t0;
      }

      const durationMs = Date.now() - start;
      processedFrames++;
      latencySum += durationMs;
      if (durationMs > peakLatencyMs) peakLatencyMs = durationMs;

      // Update rolling FPS
      fpsWindowCount++;
      const elapsed = Date.now() - fpsWindowStart;
      if (elapsed >= 1000) {
        currentFps = (fpsWindowCount * 1000) / elapsed;
        fpsWindowStart = Date.now();
        fpsWindowCount = 0;
      }

      return {
        frameIndex: frame.meta.index as FrameIndex,
        durationMs,
        processorTimings,
        warnings,
      };
    },

    reset(): void {
      for (const p of processors) p.reset();
      processedFrames = 0;
      droppedFrames = 0;
      latencySum = 0;
      peakLatencyMs = 0;
      fpsWindowStart = Date.now();
      fpsWindowCount = 0;
      currentFps = 0;
    },

    get stats(): PipelineStats { return stats; },
  };
}
