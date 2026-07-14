// ─── AI Executive service (placeholder) ───────────────────────────────────────
// Mission Control's executives currently produce deterministic, persona-flavored
// placeholder output. This module is the single seam where a real LLM gets wired
// in later: replace the bodies of `generateExecutiveReply` and
// `generateDailyBriefing` with calls to an AI provider (the rest of the app only
// depends on these signatures, not on how the text is produced).

import type { AiExecutive, AgentTaskRow } from "@workspace/db";

export type ExecutiveReplyContext = {
  executive: AiExecutive;
  founderMessage: string;
  recentMessages?: { role: "founder" | "agent"; content: string }[];
  openTasks?: { title: string; status: string; priority: string }[];
  /** The executive's latest real project-awareness report, if one exists. */
  latestReport?: {
    status: string;
    headline: string;
    topFinding?: string;
  };
};

const ROLE_VOICE: Record<string, { lead: string; closer: string }> = {
  cto: {
    lead: "From an architecture standpoint",
    closer: "I'll keep the system resilient and ship-ready.",
  },
  qa_director: {
    lead: "Quality-wise",
    closer: "Nothing reaches production until it clears the gate.",
  },
  release_manager: {
    lead: "On the release front",
    closer: "I'll keep the train on schedule and the rollback path clean.",
  },
  product_manager: {
    lead: "From a product lens",
    closer: "I'll keep us anchored to what creators actually need.",
  },
  creative_director: {
    lead: "Creatively",
    closer: "I'll make sure it feels unmistakably VYBE.",
  },
  marketing_director: {
    lead: "On growth",
    closer: "I'll turn this into reach and retention.",
  },
  chief_of_staff: {
    lead: "Stepping back across the org",
    closer: "I'll keep every executive aligned and surface what matters to you.",
  },
};

/**
 * Produce an executive's reply to the founder. Placeholder logic for v1 — swap
 * for a real model call without touching callers.
 */
export function generateExecutiveReply(ctx: ExecutiveReplyContext): string {
  const { executive, founderMessage, openTasks, latestReport } = ctx;
  const voice = ROLE_VOICE[executive.role] ?? {
    lead: "Understood",
    closer: "On it.",
  };
  const trimmed = founderMessage.trim().replace(/\s+/g, " ");
  const topic = trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;

  const taskNote =
    openTasks && openTasks.length > 0
      ? ` I'm currently tracking ${openTasks.length} open item${openTasks.length === 1 ? "" : "s"}, with "${openTasks[0]!.title}" as my active focus.`
      : " I have capacity to take this on right now.";

  // Ground the reply in the executive's latest real inspection of the project.
  const reportNote = latestReport
    ? ` Based on my latest read of the project (${latestReport.status}): ${latestReport.headline}.` +
      (latestReport.topFinding ? ` Top item on my radar — ${latestReport.topFinding}` : "")
    : " I haven't run a fresh report yet — give me the word and I'll inspect the project before advising.";

  return (
    `${voice.lead}, here's how I read "${topic}".${reportNote} ` +
    `I'll break it into concrete steps, flag dependencies on the other executives, and report progress back to Mission Control.${taskNote} ` +
    `${voice.closer}`
  );
}

export type BriefingInput = {
  executiveCount: number;
  activeCount: number;
  openTasks: number;
  blockedTasks: number;
  criticalTasks: number;
  completedTasks: number;
  handoffsToday: number;
  topPriorities: Pick<AgentTaskRow, "title" | "priority">[];
  // Portfolio-wide health (all monitored companies/apps) — optional so older
  // callers keep working; when present the briefing covers the full portfolio.
  portfolio?: {
    name: string;
    overall: "healthy" | "attention" | "critical" | "unknown";
    highlight: string;
  }[];
};

export type GeneratedBriefing = {
  headline: string;
  summary: string;
  focus: string[];
};

/**
 * Produce the daily Mission Control briefing. Placeholder logic for v1 — swap
 * for a real model call without touching callers.
 */
export function generateDailyBriefing(input: BriefingInput): GeneratedBriefing {
  const {
    activeCount,
    executiveCount,
    openTasks,
    blockedTasks,
    criticalTasks,
    completedTasks,
    handoffsToday,
    topPriorities,
    portfolio,
  } = input;

  const portfolioCritical = (portfolio ?? []).filter((p) => p.overall === "critical");
  const portfolioAttention = (portfolio ?? []).filter((p) => p.overall === "attention");

  const headline =
    portfolioCritical.length > 0
      ? `${portfolioCritical.map((p) => p.name).join(", ")} need${portfolioCritical.length === 1 ? "s" : ""} immediate attention`
      : criticalTasks > 0
        ? `${criticalTasks} critical item${criticalTasks === 1 ? "" : "s"} need your attention`
        : blockedTasks > 0
          ? `${blockedTasks} task${blockedTasks === 1 ? "" : "s"} blocked across the team`
          : "All systems nominal — the team is executing";

  const portfolioLine =
    portfolio && portfolio.length > 0
      ? `Portfolio: ${portfolio.map((p) => `${p.name} ${p.overall === "unknown" ? "(awaiting telemetry)" : p.overall}`).join(", ")}. `
      : "";

  const summary =
    portfolioLine +
    `${activeCount} of ${executiveCount} executives are active. ` +
    `${openTasks} task${openTasks === 1 ? "" : "s"} in flight, ${completedTasks} completed, ` +
    `${handoffsToday} handoff${handoffsToday === 1 ? "" : "s"} today. ` +
    (criticalTasks > 0
      ? "Recommend clearing critical items before opening new fronts."
      : "Momentum is steady — good window to push a strategic initiative.");

  const focus: string[] = [];
  for (const p of [...portfolioCritical, ...portfolioAttention].slice(0, 2)) {
    focus.push(`${p.overall.toUpperCase()} — ${p.name}: ${p.highlight}`);
  }
  for (const p of topPriorities.slice(0, 3)) {
    focus.push(`${p.priority.toUpperCase()}: ${p.title}`);
  }
  if (blockedTasks > 0) focus.push(`Unblock ${blockedTasks} stalled task${blockedTasks === 1 ? "" : "s"}`);
  if (focus.length === 0) focus.push("No pressing priorities — set the next big objective");

  return { headline, summary, focus };
}
