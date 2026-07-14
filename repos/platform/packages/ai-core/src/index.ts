/**
 * @platform/ai-core
 *
 * Generic AI infrastructure — provider interface, multi-provider fallback
 * factory, confidence scoring, detection/evidence/measurement models.
 *
 * SCOPE CONSTRAINT (explicit user requirement):
 *   This package must stay domain-agnostic.
 *   - NO pest-inspection logic (stays in readyloq-mobile)
 *   - NO streaming/social/Mission Control logic (stays in vybelive)
 *   - AI state, events, confidence scoring, generic detection models ONLY.
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
 * GENERALISATION NEEDED (before extraction):
 *   - Make EventBus generic over the event payload shape.
 *   - Extract StateEngine's localStorage coupling into an injectable adapter.
 *   - Remove VYBE-specific event kinds ("vybe.*") from any default lists;
 *     keep only generic infrastructure.
 *
 * DEPENDENCY GRAPH:
 *   ai-core → shared-types
 *   voice-intelligence → ai-core
 */

import type { AIModelHint, AIRequest, AIResponse, OSEvent } from "@platform/shared-types";

// ─── AI Provider interface ────────────────────────────────────────────────────

/**
 * Every AI provider adapter must implement this interface.
 * Implementations: OpenAI, Anthropic, Google (Gemini), Mock.
 * Canonical source: vybelive AIProvider.ts
 */
export interface AIProvider {
  readonly name: string;
  /** Relative priority — lower value = tried first in the fallback chain. */
  readonly priority: number;

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
  /**
   * Dispatch a request through the fallback chain.
   * Returns the response from the first provider that succeeds.
   */
  complete(request: AIRequest): Promise<AIResponse>;

  /**
   * Return the preferred provider for the given hint and optional objective,
   * consulting the reliability ledger and DB config.
   */
  getPreferredProvider(hint?: AIModelHint, objectiveId?: string): AIProvider;

  /** Register a new provider at runtime (used for plugin-style extensions). */
  register(provider: AIProvider): void;

  /** Summarise provider health (used by diagnostics / settings UI). */
  getHealthSummary(): ProviderHealthSummary[];
}

export interface ProviderHealthSummary {
  name: string;
  available: boolean;
  successRate: number; // 0–1
  avgLatencyMs: number;
  totalRequests: number;
}

// ─── EventBus ─────────────────────────────────────────────────────────────────

/**
 * Typed pub/sub event bus with wildcard subscriptions and sequential async
 * handler execution.
 *
 * Canonical source: vybelive EventBus.ts
 *
 * Wildcard convention: subscribe("camera.*") receives all camera.* events.
 * Handlers are called sequentially (not concurrently) — this preserves
 * ordering guarantees for state-mutating handlers.
 */
export interface EventBus {
  /** Emit an event — all matching subscribers are called in registration order. */
  emit<T = Record<string, unknown>>(event: Omit<OSEvent<T>, "id" | "emittedAt">): Promise<void>;

  /**
   * Subscribe to events matching `kind` (exact or wildcard with *).
   * Returns an unsubscribe function.
   */
  on<T = Record<string, unknown>>(
    kind: string,
    handler: (event: OSEvent<T>) => Promise<void> | void,
  ): () => void;

  /** One-shot subscription — auto-unsubscribes after the first matching event. */
  once<T = Record<string, unknown>>(
    kind: string,
    handler: (event: OSEvent<T>) => Promise<void> | void,
  ): () => void;

  /** Remove all handlers for a kind (or all handlers if kind is omitted). */
  off(kind?: string): void;
}

// ─── StateEngine ──────────────────────────────────────────────────────────────

/**
 * Observable key-value singleton for cross-service runtime state.
 *
 * Canonical source: vybelive StateEngine.ts
 *
 * Used to broadcast non-event state (e.g. "which AI provider is active",
 * "current stream session ID", "sync status") across services without
 * tight coupling. Subscribers are called synchronously on set().
 */
export interface StateEngine {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe<T>(key: string, listener: (value: T | undefined) => void): () => void;
  delete(key: string): void;
  snapshot(): Record<string, unknown>;
}

// ─── Confidence model ─────────────────────────────────────────────────────────

/**
 * A structured confidence result from any AI analysis call.
 * Normalised to 0–1 regardless of the underlying provider's scale.
 */
export interface ConfidenceResult {
  /** 0–1 confidence that the detection/finding is accurate. */
  score: number;
  /**
   * How the score was derived — used for explainability in UIs.
   * e.g. "multi-image consensus (3/3 images agree)"
   */
  method: string;
  /**
   * Optional breakdown per input signal, for detailed diagnostics.
   * e.g. { image_sharpness: 0.9, detection_agreement: 0.85 }
   */
  breakdown?: Record<string, number>;
}

// ─── Generic detection / evidence / measurement models ────────────────────────

/**
 * A single detected entity within an EvidenceItem.
 * Domain-specific fields (e.g. "pest species") belong in the consuming app,
 * not in this generic type.
 */
export interface Detection {
  id: string;
  /** Logical label for the detected entity (domain-defined). */
  label: string;
  confidence: ConfidenceResult;
  /** Bounding box in normalised coordinates (0–1), if available. */
  boundingBox?: { x: number; y: number; width: number; height: number };
  metadata?: Record<string, unknown>;
}

/**
 * The result of running AI analysis over one or more EvidenceItems.
 */
export interface AnalysisResult {
  id: string;
  evidenceIds: string[];
  detections: Detection[];
  /** Overall confidence across the full set of evidence. */
  overallConfidence: ConfidenceResult;
  /** Raw AI response text, for audit / re-analysis. */
  rawResponse: string;
  analysedAt: string; // ISO-8601
  usage: import("@platform/shared-types").AIUsage;
}

/**
 * A quantitative measurement extracted from evidence by AI.
 * Examples: area in sq-ft, count of entities, severity score 1–5.
 */
export interface Measurement {
  label: string;
  value: number;
  unit: string;
  confidence: ConfidenceResult;
}
