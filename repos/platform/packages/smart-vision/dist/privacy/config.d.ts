/**
 * @platform/smart-vision/privacy — configuration.
 *
 * PrivacyConfiguration controls all operational aspects of the Privacy Engine.
 * Applications construct one at session start and can update it at runtime.
 *
 * DEFAULT_PRIVACY_CONFIGURATION provides conservative, widely-applicable defaults.
 *
 * GOVERNANCE: No domain logic. No class-specific defaults.
 * See repos/platform/GOVERNANCE.md.
 */
/**
 * Trade-off between detection accuracy and processing speed.
 *
 * "high_accuracy"  — run inference more frequently; higher CPU/GPU; best results.
 * "balanced"       — default; 2× detection stride; suitable for most devices.
 * "low_latency"    — maximum frame skip; fastest; suitable for low-end hardware.
 */
export type PrivacyPerformanceMode = "high_accuracy" | "balanced" | "low_latency";
export interface PrivacyConfiguration {
    /**
     * Master enable/disable. When false, the engine processes no frames
     * and emits no events. Useful for toggling privacy at runtime.
     */
    readonly enabled: boolean;
    /**
     * Run the engine on live video frames (feedFrame calls).
     * Disable to use the engine only for captured images.
     */
    readonly liveVideo: boolean;
    /**
     * Run the engine when processImage() is called for still captures.
     */
    readonly capturedImages: boolean;
    /**
     * Apply privacy redaction to report generation (PDF, HTML, etc.).
     * Application-layer concern; the engine produces masks for the report renderer.
     */
    readonly reports: boolean;
    /**
     * Apply privacy redaction to media export (sharing, upload, etc.).
     */
    readonly exports: boolean;
    /**
     * Global minimum confidence to treat a detection as a privacy-sensitive object.
     * Per-class overrides can be set in PrivacyObjectPolicy.confidenceThreshold.
     * Range: 0–1. Default: 0.65.
     */
    readonly confidenceThreshold: number;
    /**
     * When true, the engine assigns stable PrivacyObjectIds across frames
     * using IoU-based ID association, reducing per-frame inference calls.
     * When false, every frame is treated independently (higher latency).
     */
    readonly trackingEnabled: boolean;
    /**
     * How many consecutive frames an object can be missing before it is
     * evicted and a "privacy.lost" event is emitted.
     * Default: 5.
     */
    readonly maxMissingFrames: number;
    /**
     * IoU threshold for associating a new detection with an existing tracked object.
     * Objects with lower overlap spawn a new PrivacyObjectId.
     * Range: 0–1. Default: 0.35.
     */
    readonly trackingIouThreshold: number;
    /**
     * When true, the engine consults the SmartVision SceneMemory before
     * running inference, reusing recent observations.
     */
    readonly sceneMemoryEnabled: boolean;
    /**
     * Run AI inference every N frames; use tracking to extrapolate positions
     * on other frames. Higher values = faster pipeline; may miss rapid changes.
     * 1 = detect every frame. Default: 3.
     */
    readonly detectionStrideFrames: number;
    /**
     * Maximum number of privacy objects to track simultaneously.
     * Additional detections are ignored (lowest-confidence first).
     * 0 = unlimited. Default: 20.
     */
    readonly maxTrackedObjects: number;
    readonly performanceMode: PrivacyPerformanceMode;
    /**
     * When true, lowers detectionStrideFrames to reduce power consumption
     * at the cost of detection freshness.
     */
    readonly batterySaver: boolean;
    /**
     * When true, the engine operates without network calls.
     * Providers that require network access are skipped.
     */
    readonly offlineMode: boolean;
    /**
     * Whether to render the output frame on every processed frame (true)
     * or only when masks change (false). "Always render" is safer for live
     * video; "render on change" is more efficient.
     */
    readonly alwaysRender: boolean;
}
export declare const DEFAULT_PRIVACY_CONFIGURATION: Readonly<PrivacyConfiguration>;
//# sourceMappingURL=config.d.ts.map