/**
 * @platform/smart-vision — concrete QualityScorer implementation.
 *
 * Scores live VideoFrames across resolution, sharpness, and exposure
 * dimensions. All thresholds are injectable via QualityScorerConfig.
 *
 * Dimensions implemented:
 *   resolution  — short-edge pixel count vs. configured minimum
 *   sharpness   — Laplacian variance on the Y-plane (pixel quality path)
 *   exposure    — mean luminance histogram (pixel quality path)
 */

import type {
  FrameQualityReport,
  QualityAdvisory,
  QualityDimension,
  QualityScorer,
  QualityScorerConfig,
} from "../quality";
import type { VideoFrame } from "../frame";

// ─── Built-in defaults ────────────────────────────────────────────────────────

const MIN_SHORT_EDGE_PX = 480;
const GOOD_SHORT_EDGE_PX = 960;
const SHARP_VARIANCE = 140;
const BLUR_VARIANCE = 12;
const MAX_SHARP_PENALTY = 35;
// Exposure: mean Y below LOW = dark; above HIGH = blown out
const EXPOSURE_LOW = 40;
const EXPOSURE_HIGH = 215;
const EXPOSURE_DARK_PENALTY = 40;
const EXPOSURE_BLOWN_PENALTY = 20;

// ─── Y-plane extraction ───────────────────────────────────────────────────────

function extractY(frame: VideoFrame): Uint8Array | null {
  const { width, height } = frame.meta.dimensions;
  const src = frame.data;
  switch (frame.pixelFormat) {
    case "gray8":
      return src instanceof Uint8Array ? src : new Uint8Array(src);
    case "yuv420p":
    case "nv12":
      return new Uint8Array(src.buffer, src.byteOffset, width * height);
    case "rgb8": {
      const y = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        y[i] = ((src[i * 3]! * 77 + src[i * 3 + 1]! * 150 + src[i * 3 + 2]! * 29) >>> 8);
      }
      return y;
    }
    case "rgba8": {
      const y = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        y[i] = ((src[i * 4]! * 77 + src[i * 4 + 1]! * 150 + src[i * 4 + 2]! * 29) >>> 8);
      }
      return y;
    }
    default:
      return null;
  }
}

// ─── Laplacian variance ───────────────────────────────────────────────────────

function laplacianVariance(y: Uint8Array, width: number, height: number): number | null {
  if (width < 3 || height < 3) return null;
  const n = (width - 2) * (height - 2);
  let sum = 0;
  let sumSq = 0;
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const c = y[row * width + col]!;
      const v = (
        y[(row - 1) * width + col]! +
        y[(row + 1) * width + col]! +
        y[row * width + col - 1]! +
        y[row * width + col + 1]! -
        4 * c
      );
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// ─── Exposure mean ────────────────────────────────────────────────────────────

function meanLuminance(y: Uint8Array, step: number = 4): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < y.length; i += step) {
    sum += y[i]!;
    count++;
  }
  return count > 0 ? sum / count : 128;
}

// ─── Dimension builders ───────────────────────────────────────────────────────

function scoreResolution(
  width: number,
  height: number,
  minEdge: number,
): { dim: QualityDimension; advisory?: QualityAdvisory } {
  const shortEdge = Math.min(width, height);
  if (shortEdge >= GOOD_SHORT_EDGE_PX) {
    return { dim: { kind: "resolution", value: shortEdge, score: 100, penalty: 0 } };
  }
  if (shortEdge < minEdge) {
    const penalty = 45;
    return {
      dim: { kind: "resolution", value: shortEdge, score: Math.max(0, 100 - penalty), penalty },
      advisory: { dimension: "resolution", severity: "critical", message: `Very low resolution (${width}×${height})` },
    };
  }
  const t = (GOOD_SHORT_EDGE_PX - shortEdge) / (GOOD_SHORT_EDGE_PX - minEdge);
  const penalty = Math.round(20 * t);
  return {
    dim: { kind: "resolution", value: shortEdge, score: Math.max(0, 100 - penalty), penalty },
    ...(penalty > 0 ? { advisory: { dimension: "resolution" as const, severity: "warning" as const, message: `Resolution may limit detail (short edge: ${shortEdge}px)` } } : {}),
  };
}

function scoreSharpness(
  y: Uint8Array,
  width: number,
  height: number,
  blurThreshold: number,
): { dim: QualityDimension; advisory?: QualityAdvisory } | null {
  const v = laplacianVariance(y, width, height);
  if (v == null) return null;
  if (v >= SHARP_VARIANCE) {
    return { dim: { kind: "sharpness", value: v, score: 100, penalty: 0 } };
  }
  if (v <= blurThreshold) {
    return {
      dim: { kind: "sharpness", value: v, score: Math.max(0, 100 - MAX_SHARP_PENALTY), penalty: MAX_SHARP_PENALTY },
      advisory: { dimension: "sharpness", severity: "warning", message: "Image appears out of focus or blurry" },
    };
  }
  const t = (SHARP_VARIANCE - v) / (SHARP_VARIANCE - blurThreshold);
  const penalty = Math.round(MAX_SHARP_PENALTY * t);
  return {
    dim: { kind: "sharpness", value: v, score: Math.max(0, 100 - penalty), penalty },
    ...(penalty >= MAX_SHARP_PENALTY / 2 ? { advisory: { dimension: "sharpness" as const, severity: "warning" as const, message: "Image may be slightly out of focus" } } : {}),
  };
}

function scoreExposure(
  y: Uint8Array,
): { dim: QualityDimension; advisory?: QualityAdvisory } {
  const mean = meanLuminance(y);
  if (mean < EXPOSURE_LOW) {
    return {
      dim: { kind: "exposure", value: mean, score: Math.max(0, 100 - EXPOSURE_DARK_PENALTY), penalty: EXPOSURE_DARK_PENALTY },
      advisory: { dimension: "exposure", severity: "warning", message: "Scene appears too dark — increase lighting" },
    };
  }
  if (mean > EXPOSURE_HIGH) {
    return {
      dim: { kind: "exposure", value: mean, score: Math.max(0, 100 - EXPOSURE_BLOWN_PENALTY), penalty: EXPOSURE_BLOWN_PENALTY },
      advisory: { dimension: "exposure", severity: "warning", message: "Scene may be overexposed — reduce glare" },
    };
  }
  return { dim: { kind: "exposure", value: mean, score: 100, penalty: 0 } };
}

// ─── Report assembly ─────────────────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

function assemble(
  dims: QualityDimension[],
  advisories: QualityAdvisory[],
  threshold: number,
): FrameQualityReport {
  const overall = Math.max(0, Math.min(100, 100 - dims.reduce((s, d) => s + d.penalty, 0)));
  const sorted = [...advisories].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return { overall, acceptable: overall >= threshold, dimensions: dims, advisories: sorted };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: QualityScorerConfig = {
  acceptanceThreshold: 50,
  thresholds: {
    resolution: MIN_SHORT_EDGE_PX,
    sharpness: BLUR_VARIANCE,
  },
  enablePixelAnalysis: true,
};

/**
 * Create the platform-level QualityScorer.
 *
 * This is the canonical implementation. Applications may substitute their own
 * scorer via SmartVisionDependencies.qualityScorer.
 */
export function createQualityScorer(
  config: Partial<QualityScorerConfig> = {},
): QualityScorer {
  const cfg: QualityScorerConfig = {
    acceptanceThreshold: config.acceptanceThreshold ?? DEFAULT_CONFIG.acceptanceThreshold,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...config.thresholds },
    enablePixelAnalysis: config.enablePixelAnalysis ?? DEFAULT_CONFIG.enablePixelAnalysis,
  };
  const minEdge = cfg.thresholds.resolution ?? MIN_SHORT_EDGE_PX;
  const blurThreshold = cfg.thresholds.sharpness ?? BLUR_VARIANCE;

  return {
    config: cfg,

    scoreMetadata(frame: Pick<VideoFrame, "meta">): FrameQualityReport {
      const { width, height } = frame.meta.dimensions;
      const { dim, advisory } = scoreResolution(width, height, minEdge);
      return assemble([dim], advisory ? [advisory] : [], cfg.acceptanceThreshold);
    },

    async score(frame: VideoFrame): Promise<FrameQualityReport> {
      const { width, height } = frame.meta.dimensions;
      const dims: QualityDimension[] = [];
      const advisories: QualityAdvisory[] = [];

      // Resolution (always)
      const res = scoreResolution(width, height, minEdge);
      dims.push(res.dim);
      if (res.advisory) advisories.push(res.advisory);

      // Pixel-level analysis
      if (cfg.enablePixelAnalysis) {
        const y = extractY(frame);
        if (y) {
          // Sharpness
          const sharp = scoreSharpness(y, width, height, blurThreshold);
          if (sharp) {
            dims.push(sharp.dim);
            if (sharp.advisory) advisories.push(sharp.advisory);
          }
          // Exposure
          const exp = scoreExposure(y);
          dims.push(exp.dim);
          if (exp.advisory) advisories.push(exp.advisory);
        }
      }

      return assemble(dims, advisories, cfg.acceptanceThreshold);
    },
  };
}
