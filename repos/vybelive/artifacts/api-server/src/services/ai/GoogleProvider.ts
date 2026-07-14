// ─── Google Gemini Provider ────────────────────────────────────────────────────
//
// Uses the public Gemini REST API (GEMINI_API_KEY).
// Falls back to GOOGLE_AI_API_KEY for backward compatibility.
//
// Model selection by hint:
//   fast      → gemini-2.5-flash  (intent classification, quick answers)
//   standard  → gemini-2.5-flash  (everyday reasoning, conversation)
//   reasoning → gemini-2.5-pro    (strategic planning, complex decisions)

import { logger } from "../../lib/logger.js";
import {
  type AIProvider,
  type AIRequest,
  type AIResponse,
  estimateCostUsd,
} from "./AIProvider.js";

const MODEL_MAP: Record<string, string> = {
  fast:      "gemini-2.5-flash",
  standard:  "gemini-2.5-flash",
  reasoning: "gemini-2.5-pro",
};

const TIMEOUT_MS = 30_000;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleProvider implements AIProvider {
  readonly providerName = "google";
  readonly defaultModel = "gemini-2.5-flash";

  private getApiKey(): string | null {
    return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? null;
  }

  isAvailable(): boolean {
    return this.getApiKey() !== null;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Google provider: GEMINI_API_KEY is not set");
    }

    const model = MODEL_MAP[request.modelHint ?? "standard"] ?? this.defaultModel;
    const start = Date.now();

    // For JSON mode, use responseMimeType and reinforce in the system prompt.
    const systemText =
      request.responseFormat === "json"
        ? `${request.systemPrompt}\n\nRespond ONLY with a single valid JSON object. No prose, no markdown fences.`
        : request.systemPrompt;

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens ?? 8192,
    };
    if (request.responseFormat === "json") {
      generationConfig.responseMimeType = "application/json";
    }

    const body = {
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: request.userContent }] }],
      generationConfig,
    };

    const res = await fetch(`${BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const latencyMs = Date.now() - start;

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");

    const promptTokens     = data.usageMetadata?.promptTokenCount     ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    let parsed: Record<string, unknown> | undefined;
    if (request.responseFormat === "json") {
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      try {
        const raw: unknown = JSON.parse(cleaned);
        parsed =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : undefined;
      } catch {
        logger.warn({ model, latencyMs }, "Google: JSON parse failed on response");
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
