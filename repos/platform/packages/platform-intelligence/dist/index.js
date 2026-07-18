/**
 * @platform/platform-intelligence
 *
 * The Platform OS kernel.
 *
 * Every other package is a plugin. Every application is a workflow definition.
 * platform-intelligence owns nothing domain-specific — it owns the machinery
 * that connects everything together.
 *
 * ANALOGY:
 *   Windows / Linux / Android / iOS are operating systems.
 *   Applications run on top of them.
 *   The OS provides capabilities; applications define purpose.
 *
 *   platform-intelligence IS the OS.
 *   ReadyLoq is one application running on it.
 *   VYBE is another.
 *
 * WHAT THIS PACKAGE OWNS:
 *   Plugin registry           — every capability registers here
 *   Workflow engine           — defines and executes multi-step pipelines
 *   Intelligence session      — a running workflow execution with state
 *   Guidance engine           — turns AI results + session state into recommendations
 *   Measurement state         — tracks measurements accumulated in a session
 *   Memory orchestrator       — queries and stores cross-session summaries
 *   Provider coordinator      — registers and routes to camera, voice, AI providers
 *   Event router              — single pub/sub bus all plugins talk through
 *
 * WHAT THIS PACKAGE NEVER OWNS:
 *   Domain logic              — stays in the application (ReadyLoq, VYBE, etc.)
 *   AI prompts                — defined by the application, executed here
 *   Business rules            — e.g. "findings of severity HIGH require a proposal"
 *   Report templates          — application layer
 *   Product-specific events   — e.g. "inspection.completed", "stream.started"
 *
 * DEPENDENCY GRAPH:
 *   platform-intelligence → shared-types
 *   platform-intelligence → ai-core          (AIProvider, AIProviderFactory,
 *                                              EventBus, StateEngine, ConfidenceResult)
 *   platform-intelligence → camera-core      (CaptureProvider, ProviderRegistry)
 *   platform-intelligence → evidence-core    (EvidenceStore — memory context)
 *   platform-intelligence → storage-core     (MemoryOrchestrator persistence)
 *   platform-intelligence → voice-intelligence (VoiceProvider — ProviderCoordinator)
 *
 * APPLICATIONS depend on platform-intelligence:
 *   readyloq-mobile  → platform-intelligence
 *   vybelive         → platform-intelligence
 *
 * See GOVERNANCE.md for the full dependency rule set.
 */
// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM EVENT KINDS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Standard platform-level event kind constants.
 * All application-specific event kinds are defined by the application.
 *
 * Convention: "platform.<noun>.<verb>"
 */
export const PLATFORM_EVENT_KINDS = {
    // Plugin lifecycle
    PLUGIN_REGISTERED: "platform.plugin.registered",
    PLUGIN_UNREGISTERED: "platform.plugin.unregistered",
    PLUGIN_INITIALIZED: "platform.plugin.initialized",
    PLUGIN_TEARDOWN: "platform.plugin.teardown",
    PLUGIN_ERROR: "platform.plugin.error",
    // Session lifecycle
    SESSION_STARTED: "platform.session.started",
    SESSION_PAUSED: "platform.session.paused",
    SESSION_RESUMED: "platform.session.resumed",
    SESSION_COMPLETED: "platform.session.completed",
    SESSION_FAILED: "platform.session.failed",
    SESSION_CANCELLED: "platform.session.cancelled",
    // Workflow step lifecycle
    STEP_STARTED: "platform.step.started",
    STEP_COMPLETED: "platform.step.completed",
    STEP_FAILED: "platform.step.failed",
    STEP_SKIPPED: "platform.step.skipped",
    // Guidance
    GUIDANCE_REQUESTED: "platform.guidance.requested",
    GUIDANCE_GENERATED: "platform.guidance.generated",
    // Measurement
    MEASUREMENT_RECORDED: "platform.measurement.recorded",
    MEASUREMENT_UPDATED: "platform.measurement.updated",
    // Memory
    MEMORY_STORED: "platform.memory.stored",
    MEMORY_RECALLED: "platform.memory.recalled",
    MEMORY_SYNTHESISED: "platform.memory.synthesised",
    // Provider coordination
    PROVIDER_REGISTERED: "platform.provider.registered",
    PROVIDER_UNAVAILABLE: "platform.provider.unavailable",
    PROVIDER_REPLACED: "platform.provider.replaced",
};
//# sourceMappingURL=index.js.map