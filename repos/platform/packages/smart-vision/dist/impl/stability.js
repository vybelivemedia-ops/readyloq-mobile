"use strict";
/**
 * @platform/smart-vision — camera stability estimator.
 *
 * Computes StabilityMeasure from inter-frame pixel differences on the Y
 * (luminance) channel at 1/4 spatial resolution for speed. Falls back to
 * perfect stability (1.0) when pixel data is unavailable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStabilityEstimator = createStabilityEstimator;
/**
 * Mean absolute difference between two Y-plane arrays, sampled at `step`
 * pixels. Returns a value in [0, 255].
 */
function yPlaneDiff(a, b, step) {
    var len = Math.min(a.length, b.length);
    var sum = 0;
    var count = 0;
    for (var i = 0; i < len; i += step) {
        sum += Math.abs(a[i] - b[i]);
        count++;
    }
    return count > 0 ? sum / count : 0;
}
/**
 * Extract luminance (Y) plane from a VideoFrame.
 * Returns null for unsupported formats.
 */
function extractY(frame) {
    var _a = frame.meta.dimensions, width = _a.width, height = _a.height;
    var src = frame.data;
    switch (frame.pixelFormat) {
        case "gray8":
            return src instanceof Uint8Array ? src : new Uint8Array(src);
        case "yuv420p":
        case "nv12":
            return new Uint8Array(src.buffer, src.byteOffset, width * height);
        case "rgb8": {
            var y = new Uint8Array(width * height);
            for (var i = 0; i < width * height; i++) {
                y[i] = ((src[i * 3] * 77 + src[i * 3 + 1] * 150 + src[i * 3 + 2] * 29) >>> 8);
            }
            return y;
        }
        case "rgba8": {
            var y = new Uint8Array(width * height);
            for (var i = 0; i < width * height; i++) {
                y[i] = ((src[i * 4] * 77 + src[i * 4 + 1] * 150 + src[i * 4 + 2] * 29) >>> 8);
            }
            return y;
        }
        default:
            return null;
    }
}
/**
 * Create a rolling stability estimator.
 *
 * @param windowSize  Number of inter-frame differences to average (default 8).
 * @param sampleStep  Pixel stride for the diff (default 4 = 1/4 resolution).
 */
function createStabilityEstimator(windowSize, sampleStep) {
    if (windowSize === void 0) { windowSize = 8; }
    if (sampleStep === void 0) { sampleStep = 4; }
    var prevY = null;
    var diffs = [];
    return {
        update: function (frame) {
            var currY = extractY(frame);
            var displacement = 0;
            if (currY && prevY && currY.length === prevY.length) {
                // Mean absolute difference, normalised to [0, 1]
                displacement = yPlaneDiff(currY, prevY, sampleStep) / 255;
            }
            prevY = currY;
            diffs.push(displacement);
            if (diffs.length > windowSize)
                diffs.shift();
            var mean = diffs.reduce(function (s, d) { return s + d; }, 0) / diffs.length;
            // Map: displacement=0 → stability=1; displacement>=0.12 → stability=0
            // 0.12 is roughly 30/255 mean absolute luma diff, corresponding to
            // significant camera pan across a typical indoor scene.
            var score = Math.max(0, Math.min(1, 1 - mean / 0.12));
            return {
                score: score,
                meanDisplacement: mean,
                windowFrames: diffs.length,
            };
        },
        reset: function () {
            prevY = null;
            diffs.length = 0;
        },
    };
}
