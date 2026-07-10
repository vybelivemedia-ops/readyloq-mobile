/**
 * On-device evidence quality gate.
 *
 * Runs after every capture/import and scores the evidence 0–100. The gate is
 * ADVISORY: poor evidence is kept (a blurry photo of a real infestation beats
 * no photo) but the technician gets an immediate warning so they can retake
 * while still on site.
 *
 * Two tiers feed one score:
 *  - metadata heuristics (dimensions + file size) run instantly at capture;
 *  - an optional pixel-level sharpness check (Laplacian variance) folds in
 *    when a decoded bitmap is supplied (see `lib/vision/pixels.ts`). The
 *    pixel decode is deferred off the capture path, so `assessEvidence` works
 *    with or without it.
 */

import type { GrayscaleImage } from "./pixels";
import type { EvidenceItem, QualityAssessment } from "./types";

/** Below this on the short edge, AI detection recall drops off sharply. */
const MIN_SHORT_EDGE_PX = 480;
/** Comfortable resolution — no penalty at or above this. */
const GOOD_SHORT_EDGE_PX = 960;
/**
 * JPEG bytes-per-pixel below this usually means the frame is near-uniform
 * (lens covered, pitch dark) or brutally over-compressed — either way there
 * is little detail for the AI to work with.
 */
const MIN_BYTES_PER_PIXEL = 0.02;

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
  // Linear penalty between the two thresholds, capped at 20.
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

/** Ordered metadata analyzers (instant — no pixel decode required). */
const ANALYZERS: Analyzer[] = [resolutionAnalyzer, detailAnalyzer];

/**
 * Laplacian-variance sharpness gate (pixel-level).
 *
 * The Laplacian (a 4-neighbour second derivative) responds to edges; the
 * variance of the Laplacian across the frame collapses toward zero as a photo
 * goes out of focus or smears with motion blur. Thresholds are tuned against a
 * 512px working bitmap (0–255 luminance) and kept conservative so a merely
 * low-texture-but-in-focus frame is not flagged. Advisory only.
 */
const SHARP_VARIANCE = 140; // at/above → crisp, no penalty
const BLUR_VARIANCE = 12; // at/below → clearly soft/featureless
const MAX_SHARP_PENALTY = 30;

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

function sharpnessAnalyzer(img: GrayscaleImage): { penalty: number; reason?: string } {
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
    const { penalty, reason } = sharpnessAnalyzer(pixels);
    score -= penalty;
    if (reason) reasons.push(reason);
  }
  score = Math.max(0, Math.min(100, score));
  return { score, acceptable: score >= 50, reasons };
}
