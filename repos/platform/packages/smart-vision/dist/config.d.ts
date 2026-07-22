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
import type { BuiltInPolicyId } from "./capture-policy";
import type { QualityThresholds } from "./quality";
import type { SmartZoomConfig } from "./zoom";
import type { SceneMemoryConfig } from "./scene-memory";
import type { UpscaleQuality } from "./super-resolution";
import type { GuidanceCode } from "./guidance";
/**
 * Fine-grained feature switches for the SmartVisionEngine.
 * Disabled features consume no CPU/GPU resources at runtime.
 *
 * Feature set overview:
 *
 *   Frame pipeline     — always on; cannot be disabled
 *   objectTracking     — ObjectTracker + MotionPredictor
 *   subjectLocking     — SubjectLockController
 *   detectionEngine    — DetectionEngine inference per frame
 *   smartZoom          — SmartZoomController
 *   smartCrop          — SmartCropper
 *   autoCapture        — AutoCaptureEngine + CapturePolicy evaluation
 *   qualityScoring     — QualityScorer (metadata + optional pixel analysis)
 *   pixelQuality       — Laplacian sharpness / noise pixel decode (expensive)
 *   guidanceEngine     — GuidanceEngine evaluation per frame
 *   aiEnhancement      — EnhancementPipeline post-capture
 *   motionPrediction   — MotionPredictor Kalman / linear extrapolation
 *   sceneMemory        — SceneMemory duplicate detection + coverage tracking
 *   superResolution    — SuperResolutionProvider for final captures
 */
export interface SmartVisionFeatureFlags {
    objectTracking: boolean;
    subjectLocking: boolean;
    detectionEngine: boolean;
    smartZoom: boolean;
    smartCrop: boolean;
    autoCapture: boolean;
    qualityScoring: boolean;
    pixelQuality: boolean;
    guidanceEngine: boolean;
    aiEnhancement: boolean;
    motionPrediction: boolean;
    sceneMemory: boolean;
    superResolution: boolean;
}
/**
 * Pre-set battery conservation profiles.
 *
 * "off"        — full-speed processing; no battery trade-offs.
 * "light"      — reduce analysis FPS slightly; disable pixel quality decode.
 * "aggressive" — halve analysis FPS; disable tracking, guidance, scene memory.
 */
export type BatterySaverProfile = "off" | "light" | "aggressive";
export interface FrameProcessingConfig {
    /**
     * Target analysis frame rate for vision processing.
     * This is independent of the camera's capture frame rate.
     * Default: 15 fps.
     */
    analysisTargetFps: number;
    /**
     * Maximum time to spend on the full pipeline per frame (ms).
     * Frames that exceed this deadline are dropped (not queued).
     * Default: 66 ms (≈ 15 fps budget).
     */
    frameDeadlineMs: number;
    /**
     * Number of frames between full detection inference passes.
     * Between passes, the tracker extrapolates positions.
     * Example: 3 = run inference every 3rd frame, track in between.
     * Default: 3.
     */
    detectionStrideFrames: number;
    /**
     * Number of frames to include in rolling quality / confidence windows.
     * Default: 10.
     */
    rollingWindowFrames: number;
}
export interface AutoCapturePolicyConfig {
    /** Which built-in policy to use, or "custom" when providing a CapturePolicy instance. */
    policyId: BuiltInPolicyId | "custom";
    /**
     * Composite readiness score required to trigger capture: 0–1.
     * Overrides the policy's internal threshold.
     * Default: 0.75.
     */
    captureThreshold: number;
    /**
     * Minimum detection confidence required for the "confidence_first" and
     * "balanced" policies: 0–1.
     * Default: 0.65.
     */
    minDetectionConfidence: number;
    /**
     * Minimum camera stability score: 0–1.
     * Default: 0.7.
     */
    minStability: number;
    /**
     * Minimum frame quality score (0–100).
     * Default: 60.
     */
    minQualityScore: number;
    /**
     * Minimum subject framing coverage (fraction of frame area): 0–1.
     * Default: 0.05 (subject occupies ≥ 5 % of the frame).
     */
    minSubjectCoverage: number;
    /**
     * Minimum milliseconds between successive auto-captures.
     * Default: 2000 ms.
     */
    minIntervalMs: number;
    /**
     * Cooldown after any capture (auto or manual) before next auto-capture: ms.
     * Default: 1500 ms.
     */
    postCaptureCooldownMs: number;
    /**
     * Maximum captures per session. 0 = unlimited.
     * Default: 0.
     */
    captureLimit: number;
}
export interface GuidanceConfig {
    /**
     * Minimum time between successive emissions of the same GuidanceCode (ms).
     * Prevents the same directive from firing every frame.
     * Default: 2000 ms.
     */
    minRepeatIntervalMs: number;
    /**
     * Guidance codes to suppress entirely.
     * Useful to disable certain codes that are irrelevant for a workflow.
     */
    suppressCodes: readonly GuidanceCode[];
    /**
     * Maximum number of concurrent directives to emit per evaluation.
     * Default: 3 (show at most 3 guidance messages at once).
     */
    maxConcurrentDirectives: number;
}
export interface EnhancementOptions {
    /** Apply denoising after capture. Default: false. */
    denoise: boolean;
    denoiseStrength: "light" | "moderate" | "strong";
    /** Apply sharpening after capture. Default: false. */
    sharpen: boolean;
    sharpenStrength: "light" | "moderate" | "strong";
    /** Apply HDR tone-mapping. Default: false. */
    hdr: boolean;
    /** Apply contrast enhancement. Default: false. */
    contrast: boolean;
    contrastStrength: "light" | "moderate" | "strong";
}
export interface SuperResolutionOptions {
    /** Scale preset to apply on auto-capture. Default: "2x". */
    scale: "2x" | "4x" | "8x";
    quality: UpscaleQuality;
    /** Only upscale when the device is on AC power. Default: true. */
    onlyOnAc: boolean;
}
export interface OfflineModeConfig {
    /**
     * When true, disable all features that require network access:
     * remote detection inference, remote super-resolution.
     * On-device detection and processing proceed normally.
     * Default: false (auto-detect based on connectivity).
     */
    forceOffline: boolean;
    /**
     * Minimum detection confidence accepted from on-device models when
     * the preferred remote model is unavailable.
     * Default: 0.5.
     */
    offlineFallbackConfidence: number;
}
/**
 * Complete SmartVisionEngine configuration.
 *
 * One object controls all behaviour. Applications construct this at startup,
 * pass it to SmartVisionFactory.create(), and update it at runtime via
 * SmartVisionEngine.updateConfig(partial).
 */
export interface SmartVisionConfig {
    features: SmartVisionFeatureFlags;
    frameProcessing: FrameProcessingConfig;
    qualityThresholds: QualityThresholds;
    autoCapture: AutoCapturePolicyConfig;
    zoom: Pick<SmartZoomConfig, "targetCoverage" | "coverageTolerance" | "preferOptical" | "suppressDuringMotion">;
    guidance: GuidanceConfig;
    enhancement: EnhancementOptions;
    superResolution: SuperResolutionOptions;
    sceneMemory: Pick<SceneMemoryConfig, "observationTtlMs" | "overlapThreshold" | "maxFreshObservations">;
    battery: BatterySaverProfile;
    offline: OfflineModeConfig;
}
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
export declare const DEFAULT_SMART_VISION_CONFIG: SmartVisionConfig;
//# sourceMappingURL=config.d.ts.map