/**
 * @platform/smart-vision/live-session/impl — concrete implementation barrel.
 *
 * Exports the concrete factory (createLiveSessionFactory) and supporting
 * implementation utilities. Applications import from this barrel to access
 * the runtime implementations.
 *
 * Types-only consumers should import from the parent live-session barrel:
 *   import type { VisionSession } from "@platform/smart-vision/live-session";
 *
 * Concrete factory:
 *   import { createLiveSessionFactory } from "@platform/smart-vision/live-session/impl";
 */
export { createLiveSessionFactory } from "./live-session-engine";
export { createPipelineEventBus, createFramePipeline } from "./pipeline-impl";
export { createPerformanceMonitor } from "./performance-impl";
export { createLiveFrameScheduler } from "./scheduler-impl";
export { VisionSessionImpl } from "./vision-session-impl";
