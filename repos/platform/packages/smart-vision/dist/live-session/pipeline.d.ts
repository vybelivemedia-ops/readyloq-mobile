/**
 * @platform/smart-vision/live-session — pipeline contracts.
 *
 * FramePipeline:      Runs a VideoFrame through all enabled pipeline stages
 *                     sequentially and returns a PipelineFrameResult.
 *
 * PipelineCoordinator: Manages the async processing loop — dequeues frames,
 *                     calls the pipeline, handles stage errors, and drives
 *                     performance adaptation.
 *
 * DESIGN PRINCIPLES:
 *   - Each stage is an isolated async function; errors are caught per-stage.
 *   - Stages run in strict order; no parallelism within one frame.
 *   - Between frames, the coordinator may adapt target FPS.
 *   - The UI thread is never blocked.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { VideoFrame } from "../frame";
import type { PipelineStage, PipelineFrameResult, PipelineStageResult } from "./types";
/**
 * Metadata about a pipeline stage.
 * Used for diagnostics, event emission, and runtime configuration.
 */
export interface PipelineStageDescriptor {
    readonly stage: PipelineStage;
    /** Whether this stage is enabled in the current session configuration. */
    readonly enabled: boolean;
    /**
     * Stage position in the pipeline (1-indexed).
     * Stages always execute in ascending order position.
     */
    readonly order: number;
    /** Estimated maximum acceptable latency for this stage in ms. */
    readonly budgetMs: number;
}
/**
 * Executes one pipeline stage for one frame.
 * Implementations are created by the LiveSessionEngine from injected deps.
 *
 * run() must:
 *   - Never throw (catch internally; return PipelineStageResult with ok: false).
 *   - Never block the event loop.
 *   - Never mutate the input VideoFrame.
 *
 * TOutput is the stage's typed result (e.g. FrameQualityReport for quality).
 */
export interface PipelineStageRunner<TOutput = unknown> {
    readonly stage: PipelineStage;
    run(frame: VideoFrame, context: PipelineContext): Promise<PipelineStageResult<TOutput>>;
}
/**
 * Context object threaded through all pipeline stages for one frame.
 * Stages read results produced by earlier stages via this context.
 */
export interface PipelineContext {
    readonly frameCount: number;
    readonly sessionId: string;
    /** Results accumulated by earlier stages (in order). */
    readonly stageResults: Partial<Record<PipelineStage, PipelineStageResult>>;
    /**
     * True if this is a detection-stride frame (inference should run).
     * False = tracking should extrapolate from previous detections.
     */
    readonly isInferenceFrame: boolean;
}
/**
 * Runs a VideoFrame through all enabled pipeline stages in order.
 *
 * Each stage runner is invoked sequentially.  The pipeline never drops a
 * stage on stage failure — it records the failure and continues to the
 * next stage so that the event-publish stage always runs.
 *
 * Usage:
 *   const result = await pipeline.process(frame, context);
 *   // result.stages contains per-stage outcomes
 */
export interface FramePipeline {
    /** Ordered list of all stage descriptors for this pipeline instance. */
    readonly stages: readonly PipelineStageDescriptor[];
    /**
     * Run all enabled stages for one frame.
     * Never rejects — stage errors are captured inside PipelineStageResult.
     */
    process(frame: VideoFrame, context: PipelineContext): Promise<PipelineFrameResult>;
    /**
     * Notify the pipeline that a frame was dropped before processing.
     * Allows stages to update internal counters (e.g. tracking missing-frames).
     */
    notifyDropped(frame: VideoFrame, context: PipelineContext): Promise<void>;
    /** Replace a stage runner at runtime (for hot-swapping providers). */
    replaceStage<TOut>(runner: PipelineStageRunner<TOut>): void;
    /** Reset all stage runners (called on session reset). */
    reset(): void;
}
/**
 * Drives the asynchronous frame-processing loop.
 *
 * The coordinator:
 *   1. Dequeues a frame from the VisionSession's internal queue.
 *   2. Builds a PipelineContext (stride check, frame count).
 *   3. Calls pipeline.process(frame, context).
 *   4. Emits "pipeline.frame.processed" via the event bus.
 *   5. Reports metrics to PerformanceMonitor.
 *   6. Applies adaptation if needed (updates scheduler target FPS).
 *   7. Goes back to step 1.
 *
 * The loop runs entirely on the microtask queue — no setInterval or
 * setTimeout is used in the hot path to avoid timer jitter.
 */
export interface PipelineCoordinator {
    /** Start the processing loop. Resolves when the loop exits cleanly. */
    start(): Promise<void>;
    /** Pause the loop (frames already in the queue are held). */
    pause(reason: string): void;
    /** Resume a paused loop. */
    resume(): void;
    /** Stop the loop and release resources. Returns after the current frame completes. */
    stop(): Promise<void>;
    /** Current coordinator state. */
    readonly running: boolean;
    readonly paused: boolean;
}
//# sourceMappingURL=pipeline.d.ts.map