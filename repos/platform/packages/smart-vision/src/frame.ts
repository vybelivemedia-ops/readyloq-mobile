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
