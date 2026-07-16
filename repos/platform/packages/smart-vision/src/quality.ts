/**
 * @platform/smart-vision — domain-agnostic frame quality scoring contracts.
 *
 * Promotes the ReadyLoq quality-gate pattern to the platform layer.
 * Dimension names, thresholds, and advisory text are all caller-configured;
 * no pest or creator terminology appears here.
 *
 * CANONICAL SOURCE:
 *   artifacts/readyloq-app/lib/vision/quality-gate.ts
 *   (The concrete implementation stays in the application layer. This package
 *   owns the contract only. Phase 3 will migrate the implementation here with
 *   injectable threshold configuration.)
 *
 * ADVISORY RULE:
 *   Quality scores are NEVER used to discard evidence. A blurry frame
 *   containing real information is always better than no frame. Scores
 *   drive user warnings and auto-capture suppression only.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { VideoFrame } from "./frame";

// ─── Quality dimensions ───────────────────────────────────────────────────────

/**
 * Named quality dimensions provided by the platform.
 *
 * Applications may extend this with custom dimension names:
 *   type MyDimension = PlatformQualityDimension | "glare" | "fogging";
 */
export type PlatformQualityDimension =
  | "sharpness"    // Laplacian variance: measures in-focus edge detail
  | "exposure"     // Brightness distribution: over/under-exposed check
  | "resolution"   // Pixel dimensions vs. minimum threshold
  | "motion_blur"  // Inter-frame or intra-frame motion smear
  | "noise"        // High-ISO / sensor noise estimate
  | "framing"      // Subject coverage and distance-to-edge
  | "detail";      // Bytes-per-pixel information density proxy

/**
 * A measurement along a single quality dimension.
 *
 * TDim is generic so callers can parameterise with their own extended
 * dimension type without losing exhaustive switch coverage.
 */
export interface QualityDimension<TDim extends string = PlatformQualityDimension> {
  kind: TDim;
  /** Raw measurement value (units depend on the dimension). */
  value: number;
  /** Normalised score for this dimension: 0–100. */
  score: number;
  /** Points deducted from the overall score by this dimension. */
  penalty: number;
}

// ─── Quality advisory ─────────────────────────────────────────────────────────

export interface QualityAdvisory {
  /** Which quality dimension triggered this advisory. */
  dimension: PlatformQualityDimension;
  severity: "info" | "warning" | "critical";
  /**
   * Human-readable message intended for display to the device operator.
   * Must be neutral and informational — no domain-specific terminology.
   */
  message: string;
}

// ─── Frame quality report ─────────────────────────────────────────────────────

/**
 * Full quality report for a single video frame.
 *
 * `overall` is derived from the `dimensions` penalties — callers must not
 * recompute it; trust the scorer's output.
 *
 * Usage: use `advisories` for user-facing warnings, `overall` for
 * auto-capture gating, and `dimensions` for per-metric dashboards.
 */
export interface FrameQualityReport {
  /**
   * Composite quality score: 0–100. Higher = better.
   * Derived as: 100 − Σ(dimension penalties), clamped to [0, 100].
   */
  overall: number;
  /** True when `overall` is at or above the configured acceptance threshold. */
  acceptable: boolean;
  dimensions: readonly QualityDimension[];
  /** Ordered advisories, most severe first. */
  advisories: readonly QualityAdvisory[];
}

// ─── Threshold configuration ──────────────────────────────────────────────────

/**
 * Injectable minimum acceptable values per dimension.
 *
 * Dimensions absent from this map use the scorer's built-in defaults.
 * All values are in the scorer's native dimension units (not normalised scores).
 */
export type QualityThresholds = Partial<Record<PlatformQualityDimension, number>>;

/** Top-level scorer configuration. */
export interface QualityScorerConfig {
  /**
   * Minimum overall score for `acceptable = true`.
   * Default: 50. Applications should calibrate for their capture context.
   */
  acceptanceThreshold: number;
  /** Per-dimension threshold overrides. */
  thresholds: QualityThresholds;
  /**
   * Whether to run pixel-level analysis (sharpness via Laplacian variance,
   * noise estimation). Pixel decoding is expensive; disable for high-FPS paths
   * where only metadata-based scoring is needed.
   */
  enablePixelAnalysis: boolean;
}

// ─── Quality scorer interface ─────────────────────────────────────────────────

/**
 * Scores a video frame across multiple quality dimensions and returns a
 * consolidated FrameQualityReport.
 *
 * Two scoring modes:
 *   score()         — full analysis; may decode pixels; async.
 *   scoreMetadata() — metadata-only (dimensions, file size); always sync.
 *
 * Applications use `score()` on a background thread and `scoreMetadata()`
 * inline on the capture hot-path.
 */
export interface QualityScorer {
  readonly config: QualityScorerConfig;
  /**
   * Full quality score, optionally including pixel-level analysis.
   * Returns a resolved Promise immediately when `enablePixelAnalysis = false`.
   */
  score(frame: VideoFrame): Promise<FrameQualityReport>;
  /**
   * Fast metadata-only score — no pixel decode required.
   * Always synchronous. Suitable for use in the capture hot-path.
   */
  scoreMetadata(frame: Pick<VideoFrame, "meta">): FrameQualityReport;
}
