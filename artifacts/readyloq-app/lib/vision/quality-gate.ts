/**
 * On-device evidence quality gate (Tier 1: metadata heuristics).
 *
 * Runs after every capture/import and scores the evidence 0–100. The gate is
 * ADVISORY: poor evidence is kept (a blurry photo of a real infestation beats
 * no photo) but the technician gets an immediate warning so they can retake
 * while still on site.
 *
 * Tier 1 deliberately uses only metadata the providers already have
 * (dimensions + file size). True pixel-level checks (blur/Laplacian,
 * luminance histogram) require a JPEG decode path that is not economical in
 * pure JS at full resolution; the `analyzers` seam below is where a
 * pixel-based analyzer plugs in once a native image pipeline is approved.
 */

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

/** Ordered analyzers; future pixel-level checks append here. */
const ANALYZERS: Analyzer[] = [resolutionAnalyzer, detailAnalyzer];

export function assessEvidence(item: EvidenceItem): QualityAssessment {
  let score = 100;
  const reasons: string[] = [];
  for (const analyzer of ANALYZERS) {
    const { penalty, reason } = analyzer(item);
    score -= penalty;
    if (reason) reasons.push(reason);
  }
  score = Math.max(0, Math.min(100, score));
  return { score, acceptable: score >= 50, reasons };
}
