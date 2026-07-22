/**
 * @platform/smart-vision/live-session — FramePipeline + PipelineEventBus implementations.
 *
 * createFramePipeline() — runs an ordered list of PipelineStageRunners sequentially.
 *   Stage errors are caught and recorded as PipelineStageResult failures; the
 *   pipeline always continues through to the last stage (event_publish) so the
 *   session always emits a pipeline.frame.processed event.
 *
 * createPipelineEventBus() — simple typed event emitter for pipeline events.
 *   All events are dispatched synchronously on the microtask queue.
 */
import type { PipelineStageRunner, FramePipeline } from "../pipeline";
import type { PipelineEventBus } from "../events";
export declare function createFramePipeline(runners: readonly PipelineStageRunner[], sessionId: string): FramePipeline;
export declare function createPipelineEventBus(): PipelineEventBus;
//# sourceMappingURL=pipeline-impl.d.ts.map