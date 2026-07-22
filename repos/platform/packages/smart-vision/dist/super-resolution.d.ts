/**
 * @platform/smart-vision — super-resolution (upscaling) contracts.
 *
 * Defines the interface for on-device or server-assisted super-resolution.
 * The implementation (ML model, API call, fallback bicubic) is injected by
 * the application; this package owns only the contract.
 *
 * No domain logic — super-resolution is a pure signal-processing capability.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { FrameDimensions, PixelFormat, VideoFrame } from "./frame";
/** Supported upscaling factors. */
export type ScalePreset = "2x" | "4x" | "8x";
/**
 * Maps each ScalePreset to its numeric multiplier.
 * Exported as a plain value so callers can avoid hardcoding the numbers.
 */
export declare const SCALE_MULTIPLIER: Record<ScalePreset, number>;
/**
 * Output quality preset controlling the speed/fidelity trade-off.
 *
 * "draft"    — fast; suitable for real-time preview or thumbnails.
 * "balanced" — default for production captures.
 * "quality"  — maximum fidelity; suitable for final export only (slow).
 */
export type UpscaleQuality = "draft" | "balanced" | "quality";
/** Optional sub-region to upscale, in normalised frame coordinates [0, 1]. */
export interface UpscaleROI {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface SuperResolutionRequest {
    /** Source frame to upscale. */
    frame: VideoFrame;
    scale: ScalePreset;
    quality: UpscaleQuality;
    /**
     * When provided, upscale only this sub-region and composite the result
     * back into the full frame. Useful for subject-only upscaling.
     */
    roi?: UpscaleROI;
}
export interface SuperResolutionResult {
    /** The upscaled frame in the same pixel format as the source. */
    frame: VideoFrame;
    /** Actual output dimensions (may differ from source × scale when ROI clamping applies). */
    outputDimensions: FrameDimensions;
    /** Wall-clock processing time in milliseconds. */
    processingMs: number;
    /** Name and/or version of the algorithm or model used (e.g. "ESRGAN-v4", "bicubic"). */
    algorithm: string;
    /** Whether upscaling happened on-device or via a remote service. */
    origin: "on_device" | "remote";
}
/** Describes what super-resolution this device/environment supports. */
export interface SuperResolutionCapability {
    /** Whether super-resolution is available at all. */
    available: boolean;
    /** Highest scale supported on this device. */
    maxScale: ScalePreset;
    /** Maximum input frame dimensions that can be upscaled (memory/hardware limit). */
    maxInputDimensions: FrameDimensions;
    /** Pixel formats the provider can accept. */
    supportedFormats: readonly PixelFormat[];
    /**
     * Estimated latency per quality preset in milliseconds.
     * Absent when the device has not yet been benchmarked.
     */
    estimatedLatencyMs?: Partial<Record<UpscaleQuality, number>>;
}
/**
 * Super-resolution provider.
 *
 * Implementations may use:
 *   - On-device ML model (CoreML, NNAPI, WASM/ONNX)
 *   - Remote upscaling API
 *   - Classic algorithm fallback (Lanczos, bicubic)
 *
 * The interface is identical in all cases; the application's capability
 * negotiation layer selects the appropriate implementation.
 */
export interface SuperResolutionProvider {
    readonly id: string;
    readonly capability: SuperResolutionCapability;
    /**
     * Upscale a frame.
     * Resolves with the result, or rejects with a SuperResolutionError on failure.
     */
    upscale(request: SuperResolutionRequest): Promise<SuperResolutionResult>;
    /**
     * Warm up any ML model or remote connection before the first `upscale` call.
     * Resolves immediately for providers that don't require warm-up.
     */
    warmup(): Promise<void>;
}
export interface SuperResolutionError {
    kind: "unavailable" | "input_too_large" | "format_unsupported" | "remote_error" | "timeout";
    message: string;
    /** True when retrying the same request is likely to succeed. */
    retryable: boolean;
}
//# sourceMappingURL=super-resolution.d.ts.map