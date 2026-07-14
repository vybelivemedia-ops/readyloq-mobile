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
 *   platform-intelligence → camera-core      (CameraProvider, ProviderRegistry)
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

import type {
  AIProvider,
  AIProviderFactory,
  AISessionManager,
  AIPipeline,
  EventBus,
  StateEngine,
  ConfidenceResult,
} from "@platform/ai-core";
import type { CameraProvider } from "@platform/camera-core";
import type { EvidenceStore, EvidenceCollection } from "@platform/evidence-core";
import type { VoiceProvider } from "@platform/voice-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// PLUGIN SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every package that wants to participate in the OS must implement this
 * interface and register with the PluginRegistry.
 *
 * Examples:
 *   CameraPlugin     wraps camera-core's ProviderRegistry
 *   VoicePlugin      wraps voice-intelligence's VoiceProvider
 *   AIPlugin         wraps ai-core's AIProviderFactory
 *   EvidencePlugin   wraps evidence-core's EvidenceStore + UploadPipeline
 *   SyncPlugin       wraps sync-engine's SyncEngine
 *   WearablePlugin   wraps meta-wearables' WearableRegistry
 */
export interface PlatformPlugin {
  /** Stable, unique identifier. Use reverse-domain style: "camera", "voice", "ai". */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /**
   * Capability tokens this plugin provides. Used by WorkflowEngine to verify
   * a workflow's required capabilities are satisfied before starting.
   * Example: ["capture.photo", "capture.video", "capture.stream"]
   */
  readonly capabilities: string[];

  /**
   * Called once when the plugin is registered. Receives the full platform
   * context so it can wire up to the event router and state engine.
   */
  initialize(context: PlatformContext): Promise<void>;

  /**
   * Called when the platform is shutting down or when the plugin is removed.
   * Must clean up listeners and release resources.
   */
  teardown(): Promise<void>;
}

export interface PluginRegistry {
  register(plugin: PlatformPlugin): void;
  unregister(id: string): void;
  get(id: string): PlatformPlugin | undefined;
  list(): PlatformPlugin[];
  /** Check if a specific capability token is available. */
  hasCapability(capability: string): boolean;
  /** Find all plugins that provide a given capability. */
  findByCapability(capability: string): PlatformPlugin[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The context object injected into every plugin on initialization, and
 * available to every workflow step at runtime.
 *
 * This is the full platform surface area. Plugins use it to:
 *   - Subscribe to events from other plugins
 *   - Emit their own events
 *   - Read/write shared session state
 *   - Access memory from past sessions
 *   - Record measurements
 *   - Request guidance
 */
export interface PlatformContext {
  plugins: PluginRegistry;
  events: EventRouter;
  state: StateEngine;
  memory: MemoryOrchestrator;
  measurements: MeasurementState;
  guidance: GuidanceEngine;
  providers: ProviderCoordinator;
  sessions: IntelligenceSessionManager;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single step in a multi-stage workflow.
 *
 * Steps are defined by the APPLICATION — they contain domain logic.
 * The WorkflowEngine provides the execution machinery.
 *
 * Example (ReadyLoq "pest-inspection" workflow steps):
 *   capture  → AI analysis → measurement recording → memory recall →
 *   guidance → report compilation
 *
 * Example (VYBE "live-session" workflow steps):
 *   stream setup → evidence collection (clips) → memory recall → highlights
 */
export interface WorkflowStep {
  readonly id: string;
  readonly name: string;
  /**
   * Capabilities required for this step. WorkflowEngine checks these are
   * satisfied before allowing the step to execute.
   * Example: ["capture.photo"] for a photo capture step.
   */
  readonly requiredCapabilities?: string[];

  execute(input: StepInput, context: WorkflowContext): Promise<StepOutput>;
}

export interface StepInput {
  /** The session this step is part of. */
  sessionId: string;
  /** Output from the previous step (undefined for the first step). */
  previousOutput?: StepOutput;
  /** Full accumulated session state. */
  sessionState: Record<string, unknown>;
  /** Platform context for accessing plugins, memory, measurements, etc. */
  platform: PlatformContext;
}

export interface StepOutput {
  /** Whether this step completed successfully. */
  success: boolean;
  /** Data produced by this step (passed as previousOutput to the next step). */
  data?: Record<string, unknown>;
  /** Informational message for the event log. */
  message?: string;
  /** Non-fatal warnings — step still succeeded. */
  warnings?: string[];
  /** Error detail if success is false. */
  error?: string;
}

export interface WorkflowContext {
  workflowId: string;
  sessionId: string;
  platform: PlatformContext;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface WorkflowResult {
  workflowId: string;
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  completedSteps: string[];
  failedStep?: string;
  outputs: Record<string, StepOutput>; // stepId → output
  startedAt: string;
  completedAt: string;
}

export interface WorkflowEngine {
  /** Register a workflow definition. Usually called at app startup. */
  register(workflow: WorkflowDefinition): void;
  unregister(workflowId: string): void;
  list(): WorkflowDefinition[];
  get(workflowId: string): WorkflowDefinition | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE SESSION
// ─────────────────────────────────────────────────────────────────────────────

export type SessionStatus =
  | "idle"
  | "active"
  | "paused"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A running (or completed) execution of a registered workflow.
 *
 * ReadyLoq: one session per field inspection visit.
 * VYBE: one session per live stream.
 *
 * Sessions are serialisable for crash recovery and historical review.
 * The application layer attaches domain-specific identifiers (e.g. inspectionId,
 * streamId) via the `meta` field.
 */
export interface IntelligenceSession {
  readonly id: string;
  readonly workflowId: string;
  readonly status: SessionStatus;
  /** Which step is currently executing (undefined if not active). */
  readonly currentStepId: string | undefined;
  /** Steps that have finished (in order). */
  readonly completedSteps: string[];
  /** Accumulated state from all completed steps. */
  readonly state: Record<string, unknown>;
  /** Application-defined metadata (e.g. { inspectionId, assetId, technicianId }). */
  readonly meta: Record<string, unknown>;
  readonly startedAt: string; // ISO-8601
  readonly updatedAt: string;

  /** Execute all remaining steps from the current position. */
  run(): Promise<WorkflowResult>;
  /** Execute only the next pending step. */
  runNext(): Promise<StepOutput>;
  /** Pause after the current step completes. */
  pause(): Promise<void>;
  /** Resume from a paused state. */
  resume(): Promise<void>;
  /** Cancel the session. */
  cancel(): Promise<void>;

  /** Subscribe to status changes. */
  onStatusChange(listener: (status: SessionStatus) => void): () => void;
  /** Subscribe to step completions. */
  onStepComplete(listener: (stepId: string, output: StepOutput) => void): () => void;

  toJSON(): SerializedIntelligenceSession;
}

export interface SerializedIntelligenceSession {
  id: string;
  workflowId: string;
  status: SessionStatus;
  currentStepId: string | undefined;
  completedSteps: string[];
  state: Record<string, unknown>;
  meta: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
}

export interface IntelligenceSessionManager {
  /**
   * Create and start a new session for a registered workflow.
   * `meta` is application-defined (e.g. { inspectionId, assetId }).
   */
  start(workflowId: string, meta?: Record<string, unknown>): Promise<IntelligenceSession>;
  /** Restore a serialised session (e.g. after app crash or backgrounding). */
  restore(serialized: SerializedIntelligenceSession): IntelligenceSession;
  /** Retrieve an active session by ID. */
  get(sessionId: string): IntelligenceSession | undefined;
  /** List all active sessions. */
  listActive(): IntelligenceSession[];
  /** List all sessions (active + completed) for a given meta key/value. */
  listByMeta(key: string, value: string): IntelligenceSession[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GUIDANCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendationPriority = "critical" | "high" | "medium" | "low";

/**
 * A single actionable recommendation. Content is domain-defined by the
 * application — the platform provides the delivery mechanism.
 */
export interface Recommendation {
  id: string;
  priority: RecommendationPriority;
  /**
   * Human-readable recommendation text.
   * The application is responsible for crafting domain-specific messages.
   */
  message: string;
  /** Whether the user must take an action (vs. an informational note). */
  actionable: boolean;
  /** Stable action token the app can route to a UI action (optional). */
  actionId?: string;
  /** Supporting evidence IDs, if this recommendation is backed by captures. */
  evidenceIds?: string[];
  /** Confidence from the underlying AI result, if applicable. */
  confidence?: ConfidenceResult;
  metadata?: Record<string, unknown>;
}

export interface GuidanceRequest {
  sessionId: string;
  /** Current accumulated session state. */
  context: Record<string, unknown>;
  /**
   * Optional natural-language prompt from the application layer.
   * The application should inject domain-specific framing here.
   * The platform passes it through to the AI provider via AIPipeline.
   */
  prompt?: string;
  /** Limit number of recommendations returned. */
  maxRecommendations?: number;
}

export interface GuidanceResult {
  id: string;
  sessionId: string;
  recommendations: Recommendation[];
  /**
   * Which workflow step the GuidanceEngine suggests moving to next
   * (undefined if guidance says to stay in the current step).
   */
  suggestedNextStepId?: string;
  /** Overall confidence in this guidance set. */
  confidence: ConfidenceResult;
  generatedAt: string; // ISO-8601
}

/**
 * Turns current session state + AI results into actionable recommendations.
 *
 * The application provides the AI prompt (domain-specific framing).
 * The platform provides the execution machinery (pipeline, memory context,
 * event emission).
 *
 * EXTRACTION NOTE: ReadyLoq's "AI Guidance" feature maps directly to
 * GuidanceEngine. The pest-specific prompt templates stay in ReadyLoq.
 */
export interface GuidanceEngine {
  generate(request: GuidanceRequest): Promise<GuidanceResult>;
  /** Retrieve previous guidance results for a session. */
  history(sessionId: string): Promise<GuidanceResult[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single measurement recorded during a session. Labels and units are
 * domain-defined; the platform only stores and retrieves them.
 *
 * ReadyLoq examples: { label: "infestation_level", value: 3, unit: "severity_1_5" }
 * VYBE examples:     { label: "peak_viewers", value: 12340, unit: "count" }
 */
export interface MeasurementEntry {
  id: string;
  sessionId: string;
  /** Domain-defined measurement label. */
  label: string;
  value: number;
  unit: string;
  confidence?: ConfidenceResult;
  /** ID of the evidence item this measurement was derived from, if any. */
  sourceEvidenceId?: string;
  /** Which workflow step produced this measurement. */
  stepId?: string;
  capturedAt: string; // ISO-8601
}

export interface MeasurementState {
  add(entry: Omit<MeasurementEntry, "id">): MeasurementEntry;
  get(id: string): MeasurementEntry | undefined;
  /** All measurements for a session. */
  list(sessionId: string): MeasurementEntry[];
  /** Measurements for a session, filtered by label. */
  listByLabel(sessionId: string, label: string): MeasurementEntry[];
  update(id: string, patch: Partial<Pick<MeasurementEntry, "value" | "confidence" | "unit">>): void;
  remove(id: string): void;
  /**
   * Summary map: label → latest measurement value for the session.
   * Convenience method for passing current measurements into GuidanceEngine.
   */
  summary(sessionId: string): Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A summary of a completed session, stored for future recall.
 *
 * The platform stores what happened (summary, key observations).
 * The application provides the domain framing (what "key observations" means).
 *
 * ReadyLoq: previous inspections of the same asset.
 * VYBE: previous streams at the same venue or by the same creator.
 */
export interface MemoryRecord {
  id: string;
  /** The workflow that produced this memory. */
  workflowId: string;
  /** The session that produced this memory. */
  sessionId: string;
  /**
   * The entity this memory is about. Use app-defined entityType strings
   * (e.g. "asset", "creator", "team") + a stable ID.
   */
  entityType: string;
  entityId: string;
  /** AI-generated or app-provided plain-text summary. */
  summary: string;
  /**
   * Key observations — the most important facts from this session.
   * Application layer provides; platform stores and retrieves.
   */
  keyObservations: string[];
  /** Aggregate measurements from the session (label → value). */
  measurementSummary: Record<string, number>;
  /** Evidence IDs that support the key observations. */
  supportingEvidenceIds: string[];
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO-8601
}

export interface MemoryQuery {
  entityType?: string;
  entityId?: string;
  workflowId?: string;
  since?: string; // ISO-8601 — only memories after this date
  /** Maximum number of records to return (most recent first). */
  limit?: number;
  /** Full-text search across summary and keyObservations. */
  search?: string;
}

export interface MemoryOrchestrator {
  /** Store a memory record from a completed session. */
  store(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord>;
  /** Retrieve memories matching a query, most recent first. */
  recall(query: MemoryQuery): Promise<MemoryRecord[]>;
  /** Retrieve one memory by session ID. */
  getBySession(sessionId: string): Promise<MemoryRecord | null>;
  /**
   * Generate an AI summary across all recalled memories for an entity.
   * Returns a plain-text narrative for injection into GuidanceEngine prompts.
   */
  synthesise(entityType: string, entityId: string): Promise<string>;
  /** Delete all memories for an entity (e.g. on data-retention request). */
  purge(entityType: string, entityId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER COORDINATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderHealth {
  camera: { available: boolean; activeProvider?: string };
  voice: { available: boolean; activeProvider?: string };
  ai: { available: boolean; activeProviders: string[]; fallbackChainLength: number };
  registeredPlugins: number;
}

/**
 * Central registry for runtime provider instances. The ProviderCoordinator
 * decouples consumers from specific implementations — a WorkflowStep says
 * "I need a camera" and the coordinator provides the best available one.
 *
 * Registration is done by each plugin during its initialize() call.
 */
export interface ProviderCoordinator {
  // Camera
  registerCamera(provider: CameraProvider): void;
  getCamera(): CameraProvider | undefined;

  // Voice
  registerVoice(provider: VoiceProvider): void;
  getVoice(): VoiceProvider | undefined;

  // AI
  registerAI(factory: AIProviderFactory): void;
  getAI(): AIProviderFactory | undefined;
  getAIPipeline(): AIPipeline | undefined;
  getAISessionManager(): AISessionManager | undefined;

  // Evidence store (provided by EvidencePlugin)
  registerEvidenceStore(store: EvidenceStore): void;
  getEvidenceStore(): EvidenceStore | undefined;

  // Health
  health(): ProviderHealth;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT ROUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The central event bus for the entire platform. All inter-plugin communication
 * goes through the EventRouter — no plugin imports another plugin directly.
 *
 * Extends EventBus with routing rules that allow platform-intelligence to
 * direct specific event kinds to specific target plugins.
 *
 * Routing rules:
 *   events.route("ai.response.received", "evidence")
 *   → Every ai.response.received event is also dispatched to the evidence plugin.
 *
 * Convention for platform-level events: "platform.<noun>.<verb>"
 * Convention for plugin events: "<plugin-id>.<noun>.<verb>"
 * Application-level event kinds are NEVER defined here.
 */
export interface EventRouter extends EventBus {
  /**
   * Add a routing rule: when an event matching `kind` is emitted, also
   * dispatch it to the plugin with `targetPluginId`.
   */
  route(kind: string, targetPluginId: string): void;
  unroute(kind: string, targetPluginId: string): void;
  /** List all active routing rules. */
  routes(): Array<{ kind: string; targetPluginId: string }>;
}

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
  PLUGIN_REGISTERED:           "platform.plugin.registered",
  PLUGIN_UNREGISTERED:         "platform.plugin.unregistered",
  PLUGIN_INITIALIZED:          "platform.plugin.initialized",
  PLUGIN_TEARDOWN:             "platform.plugin.teardown",
  PLUGIN_ERROR:                "platform.plugin.error",

  // Session lifecycle
  SESSION_STARTED:             "platform.session.started",
  SESSION_PAUSED:              "platform.session.paused",
  SESSION_RESUMED:             "platform.session.resumed",
  SESSION_COMPLETED:           "platform.session.completed",
  SESSION_FAILED:              "platform.session.failed",
  SESSION_CANCELLED:           "platform.session.cancelled",

  // Workflow step lifecycle
  STEP_STARTED:                "platform.step.started",
  STEP_COMPLETED:              "platform.step.completed",
  STEP_FAILED:                 "platform.step.failed",
  STEP_SKIPPED:                "platform.step.skipped",

  // Guidance
  GUIDANCE_REQUESTED:          "platform.guidance.requested",
  GUIDANCE_GENERATED:          "platform.guidance.generated",

  // Measurement
  MEASUREMENT_RECORDED:        "platform.measurement.recorded",
  MEASUREMENT_UPDATED:         "platform.measurement.updated",

  // Memory
  MEMORY_STORED:               "platform.memory.stored",
  MEMORY_RECALLED:             "platform.memory.recalled",
  MEMORY_SYNTHESISED:          "platform.memory.synthesised",

  // Provider coordination
  PROVIDER_REGISTERED:         "platform.provider.registered",
  PROVIDER_UNAVAILABLE:        "platform.provider.unavailable",
  PROVIDER_REPLACED:           "platform.provider.replaced",
} as const;

export type PlatformEventKind = (typeof PLATFORM_EVENT_KINDS)[keyof typeof PLATFORM_EVENT_KINDS];

// Typed payloads for key platform events:

export interface SessionStartedPayload {
  sessionId: string;
  workflowId: string;
  meta: Record<string, unknown>;
}

export interface SessionCompletedPayload {
  sessionId: string;
  workflowId: string;
  completedSteps: string[];
  durationMs: number;
}

export interface StepCompletedPayload {
  sessionId: string;
  workflowId: string;
  stepId: string;
  success: boolean;
  durationMs: number;
}

export interface GuidanceGeneratedPayload {
  sessionId: string;
  guidanceId: string;
  recommendationCount: number;
  suggestedNextStepId?: string;
}

export interface PluginRegisteredPayload {
  pluginId: string;
  pluginName: string;
  capabilities: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM OS ROOT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for bootstrapping the platform.
 * Provided by the application at startup.
 */
export interface PlatformConfig {
  /** Application identifier. Used for event namespacing and logging. */
  appId: string;
  /** Human-readable application name. */
  appName: string;
  /**
   * Storage namespace for memory and session persistence.
   * Usually the app's DB schema name or storage prefix.
   */
  storageNamespace: string;
}

/**
 * The top-level platform OS instance.
 *
 * Application bootstrap example (ReadyLoq):
 *
 *   const os = createPlatform({ appId: "readyloq", appName: "ReadyLoq", storageNamespace: "rl" });
 *
 *   // Register plugins (application-provided implementations):
 *   await os.plugins.register(new CameraPlugin(cameraProvider));
 *   await os.plugins.register(new AIPlugin(aiProviderFactory, aipipeline));
 *   await os.plugins.register(new EvidencePlugin(evidenceStore));
 *   await os.plugins.register(new VoicePlugin(voiceProvider));
 *   await os.plugins.register(new SyncPlugin(syncEngine));
 *
 *   // Register workflows (application-defined domain logic):
 *   os.workflows.register(pestInspectionWorkflow);   // defined in readyloq-app
 *
 *   // Start a session:
 *   const session = await os.context.sessions.start("pest-inspection", {
 *     assetId: property.id,
 *     technicianId: user.id,
 *   });
 *   await session.run();
 */
export interface PlatformOS {
  readonly config: PlatformConfig;
  /** The full platform context — passed to every plugin and workflow step. */
  readonly context: PlatformContext;
  /** The workflow engine for registering and managing workflow definitions. */
  readonly workflows: WorkflowEngine;
  /** Lifecycle hooks. */
  shutdown(): Promise<void>;
}

/**
 * Factory function. The concrete implementation is provided by each
 * application — this interface declares the contract.
 */
export interface PlatformFactory {
  create(config: PlatformConfig): PlatformOS;
}
