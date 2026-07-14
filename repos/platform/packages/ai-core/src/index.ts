/**
 * @platform/ai-core
 *
 * Generic AI infrastructure — provider interface, multi-provider fallback
 * factory, AI sessions, request pipeline, event infrastructure, confidence
 * scoring, detection/evidence/measurement models.
 *
 * SCOPE CONSTRAINT (explicit):
 *   This package must stay domain-agnostic.
 *   - NO pest-inspection logic (stays in readyloq-mobile)
 *   - NO streaming/social/Mission Control logic (stays in vybelive)
 *   - Provider infrastructure, sessions, pipelines, events, confidence ONLY.
 *
 * CANONICAL SOURCES:
 *   Provider interface + factory (VYBE is canonical — superior abstraction):
 *     repos/vybelive/artifacts/api-server/src/services/ai/AIProvider.ts
 *     repos/vybelive/artifacts/api-server/src/services/ai/AIProviderFactory.ts
 *       — multi-provider fallback chain (OpenAI → Anthropic → Google → Mock)
 *       — per-request model hints (fast/standard/reasoning)
 *       — per-objective model overrides (from aiModelConfigs DB table)
 *       — cost tracking via AIUsage on every response
 *       — provider reliability ledger (daily-bucketed success/failure/latency)
 *
 *   Confidence model (ReadyLoq is canonical — more principled):
 *     repos/readyloq-mobile/artifacts/readyloq-app/lib/sync/engine.ts
 *       — confidence 0–1 float (not 0–100 int) on AI batch results
 *       — VYBE's 0–100 confidence on recommendations normalised to 0–1 here
 *
 *   Event bus / state engine (VYBE is canonical):
 *     repos/vybelive/artifacts/api-server/src/services/os/EventBus.ts
 *     repos/vybelive/artifacts/api-server/src/services/os/StateEngine.ts
 *       — typed pub/sub, wildcard subscriptions, sequential async handlers
 *       — observable KV singleton with subscription tracking
 *
 *   Session + pipeline: NEW — generalised from patterns observed in both repos.
 *   VYBE's executive AI calls are effectively multi-turn sessions; ReadyLoq's
 *   batch analysis is a pipeline of pre-processing + dispatch + post-processing.
 *
 * DEPENDENCY GRAPH:
 *   ai-core → shared-types
 *   voice-intelligence → ai-core
 */

import type { AIModelHint, AIRequest, AIResponse, AIUsage, OSEvent } from "@platform/shared-types";

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER INFRASTRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capabilities advertised by a provider. Used by AIProviderFactory to route
 * requests that require specific features (e.g. vision, function calling).
 */
export interface AIProviderCapabilities {
  /** Accepts image attachments in requests. */
  supportsVision: boolean;
  /** Supports streaming token output. */
  supportsStreaming: boolean;
  /** Supports tool/function calling. */
  supportsFunctionCalling: boolean;
  /** Supports audio/speech input. */
  supportsAudio: boolean;
  /** Maximum context window in tokens. */
  maxContextTokens: number;
  /** Supported model hints this provider can serve. */
  supportedHints: AIModelHint[];
}

/**
 * Every AI provider adapter must implement this interface.
 * Implementations: OpenAI, Anthropic, Google (Gemini), Mock.
 * Canonical source: vybelive AIProvider.ts
 */
export interface AIProvider {
  readonly name: string;
  /** Relative priority — lower value = tried first in the fallback chain. */
  readonly priority: number;
  readonly capabilities: AIProviderCapabilities;

  /**
   * True when the provider is configured and reachable.
   * Called by AIProviderFactory before dispatching.
   */
  isAvailable(): boolean;

  /**
   * Execute a single AI request. Must throw on unrecoverable errors so the
   * factory can fall back to the next provider in the chain.
   */
  complete(request: AIRequest): Promise<AIResponse>;
}

// ─── Provider factory ─────────────────────────────────────────────────────────

/**
 * Manages the ordered provider list, fallback chain, model-hint routing, and
 * per-objective model overrides.
 *
 * Canonical source: vybelive AIProviderFactory.ts
 *
 * Key behaviours (preserve on extraction):
 *   - Tries providers in priority order; on error from provider N, retries N+1.
 *   - Consults DB aiModelConfigs for global/per-objective provider preferences.
 *   - Records AIUsage on every successful completion for cost tracking.
 *   - Updates the provider reliability ledger (daily upsert) on every call.
 *   - Falls back to MockProvider if all live providers are unavailable
 *     (dev / test environments).
 */
export interface AIProviderFactory {
  complete(request: AIRequest): Promise<AIResponse>;
  getPreferredProvider(hint?: AIModelHint, objectiveId?: string): AIProvider;
  register(provider: AIProvider): void;
  getHealthSummary(): ProviderHealthSummary[];
}

export interface ProviderHealthSummary {
  name: string;
  available: boolean;
  successRate: number; // 0–1
  avgLatencyMs: number;
  totalRequests: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI SESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A message in a multi-turn AI conversation.
 */
export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Base64-encoded image attachments (for vision-capable providers). */
  attachments?: Array<{ mimeType: string; data: string }>;
  /** When this message was added. */
  timestamp: string; // ISO-8601
}

export interface AISessionConfig {
  /** System-level instruction applied to every turn in this session. */
  systemPrompt?: string;
  /** Default model hint for all requests in this session. */
  modelHint?: AIModelHint;
  /** Logical objective binding — routes to per-objective provider config. */
  objectiveId?: string;
  /** Maximum conversation history tokens retained before summarisation. */
  maxContextTokens?: number;
  /** Maximum number of past turns to include in each request. */
  maxHistoryTurns?: number;
}

/**
 * A managed multi-turn AI conversation context.
 *
 * ReadyLoq uses a session per inspection analysis batch (multiple images sent
 * in one logical context, follow-up questions for clarification).
 * VYBE uses a session per executive AI decision cycle (brief → analysis →
 * recommendation → confirmation).
 *
 * The session accumulates messages and cumulative usage, and can be
 * serialised and resumed across network interruptions.
 */
export interface AISession {
  readonly id: string;
  readonly config: AISessionConfig;
  /** All messages exchanged so far in this session. */
  readonly history: AIMessage[];
  /** Cumulative token + cost usage across all turns. */
  readonly totalUsage: Omit<AIUsage, "provider" | "model">;
  /** Whether this session has been ended. */
  readonly isEnded: boolean;

  /**
   * Send a user message and get the assistant response.
   * Automatically appends both to history.
   */
  send(content: string, attachments?: AIMessage["attachments"]): Promise<AIResponse>;

  /** Summarise the conversation history to free context window space. */
  summarise(): Promise<void>;

  /** Mark the session as ended. No further sends are accepted. */
  end(): void;

  /** Serialise to a plain object for persistence. */
  toJSON(): SerializedAISession;
}

export interface SerializedAISession {
  id: string;
  config: AISessionConfig;
  history: AIMessage[];
  totalUsage: Omit<AIUsage, "provider" | "model">;
  isEnded: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Factory for creating and restoring AI sessions.
 */
export interface AISessionManager {
  create(config?: AISessionConfig): AISession;
  restore(serialized: SerializedAISession): AISession;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI PIPELINE (middleware chain)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enriched context flowing through the middleware pipeline.
 * Middleware can read and mutate this on the way in (pre) and out (post).
 */
export interface AIRequestContext {
  /** The original request (may be mutated by pre-middleware). */
  request: AIRequest;
  /** The response, set after dispatch and available to post-middleware. */
  response?: AIResponse;
  /** Which provider was ultimately used. */
  resolvedProvider?: string;
  /** Arbitrary metadata middleware can attach for downstream consumers. */
  meta: Record<string, unknown>;
  /** ISO-8601 when the pipeline was entered. */
  startedAt: string;
}

/**
 * A single unit of middleware in the AI pipeline.
 *
 * `pre`  — runs before dispatch; can mutate context.request.
 * `post` — runs after dispatch; can mutate context.response.
 * Both phases are optional — implement only the ones you need.
 */
export interface AIMiddleware {
  readonly name: string;
  pre?(ctx: AIRequestContext): Promise<void> | void;
  post?(ctx: AIRequestContext): Promise<void> | void;
}

/**
 * Ordered chain of middleware that wraps AIProviderFactory.
 *
 * Built-in middleware to implement on extraction:
 *   - LoggingMiddleware   — structured request/response logging
 *   - CachingMiddleware   — exact-match response caching with TTL
 *   - RateLimitMiddleware — token-bucket rate limiting per provider
 *   - RetryMiddleware     — automatic retry with jitter on transient errors
 *   - ContentFilter      — strip PII from requests before dispatch
 *
 * Usage:
 *   const pipeline = new AIPipeline(factory, [
 *     new LoggingMiddleware(),
 *     new CachingMiddleware({ ttlSeconds: 300 }),
 *     new RateLimitMiddleware({ requestsPerMinute: 60 }),
 *   ]);
 *   const response = await pipeline.execute(request);
 */
export interface AIPipeline {
  /** Add a middleware to the end of the chain. */
  use(middleware: AIMiddleware): void;
  /** Execute the full chain and return the final response. */
  execute(request: AIRequest): Promise<AIResponse>;
}

// ─── Rate limiter ──────────────────────────────────────────────────────────────

export interface AIRateLimiterConfig {
  /** Maximum requests per window. */
  maxRequests: number;
  /** Window duration in ms. */
  windowMs: number;
  /** Maximum tokens per window (optional — for token-level limiting). */
  maxTokens?: number;
}

export interface AIRateLimiter {
  /** Check if a request can proceed. Returns false if the limit is exceeded. */
  check(provider: string): boolean;
  /** Record that a request was made (and optionally how many tokens were used). */
  record(provider: string, tokensUsed?: number): void;
  /** Milliseconds until the next slot is available, or 0 if available now. */
  nextAvailableMs(provider: string): number;
}

// ─── Usage tracker ─────────────────────────────────────────────────────────────

export interface AIUsageSummary {
  provider: string;
  model: string;
  requestCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  /** ISO-8601 window start for this summary bucket. */
  windowStart: string;
  windowEnd: string;
}

/**
 * Aggregates AIUsage across sessions and providers for cost dashboards.
 *
 * ReadyLoq: tracks AI cost per inspection to feed into pricing.
 * VYBE:     tracks AI cost per executive session for the reliability ledger.
 */
export interface AIUsageTracker {
  record(usage: AIUsage): void;
  /** Summarise usage for a time window, optionally filtered by provider. */
  summarise(opts: {
    from: string; // ISO-8601
    to: string;
    provider?: string;
  }): AIUsageSummary[];
  /** Total cumulative cost in USD across all recorded usage. */
  totalCostUsd(): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT INFRASTRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard AI event kind constants for use with EventBus.
 *
 * Convention: "<domain>.<noun>.<verb>"
 * All kinds here are generic AI infrastructure events. Domain-specific event
 * kinds (e.g. "inspection.analysis.completed", "stream.caption.generated")
 * are defined in the consuming app.
 */
export const AI_EVENT_KINDS = {
  PROVIDER_REGISTERED:    "ai.provider.registered",
  PROVIDER_UNAVAILABLE:   "ai.provider.unavailable",
  PROVIDER_FALLBACK:      "ai.provider.fallback",
  REQUEST_DISPATCHED:     "ai.request.dispatched",
  RESPONSE_RECEIVED:      "ai.response.received",
  REQUEST_FAILED:         "ai.request.failed",
  RATE_LIMIT_HIT:         "ai.ratelimit.hit",
  SESSION_CREATED:        "ai.session.created",
  SESSION_TURN_COMPLETED: "ai.session.turn.completed",
  SESSION_ENDED:          "ai.session.ended",
  USAGE_RECORDED:         "ai.usage.recorded",
  PIPELINE_PRE:           "ai.pipeline.pre",
  PIPELINE_POST:          "ai.pipeline.post",
} as const;

export type AIEventKind = (typeof AI_EVENT_KINDS)[keyof typeof AI_EVENT_KINDS];

/** Payload for ai.request.dispatched and ai.response.received. */
export interface AIRequestDispatchedPayload {
  requestId: string;
  provider: string;
  modelHint?: AIModelHint;
  sessionId?: string;
  promptTokenEstimate?: number;
}

export interface AIResponseReceivedPayload {
  requestId: string;
  provider: string;
  model: string;
  usage: AIUsage;
  sessionId?: string;
  latencyMs: number;
}

export interface AIRequestFailedPayload {
  requestId: string;
  provider: string;
  errorMessage: string;
  /** Whether the factory fell back to the next provider. */
  fellBack: boolean;
  sessionId?: string;
}

export interface AIProviderFallbackPayload {
  fromProvider: string;
  toProvider: string;
  reason: string;
  requestId: string;
}

export interface AISessionTurnPayload {
  sessionId: string;
  turnIndex: number;
  usage: AIUsage;
}

// ─── EventBus ─────────────────────────────────────────────────────────────────

/**
 * Typed pub/sub event bus with wildcard subscriptions and sequential async
 * handler execution.
 *
 * Canonical source: vybelive EventBus.ts
 *
 * Wildcard convention: subscribe("ai.*") receives all AI infrastructure events.
 * Handlers are called sequentially (not concurrently) — this preserves
 * ordering guarantees for state-mutating handlers.
 */
export interface EventBus {
  emit<T = Record<string, unknown>>(event: Omit<OSEvent<T>, "id" | "emittedAt">): Promise<void>;
  on<T = Record<string, unknown>>(
    kind: string,
    handler: (event: OSEvent<T>) => Promise<void> | void,
  ): () => void;
  once<T = Record<string, unknown>>(
    kind: string,
    handler: (event: OSEvent<T>) => Promise<void> | void,
  ): () => void;
  off(kind?: string): void;
}

// ─── StateEngine ──────────────────────────────────────────────────────────────

/**
 * Observable key-value singleton for cross-service runtime state.
 * Canonical source: vybelive StateEngine.ts
 */
export interface StateEngine {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe<T>(key: string, listener: (value: T | undefined) => void): () => void;
  delete(key: string): void;
  snapshot(): Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE MODEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A structured confidence result from any AI analysis call.
 * Normalised to 0–1 regardless of the underlying provider's scale.
 */
export interface ConfidenceResult {
  score: number; // 0–1
  method: string;
  breakdown?: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC DETECTION / EVIDENCE / MEASUREMENT MODELS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single detected entity within an EvidenceItem.
 * Domain-specific fields (e.g. "pest species") belong in the consuming app.
 */
export interface Detection {
  id: string;
  label: string; // domain-defined
  confidence: ConfidenceResult;
  boundingBox?: { x: number; y: number; width: number; height: number };
  metadata?: Record<string, unknown>;
}

export interface AnalysisResult {
  id: string;
  evidenceIds: string[];
  detections: Detection[];
  overallConfidence: ConfidenceResult;
  rawResponse: string;
  analysedAt: string; // ISO-8601
  usage: AIUsage;
}

export interface Measurement {
  label: string;
  value: number;
  unit: string;
  confidence: ConfidenceResult;
}
