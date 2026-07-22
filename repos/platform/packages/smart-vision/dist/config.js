/**
 * @platform/smart-vision — top-level engine configuration.
 *
 * SmartVisionConfig is the single object that controls all Smart Vision
 * Engine behaviour. Applications construct one config at startup, pass it
 * to SmartVisionFactory.create(), and can update it at runtime via
 * SmartVisionEngine.updateConfig().
 *
 * DEFAULT_SMART_VISION_CONFIG provides sensible out-of-the-box defaults.
 * Applications override only the properties they need to change.
 *
 * GOVERNANCE: No domain logic. Config values are generic thresholds and
 * feature flags. Domain-specific tuning lives in the application layer.
 * See repos/platform/GOVERNANCE.md.
 */
// ─── Default configuration ────────────────────────────────────────────────────
/**
 * Sensible out-of-the-box defaults for the SmartVisionEngine.
 *
 * Applications spread-override only the properties they need to change:
 *   const cfg: SmartVisionConfig = {
 *     ...DEFAULT_SMART_VISION_CONFIG,
 *     features: { ...DEFAULT_SMART_VISION_CONFIG.features, superResolution: true },
 *     autoCapture: { ...DEFAULT_SMART_VISION_CONFIG.autoCapture, minQualityScore: 70 },
 *   };
 */
export const DEFAULT_SMART_VISION_CONFIG = {
    features: {
        objectTracking: true,
        subjectLocking: true,
        detectionEngine: true,
        smartZoom: true,
        smartCrop: true,
        autoCapture: true,
        qualityScoring: true,
        pixelQuality: false, // expensive; opt-in
        guidanceEngine: true,
        aiEnhancement: false, // opt-in per use case
        motionPrediction: true,
        sceneMemory: true,
        superResolution: false, // opt-in; device-dependent
    },
    frameProcessing: {
        analysisTargetFps: 15,
        frameDeadlineMs: 66,
        detectionStrideFrames: 3,
        rollingWindowFrames: 10,
    },
    qualityThresholds: {}, // use scorer built-in defaults
    autoCapture: {
        policyId: "balanced",
        captureThreshold: 0.75,
        minDetectionConfidence: 0.65,
        minStability: 0.7,
        minQualityScore: 60,
        minSubjectCoverage: 0.05,
        minIntervalMs: 2000,
        postCaptureCooldownMs: 1500,
        captureLimit: 0,
    },
    zoom: {
        targetCoverage: 0.25,
        coverageTolerance: 0.05,
        preferOptical: true,
        suppressDuringMotion: true,
    },
    guidance: {
        minRepeatIntervalMs: 2000,
        suppressCodes: [],
        maxConcurrentDirectives: 3,
    },
    enhancement: {
        denoise: false,
        denoiseStrength: "moderate",
        sharpen: false,
        sharpenStrength: "light",
        hdr: false,
        contrast: false,
        contrastStrength: "light",
    },
    superResolution: {
        scale: "2x",
        quality: "balanced",
        onlyOnAc: true,
    },
    sceneMemory: {
        observationTtlMs: 5 * 60 * 1000, // 5 minutes
        overlapThreshold: 0.5,
        maxFreshObservations: 0, // unlimited
    },
    battery: "off",
    offline: {
        forceOffline: false,
        offlineFallbackConfidence: 0.5,
    },
};
