// ─── Quinn's Reasoning Pass (Mission Control V9) ──────────────────────────────
// Before Quinn answers the Founder she runs an explicit six-question reasoning
// pass. Each pass is persisted so the chat surface can expose *how* she arrived
// at her reply — and whether she chose to coordinate the team autonomously —
// rather than hiding the deliberation.
//
// The pass is deterministic: it reads the conversation context and the converse
// result and narrates the decision. It never blocks the reply (best-effort
// persistence) and works with no live LLM.

import { db, chiefReasoningTable, type ChiefReasoningRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import type { ConversationContext, ConverseResult } from "./chiefConversation.js";

export type ReasoningStep = { question: string; answer: string };

export type QuinnReasoning = {
  id: string;
  founderMessage: string;
  steps: ReasoningStep[];
  reply: string;
  reasoningIntent: string;
  coordinated: boolean;
  coordinationNote: string | null;
  createdAt: Date;
};

const truncate = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

const availableExecs = (ctx: ConversationContext) =>
  ctx.executiveAwareness.filter((e) =>
    ["idle", "standby", "active", "planning"].includes(e.status),
  );

// Build the six-question reasoning trace from the context + result.
export function buildReasoningSteps(
  ctx: ConversationContext,
  result: ConverseResult,
): { steps: ReasoningStep[]; coordinated: boolean; coordinationNote: string | null } {
  const available = availableExecs(ctx);
  const roster = available.slice(0, 3).map((e) => e.name);
  const rosterLine = roster.length ? roster.join(", ") : "the executive team";

  // Q1 — what is being asked
  const q1: ReasoningStep = {
    question: "What is the Founder actually asking for?",
    answer: `This reads as ${result.reasoningIntent.replace(/_/g, " ")}: "${truncate(
      ctx.founderMessage,
    )}".`,
  };

  // Q2 — what do I already know
  const memCount = ctx.memoryItems.length;
  const objContext = ctx.recentObjectives[0];
  const q2: ReasoningStep = {
    question: "What do I already know that's relevant?",
    answer:
      memCount > 0
        ? `${memCount} stored memory item(s) bear on this${
            objContext ? `; the most recent objective in play is "${objContext.title}" (${objContext.status})` : ""
          }.`
        : objContext
          ? `No stored memory yet, but "${objContext.title}" (${objContext.status}) is the most relevant active objective.`
          : "Nothing in memory or active objectives bears directly on this yet.",
  };

  // Q3 — who should be involved
  const q3: ReasoningStep = {
    question: "Which executives should be involved?",
    answer:
      result.intent === "launch"
        ? `Mobilizing ${rosterLine} to lead the work.`
        : `${rosterLine} ${roster.length === 1 ? "is" : "are"} available if this turns into action.`,
  };

  // Q4 — risk
  const q4: ReasoningStep = {
    question: "What's the risk, and what could go wrong?",
    answer: result.needsApprovalCategory
      ? `The "${result.needsApprovalCategory}" step is irreversible — prep can run safely, but that step must wait for your sign-off.`
      : ctx.pendingApprovals.length > 0
        ? `${ctx.pendingApprovals.length} approval(s) are already pending; I'll avoid stacking conflicting work.`
        : "Low risk — this is safe prep/analysis work the team can own end to end.",
  };

  // Q5 — act vs ask
  const q5: ReasoningStep = {
    question: "Do I act autonomously, or ask the Founder first?",
    answer:
      result.intent === "launch"
        ? result.needsApprovalCategory
          ? `Act now on the prep autonomously; pause the ${result.needsApprovalCategory} step for your approval.`
          : "Act autonomously and deliver one consolidated briefing — no sign-off needed for prep."
        : result.intent === "approval_required"
          ? "Hold for your explicit approval before anything executes."
          : result.intent === "clarify"
            ? "Ask one clarifying question before committing the team."
            : "Answer directly — no team mobilization required.",
  };

  // Q6 — decision
  const q6: ReasoningStep = {
    question: "What is my decision and next step?",
    answer:
      result.intent === "launch" && result.objectiveText
        ? `Launch: ${truncate(result.objectiveText)} — ${rosterLine} on it now.`
        : `${result.intent === "answer" ? "Respond" : result.intent === "clarify" ? "Clarify" : "Hold"}: ${truncate(
            result.reply,
            120,
          )}`,
  };

  const coordinated = result.intent === "launch";
  const coordinationNote = coordinated
    ? `Coordinated ${rosterLine} on "${truncate(result.objectiveText ?? ctx.founderMessage, 70)}"${
        result.needsApprovalCategory
          ? ` — gating the ${result.needsApprovalCategory} step for approval.`
          : " — running prep without requiring sign-off."
      }`
    : null;

  return { steps: [q1, q2, q3, q4, q5, q6], coordinated, coordinationNote };
}

// Persist a reasoning pass (best-effort) and return the structured trace.
export async function recordReasoning(input: {
  founderMessage: string;
  steps: ReasoningStep[];
  reply: string;
  reasoningIntent: string;
  coordinated: boolean;
  coordinationNote: string | null;
}): Promise<QuinnReasoning> {
  const id = randomUUID();
  const createdAt = new Date();
  try {
    await db.insert(chiefReasoningTable).values({
      id,
      founderMessage: input.founderMessage,
      steps: input.steps,
      reply: input.reply,
      reasoningIntent: input.reasoningIntent,
      coordinated: input.coordinated,
      coordinationNote: input.coordinationNote,
      createdAt,
    });
  } catch (err) {
    logger.warn({ err }, "chiefReasoning: failed to persist reasoning pass");
  }
  return { id, createdAt, ...input };
}

function toReasoning(row: ChiefReasoningRow): QuinnReasoning {
  return {
    id: row.id,
    founderMessage: row.founderMessage,
    steps: row.steps,
    reply: row.reply,
    reasoningIntent: row.reasoningIntent ?? "general_conversation",
    coordinated: row.coordinated,
    coordinationNote: row.coordinationNote,
    createdAt: row.createdAt,
  };
}

export async function getRecentReasoning(limit = 20): Promise<QuinnReasoning[]> {
  const rows = await db
    .select()
    .from(chiefReasoningTable)
    .orderBy(desc(chiefReasoningTable.createdAt))
    .limit(limit);
  return rows.map(toReasoning);
}

export async function getReasoningById(id: string): Promise<QuinnReasoning | null> {
  const [row] = await db
    .select()
    .from(chiefReasoningTable)
    .where(eq(chiefReasoningTable.id, id))
    .limit(1);
  return row ? toReasoning(row) : null;
}

export async function getReasoningCount(): Promise<number> {
  const rows = await db.select({ id: chiefReasoningTable.id }).from(chiefReasoningTable);
  return rows.length;
}
