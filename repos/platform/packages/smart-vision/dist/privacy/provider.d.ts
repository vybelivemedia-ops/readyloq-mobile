/**
 * @platform/smart-vision/privacy — provider contracts.
 *
 * PrivacyProvider: the AI-model adapter interface.
 *
 * Applications register a provider when creating a PrivacyEngine.
 * The engine calls the provider for inference; the provider calls whatever
 * model, cloud service, or on-device framework it wraps.
 *
 * The engine never knows HOW inference is performed — only WHAT was returned.
 *
 * Provider examples (implemented in application layer, not here):
 *   OpenAIVisionProvider   — OpenAI GPT-4o vision API
 *   GeminiVisionProvider   — Google Gemini Vision API
 *   MediaPipeProvider      — MediaPipe object detection tasks
 *   AppleVisionProvider    — Apple Vision framework (iOS/macOS)
 *   CoreMLProvider         — CoreML on-device model
 *   TFLiteProvider         — TensorFlow Lite on-device model
 *   ONNXProvider           — ONNX Runtime on-device model
 *   YOLOProvider           — YOLO family models (various backends)
 *   EnterpriseProvider     — custom enterprise vision API
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { VideoFrame } from "../frame";
import type { PrivacyObjectClass, PrivacyDetectionRequest, PrivacyDetectionResult } from "./detection";
/**
 * Self-reported capabilities of a PrivacyProvider.
 * The engine uses these to route frames appropriately (e.g. skip network
 * providers in offlineMode; prefer GPU-accelerated providers when available).
 */
export interface PrivacyProviderCapabilities {
    /** Provider can process frames in real time at camera frame rates. */
    readonly supportsLiveVideo: boolean;
    /** Provider can process multiple frames in a single API call. */
    readonly supportsBatchProcessing: boolean;
    /** Provider runs on GPU / NPU / accelerated hardware. */
    readonly supportsHardwareAcceleration: boolean;
    /** Provider requires a network connection (cloud-based). */
    readonly requiresNetwork: boolean;
    /**
     * Provider can run entirely on-device without a network connection.
     * A provider may set both requiresNetwork and supportsOffline if it
     * falls back to a local model when offline.
     */
    readonly supportsOffline: boolean;
    /** Estimated per-frame inference latency in ms on a mid-range device. */
    readonly targetInferenceMs: number;
    /**
     * Whether the provider supports the "custom" object class.
     * Providers that do typically accept a customClassLabel in the request.
     */
    readonly supportsCustomClasses: boolean;
    /**
     * Maximum input resolution the provider can handle efficiently.
     * Null = no restriction.
     */
    readonly maxInputResolution: {
        width: number;
        height: number;
    } | null;
}
/**
 * Adapter for any AI detection model or service used for privacy detection.
 *
 * Lifecycle:
 *   1. Application creates a PrivacyProvider instance.
 *   2. Engine calls `initialize()` once when the session starts.
 *   3. Engine calls `detect()` on every inference frame.
 *   4. Engine calls `destroy()` when the session stops.
 *
 * A provider may be shared across multiple PrivacyEngine instances if it is
 * stateless between detect() calls. If it maintains per-session state
 * (e.g. RNN hidden state), create one provider instance per session.
 */
export interface PrivacyProvider {
    /** Unique identifier for this provider. Used in events and diagnostics. */
    readonly providerId: string;
    /** Human-readable name. Not for end-user display. */
    readonly name: string;
    /** Classes this provider can detect. The engine only requests these. */
    readonly supportedClasses: readonly PrivacyObjectClass[];
    /** Self-reported capabilities for engine routing decisions. */
    readonly capabilities: PrivacyProviderCapabilities;
    /**
     * Warm up the provider — load models, acquire GPU memory, authenticate.
     * Called once before the first detect() call.
     * May be a no-op for cloud providers.
     */
    initialize(): Promise<void>;
    /**
     * Run privacy detection on `frame`.
     * The engine passes only classes supported by this provider in `request.classes`.
     * Must resolve within a reasonable time; the engine may time out and skip.
     */
    detect(frame: VideoFrame, request: PrivacyDetectionRequest): Promise<PrivacyDetectionResult>;
    /**
     * Release resources — unload models, close network connections.
     * Called when the PrivacyEngine is destroyed.
     */
    destroy(): Promise<void>;
    /**
     * Reset per-session state (moving averages, RNN state, caches).
     * Called when the session resets without destroying the engine.
     */
    reset(): void;
    /**
     * Optional health check. Returns true if the provider is ready to detect.
     * The engine may call this before the first detect() to validate the provider.
     */
    isHealthy?(): Promise<boolean>;
}
/**
 * An optional registry that allows multiple PrivacyProviders to be
 * registered and selected at runtime (e.g. switch from cloud to on-device
 * when offline mode is enabled).
 *
 * The engine consults the registry to select the best available provider
 * for each inference call based on current configuration.
 */
export interface PrivacyProviderRegistry {
    /** Register a provider. No-op if a provider with the same ID already exists. */
    register(provider: PrivacyProvider): void;
    /** Unregister by ID. */
    unregister(providerId: string): void;
    /** Get a specific provider by ID. */
    get(providerId: string): PrivacyProvider | undefined;
    /** List all registered providers. */
    list(): readonly PrivacyProvider[];
    /**
     * Select the best available provider for the given requirements.
     * Returns null if no provider satisfies the requirements.
     */
    select(requirements: PrivacyProviderRequirements): PrivacyProvider | null;
}
export interface PrivacyProviderRequirements {
    readonly requiredClasses: readonly PrivacyObjectClass[];
    readonly offlineRequired: boolean;
    readonly preferHardwareAcceleration: boolean;
    readonly maxLatencyMs?: number;
}
//# sourceMappingURL=provider.d.ts.map