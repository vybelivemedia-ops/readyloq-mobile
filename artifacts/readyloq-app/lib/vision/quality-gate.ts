/**
 * On-device evidence quality gate.
 *
 * Exposes two complementary APIs:
 *
 *   assessEvidence()               — post-capture: scores an already-saved EvidenceItem
 *                                    (metadata heuristics + optional pixel bitmap).
 *                                    Returns QualityAssessment. Used throughout the
 *                                    persist → sync → analyze pipeline.
 *
 *   createInspectionQualityScorer() — pre-capture: implements @platform/smart-vision's
 *                                    QualityScorer contract for live VideoFrame quality
 *                                    gating in the camera preview hot-path. Returns
 *                                    FrameQualityReport with structured dimensions and
 *                                    advisories.
 *
 * ADVISORY RULE: Quality scores NEVER discard evidence. A blurry photo of a real
 * finding is always better than no photo. Scores drive technician warnings and
 * auto-capture suppression only.
 */

import type {
  FrameQualityReport,
  QualityAdvisory,
  QualityDimension,
  QualityScorer,
  QualityScorerConfig,
  VideoFrame,
} from "@platform/smart-vision";

import type { GrayscaleImage } from "./pixels";
import type { EvidenceItem, QualityAssessment } from "./types";

// ─── Shared thresholds ────────────────────────────────────────────────────────

/** Below this on the short edge, AI detection recall drops off sharply. */
const MIN_SHORT_EDGE_PX = 480;
/** Comfortable resolution — no penalty at or above this. */
const GOOD_SHORT_EDGE_PX = 960;
/**
 * JPEG bytes-per-pixel below this usually means the frame is near-uniform
 * (lens covered, pitch dark) or brutally over-compressed.
 */
const MIN_BYTES_PER_PIXEL = 0.02;

const SHARP_VARIANCE = 140; // at/above → crisp, no penalty
const BLUR_VARIANCE = 12;   // at/below → clearly soft/featureless
const MAX_SHARP_PENALTY = 30;

// ─── Shared pixel analysis ────────────────────────────────────────────────────

/**
 * Laplacian-variance sharpness estimate (pixel-level).
 *
 * The 4-neighbour second derivative responds to edges; its variance collapses
 * toward zero as a photo goes out of focus or smears with motion blur.
 * Returns null if the image is too small to analyse (<3×3).
 */
function laplacianVariance(img: GrayscaleImage): number | null {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return null;
  const n = (w - 2) * (h - 2);
  const lap = new Float64Array(n);
  let mean = 0;
  let k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = data[y * w + x];
      const v =
        data[(y - 1) * w + x] +
        data[(y + 1) * w + x] +
        data[y * w + x - 1] +
        data[y * w + x + 1] -
        4 * c;
      lap[k++] = v;
      mean += v;
    }
  }
  mean /= n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = lap[i] - mean;
    s += d * d;
  }
  return s / n;
}

// ─── Legacy EvidenceItem gate (assessEvidence) ────────────────────────────────

type Analyzer = (item: EvidenceItem) => { penalty: number; reason?: string };

const resolutionAnalyzer: Analyzer = (item) => {
  if (!item.width || !item.height) return { penalty: 0 };
  const shortEdge = Math.min(item.width, item.height);
  if (shortEdge >= GOOD_SHORT_EDGE_PX) return { penalty: 0 };
  if (shortEdge < MIN_SHORT_EDGE_PX) {
    return {
      penalty: 45,
      reason: `Very low resolution (${item.width}×${item.height}) — details may be unreadable`,
    };
  }
  const t = (GOOD_SHORT_EDGE_PX - shortEdge) / (GOOD_SHORT_EDGE_PX - MIN_SHORT_EDGE_PX);
  return { penalty: Math.round(20 * t) };
};

const detailAnalyzer: Analyzer = (item) => {
  if (!item.width || !item.height || !item.fileSize) return { penalty: 0 };
  const bpp = item.fileSize / (item.width * item.height);
  if (bpp < MIN_BYTES_PER_PIXEL) {
    return {
      penalty: 50,
      reason: "Image has almost no detail — check lighting and that the lens is clear",
    };
  }
  return { penalty: 0 };
};

function sharpnessAnalyzerLegacy(img: GrayscaleImage): { penalty: number; reason?: string } {
  const v = laplacianVariance(img);
  if (v == null || v >= SHARP_VARIANCE) return { penalty: 0 };
  if (v <= BLUR_VARIANCE) {
    return {
      penalty: MAX_SHARP_PENALTY,
      reason: "Photo looks out of focus or blurry — retake for reliable AI analysis",
    };
  }
  const t = (SHARP_VARIANCE - v) / (SHARP_VARIANCE - BLUR_VARIANCE);
  return { penalty: Math.round(MAX_SHARP_PENALTY * t) };
}

const ANALYZERS: Analyzer[] = [resolutionAnalyzer, detailAnalyzer];

/**
 * Score evidence 0–100. Pass a decoded `pixels` bitmap to include the
 * pixel-level sharpness check; omit it for the instant, metadata-only gate.
 */
export function assessEvidence(
  item: EvidenceItem,
  pixels?: GrayscaleImage | null,
): QualityAssessment {
  let score = 100;
  const reasons: string[] = [];
  for (const analyzer of ANALYZERS) {
    const { penalty, reason } = analyzer(item);
    score -= penalty;
    if (reason) reasons.push(reason);
  }
  if (pixels) {
    const { penalty, reason } = sharpnessAnalyzerLegacy(pixels);
    score -= penalty;
    if (reason) reasons.push(reason);
  }
  score = Math.max(0, Math.min(100, score));
  return { score, acceptable: score >= 50, reasons };
}

// ─── QualityScorer (implements @platform/smart-vision QualityScorer) ──────────

const DEFAULT_SCORER_CONFIG: QualityScorerConfig = {
  acceptanceThreshold: 50,
  thresholds: {
    resolution: MIN_SHORT_EDGE_PX,
    sharpness: BLUR_VARIANCE,
  },
  enablePixelAnalysis: true,
};

/**
 * Extract a GrayscaleImage from a VideoFrame for pixel-level Laplacian analysis.
 * Returns null for unsupported pixel formats (e.g. compressed or unknown).
 */
function extractGrayscale(frame: VideoFrame): GrayscaleImage | null {
  const { width, height } = frame.meta.dimensions;
  const src = frame.data;
  switch (frame.pixelFormat) {
    case "gray8":
      return { width, height, data: src instanceof Uint8Array ? src : new Uint8Array(src) };
    case "rgb8": {
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        // BT.601 integer luminance: (R×77 + G×150 + B×29) >> 8
        gray[i] = ((src[i * 3] * 77 + src[i * 3 + 1] * 150 + src[i * 3 + 2] * 29) >>> 8);
      }
      return { width, height, data: gray };
    }
    case "rgba8": {
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        gray[i] = ((src[i * 4] * 77 + src[i * 4 + 1] * 150 + src[i * 4 + 2] * 29) >>> 8);
      }
      return { width, height, data: gray };
    }
    case "yuv420p":
    case "nv12":
      // Y plane is always the first width×height bytes in both planar formats.
      return { width, height, data: new Uint8Array(src.buffer, src.byteOffset, width * height) };
    default:
      return null;
  }
}

function buildResolutionDimension(
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
      advisory: {
        dimension: "resolution",
        severity: "critical",
        message: `Very low resolution (${width}×${height}) — details may be unreadable`,
      },
    };
  }
  const t = (GOOD_SHORT_EDGE_PX - shortEdge) / (GOOD_SHORT_EDGE_PX - minEdge);
  const penalty = Math.round(20 * t);
  return {
    dim: { kind: "resolution", value: shortEdge, score: Math.max(0, 100 - penalty), penalty },
    advisory:
      penalty > 0
        ? {
            dimension: "resolution",
            severity: "warning",
            message: `Resolution may limit AI recall (short edge: ${shortEdge}px)`,
          }
        : undefined,
  };
}

function buildSharpnessDimension(
  img: GrayscaleImage,
): { dim: QualityDimension; advisory?: QualityAdvisory } | null {
  const v = laplacianVariance(img);
  if (v == null) return null;
  if (v >= SHARP_VARIANCE) {
    return { dim: { kind: "sharpness", value: v, score: 100, penalty: 0 } };
  }
  if (v <= BLUR_VARIANCE) {
    return {
      dim: { kind: "sharpness", value: v, score: Math.max(0, 100 - MAX_SHARP_PENALTY), penalty: MAX_SHARP_PENALTY },
      advisory: {
        dimension: "sharpness",
        severity: "warning",
        message: "Photo looks out of focus or blurry — retake for reliable AI analysis",
      },
    };
  }
  const t = (SHARP_VARIANCE - v) / (SHARP_VARIANCE - BLUR_VARIANCE);
  const penalty = Math.round(MAX_SHARP_PENALTY * t);
  return {
    dim: { kind: "sharpness", value: v, score: Math.max(0, 100 - penalty), penalty },
    advisory:
      penalty >= MAX_SHARP_PENALTY / 2
        ? { dimension: "sharpness", severity: "warning", message: "Image may be slightly out of focus" }
        : undefined,
  };
}

function assembleReport(
  dimensions: QualityDimension[],
  advisories: QualityAdvisory[],
  threshold: number,
): FrameQualityReport {
  const overall = Math.max(
    0,
    Math.min(100, 100 - dimensions.reduce((sum, d) => sum + d.penalty, 0)),
  );
  // Sort advisories most-severe first (critical > warning > info)
  const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;
  const sorted = [...advisories].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return { overall, acceptable: overall >= threshold, dimensions, advisories: sorted };
}

/**
 * Create an InspectionQualityScorer that implements @platform/smart-vision's
 * QualityScorer contract for ReadyLoq's inspection capture workflow.
 *
 * Use for live-preview quality gating (VideoFrame → FrameQualityReport).
 * Use assessEvidence() for post-capture EvidenceItem scoring.
 *
 * @param config - Partial overrides; omitted fields fall back to ReadyLoq
 *   inspection defaults (acceptanceThreshold=50, minEdge=480px, sharpness=12).
 */
export function createInspectionQualityScorer(
  config: Partial<QualityScorerConfig> = {},
): QualityScorer {
  const cfg: QualityScorerConfig = {
    acceptanceThreshold:
      config.acceptanceThreshold ?? DEFAULT_SCORER_CONFIG.acceptanceThreshold,
    thresholds: { ...DEFAULT_SCORER_CONFIG.thresholds, ...config.thresholds },
    enablePixelAnalysis:
      config.enablePixelAnalysis ?? DEFAULT_SCORER_CONFIG.enablePixelAnalysis,
  };
  const minEdge = cfg.thresholds.resolution ?? MIN_SHORT_EDGE_PX;

  return {
    config: cfg,

    scoreMetadata(frame: Pick<VideoFrame, "meta">): FrameQualityReport {
      const { width, height } = frame.meta.dimensions;
      const { dim, advisory } = buildResolutionDimension(width, height, minEdge);
      return assembleReport([dim], advisory ? [advisory] : [], cfg.acceptanceThreshold);
    },

    async score(frame: VideoFrame): Promise<FrameQualityReport> {
      const { width, height } = frame.meta.dimensions;
      const dims: QualityDimension[] = [];
      const advisories: QualityAdvisory[] = [];

      const { dim: resDim, advisory: resAdvisory } = buildResolutionDimension(
        width,
        height,
        minEdge,
      );
      dims.push(resDim);
      if (resAdvisory) advisories.push(resAdvisory);

      if (cfg.enablePixelAnalysis) {
        const gray = extractGrayscale(frame);
        if (gray) {
          const result = buildSharpnessDimension(gray);
          if (result) {
            dims.push(result.dim);
            if (result.advisory) advisories.push(result.advisory);
          }
        }
      }

      return assembleReport(dims, advisories, cfg.acceptanceThreshold);
    },
  };
}
