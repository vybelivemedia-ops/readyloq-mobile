// ─── Executive Conversations (Mission Control V8) ─────────────────────────────
// Executives talk to each other naturally — a finding from one triggers a
// response from another, ending with Quinn adjusting priorities. Each thread is
// recorded to the organization timeline so it becomes part of company history.
//
// Generation is deterministic (scenario templates) so the org feels alive even
// without a live LLM; an AI flavor can be layered later behind the same surface.

import {
  db,
  aiExecutivesTable,
  execConversationsTable,
  execConversationMessagesTable,
  type AiExecutive,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  recordEvent,
  getRecentEventsByType,
  getEventByRef,
} from "./organizationMemory.js";
import { proposeFromPattern } from "./executiveInitiative.js";
import { accumulateMemory } from "./executiveMemory.js";

type Role = AiExecutive["role"];

type Scenario = {
  topic: string;
  importance: "low" | "normal" | "high" | "critical";
  keywords: string[];
  steps: { role: Role; content: string }[];
};

// Each scenario chains across functions and resolves with Quinn (chief_of_staff)
// adjusting priorities — the canonical "living organization" exchange.
const SCENARIOS: Scenario[] = [
  {
    topic: "Deployment risk in the multistream pipeline",
    importance: "high",
    keywords: ["deployment", "release", "risk", "multistream", "qa"],
    steps: [
      { role: "cto", content: "I found a deployment risk in the multistream pipeline — a race condition under reconnect load." },
      { role: "release_manager", content: "I'll delay the release until QA confirms the reconnect path is stable." },
      { role: "qa_director", content: "I've started regression testing on reconnect and failover scenarios." },
      { role: "chief_of_staff", content: "I've adjusted priorities accordingly — the release is gated on QA sign-off." },
    ],
  },
  {
    topic: "Technical debt in clip processing",
    importance: "normal",
    keywords: ["technical debt", "clip", "refactor", "reliability"],
    steps: [
      { role: "cto", content: "The clip-processing service has accumulated technical debt that's slowing every new feature." },
      { role: "product_manager", content: "Let's scope a cleanup that pays it down without stalling the roadmap." },
      { role: "chief_of_staff", content: "Noted — I'll weigh a focused debt-reduction objective against current commitments." },
    ],
  },
  {
    topic: "Creator activation dropping after signup",
    importance: "high",
    keywords: ["onboarding", "activation", "growth", "signup"],
    steps: [
      { role: "marketing_director", content: "Activation is dropping — creators sign up but never start their first stream." },
      { role: "product_manager", content: "The onboarding flow needs a rethink; the first-run path is too heavy." },
      { role: "creative_director", content: "I'll draft a cleaner, more guided first-run experience." },
      { role: "chief_of_staff", content: "Prioritizing an onboarding improvement — this directly affects retention." },
    ],
  },
  {
    topic: "Flaky tests masking real regressions",
    importance: "normal",
    keywords: ["quality", "tests", "reliability", "ci"],
    steps: [
      { role: "qa_director", content: "Flaky tests are masking real regressions — confidence in CI is slipping." },
      { role: "cto", content: "I'll stabilize the test harness and quarantine the worst offenders." },
      { role: "chief_of_staff", content: "I've adjusted priorities toward test reliability before the next release." },
    ],
  },
];

let scenarioCursor = 0;

async function loadExecsByRole(): Promise<Map<Role, AiExecutive>> {
  const execs = await db.select().from(aiExecutivesTable);
  return new Map(execs.map((e) => [e.role, e]));
}

// Generate one executive conversation. If `topicHint` matches a scenario's
// keywords it is preferred; otherwise scenarios rotate so repeated calls vary.
export async function generateConversation(opts: {
  topicHint?: string;
} = {}): Promise<{ id: string; topic: string; messageCount: number } | null> {
  const byRole = await loadExecsByRole();

  let scenario: Scenario | undefined;
  if (opts.topicHint) {
    const hint = opts.topicHint.toLowerCase();
    scenario = SCENARIOS.find((s) => s.keywords.some((k) => hint.includes(k)) || hint.includes(s.topic.toLowerCase()));
  }
  if (!scenario) {
    scenario = SCENARIOS[scenarioCursor % SCENARIOS.length];
    scenarioCursor += 1;
  }

  // Keep only steps whose executive exists.
  const steps = scenario.steps.filter((s) => byRole.has(s.role));
  if (steps.length < 2) return null;

  const initiator = byRole.get(steps[0].role)!;
  const conversationId = randomUUID();
  const now = new Date();

  await db.insert(execConversationsTable).values({
    id: conversationId,
    topic: scenario.topic,
    summary: steps[steps.length - 1].content,
    status: "open",
    initiatedByExecutiveId: initiator.id,
    objectiveId: null,
    messageCount: steps.length,
    lastMessageAt: now,
  });

  await db.insert(execConversationMessagesTable).values(
    steps.map((s, i) => ({
      id: randomUUID(),
      conversationId,
      fromExecutiveId: byRole.get(s.role)!.id,
      content: s.content,
      sequence: i,
      // Stagger timestamps a few seconds apart so the thread reads in order.
      createdAt: new Date(now.getTime() + i * 1000),
    })),
  );

  const participants = [...new Set(steps.map((s) => byRole.get(s.role)!.name))];
  await recordEvent({
    type: "conversation",
    title: scenario.topic,
    summary: `${participants.join(" → ")}: ${steps[steps.length - 1].content}`,
    actorExecutiveId: initiator.id,
    refType: "conversation",
    refId: conversationId,
    importance: scenario.importance,
    keywords: scenario.keywords,
    metadata: { participants },
  });

  return { id: conversationId, topic: scenario.topic, messageCount: steps.length };
}

export type ConversationSummary = {
  id: string;
  topic: string;
  summary: string;
  status: "open" | "resolved";
  initiatedByName: string | null;
  objectiveId: string | null;
  messageCount: number;
  participants: string[];
  lastMessageAt: Date;
  createdAt: Date;
};

async function participantsFor(conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ name: aiExecutivesTable.name })
    .from(execConversationMessagesTable)
    .innerJoin(
      aiExecutivesTable,
      eq(execConversationMessagesTable.fromExecutiveId, aiExecutivesTable.id),
    )
    .where(eq(execConversationMessagesTable.conversationId, conversationId))
    .orderBy(asc(execConversationMessagesTable.sequence));
  return [...new Set(rows.map((r) => r.name))];
}

export async function getRecentConversations(limit = 20): Promise<ConversationSummary[]> {
  const rows = await db
    .select({
      id: execConversationsTable.id,
      topic: execConversationsTable.topic,
      summary: execConversationsTable.summary,
      status: execConversationsTable.status,
      initiatedByName: aiExecutivesTable.name,
      objectiveId: execConversationsTable.objectiveId,
      messageCount: execConversationsTable.messageCount,
      lastMessageAt: execConversationsTable.lastMessageAt,
      createdAt: execConversationsTable.createdAt,
    })
    .from(execConversationsTable)
    .leftJoin(
      aiExecutivesTable,
      eq(execConversationsTable.initiatedByExecutiveId, aiExecutivesTable.id),
    )
    .orderBy(desc(execConversationsTable.lastMessageAt))
    .limit(limit);

  const out: ConversationSummary[] = [];
  for (const r of rows) {
    out.push({ ...r, participants: await participantsFor(r.id) });
  }
  return out;
}

export type ConversationMessage = {
  id: string;
  fromExecutiveId: string;
  fromName: string;
  fromInitials: string;
  accentColor: string;
  content: string;
  sequence: number;
  createdAt: Date;
};

export async function getConversationDetail(
  conversationId: string,
): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] } | null> {
  const [conv] = await db
    .select({
      id: execConversationsTable.id,
      topic: execConversationsTable.topic,
      summary: execConversationsTable.summary,
      status: execConversationsTable.status,
      initiatedByName: aiExecutivesTable.name,
      objectiveId: execConversationsTable.objectiveId,
      messageCount: execConversationsTable.messageCount,
      lastMessageAt: execConversationsTable.lastMessageAt,
      createdAt: execConversationsTable.createdAt,
    })
    .from(execConversationsTable)
    .leftJoin(
      aiExecutivesTable,
      eq(execConversationsTable.initiatedByExecutiveId, aiExecutivesTable.id),
    )
    .where(eq(execConversationsTable.id, conversationId))
    .limit(1);
  if (!conv) return null;

  const messages = await db
    .select({
      id: execConversationMessagesTable.id,
      fromExecutiveId: execConversationMessagesTable.fromExecutiveId,
      fromName: aiExecutivesTable.name,
      fromInitials: aiExecutivesTable.avatarInitials,
      accentColor: aiExecutivesTable.accentColor,
      content: execConversationMessagesTable.content,
      sequence: execConversationMessagesTable.sequence,
      createdAt: execConversationMessagesTable.createdAt,
    })
    .from(execConversationMessagesTable)
    .innerJoin(
      aiExecutivesTable,
      eq(execConversationMessagesTable.fromExecutiveId, aiExecutivesTable.id),
    )
    .where(eq(execConversationMessagesTable.conversationId, conversationId))
    .orderBy(asc(execConversationMessagesTable.sequence));

  const participants = [...new Set(messages.map((m) => m.fromName))];
  return { conversation: { ...conv, participants }, messages };
}

export async function getOpenConversationCount(): Promise<number> {
  const rows = await db
    .select({ id: execConversationsTable.id })
    .from(execConversationsTable)
    .where(eq(execConversationsTable.status, "open"));
  return rows.length;
}

// ── Repeated-pattern detection (V9) ───────────────────────────────────────────
// A topic discussed repeatedly across conversations — but never converted to an
// owned objective — is a signal. Cluster recent conversation events by shared
// keyword; any keyword spanning ≥2 distinct conversations becomes a process
// recommendation that cites those exact conversations and links back to the most
// recent one on the timeline.
export async function detectRepeatedDiscussionPatterns(opts: {
  minConversations?: number;
} = {}): Promise<{ created: number; patterns: string[] }> {
  const minConversations = Math.max(opts.minConversations ?? 2, 2);
  const events = await getRecentEventsByType("conversation", 40);

  // keyword → distinct conversations (by refId) carrying it.
  type Cluster = {
    keyword: string;
    conversationIds: Set<string>;
    eventIds: string[];
    initiatorCounts: Map<string, number>;
    latestEventId: string;
    extraKeywords: Set<string>;
  };
  const clusters = new Map<string, Cluster>();

  for (const ev of events) {
    if (!ev.refId) continue;
    for (const kw of ev.keywords) {
      const key = kw.toLowerCase();
      let c = clusters.get(key);
      if (!c) {
        c = {
          keyword: kw,
          conversationIds: new Set(),
          eventIds: [],
          initiatorCounts: new Map(),
          latestEventId: ev.id,
          extraKeywords: new Set(),
        };
        clusters.set(key, c);
      }
      if (!c.conversationIds.has(ev.refId)) {
        c.conversationIds.add(ev.refId);
        c.eventIds.push(ev.id);
      }
      if (ev.actorExecutiveId) {
        c.initiatorCounts.set(
          ev.actorExecutiveId,
          (c.initiatorCounts.get(ev.actorExecutiveId) ?? 0) + 1,
        );
      }
      for (const other of ev.keywords) if (other !== kw) c.extraKeywords.add(other);
    }
  }

  // Strongest clusters first; events are newest-first so latestEventId is correct.
  const repeated = [...clusters.values()]
    .filter((c) => c.conversationIds.size >= minConversations)
    .sort((a, b) => b.conversationIds.size - a.conversationIds.size);

  const execs = await db.select().from(aiExecutivesTable);
  const byId = new Map(execs.map((e) => [e.id, e]));
  const quinn = execs.find((e) => e.role === "chief_of_staff");

  const patterns: string[] = [];
  let created = 0;
  for (const c of repeated) {
    // Proposer = the executive who raised it most often, else Quinn.
    let proposer: AiExecutive | undefined;
    let best = -1;
    for (const [execId, n] of c.initiatorCounts) {
      if (n > best) {
        best = n;
        proposer = byId.get(execId);
      }
    }
    proposer = proposer ?? quinn;
    if (!proposer) continue;

    const keywords = [c.keyword, ...[...c.extraKeywords].slice(0, 3)];
    const recId = await proposeFromPattern({
      exec: proposer,
      title: `Resolve the recurring "${c.keyword}" discussions`,
      rationale: `"${c.keyword}" has surfaced across ${c.conversationIds.size} executive conversations without becoming an owned objective. Recommend turning the recurring discussion into action before it stalls momentum.`,
      keywords,
      conversationIds: [...c.conversationIds],
      causedByEventId: c.latestEventId,
    });
    if (recId) {
      created += 1;
      patterns.push(c.keyword);
    }
  }

  return { created, patterns };
}

// Resolve a conversation: mark it resolved, capture the lesson as a learning
// event (feeding briefings) linked back to the conversation, and accumulate a
// success memory for its initiator.
export async function resolveConversation(
  conversationId: string,
  lesson?: string,
): Promise<{ ok: boolean; message: string } | null> {
  const [conv] = await db
    .select()
    .from(execConversationsTable)
    .where(eq(execConversationsTable.id, conversationId))
    .limit(1);
  if (!conv) return null;
  if (conv.status === "resolved") {
    return { ok: false, message: "Conversation is already resolved." };
  }

  await db
    .update(execConversationsTable)
    .set({ status: "resolved" })
    .where(eq(execConversationsTable.id, conversationId));

  const convEvent = await getEventByRef("conversation", conversationId);
  const keywords = convEvent?.keywords ?? [];
  const lessonText = lesson ?? `Resolved: ${conv.summary}`;

  await recordEvent({
    type: "learning",
    title: `Lesson from: ${conv.topic}`,
    summary: lessonText,
    actorExecutiveId: conv.initiatedByExecutiveId,
    refType: "conversation",
    refId: conversationId,
    causedByEventId: convEvent?.id ?? null,
    importance: "normal",
    keywords,
    metadata: { outcome: "resolved" },
  });

  if (conv.initiatedByExecutiveId) {
    await accumulateMemory({
      executiveId: conv.initiatedByExecutiveId,
      kind: "success",
      content: `Resolved discussion: ${conv.topic}`,
      keywords,
      refType: "conversation",
      refId: conversationId,
    });
  }

  return { ok: true, message: `Resolved "${conv.topic}".` };
}
