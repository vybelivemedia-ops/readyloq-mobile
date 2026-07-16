/**
 * @platform/smart-vision — concrete implementation exports.
 *
 * Import concrete factories from this barrel. The parent `src/index.ts`
 * re-exports the subset intended for public consumption.
 */

export { createEventBus } from "./event-bus";
export { createFrameBuffer } from "./frame-buffer";
export { createFrameScheduler } from "./frame-scheduler";
export type { FrameSchedulerOptions } from "./frame-scheduler";
export { createFramePipeline } from "./frame-pipeline";
export { createStabilityEstimator } from "./stability";
export { createQualityScorer } from "./quality-scorer";
export { createObjectTracker } from "./object-tracker";
export { createMotionPredictor } from "./motion-predictor";
export {
  createManualPolicy,
  createQualityFirstPolicy,
  createConfidenceFirstPolicy,
  createBalancedPolicy,
  createContinuousPolicy,
  createBuiltInPolicy,
} from "./capture-policies";
export { createAutoCaptureEngine } from "./auto-capture-engine";
export { createGuidanceEngine } from "./guidance-engine";
export type { GuidanceEngineOptions } from "./guidance-engine";
export { createSceneMemory } from "./scene-memory-impl";
export { createSceneMemoryEngine } from "./scene-memory-engine-impl";
export { createSmartVisionFactory } from "./smart-vision-engine";
