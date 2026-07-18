/**
 * @platform/local-intelligence
 *
 * On-device AI runtime for the platform.
 *
 * SCOPE CONSTRAINT (explicit):
 *   This package is domain-agnostic. ZERO domain logic allowed.
 *   - NO pest-inspection logic (stays in readyloq-mobile)
 *   - NO streaming/social/creator logic (stays in vybelive)
 *   - Model lifecycle, on-device inference, hardware awareness, and
 *     hybrid provider selection ONLY.
 *
 * WHY SEPARATE FROM ai-core (see ADR-013):
 *   ai-core manages cloud AI providers — stateless API calls, session
 *   management, and the middleware pipeline. local-intelligence manages the
 *   fundamentally different lifecycle of on-device ML models: download →
 *   storage → load into framework runtime → warm up → infer → unload.
 *   Mixing them would force ai-core to carry mobile-specific framework deps
 *   (TFLite, ONNX, CoreML, NNAPI) even in pure-web/cloud applications.
 *
 * INFERENCE MODES:
 *   local   — on-device model only; works fully offline
 *   cloud   — cloud API (via ai-core AIProviderFactory); requires network
 *   hybrid  — try local first; fall back to cloud on model miss or failure
 *   auto    — ProviderSelector decides based on network/battery/thermal state
 *
 * SUPPORTED RUNTIMES (future implementations, not imported here):
 *   TensorFlow Lite · ONNX Runtime · Apple CoreML · Android NNAPI
 *   MediaPipe · Custom model runners · OpenAI Local · Future providers
 *
 * PLATFORM INTEGRATION:
 *   local-intelligence registers as a plugin in platform-intelligence.
 *   The LocalIntelligencePlugin provides LocalAIProviders to the
 *   ProviderCoordinator. Workflow steps request inference via
 *   platform-intelligence's ProviderCoordinator, not by importing this
 *   package directly.
 *
 * DEPENDENCY GRAPH (Level 3 in the platform DAG):
 *   local-intelligence → shared-types      (EvidenceItem, ConfidenceResult)
 *   local-intelligence → ai-core           (AIProvider, EventBus, StateEngine)
 *   local-intelligence → camera-core       (CaptureFrame input types)
 *   local-intelligence → storage-core      (model file storage)
 *   local-intelligence → evidence-core     (EvidenceItem duplicate detection)
 *
 * WHAT STAYS IN APPLICATIONS:
 *   - Model IDs / filenames specific to domain (pest model, stream caption model)
 *   - Inference prompts and output parsers
 *   - Domain-specific quality thresholds
 *   - Decision logic using inference results
 */
// ─────────────────────────────────────────────────────────────────────────────
// EVENT KINDS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Standard local-intelligence event kind constants.
 * Emitted via the platform EventBus (registered by LocalIntelligencePlugin).
 * Convention: "local_ai.<noun>.<verb>"
 */
export const LOCAL_AI_EVENT_KINDS = {
    // Model lifecycle
    MODEL_REGISTERED: "local_ai.model.registered",
    MODEL_DOWNLOAD_STARTED: "local_ai.model.download_started",
    MODEL_DOWNLOAD_PROGRESS: "local_ai.model.download_progress",
    MODEL_DOWNLOAD_COMPLETE: "local_ai.model.download_complete",
    MODEL_DOWNLOAD_FAILED: "local_ai.model.download_failed",
    MODEL_LOADED: "local_ai.model.loaded",
    MODEL_UNLOADED: "local_ai.model.unloaded",
    // Inference
    INFERENCE_QUEUED: "local_ai.inference.queued",
    INFERENCE_STARTED: "local_ai.inference.started",
    INFERENCE_COMPLETE: "local_ai.inference.complete",
    INFERENCE_FAILED: "local_ai.inference.failed",
    INFERENCE_THROTTLED: "local_ai.inference.throttled",
    INFERENCE_CACHE_HIT: "local_ai.inference.cache_hit",
    // Provider selection
    PROVIDER_SELECTED_LOCAL: "local_ai.provider.selected_local",
    PROVIDER_SELECTED_CLOUD: "local_ai.provider.selected_cloud",
    PROVIDER_FALLBACK: "local_ai.provider.fallback",
    // Resources
    BATTERY_LOW: "local_ai.resource.battery_low",
    BATTERY_CRITICAL: "local_ai.resource.battery_critical",
    THERMAL_THROTTLING: "local_ai.resource.thermal_throttling",
    MEMORY_LOW: "local_ai.resource.memory_low",
    NETWORK_CHANGED: "local_ai.resource.network_changed",
};
//# sourceMappingURL=index.js.map