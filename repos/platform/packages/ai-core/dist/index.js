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
    PROVIDER_REGISTERED: "ai.provider.registered",
    PROVIDER_UNAVAILABLE: "ai.provider.unavailable",
    PROVIDER_FALLBACK: "ai.provider.fallback",
    REQUEST_DISPATCHED: "ai.request.dispatched",
    RESPONSE_RECEIVED: "ai.response.received",
    REQUEST_FAILED: "ai.request.failed",
    RATE_LIMIT_HIT: "ai.ratelimit.hit",
    SESSION_CREATED: "ai.session.created",
    SESSION_TURN_COMPLETED: "ai.session.turn.completed",
    SESSION_ENDED: "ai.session.ended",
    USAGE_RECORDED: "ai.usage.recorded",
    PIPELINE_PRE: "ai.pipeline.pre",
    PIPELINE_POST: "ai.pipeline.post",
};
//# sourceMappingURL=index.js.map