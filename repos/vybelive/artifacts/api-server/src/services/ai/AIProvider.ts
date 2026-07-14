// ─── AI Provider Interface — V6.2 Intelligence Layer ──────────────────────────
//
// All AI calls in Mission Control flow through this interface.
// Quinn and executives never talk to a specific AI SDK directly.
// The factory selects the active provider; providers normalize every response.
//
// Safety contract (enforced by callers, not providers):
//   • Never send secrets, API keys, passwords, or tokens in request content.
//   • Never send raw database dumps or source repositories.
//   • Always scope userContent to the minimum needed for the task.

// ─── Task types ───────────────────────────────────────────────────────────────

/** What reasoning task is being performed — used for model selection and cost tracking */
export type AITask =
  | "conversation"   // Quinn responding to founder in chat
  | "planning"       // Strategic planning, objective decomposition
  | "reasoning"      // Analysis, decision support, recommendations
  | "briefing"       // Aggregated briefing generation after objective completion
  | "coordination"   // Executive handoff / routing decisions
  | "decomposition"  // Breaking an objective into subtasks across executives
  | "profile_analysis"; // Behavioral signal extraction from founder messages/decisions

/**
 * Hint to the provider about which model tier to use.
 * The provider maps this to a concrete model name.
 *
 *   fast      → lightweight model (intent classification, quick answers)
 *   standard  → balanced model (everyday reasoning, conversation)
 *   reasoning → highest-quality model (strategic planning, complex decisions)
 */
export type AIModelHint = "fast" | "standard" | "reasoning";

// ─── Request / Response types ─────────────────────────────────────────────────

export interface AIRequest {
  /** Reasoning task — used for model selection and usage attribution */
  task: AITask;
  /** Optional model tier override. Defaults to "standard". */
  modelHint?: AIModelHint;
  /** System prompt (role + instructions). Never include secrets here. */
  systemPrompt: string;
  /** Sanitized user-facing content. Must never contain credentials or PII. */
  userContent: string;
  /** Executive making the request — required for cost tracking */
  executiveId: string;
  executiveName: string;
  executiveRole: string;
  /** Optional objective this request is part of — for cost attribution */
  objectiveId?: string;
  /** Token budget. Providers should respect this as a soft ceiling. */
  maxTokens?: number;
  /** Whether the model should return structured JSON or plain text */
  responseFormat: "json" | "text";
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Estimated cost in USD based on public model pricing */
  estimatedCostUsd: number;
  /** Wall-clock milliseconds from request start to response received */
  latencyMs: number;
}

export interface AIResponse {
  /** Raw string response from the provider (text or JSON string) */
  content: string;
  /** Parsed JSON object — only present when responseFormat="json" and parsing succeeded */
  parsed?: Record<string, unknown>;
  /** Provider identifier (e.g. "openai", "anthropic", "mock") */
  provider: string;
  /** Concrete model name used (e.g. "gpt-4o", "claude-3-5-sonnet") */
  model: string;
  /** Token and cost accounting */
  usage: AIUsage;
  /** True when the MockProvider was used instead of the configured primary */
  fromFallback: boolean;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface AIProvider {
  /** Stable identifier string — stored in usage logs */
  readonly providerName: string;
  /** Default model name used when no modelHint is specified */
  readonly defaultModel: string;
  /** Returns true if this provider has the credentials needed to make calls */
  isAvailable(): boolean;
  /** Make a single completion request. Implementations must not throw — return a result or propagate errors to the factory's fallback chain. */
  complete(request: AIRequest): Promise<AIResponse>;
}

// ─── Cost estimation helpers (shared by providers) ───────────────────────────

/** Per-million-token pricing table (USD). Updated as models change. */
export const MODEL_PRICING: Record<string, { promptPerM: number; completionPerM: number }> = {
  "gpt-4o":           { promptPerM: 2.50,  completionPerM: 10.00 },
  "gpt-4o-mini":      { promptPerM: 0.15,  completionPerM: 0.60  },
  "gpt-4-turbo":      { promptPerM: 10.00, completionPerM: 30.00 },
  "gpt-3.5-turbo":    { promptPerM: 0.50,  completionPerM: 1.50  },
  "claude-3-5-sonnet-20241022": { promptPerM: 3.00, completionPerM: 15.00 },
  "claude-3-haiku-20240307":    { promptPerM: 0.25, completionPerM: 1.25  },
  "claude-sonnet-4-6":          { promptPerM: 3.00, completionPerM: 15.00 },
  "claude-haiku-4-5":           { promptPerM: 1.00, completionPerM: 5.00  },
  "gemini-1.5-pro":   { promptPerM: 1.25,  completionPerM: 5.00  },
  "gemini-1.5-flash": { promptPerM: 0.075, completionPerM: 0.30  },
  "gemini-2.5-pro":   { promptPerM: 1.25,  completionPerM: 10.00 },
  "gemini-2.5-flash": { promptPerM: 0.15,  completionPerM: 0.60  },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (
    (promptTokens / 1_000_000) * pricing.promptPerM +
    (completionTokens / 1_000_000) * pricing.completionPerM
  );
}
