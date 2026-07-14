// ─── Executive Initiative (Mission Control V8) ────────────────────────────────
// Executives proactively propose work instead of only reacting. Each proposal is
// an executive_recommendation that references prior organizational memory when
// relevant ("we attempted this before…"). Quinn (chief of staff) reviews each
// and either dismisses it or converts it into a real objective with assigned
// workstreams.
//
// Generation is deterministic (per-role templates) so initiative happens without
// a live LLM; the same surface can later be flavored by AI.

import {
  db,
  aiExecutivesTable,
  agentObjectivesTable,
  agentTasksTable,
  execConversationsTable,
  executiveMemoryTable,
  executiveRecommendationsTable,
  organizationEventsTable,
  type AiExecutive,
  type ExecutiveMemoryRow,
  type ExecutiveRecommendationRow,
} from "@workspace/db";
import { and, arrayOverlaps, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { decomposeObjective, type ExecutiveBrief } from "./chiefOrchestrator.js";
import {
  recordEvent,
  getRelatedPriorEvents,
  getEventByRef,
} from "./organizationMemory.js";
import { citeMemoryForKeywords } from "./executiveMemory.js";
import { logger } from "../lib/logger.js";

type Role = AiExecutive["role"];
type Category = ExecutiveRecommendationRow["category"];

type Template = {
  role: Role;
  category: Category;
  title: string;
  rationale: string;
  keywords: string[];
  expectedImpact: string;
};

// One signature proposal per executive function — the work each leader would
// push for proactively.
const TEMPLATES: Template[] = [
  {
    role: "cto",
    category: "technical_debt",
    title: "Pay down clip-pipeline technical debt",
    rationale:
      "The clip-processing path has grown brittle and slows every new feature. A focused refactor would cut incident risk and speed delivery.",
    keywords: ["technical debt", "clip", "refactor", "reliability"],
    expectedImpact: "Fewer clip-pipeline incidents and faster delivery of new features.",
  },
  {
    role: "product_manager",
    category: "onboarding",
    title: "Rebuild first-run onboarding",
    rationale:
      "New creators drop off before their first stream. A guided, lighter first-run flow would lift activation and early retention.",
    keywords: ["onboarding", "activation", "signup", "growth"],
    expectedImpact: "Higher first-stream activation and improved early creator retention.",
  },
  {
    role: "qa_director",
    category: "quality",
    title: "Stabilize the regression suite",
    rationale:
      "Flaky tests are eroding trust in CI and masking real regressions. Stabilizing them protects release confidence.",
    keywords: ["quality", "tests", "ci", "reliability"],
    expectedImpact: "Trustworthy CI signal and fewer regressions reaching production.",
  },
  {
    role: "release_manager",
    category: "launch",
    title: "Add a staged canary rollout gate",
    rationale:
      "A canary stage before full release would catch multistream regressions earlier and shrink blast radius.",
    keywords: ["launch", "release", "rollout", "multistream"],
    expectedImpact: "Earlier detection of release regressions and smaller incident blast radius.",
  },
  {
    role: "marketing_director",
    category: "growth",
    title: "Launch a creator referral loop",
    rationale:
      "Referrals are our cheapest growth channel and we have none. A simple referral loop would compound creator acquisition.",
    keywords: ["growth", "referral", "acquisition"],
    expectedImpact: "Compounding, low-cost creator acquisition through referrals.",
  },
  {
    role: "creative_director",
    category: "process",
    title: "Establish a brand-consistency review",
    rationale:
      "Generated clip output varies in style. A lightweight brand review keeps the product visually cohesive as we scale.",
    keywords: ["brand", "process", "clip", "quality"],
    expectedImpact: "A visually cohesive product as clip output scales.",
  },
];

let templateCursor = 0;

// Have executives propose new recommendations. `count` controls how many
// distinct executives propose this round (defaults to 2). Skips any proposal
// whose title is already pending so repeated runs don't pile up duplicates.
export async function proposeRecommendations(opts: {
  count?: number;
} = {}): Promise<{ created: number; titles: string[] }> {
  const count = Math.min(Math.max(opts.count ?? 2, 1), TEMPLATES.length);
  const execs = await db.select().from(aiExecutivesTable);
  const byRole = new Map(execs.map((e) => [e.role, e]));

  const pending = await db
    .select({ title: executiveRecommendationsTable.title })
    .from(executiveRecommendationsTable)
    .where(eq(executiveRecommendationsTable.status, "pending"));
  const pendingTitles = new Set(pending.map((p) => p.title));

  const created: string[] = [];
  let attempts = 0;
  while (created.length < count && attempts < TEMPLATES.length) {
    const tpl = TEMPLATES[templateCursor % TEMPLATES.length];
    templateCursor += 1;
    attempts += 1;

    const exec = byRole.get(tpl.role);
    if (!exec) continue;
    if (pendingTitles.has(tpl.title)) continue;

    const recId = await createEnrichedRecommendation({
      exec,
      category: tpl.category,
      title: tpl.title,
      rationale: tpl.rationale,
      keywords: tpl.keywords,
      expectedImpact: tpl.expectedImpact,
    });
    if (!recId) continue;

    created.push(tpl.title);
    pendingTitles.add(tpl.title);
  }

  return { created: created.length, titles: created };
}

// ── Enrichment: gather the "why" behind a recommendation ──────────────────────
// Every recommendation carries the evidence, supporting conversations, related
// objectives, cited executive memory, a confidence score, and the expected
// impact — so Quinn (and the Founder) sees the full justification, not a bare
// suggestion.
type EnrichInput = {
  exec: AiExecutive;
  category: Category;
  title: string;
  rationale: string;
  keywords: string[];
  expectedImpact: string;
  extraEvidence?: string[];
  forceConversationIds?: string[];
  causedByEventId?: string | null;
};

async function gatherEnrichment(o: EnrichInput): Promise<{
  evidence: string[];
  supportingConversationIds: string[];
  relatedObjectiveIds: string[];
  citedMemoryIds: string[];
  priorEvent: { id: string; title: string } | null;
  confidence: number;
}> {
  // Prior org memory most related to this proposal.
  const prior = await getRelatedPriorEvents(o.keywords, { limit: 1 });
  const priorEvent = prior[0] ? { id: prior[0].id, title: prior[0].title } : null;

  // Supporting conversations: conversation events whose keywords overlap, mapped
  // back to their conversation ids (or a caller-supplied set, e.g. a detected
  // repeated pattern).
  let supportingConversationIds = o.forceConversationIds ?? [];
  if (supportingConversationIds.length === 0 && o.keywords.length) {
    const convEvents = await db
      .select({ refId: organizationEventsTable.refId })
      .from(organizationEventsTable)
      .where(
        and(
          eq(organizationEventsTable.type, "conversation"),
          arrayOverlaps(organizationEventsTable.keywords, o.keywords),
        ),
      )
      .orderBy(desc(organizationEventsTable.createdAt))
      .limit(3);
    supportingConversationIds = convEvents
      .map((c) => c.refId)
      .filter((v): v is string => !!v);
  }

  // Related objectives: recent objectives whose title/request mention a keyword.
  const recentObjectives = await db
    .select({
      id: agentObjectivesTable.id,
      title: agentObjectivesTable.title,
      request: agentObjectivesTable.request,
    })
    .from(agentObjectivesTable)
    .orderBy(desc(agentObjectivesTable.createdAt))
    .limit(40);
  const kw = o.keywords.map((k) => k.toLowerCase());
  const relatedObjectiveIds = recentObjectives
    .filter((ob) => {
      const hay = `${ob.title} ${ob.request}`.toLowerCase();
      return kw.some((k) => hay.includes(k));
    })
    .slice(0, 3)
    .map((ob) => ob.id);

  // Cited executive memory — the proposer's own past experience.
  const memories = await citeMemoryForKeywords(o.exec.id, o.keywords, 3);
  const citedMemoryIds = memories.map((m) => m.id);

  const evidence: string[] = [...(o.extraEvidence ?? [])];
  if (priorEvent) evidence.push(`Prior org memory: "${priorEvent.title}".`);
  if (supportingConversationIds.length)
    evidence.push(
      `Raised in ${supportingConversationIds.length} executive conversation(s).`,
    );
  if (relatedObjectiveIds.length)
    evidence.push(`Connected to ${relatedObjectiveIds.length} related objective(s).`);
  if (memories.length)
    evidence.push(
      `Backed by ${memories.length} of ${o.exec.name}'s past lesson(s).`,
    );
  if (evidence.length === 0)
    evidence.push("Proposed from this executive's standing domain priorities.");

  // Deterministic confidence: a floor plus signal-weighted boosts, capped.
  let confidence = 45;
  confidence += (o.extraEvidence?.length ?? 0) * 6;
  if (priorEvent) confidence += 10;
  confidence += supportingConversationIds.length * 6;
  confidence += relatedObjectiveIds.length * 5;
  confidence += memories.length * 6;
  confidence = Math.max(40, Math.min(95, confidence));

  return {
    evidence,
    supportingConversationIds,
    relatedObjectiveIds,
    citedMemoryIds,
    priorEvent,
    confidence,
  };
}

async function createEnrichedRecommendation(o: EnrichInput): Promise<string | null> {
  const e = await gatherEnrichment(o);

  const recId = randomUUID();
  await db.insert(executiveRecommendationsTable).values({
    id: recId,
    proposedByExecutiveId: o.exec.id,
    category: o.category,
    title: o.title,
    rationale: e.priorEvent
      ? `${o.rationale} (Referencing prior org memory: "${e.priorEvent.title}".)`
      : o.rationale,
    status: "pending",
    priorEventId: e.priorEvent?.id ?? null,
    evidence: e.evidence,
    supportingConversationIds: e.supportingConversationIds,
    relatedObjectiveIds: e.relatedObjectiveIds,
    citedMemoryIds: e.citedMemoryIds,
    confidence: e.confidence,
    expectedImpact: o.expectedImpact,
  });

  await recordEvent({
    type: "recommendation",
    title: `${o.exec.name} proposed: ${o.title}`,
    summary: o.rationale,
    actorExecutiveId: o.exec.id,
    refType: "recommendation",
    refId: recId,
    causedByEventId: o.causedByEventId ?? null,
    importance: "normal",
    keywords: o.keywords,
  });

  return recId;
}

// Entry point for pattern detection: a repeated discussion across conversations
// becomes a process recommendation that cites those exact conversations.
export async function proposeFromPattern(o: {
  exec: AiExecutive;
  title: string;
  rationale: string;
  keywords: string[];
  conversationIds: string[];
  causedByEventId?: string | null;
}): Promise<string | null> {
  const pending = await db
    .select({ title: executiveRecommendationsTable.title })
    .from(executiveRecommendationsTable)
    .where(eq(executiveRecommendationsTable.status, "pending"));
  if (pending.some((p) => p.title === o.title)) return null;

  return createEnrichedRecommendation({
    exec: o.exec,
    category: "process",
    title: o.title,
    rationale: o.rationale,
    keywords: o.keywords,
    expectedImpact:
      "Turns a recurring, unresolved discussion into owned action before it stalls momentum.",
    extraEvidence: [
      `This topic recurred across ${o.conversationIds.length} separate conversations without resolution.`,
    ],
    forceConversationIds: o.conversationIds,
    causedByEventId: o.causedByEventId ?? null,
  });
}

// Re-enrich pending recommendations that pre-date enrichment (empty evidence).
// Used by the dev tool so legacy rows gain the full justification block.
export async function enrichPendingRecommendations(): Promise<{ enriched: number }> {
  const execs = await db.select().from(aiExecutivesTable);
  const byId = new Map(execs.map((e) => [e.id, e]));

  const pending = await db
    .select()
    .from(executiveRecommendationsTable)
    .where(eq(executiveRecommendationsTable.status, "pending"));

  let enriched = 0;
  for (const rec of pending) {
    if (rec.evidence.length > 0) continue;
    const exec = byId.get(rec.proposedByExecutiveId);
    if (!exec) continue;
    const ev = await getEventByRef("recommendation", rec.id);
    const keywords = ev?.keywords ?? [];
    const e = await gatherEnrichment({
      exec,
      category: rec.category,
      title: rec.title,
      rationale: rec.rationale,
      keywords,
      expectedImpact: rec.expectedImpact,
    });
    await db
      .update(executiveRecommendationsTable)
      .set({
        evidence: e.evidence,
        supportingConversationIds: e.supportingConversationIds,
        relatedObjectiveIds: e.relatedObjectiveIds,
        citedMemoryIds: e.citedMemoryIds,
        confidence: e.confidence,
        expectedImpact: rec.expectedImpact || "Improves the organization's standing priorities.",
      })
      .where(eq(executiveRecommendationsTable.id, rec.id));
    enriched += 1;
  }
  return { enriched };
}

export type RecommendationView = {
  id: string;
  proposedByExecutiveId: string;
  proposedByName: string;
  category: Category;
  title: string;
  rationale: string;
  status: ExecutiveRecommendationRow["status"];
  priorEventId: string | null;
  priorContext: string | null;
  objectiveId: string | null;
  decisionNote: string | null;
  evidence: string[];
  supportingConversations: { id: string; topic: string }[];
  relatedObjectives: { id: string; title: string }[];
  citedMemories: { id: string; kind: ExecutiveMemoryRow["kind"]; content: string }[];
  confidence: number;
  expectedImpact: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export async function getRecommendations(limit = 50): Promise<RecommendationView[]> {
  const priorEvents = db
    .select({ id: organizationEventsTable.id, title: organizationEventsTable.title })
    .from(organizationEventsTable)
    .as("prior_events");

  const rows = await db
    .select({
      id: executiveRecommendationsTable.id,
      proposedByExecutiveId: executiveRecommendationsTable.proposedByExecutiveId,
      proposedByName: aiExecutivesTable.name,
      category: executiveRecommendationsTable.category,
      title: executiveRecommendationsTable.title,
      rationale: executiveRecommendationsTable.rationale,
      status: executiveRecommendationsTable.status,
      priorEventId: executiveRecommendationsTable.priorEventId,
      priorContext: priorEvents.title,
      objectiveId: executiveRecommendationsTable.objectiveId,
      decisionNote: executiveRecommendationsTable.decisionNote,
      evidence: executiveRecommendationsTable.evidence,
      supportingConversationIds: executiveRecommendationsTable.supportingConversationIds,
      relatedObjectiveIds: executiveRecommendationsTable.relatedObjectiveIds,
      citedMemoryIds: executiveRecommendationsTable.citedMemoryIds,
      confidence: executiveRecommendationsTable.confidence,
      expectedImpact: executiveRecommendationsTable.expectedImpact,
      decidedAt: executiveRecommendationsTable.decidedAt,
      createdAt: executiveRecommendationsTable.createdAt,
    })
    .from(executiveRecommendationsTable)
    .innerJoin(
      aiExecutivesTable,
      eq(executiveRecommendationsTable.proposedByExecutiveId, aiExecutivesTable.id),
    )
    .leftJoin(priorEvents, eq(executiveRecommendationsTable.priorEventId, priorEvents.id))
    .orderBy(desc(executiveRecommendationsTable.createdAt))
    .limit(limit);

  // Batch-resolve the cited entities so the UI can render full justification.
  const allConvIds = [...new Set(rows.flatMap((r) => r.supportingConversationIds))];
  const allObjIds = [...new Set(rows.flatMap((r) => r.relatedObjectiveIds))];
  const allMemIds = [...new Set(rows.flatMap((r) => r.citedMemoryIds))];

  const convRows = allConvIds.length
    ? await db
        .select({ id: execConversationsTable.id, topic: execConversationsTable.topic })
        .from(execConversationsTable)
        .where(inArray(execConversationsTable.id, allConvIds))
    : [];
  const convById = new Map(convRows.map((c) => [c.id, c.topic]));

  const objRows = allObjIds.length
    ? await db
        .select({ id: agentObjectivesTable.id, title: agentObjectivesTable.title })
        .from(agentObjectivesTable)
        .where(inArray(agentObjectivesTable.id, allObjIds))
    : [];
  const objById = new Map(objRows.map((o) => [o.id, o.title]));

  const memRows = allMemIds.length
    ? await db
        .select({
          id: executiveMemoryTable.id,
          kind: executiveMemoryTable.kind,
          content: executiveMemoryTable.content,
        })
        .from(executiveMemoryTable)
        .where(inArray(executiveMemoryTable.id, allMemIds))
    : [];
  const memById = new Map(memRows.map((m) => [m.id, { kind: m.kind, content: m.content }]));

  return rows.map((r) => ({
    ...r,
    proposedByName: r.proposedByName ?? "Unknown",
    supportingConversations: r.supportingConversationIds
      .map((id) => (convById.has(id) ? { id, topic: convById.get(id)! } : null))
      .filter((v): v is { id: string; topic: string } => !!v),
    relatedObjectives: r.relatedObjectiveIds
      .map((id) => (objById.has(id) ? { id, title: objById.get(id)! } : null))
      .filter((v): v is { id: string; title: string } => !!v),
    citedMemories: r.citedMemoryIds
      .map((id) =>
        memById.has(id) ? { id, kind: memById.get(id)!.kind, content: memById.get(id)!.content } : null,
      )
      .filter((v): v is { id: string; kind: ExecutiveMemoryRow["kind"]; content: string } => !!v),
  }));
}

async function loadQuinn(): Promise<AiExecutive | undefined> {
  const [row] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"))
    .limit(1);
  return row;
}

// Build an objective + per-executive backlog tasks from a free-text request.
// Mirrors autonomyEngine's safe objective creation but is local so this service
// has no dependency on the autonomy engine.
async function createObjectiveFromRequest(
  quinn: AiExecutive,
  title: string,
  request: string,
): Promise<{ objectiveId: string; assigned: number } | null> {
  const execs = await db.select().from(aiExecutivesTable);
  const briefs: ExecutiveBrief[] = execs.map((e) => ({ role: e.role, name: e.name, title: e.title }));
  const plan = await decomposeObjective(request, briefs);
  if (plan.assignments.length === 0) return null;

  const objectiveId = randomUUID();
  await db.insert(agentObjectivesTable).values({
    id: objectiveId,
    title,
    request,
    status: "planning",
    summary: plan.rationale,
    createdByExecutiveId: quinn.id,
  });

  const roleToExec = new Map(execs.map((e) => [e.role, e]));
  let assigned = 0;
  for (const a of plan.assignments) {
    const exec = roleToExec.get(a.role);
    if (!exec) continue;
    await db.insert(agentTasksTable).values({
      id: randomUUID(),
      executiveId: exec.id,
      title: a.focus,
      description: `Converted from an executive recommendation by Quinn for objective "${title}".`,
      status: "backlog",
      priority: a.priority,
      origin: "agent",
      createdByExecutiveId: quinn.id,
      objectiveId,
    });
    assigned += 1;
  }
  return { objectiveId, assigned };
}

// Quinn reviews one recommendation. `convert` turns it into an objective;
// `dismiss` closes it (optionally citing organizational memory).
export async function reviewRecommendation(
  recommendationId: string,
  decision: "convert" | "dismiss",
  note?: string,
): Promise<{ ok: boolean; message: string; objectiveId?: string } | null> {
  const [rec] = await db
    .select()
    .from(executiveRecommendationsTable)
    .where(eq(executiveRecommendationsTable.id, recommendationId))
    .limit(1);
  if (!rec) return null;
  if (rec.status !== "pending") {
    return { ok: false, message: `Recommendation already ${rec.status}.` };
  }

  const quinn = await loadQuinn();
  const [proposer] = await db
    .select({ name: aiExecutivesTable.name })
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.id, rec.proposedByExecutiveId))
    .limit(1);
  const proposerName = proposer?.name ?? "an executive";

  if (decision === "convert") {
    if (!quinn) return { ok: false, message: "Quinn is unavailable to convert recommendations." };
    const created = await createObjectiveFromRequest(quinn, rec.title, rec.rationale);
    if (!created) return { ok: false, message: "Could not build an objective plan from this recommendation." };

    await db
      .update(executiveRecommendationsTable)
      .set({
        status: "converted",
        objectiveId: created.objectiveId,
        decisionNote: note ?? `Converted to an objective (${created.assigned} workstreams).`,
        decidedAt: new Date(),
      })
      .where(eq(executiveRecommendationsTable.id, recommendationId));

    // Link the new objective event back to the recommendation event that caused
    // it, so the Timeline renders the recommendation→objective cause/effect chain.
    const recEvent = await getEventByRef("recommendation", rec.id);

    await recordEvent({
      type: "objective",
      title: `Quinn converted a recommendation into an objective: "${rec.title}"`,
      summary: `Proposed by ${proposerName}. ${created.assigned} workstream(s) assigned.`,
      actorExecutiveId: quinn.id,
      refType: "objective",
      refId: created.objectiveId,
      causedByEventId: recEvent?.id ?? null,
      importance: "high",
      keywords: [rec.category, "recommendation", "objective"],
      metadata: { recommendationId, outcome: "converted" },
    });

    return { ok: true, message: `Converted "${rec.title}" into an objective.`, objectiveId: created.objectiveId };
  }

  // dismiss
  await db
    .update(executiveRecommendationsTable)
    .set({
      status: "dismissed",
      decisionNote: note ?? "Dismissed for now — not a current priority.",
      decidedAt: new Date(),
    })
    .where(eq(executiveRecommendationsTable.id, recommendationId));

  await recordEvent({
    type: "recommendation",
    title: `Quinn dismissed a recommendation: "${rec.title}"`,
    summary: `Proposed by ${proposerName}. ${note ?? "Not a current priority."}`,
    actorExecutiveId: quinn?.id ?? null,
    refType: "recommendation",
    refId: rec.id,
    importance: "low",
    keywords: [rec.category, "recommendation"],
    metadata: { recommendationId, outcome: "dismissed" },
  });

  return { ok: true, message: `Dismissed "${rec.title}".` };
}

// Quinn reviews every pending recommendation. Organizational memory drives the
// call: if a recommendation references a prior event that previously failed,
// Quinn dismisses it citing that history; otherwise she converts it.
export async function reviewAllPending(): Promise<{ converted: number; dismissed: number }> {
  const pending = await db
    .select()
    .from(executiveRecommendationsTable)
    .where(eq(executiveRecommendationsTable.status, "pending"))
    .orderBy(desc(executiveRecommendationsTable.createdAt));

  let converted = 0;
  let dismissed = 0;
  for (const rec of pending) {
    let priorFailed = false;
    let priorTitle: string | null = null;
    if (rec.priorEventId) {
      const [prior] = await db
        .select()
        .from(organizationEventsTable)
        .where(eq(organizationEventsTable.id, rec.priorEventId))
        .limit(1);
      if (prior) {
        priorTitle = prior.title;
        priorFailed = (prior.metadata as Record<string, unknown>)?.outcome === "failed";
      }
    }

    if (priorFailed) {
      const res = await reviewRecommendation(
        rec.id,
        "dismiss",
        `We attempted something similar before ("${priorTitle}") and it failed — recommend a different strategy first.`,
      );
      if (res?.ok) dismissed += 1;
    } else {
      const res = await reviewRecommendation(rec.id, "convert");
      if (res?.ok) converted += 1;
      else {
        await reviewRecommendation(rec.id, "dismiss", "Could not build a viable plan this round.");
        dismissed += 1;
      }
    }
  }

  logger.info({ converted, dismissed }, "executiveInitiative: reviewed pending recommendations");
  return { converted, dismissed };
}

export async function getPendingRecommendationCount(): Promise<number> {
  const rows = await db
    .select({ id: executiveRecommendationsTable.id })
    .from(executiveRecommendationsTable)
    .where(eq(executiveRecommendationsTable.status, "pending"));
  return rows.length;
}
