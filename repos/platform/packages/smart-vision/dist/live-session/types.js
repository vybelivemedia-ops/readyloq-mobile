/**
 * @platform/smart-vision/live-session — core types.
 *
 * Defines the pipeline lifecycle, stage identifiers, per-frame results,
 * feature flags, and top-level session configuration.
 *
 * GOVERNANCE: Zero domain logic. No application-specific identifiers.
 * See repos/platform/GOVERNANCE.md.
 */
export const DEFAULT_LIVE_SESSION_FEATURES = {
    stability: true,
    quality: true,
    sceneMemory: true,
    detection: true,
    tracking: true,
    motionPrediction: true,
    smartZoom: false,
    privacy: false,
    autoCapture: true,
};
export const DEFAULT_LIVE_SESSION_CONFIG = {
    targetFps: 30,
    maxQueueDepth: 2,
    frameDropPolicy: "drop_oldest",
    maxFrameAgeMs: 100,
    features: DEFAULT_LIVE_SESSION_FEATURES,
    detectionStrideFrames: 3,
    performanceProfile: "balanced",
    adaptivePerformance: true,
    sceneNoveltyThreshold: 0.3,
};
