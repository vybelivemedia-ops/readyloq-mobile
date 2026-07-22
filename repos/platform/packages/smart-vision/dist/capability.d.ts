/**
 * @platform/smart-vision — device capability negotiation contracts.
 *
 * Describes what vision features the current device supports and at what
 * fidelity, then negotiates the best achievable configuration given those
 * hardware constraints.
 *
 * No domain logic — capability negotiation is a hardware-abstraction concern.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { FrameDimensions, FrameRate } from "./frame";
import type { ZoomConstraints } from "./zoom";
import type { ScalePreset, UpscaleQuality } from "./super-resolution";
/**
 * Device processing tier, inferred from available compute resources (CPU core
 * count, GPU memory, presence of a neural engine/NPU).
 *
 * Used to gate features that are too expensive on low-end hardware.
 *
 * "low"      — entry-level; metadata-based analysis only.
 * "mid"      — mainstream; pixel analysis, single-target tracking.
 * "high"     — upper-mid; real-time multi-target tracking + basic SR.
 * "flagship" — high-end with dedicated ML accelerator; all features.
 */
export type ProcessingTier = "low" | "mid" | "high" | "flagship";
/**
 * Individual smart-vision features that may or may not be available on a
 * given device. Each flag is independently gated by hardware requirements.
 */
export type VisionFeatureFlag = "live_tracking" | "smart_zoom" | "smart_crop" | "auto_capture" | "subject_locking" | "motion_prediction" | "pixel_quality_analysis" | "super_resolution" | "hdr_capture" | "optical_image_stab" | "depth_data" | "raw_capture";
/**
 * Full description of this device's vision capabilities.
 * Produced by CapabilityProbe.probe() at session startup.
 */
export interface VisionCapabilities {
    processingTier: ProcessingTier;
    /** Per-feature availability on this specific device. */
    features: Record<VisionFeatureFlag, boolean>;
    /** Maximum capture resolution as reported by the camera hardware. */
    maxCaptureResolution: FrameDimensions;
    /** All capture frame rates the hardware supports. */
    supportedFrameRates: readonly FrameRate[];
    zoom: ZoomConstraints;
    superResolution: {
        available: boolean;
        /** Highest scale the device can handle. Null when unavailable. */
        maxScale: ScalePreset | null;
        /** Estimated latency at 'balanced' quality in milliseconds. */
        balancedLatencyMs?: number;
    };
    /** Whether a dedicated neural engine (Apple ANE, Qualcomm NPU, etc.) is present. */
    hasNeuralEngine: boolean;
    /** Platform identifier for diagnostics and feature-flag decisions. */
    platform: "ios" | "android" | "web" | "desktop" | "unknown";
    /** OS version string for diagnostic logging. */
    osVersion?: string;
}
/**
 * Detects the current device's vision capabilities by querying native APIs.
 *
 * Concrete implementations call AVFoundation, Camera2 API, WebRTC, etc.
 * The application supplies the implementation; this package owns the contract.
 */
export interface CapabilityProbe {
    /**
     * Run the full capability detection pass.
     * Async because some APIs require permission grants before they can report
     * full capability information.
     */
    probe(): Promise<VisionCapabilities>;
    /**
     * Return a conservative estimate based on static device properties
     * (CPU cores, OS version, device model string) — synchronous and available
     * immediately, before the full async probe completes.
     */
    probeSync(): Partial<VisionCapabilities>;
}
/**
 * Defines the minimum device capabilities required to enable a specific
 * vision feature. Used by the CapabilityNegotiator to produce the final
 * NegotiatedVisionConfig.
 */
export interface CapabilityConstraint {
    /** The feature this constraint governs. */
    feature: VisionFeatureFlag;
    /** Minimum processing tier required for this feature. */
    minimumTier: ProcessingTier;
    /**
     * Other features that must also be available as prerequisites.
     * Example: "super_resolution" requires "pixel_quality_analysis".
     */
    requires?: readonly VisionFeatureFlag[];
    /**
     * Minimum capture resolution needed by this feature.
     * Example: super-resolution needs at least 720 p input to produce quality output.
     */
    minimumResolution?: FrameDimensions;
}
/**
 * The resolved vision configuration produced by CapabilityNegotiator.negotiate().
 *
 * Applications use this to configure the FramePipeline, enable/disable UI
 * controls, and set processor parameters — in place of querying raw hardware
 * capabilities directly.
 */
export interface NegotiatedVisionConfig {
    /** Features that passed all constraints and will be active. */
    enabledFeatures: readonly VisionFeatureFlag[];
    /** Features that were requested but could not be enabled due to constraints. */
    unavailableFeatures: readonly VisionFeatureFlag[];
    /** Effective capture resolution to request from the camera provider. */
    captureResolution: FrameDimensions;
    /** Effective target frame rate. */
    frameRate: FrameRate;
    /**
     * The quality preset to use for super-resolution.
     * Null when super-resolution is not in `enabledFeatures`.
     */
    upscaleQuality: UpscaleQuality | null;
    /**
     * Whether pixel-level quality analysis (Laplacian variance, noise) is
     * active. False on "low" tier devices; true otherwise.
     */
    pixelAnalysisEnabled: boolean;
}
/**
 * Takes desired features and probed device capabilities and returns the best
 * achievable NegotiatedVisionConfig.
 *
 * Negotiation is applied in this order:
 *   1. Features blocked by `minimumTier` constraint are disabled.
 *   2. Features with unmet `requires` prerequisites are disabled.
 *   3. Features requiring a minimum resolution are checked; disabled if unmet.
 *   4. Processing tier sets `pixelAnalysisEnabled` and `upscaleQuality`.
 *   5. Frame rate and resolution are reduced to the nearest supported value.
 *
 * The concrete implementation lives in the application layer.
 */
export interface CapabilityNegotiator {
    /**
     * Negotiate the best achievable configuration.
     *
     * @param desired      Features the application would like to enable.
     * @param capabilities The probed device VisionCapabilities.
     * @param constraints  Per-feature minimum requirements.
     */
    negotiate(desired: readonly VisionFeatureFlag[], capabilities: VisionCapabilities, constraints: readonly CapabilityConstraint[]): NegotiatedVisionConfig;
}
//# sourceMappingURL=capability.d.ts.map