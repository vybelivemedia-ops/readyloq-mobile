/**
 * @platform/smart-vision — camera stability estimator.
 *
 * Computes StabilityMeasure from inter-frame pixel differences on the Y
 * (luminance) channel at 1/4 spatial resolution for speed. Falls back to
 * perfect stability (1.0) when pixel data is unavailable.
 */
import type { StabilityMeasure } from "../auto-capture";
import type { VideoFrame } from "../frame";
/**
 * Create a rolling stability estimator.
 *
 * @param windowSize  Number of inter-frame differences to average (default 8).
 * @param sampleStep  Pixel stride for the diff (default 4 = 1/4 resolution).
 */
export declare function createStabilityEstimator(windowSize?: number, sampleStep?: number): {
    update(frame: VideoFrame): StabilityMeasure;
    reset(): void;
};
//# sourceMappingURL=stability.d.ts.map