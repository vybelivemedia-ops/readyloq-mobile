// ─── Anthropic Provider ───────────────────────────────────────────────────────
//
// Uses the Replit AI Integrations proxy (AI_INTEGRATIONS_ANTHROPIC_API_KEY +
// AI_INTEGRATIONS_ANTHROPIC_BASE_URL) so no raw Anthropic key is needed.
// Falls back to ANTHROPIC_API_KEY against the public API if the proxy vars
// are absent.
//
// Model selection by hint:
//   fast      → claude-haiku-4-5   (intent classification, simple routing)
//   standard  → claude-sonnet-4-6  (conversation, coordination)
//   reasoning → claude-sonnet-4-6  (strategic planning, complex decisions)

import { logger } from "../../lib/logger.js";
import {
  type AIProvider,
  type AIRequest,
  type AIResponse,
  estimateCostUsd,
} from "./AIProvider.js";

const MODEL_MAP: Record<string, string> = {
  fast:      "claude-haiku-4-5",
  standard:  "claude-sonnet-4-6",
  reasoning: "claude-sonnet-4-6",
};

const TIMEOUT_MS = 22_000;
const PUBLIC_BASE_URL = "https://api.anthropic.com";

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements AIProvider {
  readonly providerName = "anthropic";
  readonly defaultModel = "claude-sonnet-4-6";

  private getConfig(): { baseUrl: string; apiKey: string } | null {
    const proxyKey  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    const proxyBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    if (proxyKey && proxyBase) {
      return { baseUrl: proxyBase.replace(/\/$/, ""), apiKey: proxyKey };
    }
    const directKey = process.env.ANTHROPIC_API_KEY;
    if (directKey) {
      return { baseUrl: PUBLIC_BASE_URL, apiKey: directKey };
    }
    return null;
  }

  isAvailable(): boolean {
    return this.getConfig() !== null;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const config = this.getConfig();
    if (!config) {
      throw new Error("Anthropic provider is not configured");
    }

    const model = MODEL_MAP[request.modelHint ?? "standard"] ?? this.defaultModel;
    const start = Date.now();

    // Anthropic has no native response_format — enforce JSON via the system prompt.
    const systemPrompt =
      request.responseFormat === "json"
        ? `${request.systemPrompt}\n\nRespond ONLY with a single valid JSON object. No prose, no markdown fences.`
        : request.systemPrompt;

    const res = await fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: request.userContent }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Anthropic API error ${res.status}: ${body.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as AnthropicMessageResponse;
    const latencyMs = Date.now() - start;

    const text = (data.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");

    const promptTokens     = data.usage?.input_tokens  ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    let parsed: Record<string, unknown> | undefined;
    if (request.responseFormat === "json") {
      // Strip markdown fences if the model added them despite instructions.
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      try {
        const raw: unknown = JSON.parse(cleaned);
        parsed = raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : undefined;
      } catch {
        logger.warn({ model, latencyMs }, "Anthropic: JSON parse failed on response");
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
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
        latencyMs,
      },
      fromFallback: false,
    };
  }
}
