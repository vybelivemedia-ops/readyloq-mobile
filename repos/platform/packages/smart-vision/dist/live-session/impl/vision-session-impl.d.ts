/**
 * @platform/smart-vision/live-session — VisionSession implementation.
 *
 * VisionSessionImpl coordinates all pipeline stages for one active session.
 * It owns the frame queue, the async processing loop, per-stage runners built
 * from injected dependencies, and session-level statistics.
 *
 * Frame flow:
 *   feedFrame()                        — synchronous gate; scheduler decides
 *     → queue                          — bounded FIFO; overflow applies dropPolicy
 *       → _kickProcessing()            — starts async loop if not running
 *         → _processLoop()             — dequeues one frame at a time
 *           → pipeline.process()       — runs all enabled stage runners in order
 *             → emit pipeline.frame.processed
 *             → perfMonitor.record()
 *             → checkAdaptation()
 */
import type { VideoFrame } from "../../frame";
import type { PipelineState, LiveSessionConfig } from "../types";
import type { PipelineEventBus } from "../events";
import type { SessionStatistics, VisionSession, VisionSessionSnapshot } from "../session";
import type { LiveSessionDependencies } from "../engine";
export declare class VisionSessionImpl implements VisionSession {
    readonly sessionId: string;
    readonly events: PipelineEventBus;
    readonly config: LiveSessionConfig;
    private _state;
    private readonly _queue;
    private _processingActive;
    private _frameCount;
    private _lastCaptureMs;
    private _totalCaptures;
    private readonly _startedAt;
    private readonly _stats;
    private readonly _perfMonitor;
    private readonly _scheduler;
    private readonly _pipeline;
    constructor(deps: LiveSessionDependencies, config: LiveSessionConfig, parentEvents: PipelineEventBus);
    get state(): PipelineState;
    feedFrame(frame: VideoFrame): void;
    pause(reason?: string): void;
    resume(): void;
    stop(): Promise<void>;
    updateConfig(updates: Pick<Partial<LiveSessionConfig>, "targetFps" | "frameDropPolicy" | "maxFrameAgeMs">): void;
    getStatistics(): SessionStatistics;
    snapshot(): VisionSessionSnapshot;
    private _dropFrame;
    private _applyDropPolicy;
    private _kickProcessing;
    private _processLoop;
    private _processFrame;
    private _bridgeToParent;
}
//# sourceMappingURL=vision-session-impl.d.ts.map