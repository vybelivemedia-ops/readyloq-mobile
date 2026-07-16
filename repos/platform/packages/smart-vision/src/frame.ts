/**
 * @platform/smart-vision — live frame processing contracts.
 *
 * Defines the raw frame abstraction that flows through the smart-vision
 * pipeline. Frames arrive from any CaptureProvider; the pipeline is
 * completely source-agnostic. No domain logic of any kind.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { CaptureSource } from "@platform/camera-core";

// ─── Branded primitives ───────────────────────────────────────────────────────

/** Monotonic presentation timestamp in milliseconds (device-clock relative). */
export type FrameTimestamp = number & { readonly __brand: "FrameTimestamp" };

/** Sequential index of the frame within a capture session. Resets on session restart. */
export type FrameIndex = number & { readonly __brand: "FrameIndex" };

// ─── Frame dimensions ─────────────────────────────────────────────────────────

export interface FrameDimensions {
  width: number;
  height: number;
}

// ─── Pixel formats ────────────────────────────────────────────────────────────

/**
 * Raw pixel formats carried by VideoFrame.
 *
 * Processors declare which formats they accept. The pipeline inserts a
 * conversion step when an upstream and downstream processor formats mismatch.
 */
export type PixelFormat =
  | "rgba8"    // 4 bytes per pixel: R G B A
  | "rgb8"     // 3 bytes per pixel: R G B
  | "yuv420p"  // planar YUV 4:2:0 (common in hardware decoders)
  | "nv12"     // semi-planar YUV (Android Camera2 / AVFoundation)
  | "gray8";   // 1 byte per pixel: luminance only (for internal analysis)

// ─── Frame metadata ───────────────────────────────────────────────────────────

export interface FrameMetadata {
  /** Monotonic capture timestamp (ms). */
  timestamp: FrameTimestamp;
  /** Ordinal position within the session. */
  index: FrameIndex;
  /** Pixel dimensions as reported by the hardware. */
  dimensions: FrameDimensions;
  /** Where this frame originated. */
  source: CaptureSource;
  /** Camera sensor orientation in degrees clockwise. */
  rotation?: 0 | 90 | 180 | 270;
  /** Device-reported sensor exposure time in microseconds. */
  exposureUs?: number;
  /** ISO equivalent sensitivity. */
  iso?: number;
}

// ─── Frame payload ────────────────────────────────────────────────────────────

/**
 * A decoded video frame — source-agnostic.
 *
 * `data` holds raw pixel bytes in the declared `pixelFormat`. Processors
 * consume the format(s) they declare support for; the pipeline handles
 * conversion when needed.
 *
 * NOTE: This is a platform CONTRACT, not a reference to the browser
 * VideoFrame API. Implementations may back this with ImageData, a React
 * Native Buffer, a WASM heap view, or any concrete buffer type.
 */
export interface VideoFrame {
  readonly meta: FrameMetadata;
  readonly pixelFormat: PixelFormat;
  /**
   * Raw pixel bytes.
   * Expected length = width × height × bytesPerPixel(pixelFormat).
   */
  readonly data: Uint8Array | Uint8ClampedArray;
}

// ─── Frame rate ───────────────────────────────────────────────────────────────

export interface FrameRate {
  /** Desired frames per second. */
  target: number;
  /** Measured FPS over the last second. Absent until enough frames have passed. */
  actual?: number;
}

// ─── Frame processor ──────────────────────────────────────────────────────────

/**
 * A single transform step in the FramePipeline.
 *
 * Implementations are stateful (tracking windows, accumulation buffers) but
 * their state is cleared by `reset()`. The pipeline calls `process` on each
 * frame in registration order.
 *
 * Generic: TInput → TOutput lets processors narrow or enrich frames.
 * Most processors pass VideoFrame through and emit a sidecar annotation
 * rather than mutating the pixel data.
 */
export interface FrameProcessor<TInput = VideoFrame, TOutput = VideoFrame> {
  /** Stable identifier — used to reference and remove the processor. */
  readonly id: string;
  /** Human-readable label for diagnostics. */
  readonly label: string;
  /** Pixel formats this processor can accept as input. */
  readonly acceptedFormats: readonly PixelFormat[];
  /**
   * Process a single frame.
   *
   * Must complete within the frame deadline (1000 / fps ms). When a processor
   * consistently overruns, the pipeline adapts by reducing its target frame rate.
   */
  process(frame: TInput): Promise<TOutput>;
  /**
   * Reset all internal state.
   * Called on session restart, seek, or when a new tracking target is selected.
   */
  reset(): void;
}

// ─── Frame buffer ─────────────────────────────────────────────────────────────

/**
 * Fixed-capacity ring buffer for live frames.
 *
 * Oldest frames are silently evicted when the buffer is full. Consumers that
 * fall behind simply lose stale frames — there is intentionally no back-pressure.
 * Processing a stale frame is always worse than skipping it.
 */
export interface FrameBuffer {
  /** Number of frames currently held. */
  readonly length: number;
  /** Maximum capacity; oldest frame evicted on overflow. */
  readonly capacity: number;
  /** Push a new frame. If full, the oldest frame is evicted. */
  push(frame: VideoFrame): void;
  /** Return the N most-recent frames without consuming them (newest last). */
  peek(n: number): readonly VideoFrame[];
  /** Drain all frames in chronological order (oldest first). Clears the buffer. */
  drain(): VideoFrame[];
  /** Discard all frames. */
  clear(): void;
}

// ─── Frame pipeline ───────────────────────────────────────────────────────────

/**
 * Ordered chain of FrameProcessors applied to every incoming frame.
 *
 * The pipeline is the single entry point for all smart-vision analysis.
 * Applications build a pipeline by registering processors via `use()`; the
 * pipeline manages execution order, timing, and error isolation.
 */
export interface FramePipeline {
  /** Append a processor to the end of the chain. */
  use(processor: FrameProcessor): void;
  /** Remove a processor by its id. No-op if not found. */
  remove(processorId: string): void;
  /**
   * Submit a frame for processing through the full chain.
   * Resolves when all processors complete (or the deadline is exceeded).
   */
  run(frame: VideoFrame): Promise<PipelineResult>;
  /** Reset all processors and clear all buffers. */
  reset(): void;
  /** Live statistics for diagnostics and frame-rate adaptation. */
  readonly stats: PipelineStats;
}

export interface PipelineResult {
  frameIndex: FrameIndex;
  /** Wall-clock time for the full pipeline pass (ms). */
  durationMs: number;
  /** Per-processor timing for performance profiling (processor id → ms). */
  processorTimings: Record<string, number>;
  /** Non-fatal warnings from individual processors. */
  warnings: readonly string[];
}

export interface PipelineStats {
  processedFrames: number;
  droppedFrames: number;
  averageLatencyMs: number;
  peakLatencyMs: number;
  currentFps: number;
}

// ─── Frame priority ───────────────────────────────────────────────────────────

/**
 * Priority levels for scheduled analysis frames.
 *
 * The FrameScheduler uses priority to decide which frames to process when
 * the pipeline is running behind its target FPS.
 *
 * "critical"    — must be processed regardless of load (e.g. manual capture trigger)
 * "high"        — detection inference frame; process before normal ticks
 * "normal"      — standard analysis tick
 * "low"         — background quality check; drop first when overloaded
 * "background"  — deferred enhancement or scene-memory GC; drop freely
 */
export type FramePriority = "critical" | "high" | "normal" | "low" | "background";

// ─── Scheduled frame ──────────────────────────────────────────────────────────

/**
 * A VideoFrame wrapped with scheduling metadata.
 * Created by the FrameScheduler and passed to the FramePipeline.
 */
export interface ScheduledFrame {
  frame: VideoFrame;
  priority: FramePriority;
  /**
   * Absolute deadline (epoch ms) by which this frame must begin processing,
   * or it is dropped. The scheduler computes this from the target FPS and
   * the drop policy.
   */
  deadlineMs: number;
  /**
   * Whether this frame was flagged as a mandatory detection frame
   * (i.e. the detectionStrideFrames counter reached zero for this frame).
   */
  isDetectionFrame: boolean;
}

// ─── Frame drop policy ────────────────────────────────────────────────────────

/**
 * Strategy for handling frames when the pipeline is overloaded.
 *
 * "drop_oldest"            — evict the oldest queued frame to make room.
 * "drop_lowest_priority"   — evict the lowest-priority queued frame.
 * "drop_incoming"          — reject the new frame; preserve the queue.
 */
export type FrameDropPolicy =
  | "drop_oldest"
  | "drop_lowest_priority"
  | "drop_incoming";

// ─── Frame scheduler ──────────────────────────────────────────────────────────

/**
 * Regulates the rate at which frames are submitted to the FramePipeline.
 *
 * The scheduler decouples the camera's hardware frame rate (e.g. 60 fps)
 * from the vision analysis rate (e.g. 15 fps). It decides which frames to
 * analyse, assigns priorities, marks detection frames, and applies the drop
 * policy when the pipeline falls behind.
 *
 * `submit` is called by the camera provider on every raw frame. The scheduler
 * either queues the frame for pipeline processing or drops it silently.
 */
export interface FrameScheduler {
  /** Target analysis frames per second (independent of camera fps). */
  readonly targetFps: number;
  /** How many frames are waiting to be picked up by the pipeline. */
  readonly queueDepth: number;
  /** Total frames submitted since the scheduler was created or last reset. */
  readonly submittedFrames: number;
  /** Total frames dropped since creation or last reset. */
  readonly droppedFrames: number;
  /**
   * Submit a raw camera frame for scheduling.
   * The scheduler decides immediately whether to enqueue, drop, or
   * assign priority based on the current queue state.
   */
  submit(frame: VideoFrame): void;
  /**
   * Dequeue the next frame for pipeline processing.
   * Returns null when the queue is empty.
   * The caller (FramePipeline) calls this in its processing loop.
   */
  dequeue(): ScheduledFrame | null;
  /**
   * Update the target analysis FPS at runtime
   * (e.g. in response to a battery-saver mode change).
   */
  setTargetFps(fps: number): void;
  /** Reset all queues, counters, and stride state. */
  reset(): void;
}
