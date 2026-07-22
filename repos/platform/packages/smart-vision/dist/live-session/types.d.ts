/**
 * @platform/smart-vision/live-session — core types.
 *
 * Defines the pipeline lifecycle, stage identifiers, per-frame results,
 * feature flags, and top-level session configuration.
 *
 * GOVERNANCE: Zero domain logic. No application-specific identifiers.
 * See repos/platform/GOVERNANCE.md.
 */
import type { FrameIndex, FrameTimestamp } from "../frame";
import type { BuiltInPolicyId } from "../capture-policy";
import type { PrivacyPolicy } from "../privacy/policy";
import type { PrivacyConfiguration } from "../privacy/config";
import type { PerformanceProfile } from "./performance";
/**
 * State of the Live Session pipeline.
 *
 * "idle"      — created; no frames accepted yet
 * "starting"  — warming up sub-systems; not yet processing frames
 * "running"   — actively processing frames
 * "paused"    — frame ingestion suspended; sub-systems held warm
 * "stopping"  — teardown in progress
 * "error"     — non-recoverable error; must recreate session
 */
export type PipelineState = "idle" | "starting" | "running" | "paused" | "stopping" | "error";
/**
 * The 11 ordered processing stages of the Live Session pipeline.
 * Stages are always executed in the order defined here.
 * Each stage can be disabled independently via LiveSessionFeatureFlags.
 */
export type PipelineStage = "frame_acquisition" | "stability" | "quality" | "scene_memory" | "detection" | "tracking" | "motion_prediction" | "smart_zoom" | "privacy" | "auto_capture" | "event_publish";
/**
 * The outcome of running one pipeline stage on one frame.
 */
export interface PipelineStageResult<TData = unknown> {
    readonly stage: PipelineStage;
    readonly ok: boolean;
    /** Stage latency in ms. */
    readonly latencyMs: number;
    /** Stage output (null on skip or failure). */
    readonly data: TData | null;
    /** Error message if ok is false. */
    readonly error?: string;
    /** True when the stage was bypassed (disabled or ineligible frame). */
    readonly skipped: boolean;
}
/**
 * The combined result of running all pipeline stages on one frame.
 * Published via "pipeline.frame.processed" event.
 */
export interface PipelineFrameResult {
    readonly sessionId: string;
    readonly frameIndex: FrameIndex;
    readonly timestamp: FrameTimestamp;
    /** Whether the frame went through inference or was extrapolated from tracking. */
    readonly ranInference: boolean;
    /** Stage results keyed by stage name. Not all stages produce a result record. */
    readonly stages: Partial<Record<PipelineStage, PipelineStageResult>>;
    /** Wall-clock time for the full pipeline (all stages combined). */
    readonly totalLatencyMs: number;
}
/**
 * Enables or disables each pipeline stage.
 * Disabled stages are skipped and consume no resources.
 *
 * frame_acquisition is always active; it cannot be disabled.
 * event_publish is always active; it cannot be disabled.
 */
export interface LiveSessionFeatureFlags {
    stability: boolean;
    quality: boolean;
    sceneMemory: boolean;
    detection: boolean;
    tracking: boolean;
    motionPrediction: boolean;
    smartZoom: boolean;
    privacy: boolean;
    autoCapture: boolean;
}
export declare const DEFAULT_LIVE_SESSION_FEATURES: Readonly<LiveSessionFeatureFlags>;
/**
 * Controls how the pipeline behaves when the processing queue is full.
 *
 * "drop_oldest"  — discard the oldest queued frame (prefer fresh frames).
 * "drop_newest"  — discard the incoming frame (preserve queued work).
 * "drop_all"     — clear the entire queue and start fresh with the new frame.
 */
export type FrameDropPolicy = "drop_oldest" | "drop_newest" | "drop_all";
/**
 * Full configuration for a LiveSessionEngine session.
 * Applications construct one and pass it to LiveSessionEngine.startSession().
 */
export interface LiveSessionConfig {
    /**
     * Target analysis frame rate. The pipeline drops or defers frames to stay
     * at or below this rate. The scheduler adapts automatically if processing
     * cannot keep up.
     *
     * Default: 30 fps. Use 60 on flagship devices; 15 on low-end hardware.
     */
    readonly targetFps: number;
    /**
     * Maximum frames held in the processing queue at one time.
     * When the queue is full, the frameDropPolicy applies.
     * Default: 2 (prefer fresh frames over deep queues).
     */
    readonly maxQueueDepth: number;
    /** How to handle queue overflow. Default: "drop_oldest". */
    readonly frameDropPolicy: FrameDropPolicy;
    /**
     * Maximum frame age in ms before the scheduler drops it as stale.
     * 0 = no staleness check. Default: 100 (drop frames older than 100 ms).
     */
    readonly maxFrameAgeMs: number;
    /** Which stages to enable. */
    readonly features: LiveSessionFeatureFlags;
    /**
     * Run detection inference every N frames; use tracking to extrapolate
     * positions on other frames.
     * 1 = detect every frame. Default: 3.
     */
    readonly detectionStrideFrames: number;
    /**
     * Performance profile that drives adaptive frame rate and resource usage.
     * Default: "balanced".
     */
    readonly performanceProfile: PerformanceProfile;
    /**
     * When true, the PerformanceMonitor may automatically lower targetFps to
     * stay within latency budget. Set false to disable adaptation.
     */
    readonly adaptivePerformance: boolean;
    /** Privacy policy to apply when features.privacy is true. */
    readonly privacyPolicy?: PrivacyPolicy;
    /** Privacy configuration overrides when features.privacy is true. */
    readonly privacyConfig?: Partial<PrivacyConfiguration>;
    /** Built-in capture policy ID when features.autoCapture is true. */
    readonly capturePolicyId?: BuiltInPolicyId;
    /**
     * Minimum novelty score [0–1] required to run inference.
     * Frames with lower novelty reuse the previous detection result.
     * Default: 0.3.
     */
    readonly sceneNoveltyThreshold: number;
}
export declare const DEFAULT_LIVE_SESSION_CONFIG: Readonly<LiveSessionConfig>;
//# sourceMappingURL=types.d.ts.map