/**
 * @platform/smart-vision/privacy — renderer contracts.
 *
 * The PrivacyRenderer is an optional output stage that takes a frame and
 * a set of masks and produces a visually redacted copy.
 *
 * ORIGINAL MEDIA PRESERVATION:
 *   Original frame → never mutated.
 *   PrivacyMask[]  → instructions derived from the policy.
 *   PrivacyRenderOutput → confirmation that redaction was applied.
 *
 * Applications choose which "layer" to display, upload, or store.
 * The engine passes masks to the renderer; the renderer decides how pixels
 * are modified. Platform contracts stay pixel-format agnostic.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { VideoFrame, FrameIndex, FrameTimestamp } from "../frame";
import type { PrivacyMask } from "./types";
import type { RedactionType } from "./policy";

// ─── Render input ─────────────────────────────────────────────────────────────

/**
 * Input to the PrivacyRenderer for one frame.
 */
export interface PrivacyRenderInput {
  /**
   * The original, unmodified frame.
   * Implementations must NOT mutate this frame.
   */
  readonly frame: VideoFrame;
  /**
   * Redaction instructions for this frame, ordered by descending priority.
   * Empty array = no redactions; renderer should return the original dimensions.
   */
  readonly masks: readonly PrivacyMask[];
  /**
   * Optional override for the solid_mask colour (CSS hex or rgba).
   * Defaults to "#000000" (black) when not provided.
   */
  readonly solidMaskColor?: string;
  /**
   * Optional override for the transparent_mask opacity 0–1.
   * Defaults to 0.6 when not provided.
   */
  readonly transparentMaskOpacity?: number;
}

// ─── Render output ────────────────────────────────────────────────────────────

/**
 * Confirmation that redaction was applied.
 *
 * Renderers do NOT return a VideoFrame directly — the rendered output is
 * owned by the renderer implementation and may live in GPU memory, a canvas,
 * a React Native Skia surface, or an ML tensor, depending on platform.
 *
 * The engine records which masks were applied for events and history.
 */
export interface PrivacyRenderOutput {
  readonly frameIndex: FrameIndex;
  readonly timestamp: FrameTimestamp;
  /** Masks that were successfully applied to the output. */
  readonly appliedMasks: readonly PrivacyMask[];
  /** Number of masks requested but not applied (unsupported type, out of bounds, etc.). */
  readonly skippedMasks: number;
  /** Renderer wall-clock time in ms. */
  readonly renderMs: number;
  /**
   * Opaque renderer-specific handle that the application uses to obtain the
   * redacted output (canvas element, texture ID, URI, buffer reference, etc.).
   * Null when no handle is applicable (e.g. in-place GPU render).
   */
  readonly outputHandle: unknown;
}

// ─── PrivacyRenderer ─────────────────────────────────────────────────────────

/**
 * Applies visual redactions to video frames.
 *
 * Implementations are platform-specific — WebGL shader, React Native Skia,
 * Metal/HLSL, CPU pixel ops, AVFoundation filter, etc.
 *
 * The Privacy Engine never knows how pixels are modified.
 * It calls render() and records the output metadata.
 *
 * Built-in provider examples (in application layer):
 *   CanvasBlurRenderer     — blur via Canvas 2D API
 *   SkiaRenderer           — React Native Skia (mobile)
 *   WebGLRedactionRenderer — GPU shader for live video
 *   NullRenderer           — no-op for testing (returns empty output)
 */
export interface PrivacyRenderer {
  /** Unique identifier for this renderer. Used in events. */
  readonly rendererId: string;
  /** Human-readable name for debugging. */
  readonly name: string;
  /** Redaction types this renderer can handle. */
  readonly supportedTypes: readonly RedactionType[];
  /**
   * Apply the masks to the frame and return the render output.
   * Called once per frame when masks are non-empty (or always, per configuration).
   * Must not mutate `input.frame`.
   */
  render(input: PrivacyRenderInput): Promise<PrivacyRenderOutput>;
  /**
   * Release GPU/memory resources if any.
   * Called when the session stops or the renderer is swapped.
   */
  destroy(): Promise<void>;
  /**
   * Reset per-session state (e.g. temporal blur accumulators).
   * Called on session start.
   */
  reset(): void;
}
