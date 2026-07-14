// ─── Mock AI Provider — Deterministic Fallback ────────────────────────────────
//
// Used when:
//   • No AI provider is configured (no API key)
//   • The primary provider is unavailable or returns an error
//   • Running in test/offline environments
//
// Returns an empty parsed object so callers can fall through to their own
// deterministic logic without needing to branch on provider type.

import type { AIProvider, AIRequest, AIResponse } from "./AIProvider.js";

export class MockProvider implements AIProvider {
  readonly providerName = "mock";
  readonly defaultModel = "deterministic-fallback";

  isAvailable(): boolean {
    return true; // Always available — it's a no-op
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const start = Date.now();

    // Return an empty parsed object — callers detect null/empty and use
    // their own deterministic logic (e.g. deterministicConverse in Quinn).
    const content = request.responseFormat === "json" ? "{}" : "";

    return {
      content,
      parsed: request.responseFormat === "json" ? {} : undefined,
      provider: this.providerName,
      model: this.defaultModel,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - start,
      },
      fromFallback: true,
    };
  }
}
