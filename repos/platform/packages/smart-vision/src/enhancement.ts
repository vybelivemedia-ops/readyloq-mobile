/**
 * @platform/smart-vision — image enhancement provider contracts.
 *
 * Defines interfaces for on-device or server-assisted image enhancement.
 * Implementations are injected by the application; this package owns only
 * the contracts. Enhancement passes operate on raw frames and are
 * composable via EnhancementPipeline.
 *
 * Supported passes: denoising · sharpening · HDR tone-mapping · contrast.
 *
 * No domain logic — enhancement is a pure signal-processing concern.
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { VideoFrame } from "./frame";

// ─── Shared presets ───────────────────────────────────────────────────────────

/**
 * Generic strength preset used across enhancement passes.
 * Implementors map these to numeric parameters appropriate for their algorithm.
 */
export type EnhancementStrength = "light" | "moderate" | "strong";

// ─── Denoising ────────────────────────────────────────────────────────────────

export interface DenoiseConfig {
  strength: EnhancementStrength;
  /**
   * When true (default), apply denoising only to the luminance channel,
   * preserving colour accuracy while reducing luma noise.
   */
  luminanceOnly?: boolean;
  /**
   * Preserve edge detail — avoid smoothing across high-gradient areas.
   * Default: true.
   */
  preserveEdges?: boolean;
}

export interface DenoiseProvider {
  readonly id: string;
  denoise(frame: VideoFrame, config: DenoiseConfig): Promise<VideoFrame>;
}

// ─── Sharpening ───────────────────────────────────────────────────────────────

export interface SharpenConfig {
  strength: EnhancementStrength;
  /**
   * Sharpening radius in pixels (unsharp-mask σ or equivalent). Default: 1.0.
   * Larger values create a broader, more visible halo; smaller = subtle.
   */
  radius?: number;
  /**
   * When true (default), mask out flat regions (sky, walls, uniform surfaces)
   * so only textured areas receive sharpening, reducing artefacts.
   */
  maskFlat?: boolean;
}

export interface SharpenProvider {
  readonly id: string;
  sharpen(frame: VideoFrame, config: SharpenConfig): Promise<VideoFrame>;
}

// ─── HDR tone-mapping ─────────────────────────────────────────────────────────

export interface HDRConfig {
  /**
   * Number of exposure brackets to merge.
   * 1 = single-frame simulated HDR (local tone-mapping only).
   * > 1 = true multi-exposure merge; use `merge()` in that case.
   */
  exposureCount: number;
  /**
   * Tone-mapping operator.
   * "local"  — spatially-varying (detail-preserving, more natural-looking).
   * "global" — uniform curve (faster; good for scenes with modest range).
   * Default: "local".
   */
  operator?: "local" | "global";
  /**
   * Saturation boost applied after tone-mapping (1.0 = no change). Default: 1.0.
   * Values above 1.0 increase colour vibrancy; below 1.0 desaturate.
   */
  saturation?: number;
}

export interface HDRProvider {
  readonly id: string;
  /** Apply local or global tone-mapping to a single frame. */
  tonemap(frame: VideoFrame, config: HDRConfig): Promise<VideoFrame>;
  /**
   * Merge multiple bracketed exposures into a single HDR result.
   * `frames` must be ordered from darkest (under-exposed) to brightest (over-exposed).
   */
  merge(frames: readonly VideoFrame[], config: HDRConfig): Promise<VideoFrame>;
}

// ─── Contrast enhancement ────────────────────────────────────────────────────

export interface ContrastConfig {
  strength: EnhancementStrength;
  /**
   * CLAHE clip limit — controls how aggressively local histogram bins are
   * redistributed. Higher = stronger contrast but more noise amplification.
   * Default: 2.0.
   */
  clipLimit?: number;
  /**
   * Grid tile size for CLAHE (tiles × tiles). Larger = less local adaptation.
   * Default: 8.
   */
  tileSize?: number;
}

export interface ContrastProvider {
  readonly id: string;
  enhance(frame: VideoFrame, config: ContrastConfig): Promise<VideoFrame>;
}

// ─── Enhancement pipeline ─────────────────────────────────────────────────────

/**
 * Configuration for one enhancement pipeline pass.
 * Set any provider to null to disable that step.
 * Order of passes: denoise → contrast → sharpen → hdr (HDR usually last).
 */
export interface EnhancementConfig {
  denoise?: { provider: DenoiseProvider; config: DenoiseConfig } | null;
  contrast?: { provider: ContrastProvider; config: ContrastConfig } | null;
  sharpen?: { provider: SharpenProvider; config: SharpenConfig } | null;
  hdr?: { provider: HDRProvider; config: HDRConfig } | null;
}

/**
 * Applies the configured enhancement passes in sequence.
 * Applications inject the providers; the pipeline orchestrates the calls.
 *
 * The pipeline is stateful (HDR accumulation, bilateral filter warm-up).
 * Call `reset()` when the scene changes or the session restarts.
 */
export interface EnhancementPipeline {
  readonly config: EnhancementConfig;
  /**
   * Run all configured enhancement passes in order.
   * Returns the enhanced frame; the input frame is not mutated.
   */
  process(frame: VideoFrame): Promise<VideoFrame>;
  /**
   * Reset any accumulated state (HDR bracket buffers, temporal filters).
   * Call when the capture subject changes, session restarts, or camera moves.
   */
  reset(): void;
}
