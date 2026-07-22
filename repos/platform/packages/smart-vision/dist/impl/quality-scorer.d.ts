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
import type { QualityScorer, QualityScorerConfig } from "../quality";
/**
 * Create the platform-level QualityScorer.
 *
 * This is the canonical implementation. Applications may substitute their own
 * scorer via SmartVisionDependencies.qualityScorer.
 */
export declare function createQualityScorer(config?: Partial<QualityScorerConfig>): QualityScorer;
//# sourceMappingURL=quality-scorer.d.ts.map