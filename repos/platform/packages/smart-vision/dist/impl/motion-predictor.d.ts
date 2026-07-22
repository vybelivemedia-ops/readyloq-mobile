/**
 * @platform/smart-vision — concrete MotionPredictor implementation.
 *
 * Linear extrapolation from a rolling window of MotionSamples.
 * Sufficient for 15-fps dead-reckoning between detection frames.
 * Applications requiring Kalman filtering can inject their own predictor.
 */
import type { MotionPredictor } from "../tracking";
export declare function createMotionPredictor(): MotionPredictor;
//# sourceMappingURL=motion-predictor.d.ts.map