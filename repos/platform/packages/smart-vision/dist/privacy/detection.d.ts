/**
 * @platform/smart-vision/privacy — detection contracts.
 *
 * PrivacyObjectClass:  the universe of detectable privacy-sensitive objects.
 * PrivacyDetectionRequest / Result: the inference API.
 * PrivacyDetector: the abstract interface applications implement per-model.
 *
 * GOVERNANCE: No class values reference pests, creators, or any application
 * domain. All values are generic computer-vision concepts.
 * See repos/platform/GOVERNANCE.md.
 */
import type { VideoFrame, FrameIndex, FrameTimestamp } from "../frame";
import type { BoundingBox } from "../tracking";
/**
 * Generic privacy-sensitive object classes detectable by the Privacy Engine.
 *
 * Applications map these classes to their own UI labels and policy decisions.
 * The platform never hardcodes what should be done with any class — only that
 * the class was detected.
 *
 * Extension: applications may use "custom" and annotate with a custom label
 * for classes not listed here.
 */
export type PrivacyObjectClass = "person" | "face" | "pet" | "vehicle" | "license_plate" | "house_number" | "address_number" | "mailbox" | "computer_screen" | "monitor" | "whiteboard" | "document" | "qr_code" | "barcode" | "credit_card" | "sensitive_text" | "custom";
/**
 * What the Privacy Engine asks a PrivacyProvider to detect.
 *
 * The engine populates this from the active policy — only requested classes are
 * inferred. Providers that don't support a class ignore it gracefully.
 */
export interface PrivacyDetectionRequest {
    /** Which classes to detect in this frame. Derived from the active policy. */
    readonly classes: readonly PrivacyObjectClass[];
    /** Minimum confidence to report a detection (provider-side pre-filter). */
    readonly confidenceThreshold: number;
    /** Optional cap on detections per class (provider may enforce or ignore). */
    readonly maxObjectsPerClass?: number;
    /**
     * Custom label associated with the "custom" class, if included in `classes`.
     * Providers that support custom labels use this for model routing.
     */
    readonly customClassLabel?: string;
}
/**
 * A single object detection from a PrivacyProvider before ID assignment.
 * The engine assigns stable PrivacyObjectId values during tracking.
 */
export interface DetectedPrivacyObject {
    /** The detected class. */
    readonly classId: PrivacyObjectClass;
    /** Normalised bounding box (0–1 each dimension). */
    readonly box: BoundingBox;
    /** Confidence 0–1. */
    readonly confidence: number;
    /**
     * Optional provider-assigned instance ID within this inference batch.
     * Not stable across frames — use the engine's PrivacyObjectId for that.
     */
    readonly instanceId?: string;
    /**
     * Optional structured metadata from the provider.
     * Example: { text: "REDACTED", chars: 8 } for sensitive_text detection.
     */
    readonly metadata?: Record<string, string | number | boolean>;
}
/**
 * The complete inference output for one frame from a PrivacyProvider.
 */
export interface PrivacyDetectionResult {
    readonly objects: readonly DetectedPrivacyObject[];
    readonly frameIndex: FrameIndex;
    readonly timestamp: FrameTimestamp;
    /** Provider wall-clock inference latency in ms. */
    readonly inferenceMs: number;
    /** Which provider produced this result. */
    readonly providerId: string;
    /**
     * True if the provider ran on a cached/compressed version of the frame
     * (e.g. downsampled for performance).
     */
    readonly downsampledInput: boolean;
}
/**
 * Abstraction over any AI model, cloud service, or on-device framework
 * capable of detecting privacy-sensitive objects.
 *
 * Concrete implementations live in the application layer or in a provider
 * adapter package. Examples: OpenAI Vision, Gemini Vision, MediaPipe, YOLO,
 * CoreML, TensorFlow Lite, ONNX, Apple Vision, custom enterprise providers.
 *
 * The Privacy Engine never knows how detection was performed.
 */
export interface PrivacyDetector {
    /**
     * Unique identifier for this detector instance.
     * Used in diagnostic events and provider attribution.
     */
    readonly detectorId: string;
    /** Human-readable name for logging. */
    readonly name: string;
    /** Which classes this detector can handle. */
    readonly supportedClasses: readonly PrivacyObjectClass[];
    /**
     * Run inference on `frame` and return all privacy-sensitive detections.
     * The engine passes only supported classes in `request.classes`.
     */
    detect(frame: VideoFrame, request: PrivacyDetectionRequest): Promise<PrivacyDetectionResult>;
    /**
     * Reset any per-session state (e.g. RNN hidden states, moving-average buffers).
     * Called on session start and after significant scene changes.
     */
    reset(): void;
}
//# sourceMappingURL=detection.d.ts.map