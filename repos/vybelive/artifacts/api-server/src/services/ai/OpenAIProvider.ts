// ─── OpenAI Provider ──────────────────────────────────────────────────────────
//
// Uses the Replit AI Integrations proxy (AI_INTEGRATIONS_OPENAI_API_KEY +
// AI_INTEGRATIONS_OPENAI_BASE_URL) so no raw OpenAI key is needed.
//
// Model selection by hint:
//   fast      → gpt-4o-mini   (intent classification, simple routing)
//   standard  → gpt-4o        (conversation, coordination)
//   reasoning → gpt-4o        (strategic planning, complex decisions)
//                              (swap to o1/o3 here when available in proxy)

import OpenAI from "openai";
import { logger } from "../../lib/logger.js";
import {
  type AIProvider,
  type AIRequest,
  type AIResponse,
  estimateCostUsd,
} from "./AIProvider.js";

const MODEL_MAP: Record<string, string> = {
  fast:      "gpt-4o-mini",
  standard:  "gpt-4o",
  reasoning: "gpt-4o",
};

const TIMEOUT_MS = 22_000;

export class OpenAIProvider implements AIProvider {
  readonly providerName = "openai";
  readonly defaultModel = "gpt-4o";

  private client: OpenAI | null = null;
  private initialized = false;

  private getClient(): OpenAI | null {
    if (this.initialized) return this.client;
    this.initialized = true;

    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

    if (apiKey && baseURL) {
      this.client = new OpenAI({ apiKey, baseURL });
      logger.info({ provider: "openai" }, "AI provider: OpenAI ready via Replit proxy");
    } else {
      logger.info(
        { provider: "openai", hasKey: !!apiKey, hasBase: !!baseURL },
        "AI provider: OpenAI not configured — missing key or base URL",
      );
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!(
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    );
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const client = this.getClient();
    if (!client) {
      throw new Error("OpenAI provider is not configured");
    }

    const model = MODEL_MAP[request.modelHint ?? "standard"] ?? this.defaultModel;
    const start = Date.now();

    const completion = await client.chat.completions.create(
      {
        model,
        max_completion_tokens: request.maxTokens ?? 1000,
        response_format:
          request.responseFormat === "json"
            ? { type: "json_object" }
            : { type: "text" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user",   content: request.userContent  },
        ],
      },
      { timeout: TIMEOUT_MS },
    );

    const latencyMs = Date.now() - start;
    const text = completion.choices[0]?.message?.content ?? "";
    const promptTokens     = completion.usage?.prompt_tokens     ?? 0;
    const completionTokens = completion.usage?.completion_tokens ?? 0;
    const totalTokens      = completion.usage?.total_tokens      ?? 0;

    let parsed: Record<string, unknown> | undefined;
    if (request.responseFormat === "json") {
      try {
        const raw: unknown = JSON.parse(text);
        parsed = raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : undefined;
      } catch {
        logger.warn({ model, latencyMs }, "OpenAI: JSON parse failed on response");
      }
    }

    return {
      content: text,
      parsed,
      provider: this.providerName,
      model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
        latencyMs,
      },
      fromFallback: false,
    };
  }
}
