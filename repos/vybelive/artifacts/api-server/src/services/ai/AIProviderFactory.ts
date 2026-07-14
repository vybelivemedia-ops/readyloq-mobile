// ─── AI Provider Factory — V6.2 Intelligence Layer ───────────────────────────
//
// Central access point for AI capabilities in Mission Control.
// Quinn and executives call getProvider() — they never instantiate providers
// directly and never import specific AI SDKs.
//
// Provider selection (in priority order):
//   1. AI_PROVIDER env var (explicit override)
//   2. First available provider in the default priority list
//   3. MockProvider (deterministic fallback — always available)
//
// Failure handling:
//   • If the primary provider's complete() throws, the factory retries once,
//     then transparently falls back to MockProvider.
//   • MockProvider always returns an empty parsed object — callers detect this
//     and apply their own deterministic logic.
//
// Cost and usage:
//   • Every AIResponse includes a `usage` block with tokens + estimated USD.
//   • The caller (service layer) is responsible for persisting usage to the
//     ai_usage_log table via recordAIUsage().

import { randomUUID } from "node:crypto";
import { db, aiModelConfigsTable, providerReliabilityTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import type { AIProvider, AIRequest, AIResponse, AIModelHint } from "./AIProvider.js";
import { OpenAIProvider }    from "./OpenAIProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";
import { GoogleProvider }    from "./GoogleProvider.js";
import { MockProvider }      from "./MockProvider.js";

// ─── Singleton registry ────────────────────────────────────────────────────────

const registry: Record<string, AIProvider> = {
  openai:    new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  google:    new GoogleProvider(),
  mock:      new MockProvider(),
};

const MOCK = registry["mock"] as MockProvider;

/** Default provider priority when AI_PROVIDER is not set */
const DEFAULT_PRIORITY = ["openai", "anthropic", "google"] as const;

// ─── Phase 10: Provider reliability ledger ────────────────────────────────────

function recordProviderReliability(
  providerName: string,
  model: string,
  success: boolean,
  latencyMs: number,
  tokens: number,
): void {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  db.insert(providerReliabilityTable)
    .values({
      id: randomUUID(),
      provider: providerName,
      model,
      date,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      timeoutCount: 0,
      totalTokens: tokens,
      avgLatencyMs: latencyMs,
      lastSeenAt: new Date(),
    })
    .catch((err: unknown) =>
      logger.warn({ err, provider: providerName }, "AI factory: failed to record provider reliability"),
    );
}

let _resolved: AIProvider | null = null;

// ─── Persisted config (V12: founder-selected provider / model tier) ───────────
// Loaded lazily from ai_model_configs and consulted at request time. A "global"
// row sets the default active provider + model tier; "objective" rows override
// per objective. Selection precedence for the active provider:
//   1. objective override (per-request, in completeWithFallback)
//   2. founder-set global override (persisted)
//   3. AI_PROVIDER env var
//   4. default priority list → mock
let _globalProvider: string | null = null;
let _globalModelHint: string | null = null;
const _objectiveOverrides = new Map<string, { provider: string | null; modelHint: string | null }>();
let _configLoaded = false;
let _configLoading: Promise<void> | null = null;

/** Return the registry provider for `name` only if it is currently available. */
function availableProviderByName(name: string | null | undefined): AIProvider | null {
  if (!name) return null;
  const found = registry[name.toLowerCase().trim()];
  return found && found.isAvailable() ? found : null;
}

async function loadConfig(): Promise<void> {
  const rows = await db.select().from(aiModelConfigsTable);
  _objectiveOverrides.clear();
  _globalProvider = null;
  _globalModelHint = null;
  for (const r of rows) {
    if (r.scope === "global") {
      _globalProvider = r.provider;
      _globalModelHint = r.modelHint;
    } else if (r.scope === "objective" && r.scopeId) {
      _objectiveOverrides.set(r.scopeId, { provider: r.provider, modelHint: r.modelHint });
    }
  }
  resetProviderCache();
}

/** Load persisted config once (best-effort — DB failures leave defaults). */
async function ensureConfigLoaded(): Promise<void> {
  if (_configLoaded) return;
  if (!_configLoading) {
    _configLoading = loadConfig()
      .catch((err) => {
        logger.warn({ err }, "AI factory: failed to load ai_model_configs — using env/priority defaults");
      })
      .finally(() => {
        _configLoaded = true;
        _configLoading = null;
      });
  }
  await _configLoading;
}

/** Force a re-read of persisted config on next request (call after mutations). */
export async function reloadAiModelConfig(): Promise<void> {
  _configLoaded = false;
  await ensureConfigLoaded();
}

function resolveProvider(): AIProvider {
  if (_resolved) return _resolved;

  // 1. Founder-set global override (persisted) wins over env.
  const globalPick = availableProviderByName(_globalProvider);
  if (globalPick) {
    _resolved = globalPick;
    return globalPick;
  }
  if (_globalProvider) {
    logger.warn(
      { provider: _globalProvider },
      "AI factory: persisted global provider is not available — falling back",
    );
  }

  const explicit = process.env.AI_PROVIDER?.toLowerCase().trim();
  if (explicit) {
    const found = registry[explicit];
    if (found) {
      if (found.isAvailable()) {
        logger.info({ provider: found.providerName }, "AI factory: using explicitly configured provider");
        _resolved = found;
        return found;
      }
      logger.warn(
        { provider: explicit },
        "AI factory: explicitly configured provider is not available — falling back",
      );
    } else {
      logger.warn({ provider: explicit }, "AI factory: unknown provider name in AI_PROVIDER env var");
    }
  }

  for (const name of DEFAULT_PRIORITY) {
    const candidate = registry[name];
    if (candidate?.isAvailable()) {
      logger.info({ provider: name }, "AI factory: auto-selected provider");
      _resolved = candidate;
      return candidate;
    }
  }

  logger.info("AI factory: no AI provider available — using deterministic mock fallback");
  _resolved = MOCK;
  return MOCK;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the active AIProvider for the current configuration.
 * Result is cached after first call — restart the server to re-evaluate.
 */
export function getProvider(): AIProvider {
  return resolveProvider();
}

/**
 * Make an AI request with automatic retry, cross-provider failover, and
 * MockProvider as the final fallback.
 *
 * Chain: primary (retry once) → each other available real provider (once)
 * → MockProvider. When a secondary provider succeeds, it is promoted to
 * primary so subsequent requests skip the dead provider entirely.
 *
 * The caller should always check response.fromFallback and apply
 * deterministic logic when true (empty `parsed` object).
 */
export async function completeWithFallback(request: AIRequest): Promise<AIResponse> {
  await ensureConfigLoaded();

  // Apply persisted overrides: objective-scoped wins over global.
  const override = request.objectiveId ? _objectiveOverrides.get(request.objectiveId) : undefined;
  const effectiveModelHint = (override?.modelHint ?? _globalModelHint ?? request.modelHint) as
    | AIModelHint
    | undefined;
  const req: AIRequest =
    effectiveModelHint && effectiveModelHint !== request.modelHint
      ? { ...request, modelHint: effectiveModelHint }
      : request;

  // Objective-scoped provider override takes precedence over the global default.
  const overrideProvider = availableProviderByName(override?.provider);
  const provider = overrideProvider ?? getProvider();

  // If we're already on the mock, skip the retry loop
  if (provider === MOCK) {
    return MOCK.complete(req);
  }

  // Attempt primary provider with one retry
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const response = await provider.complete(req);
      recordProviderReliability(provider.providerName, provider.defaultModel, true, Date.now() - t0, response.usage?.totalTokens ?? 0);
      return response;
    } catch (err) {
      recordProviderReliability(provider.providerName, provider.defaultModel, false, Date.now() - t0, 0);
      logger.warn(
        { err, provider: provider.providerName, attempt, task: req.task },
        attempt < 2
          ? "AI provider call failed — retrying"
          : "AI provider call failed after retry — trying next available provider",
      );
    }
  }

  // Cross-provider failover: try the remaining available real providers once each
  for (const name of DEFAULT_PRIORITY) {
    const candidate = registry[name];
    if (!candidate || candidate === provider || !candidate.isAvailable()) continue;
    const t0 = Date.now();
    try {
      const response = await candidate.complete(req);
      recordProviderReliability(candidate.providerName, candidate.defaultModel, true, Date.now() - t0, response.usage?.totalTokens ?? 0);
      logger.info(
        { from: provider.providerName, to: candidate.providerName, task: req.task },
        "AI factory: failover succeeded — promoting provider to primary",
      );
      _resolved = candidate;
      return response;
    } catch (err) {
      recordProviderReliability(candidate.providerName, candidate.defaultModel, false, Date.now() - t0, 0);
      logger.warn(
        { err, provider: candidate.providerName, task: req.task },
        "AI factory: failover provider also failed",
      );
    }
  }

  logger.warn({ task: req.task }, "AI factory: all real providers failed — using mock fallback");
  return MOCK.complete(req);
}

/**
 * Returns a brief status summary — useful for health checks and the metrics UI.
 */
export function getProviderStatus(): {
  active: string;
  model: string;
  available: Record<string, boolean>;
} {
  const active = resolveProvider();
  return {
    active: active.providerName,
    model:  active.defaultModel,
    available: Object.fromEntries(
      Object.entries(registry).map(([name, p]) => [name, p.isAvailable()]),
    ),
  };
}

/**
 * Force re-evaluation of provider availability on next call.
 * Useful in tests or after credential hot-reload.
 */
export function resetProviderCache(): void {
  _resolved = null;
}
