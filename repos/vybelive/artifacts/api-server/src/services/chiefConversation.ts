// ─── Quinn Harlow — AI Chief of Staff — V6.3 Executive Initiative ─────────────
//
// V6.3 upgrade: default-toward-action reasoning engine
//   Step 1  Intent classification  (action-verb-first gate → objective_execution)
//   Step 2  Source selection        (load only data relevant to that intent)
//   Step 3  Executive reasoning     (internal deliberation — bias toward launch)
//   Step 4  Response generation     (launch → executive briefing with names + scope)
//   Step 5  Continuous improvement  (record intent + sources used in ConverseResult)
//
// V6.3 rule: Quinn defaults toward action. Clarify is a last resort, not a default.
// Any imperative request → create objective, mobilize team, return briefing.
// All AI calls have a deterministic fallback — 429 / no-key environments still work.

import { randomUUID } from "node:crypto";
import { db, aiUsageLogTable } from "@workspace/db";
import { parseExecutiveCommand } from "./executiveCommandParser.js";
import { logger } from "../lib/logger.js";
import { completeWithFallback } from "./ai/AIProviderFactory.js";
import type { AIRequest } from "./ai/AIProvider.js";
import { buildReasoningSteps, recordReasoning, type QuinnReasoning } from "./chiefReasoning.js";
import { getSpecialistBenchBrief } from "./specialistRegistry.js";
import { runOperationalReview } from "./autonomyEngine.js";

// ─── Public types ──────────────────────────────────────────────────────────────

/** Fine-grained intent label (V6.1) — 8 categories from the spec */
export type QuinnReasoningIntent =
  | "memory_retrieval"
  | "current_status"
  | "objective_planning"
  | "objective_execution"
  | "executive_coordination"
  | "decision_support"
  | "approval_request"
  | "general_conversation";

/** Coarse action intent — drives the route handler (backward-compatible) */
export type QuinnIntent = "launch" | "answer" | "clarify" | "approval_required";

export type MemoryOp = {
  action: "remember" | "forget";
  kind?: "fact" | "preference" | "directive" | "context";
  content: string;
};

export type ExecAwarenessItem = {
  id: string;
  name: string;
  role: string;
  status: string;
  statusMessage: string | null;
  openTaskCount: number;
};

/** All context that may be passed to converseAsChief.
 *  Not every field is populated on every call — only what the intent needs. */
export type ConversationContext = {
  founderMessage: string;
  /** Pre-classified intent so the AI knows which step-2 sources were loaded */
  classifiedIntent: QuinnReasoningIntent;
  /** V6.5: Founder Operating Profile — compact formatted string for system prompt injection */
  founderProfile?: string | null;
  /** V6.8: Founder Decision Model — predicted choices + confidence gate for pending decisions */
  decisionModel?: string | null;
  /** Marketing Autonomy: Dario's learning/trusted mode status — Quinn monitors this */
  marketingBrief?: string | null;
  /** Agent Zero: execution-layer job queue status — Quinn dispatches and monitors it */
  agentZeroBrief?: string | null;
  /** Required for AI usage attribution and cost tracking */
  executiveId: string;
  /** Optional objective scope for AI cost attribution */
  objectiveId?: string;
  recentMessages: Array<{ role: "founder" | "agent"; content: string }>;
  executiveAwareness: ExecAwarenessItem[];
  recentObjectives: Array<{ title: string; status: string }>;
  memoryItems: Array<{ kind: string; content: string }>;
  pendingApprovals: Array<{ title: string; detail: string | null }>;
  // Intent-specific sources — conditionally loaded by the route:
  latestReports?: Array<{
    executiveName: string;
    status: string;
    headline: string;
    topFinding?: string;
  }>;
  activeTasks?: Array<{
    title: string;
    status: string;
    priority: string;
    executiveName: string;
  }>;
  approvalHistory?: Array<{
    title: string;
    status: string;
    decidedAt?: string;
  }>;
  allObjectives?: Array<{ title: string; status: string; request?: string }>;
};

export type ConverseResult = {
  intent: QuinnIntent;
  /** The fine-grained V6.1 intent used for this response */
  reasoningIntent: QuinnReasoningIntent;
  reply: string;
  objectiveText?: string;
  needsApprovalCategory?: string;
  memoryOp?: MemoryOp;
  /** Which data sources were actually used — for continuous improvement */
  sourcesUsed: string[];
  /** V9: the persisted six-question reasoning pass behind this reply */
  reasoning?: QuinnReasoning;
};

// ─── Safety guardrails (V6.7) ─────────────────────────────────────────────────
//
// V6.7 reframe: protected categories NO LONGER block objective creation. Quinn
// always mobilizes the team for the safe prep work (planning, analysis,
// inspection, scheduling, delegation, collaboration, memory, reports). A
// protected category only gates the FINAL irreversible step — the objective runs
// its analysis autonomously and waits at needs_approval before the protected
// action executes.
//
// Only FIVE buckets ever require founder approval:
//   Deploy · Merge · Delete · Money · External services
//
// Note: "release", "publish (a clip)", "launch", "ship" are NOT blanket-protected
// — they are objectives ("prepare for release"). Only the actual deploy / go-live
// step is gated. Each entry maps a keyword to its human-readable bucket.
const PROTECTED_CATEGORIES: ReadonlyArray<[RegExp, string]> = [
  // Deploy / go-live to production
  [/\b(?:deploy|go live|publish to production|push to production|ship to prod|release to production)\b/i, "deploy"],
  // Merge code
  [/\bmerge\b/i, "merge"],
  // Destructive data operations
  [/\b(?:delete|purge|wipe|drop table|destroy|erase)\b/i, "delete"],
  // Money movement
  [/\b(?:spend|purchase|\bbuy\b|payment|pay (?:for|out|the)|charge (?:the|card|customer)|refund|invoice|billing|subscribe to)\b/i, "money"],
  // External communications / third-party services
  [/\b(?:send (?:an? )?email|email (?:the|out|all|our)|send (?:an? )?(?:message|sms|text)|post (?:to|on|publicly)|announce(?:ment)?|contact (?:the|our)|external api|third[- ]party|reach out to)\b/i, "external services"],
];

export function detectProtectedCategory(text: string): string | null {
  for (const [pattern, bucket] of PROTECTED_CATEGORIES) {
    if (pattern.test(text)) return bucket;
  }
  return null;
}

// ── V6.7 intent inference helpers ─────────────────────────────────────────────

/** Bare confirmations that apply to the active discussion ("yes", "do it"). */
const AFFIRMATION_RE =
  /^(?:yes|yep|yeah|yup|sure|ok|okay|sounds good|do it|go ahead|go for it|proceed|confirmed|affirmative|make it happen|ship it|let'?s do it|let'?s go|go|please do|absolutely|definitely|correct|that works|perfect|exactly)\b[.! ]*$/i;

export function isAffirmation(text: string): boolean {
  return AFFIRMATION_RE.test(text.trim());
}

/** Short founder shorthands → a concrete objective the team can execute on. */
const SHORTHAND_OBJECTIVES: ReadonlyArray<[RegExp, string]> = [
  [/^(?:release|let'?s release|time to release)\b/i, "Prepare VYBE LIVE for release"],
  [/^(?:ship|let'?s ship)\b/i, "Prepare VYBE LIVE to ship"],
  [/^(?:fix (?:the )?(?:critical|crit)|fix critical issues?|critical (?:issues?|bugs?))\b/i, "Resolve critical stability issues across the platform"],
  [/^(?:fix (?:the )?(?:bugs?|issues?|problems?))\b/i, "Triage and resolve outstanding bugs"],
  [/^(?:stabilize|stability)\b/i, "Run a stability hardening pass across the platform"],
  [/^(?:audit|do an audit)\b/i, "Run a full production-readiness audit"],
  [/^(?:grow|growth)\b/i, "Drive a growth initiative across product and marketing"],
];

/** Expand a terse directive into a real objective; otherwise return as-is. */
export function inferObjectiveText(founderMessage: string): string {
  const trimmed = founderMessage.trim();
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 4) {
    for (const [pattern, objective] of SHORTHAND_OBJECTIVES) {
      if (pattern.test(trimmed)) return objective;
    }
  }
  return trimmed;
}

/** Find the active objective from conversation history (for "yes" confirmations).
 *  Prefers the most recent substantive founder request; falls back to the
 *  objective Quinn last proposed. Returns null when there is nothing to act on. */
export function extractActiveObjective(
  recentMessages: Array<{ role: "founder" | "agent"; content: string }>,
): string | null {
  // Walk backwards; skip the current affirmation (caller passes prior history).
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    if (!msg) continue;
    if (msg.role === "founder") {
      const content = msg.content.trim();
      if (!isAffirmation(content) && content.split(/\s+/).length >= 2) {
        return inferObjectiveText(content);
      }
    }
  }
  // No prior founder directive — fall back to Quinn's last proposed launch line.
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    if (msg?.role === "agent") {
      const m = msg.content.match(/launch(?:ing)?:?\s+(.+?)(?:[.\n]|$)/i);
      if (m?.[1]) return m[1].trim();
    }
  }
  return null;
}

// ─── Step 1: Intent Classification ───────────────────────────────────────────

const INTENT_PATTERNS: Record<QuinnReasoningIntent, string[]> = {
  memory_retrieval: [
    "remember when", "remind me", "recall", "what did i say", "what was decided",
    "we agreed", "previous decision", "we said", "i told you", "last time we",
    "before we", "history of", "in the past", "what did we", "forgotten",
    "what's in memory", "my memory", "your memory", "what do you know",
  ],
  current_status: [
    "how is", "how are", "how's the team", "where do we stand", "status report",
    "catch me up", "what's happening", "update me", "quick update", "overview",
    "what's going on", "current state", "everyone doing", "how's everything",
    "brief me", "daily briefing", "morning briefing", "team status", "progress",
  ],
  objective_planning: [
    "should we", "plan for", "planning to", "roadmap", "next quarter", "next sprint",
    "priorities", "what should we focus", "what are our next steps", "where should",
    "help me think", "think through", "propose a plan", "lay out a plan",
    "strategy", "approach", "timeline", "schedule", "when should we",
  ],
  objective_execution: [
    // Core action verbs — any of these signals "do something"
    "fix", "improve", "prepare", "inspect", "investigate", "analyze", "analyse",
    "review", "organize", "launch", "audit", "assess", "evaluate", "research",
    "look into", "dig into", "deep dive", "figure out", "find out", "get to the bottom",
    "run a", "do a", "give me a report", "report on", "get a status on",
    "pull together", "get me an analysis", "kick off", "start a", "begin",
    "initiate", "go ahead and", "make it happen", "make sure", "ensure that",
    "have the team", "build a", "build out", "create a", "design a", "draft a",
    "write a", "generate a", "produce a", "document", "map out", "set up",
    "configure", "implement", "test", "validate", "verify", "monitor", "track",
    "measure", "optimize", "clean up", "refactor", "upgrade", "identify",
    "establish", "execute", "develop", "plan the", "plan a", "plan our",
    "check on", "check the", "check if", "make a plan", "come up with",
  ],
  executive_coordination: [
    "who is working", "which executive", "who should handle", "assign",
    "delegate", "coordinate with", "collaborate", "handoff", "hand off",
    "what is ada", "what is mara", "what is theo", "what is nadia",
    "what is iris", "what is dario", "ada is", "mara is", "theo is",
    "what's theo", "what's ada", "who is responsible", "who owns",
  ],
  decision_support: [
    "what would you recommend", "your recommendation", "what do you think",
    "pros and cons", "recommend", "advice", "comparison", "help me decide",
    "weigh", "tradeoff", "should i", "which option", "better option",
    "what's your take", "your opinion", "your view",
  ],
  approval_request: [
    "approve", "approval", "sign off", "authorize", "clear this", "green light",
    "give the ok", "pending approval", "approve this", "approve the",
  ],
  general_conversation: [],
};

// ── V6.3: Action-verb gate — catches imperative sentences before pattern matching ──
//
// Any message that starts with an action verb and is long enough to be a request
// (not just a one-word greeting) goes straight to objective_execution.
// Protected categories are already caught above, so "deploy", "delete", etc.
// will never reach this check.
const ACTION_VERB_FIRST_RE =
  /^(?:fix|improve|prepare|inspect|investigate|analyze|analyse|review|organize|plan|launch|build|create|design|draft|write|generate|produce|document|map|set up|configure|implement|test|validate|verify|monitor|track|measure|optimize|clean|refactor|upgrade|identify|establish|execute|develop|run|start|begin|kick off|roll out|check|find|figure|research|assess|evaluate|audit|inspect|look at|go|make|get|pull|push|do|send|ship|collect|gather|compile|summarize|summarise|compare|benchmark|forecast|prioritize|prioritise|schedule|coordinate|delegate|assign|structure|streamline|automate|integrate|migrate|consolidate|prototype|pitch|present|propose|recommend|outline|define|clarify|confirm|verify)\b/i;

/** Deterministic intent classification — no AI call needed for common patterns */
export function classifyIntent(
  founderMessage: string,
  recentMessages: Array<{ role: "founder" | "agent"; content: string }>,
): QuinnReasoningIntent {
  const lower = founderMessage.toLowerCase().trim();

  // Memory operations take priority over everything
  if (
    /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)\s/i.test(lower) ||
    /^(?:please\s+)?(?:forget|clear|remove)\s/i.test(lower)
  ) {
    return "memory_retrieval";
  }

  // V11.2: Approval-queue queries must reach the approval path even when phrased
  // imperatively ("check/review the approval queue", "any pending approvals?").
  // Without this, the action-verb gate below ("check", "review", …) would divert
  // them to objective_execution and the empty-queue operational-review
  // interception would never run. approval_request is already the highest pattern
  // priority; this restores that priority for queue queries that lead with a verb.
  if (
    /\b(?:approval queue|pending approvals?|any (?:pending )?approvals?|approvals?\s+(?:to|i\s+need\s+to)\s+(?:sign\s+off|approve|review)|anything\s+to\s+(?:approve|sign\s+off))\b/i.test(
      lower,
    )
  ) {
    return "approval_request";
  }

  // V6.7: bare affirmations ("yes", "do it", "go ahead") apply to the active
  // discussion — but ONLY when there is a real prior objective to act on. A
  // first-message "Yes" with no context must NOT launch a nonsensical objective;
  // it falls through to general_conversation → clarify. extractActiveObjective
  // skips the current affirmation and walks history for the last real directive.
  if (isAffirmation(founderMessage) && extractActiveObjective(recentMessages)) {
    return "objective_execution";
  }

  // Status queries: short questions about current state (not action requests)
  if (
    /^(?:how(?:'s| is| are)|where do we|what'?s (?:happening|going on|the status|the state|our|the team)|catch me up|brief me|update me|status|overview|morning briefing|daily briefing|team status)\b/i.test(lower)
  ) {
    return "current_status";
  }

  // V6.7: terse directives ("release", "ship", "fix critical issues") that expand
  // to a concrete objective → execute. Protected categories are no longer routed
  // to approval here; the route gates only the final irreversible step.
  if (inferObjectiveText(founderMessage) !== founderMessage.trim()) {
    return "objective_execution";
  }

  // V6.7: a protected directive ("deploy to production now", "delete the table")
  // is still an objective — execute it so the route can launch the prep and gate
  // the irreversible step. Questions are not actions and fall through.
  if (
    !lower.endsWith("?") &&
    detectProtectedCategory(founderMessage) &&
    !/^(?:what|how|why|when|who|where|can|should|could|would|is|are|do|does|did)\b/i.test(lower)
  ) {
    return "objective_execution";
  }

  // V6.3 Executive Initiative gate: imperative action-verb sentences → always execute
  // Must be > 4 words so single-word or two-word messages don't get caught here
  if (ACTION_VERB_FIRST_RE.test(lower) && lower.split(/\s+/).length > 4) {
    return "objective_execution";
  }

  // Explicit command (imperative verb + subject) from command parser → execution
  const command = parseExecutiveCommand(founderMessage);
  if (command.isCommand) {
    return "objective_execution";
  }

  // Pattern match each category in priority order
  const priorities: QuinnReasoningIntent[] = [
    "approval_request",
    "memory_retrieval",
    "current_status",
    "executive_coordination",
    "decision_support",
    "objective_execution",
    "objective_planning",
    "general_conversation",
  ];

  for (const intent of priorities) {
    const patterns = INTENT_PATTERNS[intent];
    if (patterns.some((p) => lower.includes(p))) {
      return intent;
    }
  }

  // Context-sensitive: if the previous agent message asked a clarifying question,
  // and this reply looks like an answer with substance, treat as execution
  const lastAgent = [...recentMessages].reverse().find((m) => m.role === "agent");
  if (lastAgent?.content.endsWith("?") && lower.split(/\s+/).length > 3) {
    return "objective_execution";
  }

  return "general_conversation";
}

// ─── AI access via Intelligence Layer ────────────────────────────────────────
//
// Quinn never imports OpenAI directly. All AI calls go through the provider
// factory, which handles provider selection, retry, and mock fallback.

/** Call the AI provider for Quinn's reasoning step. Returns parsed JSON or null. */
async function callChiefAI(
  system: string,
  user: string,
  executiveId: string,
  objectiveId?: string,
): Promise<Record<string, unknown> | null> {
  const request: AIRequest = {
    task: "conversation",
    modelHint: "standard",
    systemPrompt: system,
    userContent: user,
    executiveId,
    executiveName: "Quinn Harlow",
    executiveRole: "chief_of_staff",
    objectiveId,
    maxTokens: 900,
    responseFormat: "json",
  };

  try {
    const response = await completeWithFallback(request);

    // Record usage to the AI usage log (fire-and-forget, never block response)
    void db
      .insert(aiUsageLogTable)
      .values({
        id: randomUUID(),
        executiveId: executiveId || null,
        objectiveId: objectiveId ?? null,
        provider: response.provider,
        model: response.model,
        task: "conversation",
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        estimatedCostUsd: response.usage.estimatedCostUsd,
        latencyMs: response.usage.latencyMs,
        success: true,
        fromFallback: response.fromFallback,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "Quinn brain: failed to record AI usage");
      });

    if (response.fromFallback || !response.parsed) return null;
    return response.parsed;
  } catch (err) {
    logger.warn({ err }, "Quinn brain: AI call failed — using deterministic fallback");
    return null;
  }
}

// ─── Step 4 deterministic fallback — intent-specific responses ────────────────

function deterministicConverse(ctx: ConversationContext): ConverseResult {
  const {
    founderMessage,
    classifiedIntent,
    executiveAwareness,
    recentObjectives,
    pendingApprovals,
    memoryItems,
    latestReports,
    activeTasks,
    allObjectives,
    approvalHistory,
  } = ctx;
  const lower = founderMessage.toLowerCase().trim();
  const command = parseExecutiveCommand(founderMessage);

  // ── Memory directives ─────────────────────────────────────────────────────
  const rememberMatch =
    lower.match(/^(?:please\s+)?remember\s+(?:that\s+)?(.+)/) ??
    lower.match(
      /^(?:please\s+)?(?:note|keep in mind|don'?t forget)\s+(?:that\s+)?(.+)/,
    );
  if (rememberMatch) {
    const content = rememberMatch[1]?.trim() ?? founderMessage;
    const isPreference =
      /\b(don'?t|never|always|prefer|avoid|make sure|ensure|only)\b/.test(
        content.toLowerCase(),
      );
    return {
      intent: "answer",
      reasoningIntent: "memory_retrieval",
      reply: `Noted — I've saved that to memory and will carry it into every future conversation: "${content.length > 60 ? `${content.slice(0, 60)}…` : content}".`,
      memoryOp: {
        action: "remember",
        kind: isPreference ? "preference" : "fact",
        content,
      },
      sourcesUsed: ["memory"],
    };
  }

  // V6.7: "delete" is a protected DATA action, not a memory verb — it must NOT be
  // swallowed here (otherwise "delete all test users" becomes a memory op instead
  // of a gated objective). Memory-forget keeps forget/remove/clear only.
  const forgetMatch =
    lower.match(/^(?:please\s+)?forget\s+(?:about\s+|that\s+)?(.+)/) ??
    lower.match(
      /^(?:please\s+)?(?:remove|clear)\s+(?:from\s+(?:your\s+)?memory\s+)?(.+)(?:\s+from\s+(?:your\s+)?memory)?/,
    );
  if (forgetMatch) {
    const content = forgetMatch[1]?.trim() ?? founderMessage;
    return {
      intent: "answer",
      reasoningIntent: "memory_retrieval",
      reply: `Got it — I'll clear that from my memory: "${content.length > 60 ? `${content.slice(0, 60)}…` : content}". It won't influence future responses.`,
      memoryOp: { action: "forget", content },
      sourcesUsed: ["memory"],
    };
  }

  // ── V6.7 affirmation: apply "yes / do it / go ahead" to the active discussion ──
  if (isAffirmation(founderMessage) && ctx.recentMessages.length > 0) {
    const activeObjective = extractActiveObjective(ctx.recentMessages);
    if (activeObjective) {
      const protectedConf = detectProtectedCategory(activeObjective);
      const available = executiveAwareness.filter(
        (e) => ["idle", "standby", "active", "planning"].includes(e.status),
      );
      const rosterLine =
        available.length > 0
          ? available.slice(0, 3).map((e) => `**${e.name}**`).join(", ")
          : "the executive team";
      return {
        intent: "launch",
        reasoningIntent: "objective_execution",
        objectiveText: activeObjective,
        needsApprovalCategory: protectedConf ?? undefined,
        reply:
          `On it — moving forward with: ${activeObjective}. I'm mobilizing ${rosterLine} to execute.` +
          (protectedConf
            ? ` The team will complete all prep autonomously; the ${protectedConf} step will pause for your final approval.`
            : ` I'll coordinate everything and deliver one consolidated briefing when the team reports in.`),
        sourcesUsed: ["awareness", "conversation"],
      };
    }
  }

  // ── V6.7 safety: protected categories no longer refuse — Quinn launches the ──
  // safe prep work and flags the irreversible step for approval. The route turns
  // needsApprovalCategory into a real approval gate so the objective parks at
  // needs_approval before the protected action runs.
  const protected_ = detectProtectedCategory(founderMessage);
  if (protected_ && classifiedIntent === "objective_execution") {
    const objectiveText = inferObjectiveText(founderMessage);
    const available = executiveAwareness.filter(
      (e) => ["idle", "standby", "active", "planning"].includes(e.status),
    );
    const rosterLine =
      available.length > 0
        ? available.slice(0, 3).map((e) => `**${e.name}**`).join(", ")
        : "the executive team";
    return {
      intent: "launch",
      reasoningIntent: "objective_execution",
      objectiveText,
      needsApprovalCategory: protected_,
      reply:
        `Launching the prep now: ${objectiveText}. I'm mobilizing ${rosterLine} to handle planning, analysis, and inspection autonomously. ` +
        `The actual ${protected_} step is the only thing I'll hold for your explicit approval — everything up to that point proceeds without waiting.`,
      sourcesUsed: ["awareness", "safety_guardrail"],
    };
  }

  // ── Dispatch by classified intent ─────────────────────────────────────────

  switch (classifiedIntent) {
    case "memory_retrieval": {
      const memLines =
        memoryItems.length > 0
          ? memoryItems
              .slice(0, 6)
              .map((m) => `• [${m.kind}] ${m.content}`)
              .join("\n")
          : null;
      const objHistory =
        allObjectives && allObjectives.length > 0
          ? allObjectives
              .slice(0, 5)
              .map((o) => `• [${o.status}] ${o.title}`)
              .join("\n")
          : null;
      if (!memLines && !objHistory) {
        return {
          intent: "clarify",
          reasoningIntent: "memory_retrieval",
          reply:
            `I don't have any prior context saved about that yet. ` +
            `Once we run a few objectives or you tell me things to remember, I'll be able to recall them here.`,
          sourcesUsed: ["memory", "objective_history"],
        };
      }
      const sections: string[] = [];
      if (memLines) sections.push(`Memory:\n${memLines}`);
      if (objHistory) sections.push(`Past objectives:\n${objHistory}`);
      return {
        intent: "answer",
        reasoningIntent: "memory_retrieval",
        reply: `Here's what I have on record:\n\n${sections.join("\n\n")}`,
        sourcesUsed: ["memory", "objective_history"],
      };
    }

    case "current_status": {
      const busy = executiveAwareness.filter((e) =>
        ["active", "planning", "collaborating"].includes(e.status),
      );
      const blocked = executiveAwareness.filter(
        (e) => e.status === "needs_approval",
      );
      const idle = executiveAwareness.filter((e) =>
        ["idle", "standby"].includes(e.status),
      );
      const sourcesUsed = ["awareness"];

      let reply = "";
      if (busy.length > 0) {
        reply += `**In motion:** ${busy.map((e) => `${e.name}${e.statusMessage ? ` (${e.statusMessage})` : ""}`).join(", ")}.\n`;
      } else {
        reply += `The team is at rest — ${idle.length} executive${idle.length !== 1 ? "s" : ""} available immediately.\n`;
      }
      if (blocked.length > 0) {
        reply += `**Blocked:** ${blocked.map((e) => e.name).join(", ")} need${blocked.length === 1 ? "s" : ""} your approval to proceed.\n`;
      }
      if (pendingApprovals.length > 0) {
        reply += `**Pending approvals:** ${pendingApprovals.length} item${pendingApprovals.length !== 1 ? "s" : ""} waiting — top: "${pendingApprovals[0]?.title}".`;
        sourcesUsed.push("approvals");
      }
      if (latestReports && latestReports.length > 0) {
        const attentionNeeded = latestReports.filter(
          (r) => r.status !== "healthy",
        );
        if (attentionNeeded.length > 0) {
          reply += `\n**Areas needing attention:** ${attentionNeeded.map((r) => `${r.executiveName} (${r.status})`).join(", ")}.`;
        }
        sourcesUsed.push("reports");
      }
      if (recentObjectives.length > 0) {
        const inProgress = recentObjectives.filter(
          (o) => o.status === "in_progress",
        );
        if (inProgress.length > 0) {
          reply += `\n**Active objectives:** ${inProgress.length} running.`;
          sourcesUsed.push("objectives");
        }
      }
      reply += `\n\nWant me to run a deeper sweep on any specific area?`;
      return { intent: "answer", reasoningIntent: "current_status", reply, sourcesUsed };
    }

    case "objective_planning": {
      const workload = executiveAwareness.map(
        (e) => `${e.name}: ${e.openTaskCount} task${e.openTaskCount !== 1 ? "s" : ""}, status ${e.status}`,
      );
      const memContext =
        memoryItems.length > 0
          ? `\nFounder priorities on record: ${memoryItems.filter((m) => m.kind === "preference" || m.kind === "directive").map((m) => m.content).slice(0, 3).join("; ")}.`
          : "";
      const sourcesUsed = ["awareness", "memory"];
      if (latestReports) sourcesUsed.push("reports");
      return {
        intent: "answer",
        reasoningIntent: "objective_planning",
        reply:
          `Here's where the team stands before we plan:\n\n` +
          `**Current workload:**\n${workload.join("\n")}\n` +
          memContext +
          `\n\nTell me the specific goal and I'll decompose it across the right executives, sequence dependencies, and give you a clear execution plan before anything kicks off.`,
        sourcesUsed,
      };
    }

    case "objective_execution": {
      const available = executiveAwareness.filter(
        (e) => e.status === "idle" || e.status === "standby" || e.status === "active" || e.status === "planning",
      );
      const busy = executiveAwareness.filter((e) => e.status === "active" || e.status === "planning");

      // Build a named exec roster for the briefing
      const rosterLines =
        available.length > 0
          ? available
              .slice(0, 4)
              .map((e) => {
                const roleLabel = e.role
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase());
                const stateNote = e.status === "active" || e.status === "planning"
                  ? " (already in motion)"
                  : "";
                return `**${e.name}** (${roleLabel})${stateNote}`;
              })
              .join(", ")
          : "the full executive team";

      const sequenceNote =
        busy.length > 0
          ? ` ${busy.map((e) => e.name).join(" and ")} will lead the initial sweep; others sequence in as findings emerge.`
          : " I'll sequence dependencies as the sweep unfolds.";

      const historyLine =
        recentObjectives.length > 0
          ? ` This builds on ${recentObjectives.length} prior objective${recentObjectives.length !== 1 ? "s" : ""}.`
          : "";

      return {
        intent: "launch",
        reasoningIntent: "objective_execution",
        objectiveText: inferObjectiveText(founderMessage),
        reply:
          `Launching this now. I'm mobilizing ${rosterLines}.${sequenceNote}${historyLine} ` +
          `I'll handle all cross-functional coordination and deliver one consolidated briefing once the team reports in.`,
        sourcesUsed: ["awareness", "objectives"],
      };
    }

    case "executive_coordination": {
      const execLines = executiveAwareness.map(
        (e) =>
          `• **${e.name}** (${e.role}): ${e.status}${e.statusMessage ? ` — ${e.statusMessage}` : ""}, ${e.openTaskCount} open task${e.openTaskCount !== 1 ? "s" : ""}`,
      );
      const taskLines =
        activeTasks && activeTasks.length > 0
          ? activeTasks
              .slice(0, 5)
              .map((t) => `• [${t.priority.toUpperCase()}] ${t.title} — ${t.executiveName} (${t.status})`)
              .join("\n")
          : null;
      const sourcesUsed = ["awareness"];
      if (taskLines) sourcesUsed.push("tasks");
      let reply = `**Executive team status:**\n${execLines.join("\n")}`;
      if (taskLines) reply += `\n\n**Top active tasks:**\n${taskLines}`;
      reply += `\n\nWant me to coordinate any specific interaction or reassign work?`;
      return { intent: "answer", reasoningIntent: "executive_coordination", reply, sourcesUsed };
    }

    case "decision_support": {
      const memContext =
        memoryItems.filter((m) => m.kind === "preference" || m.kind === "directive").length > 0
          ? `Your stated preferences: ${memoryItems.filter((m) => m.kind === "preference" || m.kind === "directive").map((m) => m.content).slice(0, 3).join("; ")}.`
          : "";
      const historyContext =
        approvalHistory && approvalHistory.length > 0
          ? `Previous decisions: ${approvalHistory.slice(0, 3).map((a) => `"${a.title}" → ${a.status}`).join("; ")}.`
          : "";
      const reportContext =
        latestReports && latestReports.length > 0
          ? `Current signals: ${latestReports.map((r) => `${r.executiveName} (${r.status})`).join(", ")}.`
          : "";
      const sourcesUsed: string[] = ["memory"];
      if (approvalHistory) sourcesUsed.push("approval_history");
      if (latestReports) sourcesUsed.push("reports");
      return {
        intent: "answer",
        reasoningIntent: "decision_support",
        reply:
          `To support this decision, here's what I can draw on:\n\n` +
          [memContext, historyContext, reportContext].filter(Boolean).join("\n") +
          `\n\nGive me the specific options or question and I'll frame a recommendation with clear reasoning.`,
        sourcesUsed,
      };
    }

    case "approval_request": {
      if (pendingApprovals.length > 0) {
        const items = pendingApprovals
          .slice(0, 3)
          .map((a, i) => `${i + 1}. "${a.title}"${a.detail ? ` — ${a.detail.slice(0, 80)}` : ""}`)
          .join("\n");
        return {
          intent: "answer",
          reasoningIntent: "approval_request",
          reply: `You have ${pendingApprovals.length} pending approval${pendingApprovals.length !== 1 ? "s" : ""}:\n\n${items}\n\nHead to the Objectives page to approve or reject each one.`,
          sourcesUsed: ["approvals"],
        };
      }
      return {
        intent: "answer",
        reasoningIntent: "approval_request",
        reply: `No pending approvals right now — the queue is clear. Anything you'd like me to prepare?`,
        sourcesUsed: ["approvals"],
      };
    }

    default: {
      // general_conversation — V6.3: bias toward action over clarification
      // If the message has any detectable substance, launch rather than ask.
      const lowerMsg = founderMessage.toLowerCase().trim();
      const wordCount = lowerMsg.split(/\s+/).length;
      const isGreeting = /^(?:hi|hello|hey|good morning|good afternoon|good evening|howdy|sup|yo|what'?s up)\b/i.test(lowerMsg) && wordCount <= 4;
      const hasActionSignal = ACTION_VERB_FIRST_RE.test(lowerMsg) || command.isCommand;
      const hasSubstance = wordCount > 6;

      if (isGreeting) {
        const activeExecs = executiveAwareness.filter((e) => e.status === "active" || e.status === "planning");
        const pendingCount = pendingApprovals.length;
        return {
          intent: "answer",
          reasoningIntent: "general_conversation",
          reply:
            `${activeExecs.length > 0 ? `${activeExecs.map((e) => e.name).join(" and ")} ${activeExecs.length === 1 ? "is" : "are"} active right now. ` : "Team is at rest. "}` +
            `${pendingCount > 0 ? `${pendingCount} approval${pendingCount !== 1 ? "s" : ""} waiting for you. ` : ""}` +
            `What would you like kicked off?`,
          sourcesUsed: ["awareness", "approvals"],
        };
      }

      if (hasActionSignal || hasSubstance) {
        // Enough signal to act — launch rather than ask
        const available = executiveAwareness.filter(
          (e) => e.status === "idle" || e.status === "standby" || e.status === "active" || e.status === "planning",
        );
        const rosterLine =
          available.length > 0
            ? available.slice(0, 3).map((e) => `**${e.name}**`).join(", ")
            : "the executive team";
        return {
          intent: "launch",
          reasoningIntent: "objective_execution",
          objectiveText: inferObjectiveText(founderMessage),
          reply:
            `Understood — launching this. I'm mobilizing ${rosterLine} to execute. ` +
            `I'll coordinate everything and deliver one consolidated briefing when the team reports in.`,
          sourcesUsed: ["awareness"],
        };
      }

      // True last resort: message is too short/ambiguous to act on
      return {
        intent: "clarify",
        reasoningIntent: "general_conversation",
        reply:
          `I can kick something off immediately — what's the objective? Give me a direction and I'll mobilize the team.`,
        sourcesUsed: [],
      };
    }
  }
}

// ─── Step 3 system prompt ─────────────────────────────────────────────────────

const QUINN_SYSTEM_PROMPT = `You are Quinn Harlow, Chief of Staff at VYBE LIVE — a mobile-first POV livestreaming platform. You are the ONLY interface between the Founder and the executive team.

Your role: understand intent like a COO, mobilize the right people, and get work done. You infer what the Founder means from plain language and conversation context — you do NOT wait for rigid command phrasing or specific action verbs. You default toward action. You do not ask unnecessary questions.

━━━ PRIME DIRECTIVE — INFER INTENT, DEFAULT TOWARD ACTION ━━━

You are a Chief Operating Officer, not a command parser. Read the Founder the way a seasoned COO reads a CEO: extract the underlying goal and turn it into an objective, even from a single word or a casual aside.

• "Release" / "Ship it" → create the objective "Prepare VYBE LIVE for release", delegate the prep across executives, and ONLY gate the actual deploy/go-live step for approval.
• "Fix critical issues" → create a stability objective, assign the right executives, and return a briefing.
• A single word like "audit", "stabilize", "grow" → expand it into a real objective and launch.

When the Founder asks you to fix, improve, prepare, inspect, investigate, analyze, review, organize, plan, schedule, delegate, coordinate, or launch anything — you automatically:

1. Set intent = "launch"
2. Resolve the objective text (expand shorthand into a concrete objective)
3. Choose which executives are needed and sequence their work
4. Return an executive briefing

You only ask a clarifying question (intent = "clarify") when ALL of these are true:
  • The request is genuinely ambiguous with 2+ incompatible interpretations
  • No action can be taken without the missing information
  • The question you'd ask is directly blocking progress

When in doubt between "answer" and "launch" — choose "launch".
When in doubt between "clarify" and "launch" — choose "launch".

━━━ CONFIRMATIONS USE CONVERSATION HISTORY ━━━

When the Founder replies with a bare confirmation — "yes", "do it", "go ahead", "proceed", "sounds good", "make it happen" — it applies to the active discussion. Look back through the conversation history, identify the most recent objective or proposal under discussion, and ACT on it. Set intent = "launch" with that objective as objectiveText.

NEVER respond to a confirmation by asking "what's the objective?" or "what would you like me to do?" — the answer is in the history. Re-asking is a failure.

━━━ FOUNDER OPERATING PROFILE ━━━

When "FOUNDER OPERATING PROFILE" data appears in your context, you MUST:
1. Reference specific profile insights when making recommendations or planning
2. Include the observation count to show evidence, not assumption
3. Never contradict a high-confidence (★★★) insight without explaining why this case is an exception
4. Use this format: "I recommend X because your profile shows [insight] (observed N times)"

If no profile data is present, do not mention the profile. Only reference what is actually there.

━━━ FOUNDER DECISION MODEL — "WHAT WOULD THE FOUNDER CHOOSE?" ━━━

You don't just remember the Founder's preferences — you model how they DECIDE. Before you make ANY recommendation or take a judgment call on the Founder's behalf, silently ask yourself: "Based on everything I've observed, what would the Founder most likely choose here?"

Then gate on your confidence:
1. HIGH confidence — the decision model clearly points one way (strong, consistent evidence). ACT on it: recommend decisively and move, e.g. "I'd approve this — you consistently green-light high-impact infra calls."
2. MEDIUM confidence — lean toward the predicted choice but name the uncertainty.
3. LOW confidence (thin, conflicting, or no evidence) — do NOT assume. REQUEST CONFIRMATION: "I'm not yet confident how you'd weigh this — want me to proceed with X, or hold?"

When a "FOUNDER DECISION MODEL" block appears in your context, it already contains the predicted choice + confidence + the act/confirm gate for each pending decision. Follow it. Never fabricate a prediction — low confidence is the honest answer when the evidence isn't there, and asking is correct, not a failure. This model sharpens every time the Founder actually decides.

━━━ STEP 1 — INTENT CLASSIFICATION ━━━

Classify the Founder's message into exactly ONE of these categories:

• memory_retrieval   — "remember that X", "remind me", "what did we decide", "forget X"
• current_status     — "how's the team", "status update", "where do we stand", "brief me"
• objective_execution — FIX / IMPROVE / PREPARE / INSPECT / INVESTIGATE / ANALYZE / REVIEW / ORGANIZE / PLAN / LAUNCH anything. Also: audit, build, create, design, draft, research, test, validate, monitor, optimize, identify, map out, set up, configure, implement, develop, execute, run, start, kick off, check, find, figure out, get to the bottom of, make a plan, come up with — ANY action verb directing work.
• executive_coordination — asking who should handle something, which executive owns X, assignment/handoff questions
• decision_support   — "what do you recommend", "pros and cons", "help me decide", "what's your take"
• approval_request   — "approve", "sign off", "check the approval queue", "pending approvals"
• general_conversation — greeting only, or genuinely unclear intent with no action verb

RULE: If the message has an action verb pointing at work to be done, classify as objective_execution. Do not reclassify to general_conversation or clarify. Plan requests ARE execution requests.

━━━ STEP 2 — SOURCE SELECTION ━━━

memory_retrieval    → memory items, objective history, approval history, conversation history
current_status      → executive awareness, active objectives, latest reports, pending approvals
objective_execution → executive availability, recent objectives (for context), then launch
executive_coordination → executive awareness, active tasks
decision_support    → reports, memory (preferences), approval history
approval_request    → pending approvals only
general_conversation → memory, recent conversation

CRITICAL: Never cite the current report to answer a memory/history question. Never repeat the same project summary in consecutive messages.

━━━ STEP 3 — INTERNAL REASONING ━━━

Before writing the reply, think silently:
• What is the Founder actually asking?
• Is there any ambiguity that would genuinely block action? If not, launch.
• Which executives should own this? (Reference EXECUTIVE AWARENESS in context.)
• What is the right sequence — who goes first, who depends on whom?
• Am I about to ask an unnecessary question? If the request is clear enough to act on, act.

━━━ STEP 4 — RESPONSE RULES ━━━

• "answer" → grounded, specific, draws from correct sources only. No filler.
• "clarify" → LAST RESORT. One focused question only. No multiple-choice menus.
• "launch" → Executive briefing format (see below). Name the executives. Describe scope. Set expectations.
• "approval_required" → Name the risk category. Explain what will not proceed. Ask for confirmation.
• memory_retrieval responses: brief and warm (under 40 words for remember/forget ops).
• Never invent facts. Only use what is in the context provided.
• answer/clarify/approval_required: under 120 words. launch: up to 200 words — a real briefing deserves space.

━━━ LAUNCH REPLY FORMAT ━━━

When intent = "launch", your reply must:
1. Confirm the objective in one sentence (no hedging, no "I'll try")
2. Name which executives are being mobilized and their specific focus areas
3. Describe the execution sequence (who goes first, any dependencies)
4. State what the Founder will receive and approximately when ("Full consolidated briefing once the team reports in — typically within a few minutes.")

Example structure:
"Launching: [objective]. I'm mobilizing [Name] to [focus] and [Name] to [focus]. [Name] runs first and hands findings to [Name]. You'll receive a full consolidated briefing once both reports are in."

Use the EXECUTIVE AWARENESS section in the context to pick real names and roles.

━━━ AUTONOMY VS. APPROVAL — THE 5-STOP RULE ━━━

You act AUTONOMOUSLY (no founder approval) for everything reversible and internal:
planning, analysis, inspection, investigation, scheduling, delegation, executive
coordination, collaboration, memory updates, and report generation. Launch these freely.

You STOP for founder approval ONLY when an objective's final step lands in one of
these FIVE buckets:
  1. Deploy — going live / pushing to production
  2. Merge — merging code
  3. Delete — destroying data (delete/purge/wipe/drop)
  4. Money — spending, purchasing, charging, refunds, billing
  5. External services — emails, public posts/announcements, third-party API calls,
     outbound contact

CRITICAL: A protected bucket does NOT block objective creation. When the Founder says
"release", you still CREATE the objective and mobilize the team to do all the safe prep
(planning, analysis, inspection). You set intent = "launch", set objectiveText, AND set
needsApprovalCategory to the bucket. The system parks the objective at needs_approval
right before the irreversible step — the founder approves only that final action, never
the prep. Do NOT refuse, and do NOT use intent = "approval_required" for these — use
"launch" with needsApprovalCategory set.

If the message is a pure question (ends with "?") about a protected topic, just answer
it — questions are not actions.

━━━ MEMORY DIRECTIVES ━━━

Check FIRST before everything else:
• "remember that X", "note that X", "keep in mind X" → intent=answer, memoryOp={action:"remember", kind:"preference"|"fact", content:X}
• "forget about X", "clear X from memory" → intent=answer, memoryOp={action:"forget", content:X}
Memory replies must be under 40 words.

━━━ OUTPUT FORMAT (JSON only) ━━━

{
  "reasoningIntent": "<one of the 8 category names above>",
  "intent": "launch" | "answer" | "clarify" | "approval_required",
  "reply": "<your response — direct, confident, action-biased Chief of Staff tone>",
  "objectiveText": "<only when intent=launch — clean, expanded objective text for the orchestration engine>",
  "needsApprovalCategory": "<set this whenever the objective's final step lands in a protected bucket (deploy/merge/delete/money/external services) — typically alongside intent=launch so the prep runs but the irreversible step is gated>",
  "memoryOp": { "action": "remember"|"forget", "kind": "fact"|"preference"|"directive"|"context", "content": "<extracted content>" },
  "sourcesUsed": ["<list of source names you actually drew from>"]
}

Only include memoryOp when handling a memory directive. sourcesUsed should list only sources that actually informed the reply.`;

// ─── Step 2 context builder ───────────────────────────────────────────────────

function buildUserContent(ctx: ConversationContext): string {
  const { classifiedIntent } = ctx;

  // Core context (always included)
  const awarenessLines =
    ctx.executiveAwareness.length > 0
      ? ctx.executiveAwareness
          .map(
            (e) =>
              `  - ${e.name} (${e.role}): ${e.status}${e.statusMessage ? ` — "${e.statusMessage}"` : ""}, ${e.openTaskCount} open task${e.openTaskCount !== 1 ? "s" : ""}`,
          )
          .join("\n")
      : "  (no executives loaded)";

  const memoryLines =
    ctx.memoryItems.length > 0
      ? ctx.memoryItems
          .slice(0, 10)
          .map((m) => `  - [${m.kind}] ${m.content}`)
          .join("\n")
      : "  (no prior memory)";

  const recentConvo = ctx.recentMessages
    .slice(-8)
    .map(
      (m) =>
        `${m.role === "founder" ? "Founder" : "Quinn"}: ${m.content.slice(0, 200)}`,
    )
    .join("\n");

  const approvalsLine =
    ctx.pendingApprovals.length === 0
      ? "None pending."
      : `${ctx.pendingApprovals.length} pending — top: "${ctx.pendingApprovals[0]?.title ?? "unknown"}"`;

  const objectivesLines =
    ctx.recentObjectives.length > 0
      ? ctx.recentObjectives
          .slice(0, 6)
          .map((o) => `  - [${o.status.toUpperCase()}] ${o.title}`)
          .join("\n")
      : "  (none yet)";

  const sections: string[] = [
    `CLASSIFIED INTENT: ${classifiedIntent}`,
    `\nEXECUTIVE AWARENESS (live team state):\n${awarenessLines}`,
    `\nQUINN'S MEMORY:\n${memoryLines}`,
    `\nPENDING APPROVALS: ${approvalsLine}`,
    `\nRECENT OBJECTIVES:\n${objectivesLines}`,
  ];

  // Intent-specific context blocks
  if (ctx.latestReports && ctx.latestReports.length > 0) {
    const reportLines = ctx.latestReports
      .map(
        (r) =>
          `  - ${r.executiveName}: [${r.status.toUpperCase()}] ${r.headline}${r.topFinding ? ` | Top finding: ${r.topFinding}` : ""}`,
      )
      .join("\n");
    sections.push(`\nLATEST EXECUTIVE REPORTS:\n${reportLines}`);
  }

  if (ctx.activeTasks && ctx.activeTasks.length > 0) {
    const taskLines = ctx.activeTasks
      .slice(0, 8)
      .map(
        (t) =>
          `  - [${t.priority.toUpperCase()}] ${t.title} (${t.executiveName}, ${t.status})`,
      )
      .join("\n");
    sections.push(`\nACTIVE TASKS:\n${taskLines}`);
  }

  if (ctx.approvalHistory && ctx.approvalHistory.length > 0) {
    const histLines = ctx.approvalHistory
      .slice(0, 5)
      .map((a) => `  - "${a.title}" → ${a.status}${a.decidedAt ? ` (${a.decidedAt.slice(0, 10)})` : ""}`)
      .join("\n");
    sections.push(`\nAPPROVAL HISTORY:\n${histLines}`);
  }

  if (ctx.allObjectives && ctx.allObjectives.length > 0) {
    const allObjLines = ctx.allObjectives
      .slice(0, 10)
      .map((o) => `  - [${o.status.toUpperCase()}] ${o.title}${o.request ? ` — "${o.request.slice(0, 80)}"` : ""}`)
      .join("\n");
    sections.push(`\nFULL OBJECTIVE HISTORY:\n${allObjLines}`);
  }

  // V6.5: Founder Operating Profile — inject when available (medium+ confidence only)
  if (ctx.founderProfile) {
    sections.push(`\n${ctx.founderProfile}`);
  }

  // V6.8: Founder Decision Model — predicted choices + confidence gate
  if (ctx.decisionModel) {
    sections.push(`\n${ctx.decisionModel}`);
  }

  // ENGINEERING EXPANSION: Specialist bench — Quinn knows which specialists
  // exist, who owns them, and that they are routed through owning executives.
  sections.push(`\n${getSpecialistBenchBrief()}`);

  // MARKETING AUTONOMY: Quinn continuously monitors Dario's learning-based
  // publishing system — mode, learning progress, and suspension history.
  if (ctx.marketingBrief) {
    sections.push(`\n${ctx.marketingBrief}`);
  }

  // AGENT ZERO: Quinn's execution layer. Quinn dispatches jobs to Agent Zero
  // (never the other way around) and monitors queue health here.
  if (ctx.agentZeroBrief) {
    sections.push(`\n${ctx.agentZeroBrief}`);
  }

  sections.push(`\nRECENT CONVERSATION:\n${recentConvo || "(no prior messages)"}`);
  sections.push(`\nFOUNDER'S MESSAGE:\n${ctx.founderMessage}`);

  return sections.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function converseAsChief(
  ctx: ConversationContext,
): Promise<ConverseResult> {
  const result = await computeConverseResult(ctx);

  // V9: run Quinn's six-question reasoning pass over the decision, persist it,
  // and attach the trace so the chat surface can expose how she reasoned.
  const { steps, coordinated, coordinationNote } = buildReasoningSteps(ctx, result);
  const reasoning = await recordReasoning({
    founderMessage: ctx.founderMessage,
    steps,
    reply: result.reply,
    reasoningIntent: result.reasoningIntent,
    coordinated,
    coordinationNote,
  });

  return { ...result, reasoning };
}

async function computeConverseResult(
  ctx: ConversationContext,
): Promise<ConverseResult> {
  // V11.2: Remove the passive idle state. When the founder asks about approvals
  // and the queue is empty, Quinn must not wait — she runs a full operational
  // review (autonomy cycle, engineering refresh, blocker retries, workload
  // rebalancing) and reports the outcome. This is intercepted BEFORE the AI path
  // so the old "queue is clear, anything to prepare?" reply can never surface.
  if (ctx.classifiedIntent === "approval_request" && ctx.pendingApprovals.length === 0) {
    const review = await runOperationalReview();
    if (review.ran) {
      return {
        intent: "answer",
        reasoningIntent: "approval_request",
        reply: review.summary,
        sourcesUsed: ["approvals", "autonomy", "engineering", "blockers"],
      };
    }
    // Genuinely nothing to do (autonomy disabled, no projects, or all clear) —
    // this is the ONLY path where Quinn asks the founder what to prepare.
    const idleReply =
      review.idleReason === "autonomy_disabled"
        ? `Approval queue is clear. Autonomy is paused, so I'm holding for your direction — what would you like me to prepare?`
        : review.idleReason === "no_projects"
          ? `Approval queue is clear, and there are no active projects yet. What would you like me to prepare?`
          : `Approval queue is clear and every monitored system is steady — no launch blockers, no pending work, engineering and launch readiness look healthy. What would you like me to prepare?`;
    return {
      intent: "answer",
      reasoningIntent: "approval_request",
      reply: idleReply,
      sourcesUsed: ["approvals", "autonomy", "engineering", "blockers"],
    };
  }

  const userContent = buildUserContent(ctx);
  const raw = await callChiefAI(
    QUINN_SYSTEM_PROMPT,
    userContent,
    ctx.executiveId,
    ctx.objectiveId,
  );

  if (raw) {
    const intent =
      typeof raw.intent === "string" &&
      (["launch", "answer", "clarify", "approval_required"] as const).includes(
        raw.intent as QuinnIntent,
      )
        ? (raw.intent as QuinnIntent)
        : null;
    const reply =
      typeof raw.reply === "string" && raw.reply.trim().length > 0
        ? raw.reply
        : null;

    if (intent && reply) {
      const validReasoningIntents: QuinnReasoningIntent[] = [
        "memory_retrieval", "current_status", "objective_planning",
        "objective_execution", "executive_coordination", "decision_support",
        "approval_request", "general_conversation",
      ];
      const reasoningIntent: QuinnReasoningIntent =
        typeof raw.reasoningIntent === "string" &&
        validReasoningIntents.includes(raw.reasoningIntent as QuinnReasoningIntent)
          ? (raw.reasoningIntent as QuinnReasoningIntent)
          : ctx.classifiedIntent;

      const sourcesUsed: string[] = Array.isArray(raw.sourcesUsed)
        ? (raw.sourcesUsed as unknown[]).filter((s): s is string => typeof s === "string")
        : [];

      // Parse memoryOp
      let memoryOp: MemoryOp | undefined;
      if (
        raw.memoryOp &&
        typeof raw.memoryOp === "object" &&
        !Array.isArray(raw.memoryOp)
      ) {
        const op = raw.memoryOp as Record<string, unknown>;
        const action =
          op.action === "remember" || op.action === "forget" ? op.action : null;
        const content =
          typeof op.content === "string" && op.content.trim()
            ? op.content.trim()
            : null;
        if (action && content) {
          const rawKind = op.kind;
          const kind: MemoryOp["kind"] =
            rawKind === "fact" ||
            rawKind === "preference" ||
            rawKind === "directive" ||
            rawKind === "context"
              ? rawKind
              : "fact";
          memoryOp = { action, kind, content };
        }
      }

      return {
        intent,
        reasoningIntent,
        reply,
        objectiveText:
          intent === "launch" &&
          typeof raw.objectiveText === "string" &&
          raw.objectiveText.trim()
            ? raw.objectiveText
            : undefined,
        // V6.7: preserve needsApprovalCategory for BOTH launch and
        // approval_required — the new design sets it alongside intent="launch"
        // so the prep runs while the route gates the irreversible step.
        needsApprovalCategory:
          (intent === "launch" || intent === "approval_required") &&
          typeof raw.needsApprovalCategory === "string" &&
          raw.needsApprovalCategory.trim()
            ? raw.needsApprovalCategory
            : undefined,
        memoryOp,
        sourcesUsed,
      };
    }
  }

  return deterministicConverse(ctx);
}
