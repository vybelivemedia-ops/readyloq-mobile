// ─── Executive command parser ─────────────────────────────────────────────────
// Detects whether a founder's chat message is an executive *command* (an
// imperative to perform real work) rather than ordinary discussion. Kept pure and
// dependency-free so it can be unit-tested and reused on either side of the API.

export const COMMAND_VERBS = [
  "inspect",
  "analyze",
  "review",
  "audit",
  "prepare",
  "research",
  "compare",
  "monitor",
  "summarize",
  "assign",
  "delegate",
  "report",
] as const;

export type CommandVerb = (typeof COMMAND_VERBS)[number];

export type ParsedCommand =
  | { isCommand: false }
  | { isCommand: true; verb: CommandVerb; subject: string };

// Leading filler that may precede the imperative verb ("please inspect …").
const FILLER = new Set([
  "please", "pls", "can", "could", "would", "will", "you", "hey", "hi", "ok", "okay",
  "now", "just", "kindly", "go", "ahead", "and", "then", "also", "lets", "let", "us",
  "we", "i", "need", "want", "id", "like", "to", "do", "a", "an", "the", "some",
]);

const VERB_SET = new Set<string>(COMMAND_VERBS);

// Map common inflections back to their base verb so "analyzing the logs" or
// "audited" still register as commands.
const VERB_ALIASES: Record<string, CommandVerb> = {
  inspecting: "inspect", inspected: "inspect", inspection: "inspect",
  analyzing: "analyze", analyse: "analyze", analysing: "analyze", analyzed: "analyze", analysis: "analyze",
  reviewing: "review", reviewed: "review",
  auditing: "audit", audited: "audit",
  preparing: "prepare", prepared: "prepare", prep: "prepare",
  researching: "research", researched: "research",
  comparing: "compare", compared: "compare", comparison: "compare",
  monitoring: "monitor", monitored: "monitor",
  summarizing: "summarize", summarise: "summarize", summarising: "summarize", summarized: "summarize", summary: "summarize",
  assigning: "assign", assigned: "assign",
  delegating: "delegate", delegated: "delegate",
  reporting: "report", reported: "report",
};

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

function resolveVerb(token: string): CommandVerb | null {
  if (VERB_SET.has(token)) return token as CommandVerb;
  return VERB_ALIASES[token] ?? null;
}

/**
 * Determine whether a message is an executive command. A command is an imperative
 * that *starts* (after optional filler words) with one of the known verbs —
 * "inspect the auth flow" is a command, "what did you think of the audit" is not.
 */
export function parseExecutiveCommand(content: string): ParsedCommand {
  const trimmed = content.trim();
  if (!trimmed) return { isCommand: false };

  const rawTokens = trimmed.split(/\s+/);
  let idx = 0;
  let scanned = 0;
  while (idx < rawTokens.length && scanned < 5) {
    const norm = normalize(rawTokens[idx]!);
    if (!norm) {
      idx++;
      continue;
    }
    if (FILLER.has(norm)) {
      idx++;
      scanned++;
      continue;
    }
    const verb = resolveVerb(norm);
    if (verb) {
      const subject = rawTokens
        .slice(idx + 1)
        .join(" ")
        .replace(/^[\s:,\-–—]+/, "")
        .trim();
      return { isCommand: true, verb, subject };
    }
    // First meaningful token isn't a verb → this is discussion, not a command.
    break;
  }
  return { isCommand: false };
}

/** Priority a command-created task should carry, based on its verb. */
export function commandPriority(verb: CommandVerb): "low" | "medium" | "high" | "critical" {
  switch (verb) {
    case "audit":
    case "inspect":
    case "monitor":
    case "review":
      return "high";
    default:
      return "medium";
  }
}

/** Human-friendly task title for a parsed command. */
export function commandTaskTitle(verb: CommandVerb, subject: string): string {
  const cap = verb.charAt(0).toUpperCase() + verb.slice(1);
  if (!subject) return `${cap} the project`;
  const clipped = subject.length > 80 ? `${subject.slice(0, 77)}…` : subject;
  return `${cap}: ${clipped}`;
}
