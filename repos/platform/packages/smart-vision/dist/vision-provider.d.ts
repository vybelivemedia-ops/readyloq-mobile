/**
 * @platform/smart-vision — VisionProvider abstraction.
 *
 * Instead of binding the SmartVisionEngine to a single DetectionEngine, this
 * module defines a pluggable VisionProvider interface. Any backend that can
 * analyse a VideoFrame and return structured results qualifies as a provider:
 *
 *   On-device          CoreML, TFLite, ONNX Runtime, MediaPipe
 *   Remote API         OpenAI Vision, Gemini Vision, Azure CV, Rekognition
 *   Custom             Enterprise models, domain-specific runtimes
 *
 * The engine asks: "Who can analyse this frame for object_detection?"
 * The registry returns the highest-priority healthy provider.
 * The engine doesn't care how the result was produced.
 *
 * ─── Relationship to DetectionEngine ───────────────────────────────────────
 *
 * `DetectionEngine` (detection.ts) remains for backward compatibility and
 * for callers that want the narrower, detection-only contract.
 * `ObjectDetectionProvider` (below) bridges the two: a DetectionEngine can
 * trivially implement ObjectDetectionProvider by wrapping its `detect()` call.
 *
 * GOVERNANCE: Analysis result types are domain-neutral. classId values in
 * ObjectDetectionAnalysis are application-defined integers — the platform
 * never assigns meaning to them. See repos/platform/GOVERNANCE.md.
 */
import type { VideoFrame, FrameIndex, FrameTimestamp } from "./frame";
import type { BoundingBox } from "./tracking";
import type { DetectedObject, DetectionModelId } from "./detection";
export type VisionProviderId = string & {
    readonly __brand: "VisionProviderId";
};
/**
 * Kinds of analysis a VisionProvider can perform.
 * A provider declares which kinds it supports; the registry routes accordingly.
 */
export type VisionAnalysisKind = "object_detection" | "classification" | "ocr" | "pose_estimation" | "depth_estimation" | "face_detection" | "segmentation" | "custom";
export interface VisionProviderCapabilities {
    /** Which analysis kinds this provider can produce. */
    supportedKinds: readonly VisionAnalysisKind[];
    /** Where inference runs. */
    runLocation: "on_device" | "remote" | "either";
    /** True when the device has a GPU / NPU available for this provider. */
    hasAccelerator: boolean;
    /** Whether this provider can operate without network access. */
    supportsOffline: boolean;
    /** Maximum sustainable analysis FPS on the current device. Absent if unknown. */
    maxFps?: number;
    /**
     * Latency class for UI feedback decisions.
     * "realtime" < 50 ms · "interactive" 50–200 ms · "background" > 200 ms
     */
    latencyClass: "realtime" | "interactive" | "background";
}
/** Common fields on every analysis result. */
interface AnalysisResultBase {
    frameIndex: FrameIndex;
    timestamp: FrameTimestamp;
    providerId: VisionProviderId;
    /** Wall-clock inference time (ms). */
    inferenceMs: number;
    /** Whether this result was produced on-device or via a remote call. */
    origin: "on_device" | "remote";
}
export interface ObjectDetectionAnalysis extends AnalysisResultBase {
    kind: "object_detection";
    objects: readonly DetectedObject[];
    /** Model that produced this result (if the provider exposes it). */
    modelId?: DetectionModelId;
}
export interface ClassificationLabel {
    /** Application-defined class index. */
    classId: number;
    confidence: number;
}
export interface ClassificationAnalysis extends AnalysisResultBase {
    kind: "classification";
    /** Top-N labels, ordered by descending confidence. */
    labels: readonly ClassificationLabel[];
}
export interface TextRegion {
    /** Normalised bounding box [0, 1] of this text region. */
    box: BoundingBox;
    /** Recognised text transcript. */
    transcript: string;
    /** Recognition confidence: 0–1. */
    confidence: number;
}
export interface OcrAnalysis extends AnalysisResultBase {
    kind: "ocr";
    regions: readonly TextRegion[];
    /** All recognised text joined in reading order. */
    fullText: string;
}
export interface PoseKeypoint {
    /** Named keypoint identifier (e.g. "left_wrist"). Application-defined. */
    name: string;
    /** Normalised position [0, 1]. */
    x: number;
    y: number;
    /** Visibility / confidence: 0–1. */
    confidence: number;
}
export interface PoseSubject {
    /** Index of this subject in the frame. */
    index: number;
    keypoints: readonly PoseKeypoint[];
    /** Bounding box around the full subject. */
    box: BoundingBox;
}
export interface PoseAnalysis extends AnalysisResultBase {
    kind: "pose_estimation";
    subjects: readonly PoseSubject[];
}
export interface DepthAnalysis extends AnalysisResultBase {
    kind: "depth_estimation";
    /**
     * Relative depth map as a Float32Array.
     * Length = `width × height`. Values are normalised [0, 1] unless
     * `absoluteMeters` is true, in which case values are meters.
     */
    depthMap: Float32Array;
    mapWidth: number;
    mapHeight: number;
    absoluteMeters: boolean;
}
export interface FaceRegion {
    box: BoundingBox;
    confidence: number;
    /** Estimated head pose angles (degrees). Present only when the provider supports it. */
    yaw?: number;
    pitch?: number;
    roll?: number;
}
export interface FaceDetectionAnalysis extends AnalysisResultBase {
    kind: "face_detection";
    faces: readonly FaceRegion[];
}
export interface SegmentationMask {
    /** Application-defined class index. */
    classId: number;
    box: BoundingBox;
    /**
     * Binary mask within `box`. Length = box.width × box.height (model resolution).
     * 1 = pixel belongs to this class; 0 = background.
     */
    mask: Uint8Array;
    confidence: number;
}
export interface SegmentationAnalysis extends AnalysisResultBase {
    kind: "segmentation";
    masks: readonly SegmentationMask[];
}
/**
 * Provider-specific structured output that doesn't fit any of the above kinds.
 * The platform passes this through without interpretation.
 * The application layer is responsible for deserialising `data`.
 */
export interface CustomAnalysis extends AnalysisResultBase {
    kind: "custom";
    /** Sub-type tag so the application can distinguish custom outputs. */
    subKind: string;
    /** Opaque structured result from the provider. */
    data: unknown;
}
export type VisionAnalysisResult = ObjectDetectionAnalysis | ClassificationAnalysis | OcrAnalysis | PoseAnalysis | DepthAnalysis | FaceDetectionAnalysis | SegmentationAnalysis | CustomAnalysis;
/**
 * Per-call options passed to `VisionProvider.analyze()`.
 * Not every provider honours every option — the provider uses what it can.
 */
export interface VisionAnalysisOptions {
    /** Request a specific analysis kind (must be in provider's supportedKinds). */
    kind?: VisionAnalysisKind;
    /**
     * Application-defined class IDs to include; others are filtered before return.
     * Relevant for object_detection and segmentation providers.
     */
    classFilter?: readonly number[];
    /**
     * Maximum results to return (detections, labels, faces, etc.).
     * 0 = provider default.
     */
    maxResults?: number;
    /**
     * Minimum confidence to include in results: 0–1.
     * Overrides the provider's built-in threshold for this call.
     */
    minConfidence?: number;
    /**
     * If true, return immediately from the last cached result rather than running
     * a new inference pass. Useful for UI queries that don't need fresh results.
     */
    useCached?: boolean;
}
/**
 * Core interface every vision analysis backend must implement.
 *
 * Any backend that can analyse a VideoFrame and return a VisionAnalysisResult
 * qualifies: CoreML, TFLite, ONNX, MediaPipe, OpenAI Vision, Gemini Vision,
 * Azure CV, a custom enterprise model, or a mock for testing.
 *
 * The SmartVisionEngine asks the VisionProviderRegistry for the best available
 * provider for the required analysis kind, then calls `analyze()`. It doesn't
 * care whether inference ran on a Neural Engine or called a remote HTTP API.
 */
export interface VisionProvider {
    readonly id: VisionProviderId;
    /** Human-readable name for logging and diagnostics. */
    readonly name: string;
    readonly capabilities: VisionProviderCapabilities;
    /**
     * Analyse a single video frame.
     * The provider decides which analysis kind to return unless `options.kind`
     * narrows the request.
     */
    analyze(frame: VideoFrame, options?: VisionAnalysisOptions): Promise<VisionAnalysisResult>;
    /**
     * Warm up the provider — load model weights, allocate GPU buffers,
     * establish remote connections. No-op if already warm.
     * Called during session startup before the first `analyze`.
     */
    warmup(): Promise<void>;
    /**
     * Release resources — unload weights, free GPU memory, close connections.
     * Called on session teardown or when the provider is unregistered.
     */
    teardown(): void;
    /**
     * Lightweight health probe.
     * Returns true if the provider can currently accept analysis requests.
     */
    isHealthy(): boolean;
}
/**
 * Requirements a caller can impose when selecting a provider from the registry.
 */
export interface ProviderConstraints {
    /** Must run on-device (disqualifies remote-only providers). */
    requireOnDevice?: boolean;
    /** Must support offline operation (no network needed). */
    requireOffline?: boolean;
    /** Must be capable of at least this many FPS. */
    minimumFps?: number;
    /** Must support this latency class or faster. */
    maximumLatencyClass?: "realtime" | "interactive" | "background";
    /** Specific provider IDs to exclude (e.g. a recently failed provider). */
    exclude?: readonly VisionProviderId[];
}
/**
 * Manages a collection of VisionProviders and routes analysis requests to the
 * best available provider.
 *
 * Registration is additive — multiple providers can support the same kind.
 * The registry maintains a priority-ordered fallback chain per kind.
 * If the primary provider fails its health check, the registry falls back to
 * the next registered provider automatically.
 *
 * Applications register providers at session startup:
 *   registry.register(geminiProvider, { kind: "object_detection", priority: 10 });
 *   registry.register(tfliteProvider, { kind: "object_detection", priority: 5 });
 *   // Gemini is tried first (priority 10); TFLite is the offline fallback (5).
 */
export interface VisionProviderRegistry {
    /**
     * Register a provider.
     * @param provider   The provider to add.
     * @param priority   Higher = preferred when multiple providers support the same kind.
     *                   Default: 0.
     */
    register(provider: VisionProvider, priority?: number): void;
    /** Remove a provider by id. No-op if not found. */
    unregister(id: VisionProviderId): void;
    /**
     * Get the highest-priority healthy provider for a given analysis kind,
     * optionally filtered by constraints.
     * Returns undefined if no qualifying provider is registered or healthy.
     */
    getFor(kind: VisionAnalysisKind, constraints?: ProviderConstraints): VisionProvider | undefined;
    /**
     * All healthy providers that support a given kind, ordered by descending priority.
     */
    getAllFor(kind: VisionAnalysisKind, constraints?: ProviderConstraints): readonly VisionProvider[];
    /**
     * The full ordered fallback chain for a kind, including unhealthy providers.
     * Used for diagnostics and pre-flight checks.
     */
    getFallbackChain(kind: VisionAnalysisKind): readonly VisionProvider[];
    /** All registered providers across all kinds, deduped. */
    list(): readonly VisionProvider[];
    /** True if at least one healthy provider supports the given kind. */
    canHandle(kind: VisionAnalysisKind, constraints?: ProviderConstraints): boolean;
    /** Remove all registered providers. */
    clear(): void;
}
export {};
//# sourceMappingURL=vision-provider.d.ts.map