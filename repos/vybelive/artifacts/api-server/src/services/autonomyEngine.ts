// ─── Autonomy Engine (Mission Control V7) ─────────────────────────────────────
// Quinn's continuous "what should happen next?" loop. Each cycle inspects the
// portfolio, executive workload, objectives, blockers, approvals, reports, and
// founder priorities, then EITHER acts autonomously (safe actions only) OR
// escalates to the founder.
//
// AUTONOMY LIMITS (hard rule): Quinn may inspect, analyze, prioritize, create
// objectives, assign, request collaboration, reprioritize, report, brief, and
// update knowledge. Quinn must NEVER deploy, merge, publish, delete, spend, or
// take external actions — those always become founder approvals (escalations).
//
// Escalate to the founder ONLY for: approval required, critical blocker,
// milestone completed, strategic decision.
//
// Cadence: DEV runs manually (button). PROD runs every 15 min via a worker.
// Cycles are intentionally cheap — they never auto-run expensive capability
// passes — so the scheduled cadence cannot amplify cost.

import {
  db,
  aiExecutivesTable,
  agentObjectivesTable,
  agentTasksTable,
  agentReportsTable,
  agentApprovalsTable,
  agentActivityTable,
  agentMemoryTable,
  autonomyCyclesTable,
  type AiExecutive,
  type AutonomyAction,
  type AutonomyEscalation,
  type AutonomyCycleRow,
} from "@workspace/db";
import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getPortfolioSummary, type PortfolioAssetHealth } from "./portfolioMonitor.js";
import { decomposeObjective, type ExecutiveBrief } from "./chiefOrchestrator.js";
import { getLearningTotals } from "./executiveLearning.js";
import { recordEvent } from "./organizationMemory.js";
import {
  generateConversation,
  getOpenConversationCount,
  detectRepeatedDiscussionPatterns,
} from "./executiveConversations.js";
import {
  proposeRecommendations,
  getPendingRecommendationCount,
  enrichPendingRecommendations,
} from "./executiveInitiative.js";
import { accumulateFromRecentWork, accumulateMemory } from "./executiveMemory.js";
import {
  collectSnapshot,
  getActiveProducts,
  getPreviousSnapshot,
  getRecentEvents,
  detectChanges,
  getFlagshipSnapshot,
  computeLaunchReadiness,
} from "./engineering/engineeringIntelligence.js";
import type { EngineeringProduct, EngineeringSnapshot } from "./engineering/types.js";
import {
  runBlockerResolutionPass,
  getBlockerSummary,
  type BlockerPassResult,
  type BlockerSummary,
} from "./blockers/blockerResolution.js";
import { logger } from "../lib/logger.js";

export type AutonomyTrigger = "manual" | "scheduled";

// ─── Small persistence helpers (self-contained so the cron worker never has to
// import the Mission Control router) ──────────────────────────────────────────

async function recordActivity(
  type: "objective" | "approval" | "message" | "task_created",
  executiveId: string | null,
  summary: string,
  detail: string | null,
): Promise<void> {
  await db
    .insert(agentActivityTable)
    .values({ id: randomUUID(), type, executiveId, summary, detail })
    .catch(() => {});
}

async function loadQuinn(): Promise<AiExecutive | undefined> {
  const [row] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"))
    .limit(1);
  return row;
}

// Surface a founder approval, de-duplicated against any still-pending approval
// carrying the same title so repeated cycles don't spam the queue.
async function ensureApproval(
  quinnId: string,
  title: string,
  detail: string,
  impact: string,
  objectiveId: string | null,
): Promise<boolean> {
  const existing = await db
    .select({ id: agentApprovalsTable.id })
    .from(agentApprovalsTable)
    .where(and(eq(agentApprovalsTable.title, title), eq(agentApprovalsTable.status, "pending")))
    .limit(1);
  if (existing.length > 0) return false;
  await db.insert(agentApprovalsTable).values({
    id: randomUUID(),
    objectiveId,
    executiveId: quinnId,
    taskId: null,
    title,
    detail,
    impact,
    status: "pending",
  });
  await recordActivity("approval", quinnId, title, detail);
  return true;
}

// ─── Signals ──────────────────────────────────────────────────────────────────

type Signals = {
  portfolio: {
    totalAssets: number;
    healthy: number;
    attention: number;
    critical: number;
    worstAsset: { slug: string; name: string; overall: string } | null;
    worstDimension: { assetSlug: string; key: string; label: string; status: string; detail: string } | null;
  };
  objectives: { planning: number; inProgress: number; needsApproval: number; open: number };
  tasks: { open: number; blocked: number };
  approvals: { pending: number };
  reports: { critical: number };
  execWorkload: { peak: number; idle: number };
  learning: { lessons: number; retrospectives: number; weeklyReviews: number };
  milestones: { completedSince: number; titles: string[] };
};

const DIM_RANK: Record<string, number> = { unknown: 0, healthy: 1, attention: 2, critical: 3 };

function pickWorstDimension(assets: PortfolioAssetHealth[]): Signals["portfolio"]["worstDimension"] {
  let worst: Signals["portfolio"]["worstDimension"] = null;
  for (const a of assets) {
    for (const d of a.dimensions) {
      const rank = DIM_RANK[d.status] ?? 0;
      if (rank < 2) continue; // only attention/critical are actionable
      if (!worst || rank > (DIM_RANK[worst.status] ?? 0)) {
        worst = { assetSlug: a.slug, key: d.key, label: d.label, status: d.status, detail: d.detail };
      }
    }
  }
  return worst;
}

async function gatherSignals(): Promise<Signals> {
  // Window for milestone detection: objectives completed since the previous
  // cycle (or the last 15 minutes on the very first cycle, so we don't escalate
  // the entire history of completed objectives on cold start).
  const [prevCycle] = await db
    .select({ startedAt: autonomyCyclesTable.startedAt })
    .from(autonomyCyclesTable)
    .orderBy(desc(autonomyCyclesTable.startedAt))
    .limit(1);
  const milestoneSince = prevCycle?.startedAt ?? new Date(Date.now() - 15 * 60 * 1000);

  const [
    portfolio,
    objGroups,
    taskGroups,
    blocked,
    pendingApprovals,
    criticalReports,
    workloadRows,
    execCount,
    learning,
    completedObjectives,
  ] = await Promise.all([
      getPortfolioSummary(),
      db
        .select({ status: agentObjectivesTable.status, n: count() })
        .from(agentObjectivesTable)
        .groupBy(agentObjectivesTable.status),
      db
        .select({ status: agentTasksTable.status, n: count() })
        .from(agentTasksTable)
        .groupBy(agentTasksTable.status),
      db.select({ n: count() }).from(agentTasksTable).where(eq(agentTasksTable.status, "blocked")),
      db
        .select({ n: count() })
        .from(agentApprovalsTable)
        .where(eq(agentApprovalsTable.status, "pending")),
      db.select({ n: count() }).from(agentReportsTable).where(eq(agentReportsTable.status, "critical")),
      db
        .select({ executiveId: agentTasksTable.executiveId, n: count() })
        .from(agentTasksTable)
        .where(inArray(agentTasksTable.status, ["backlog", "in_progress", "blocked", "review"]))
        .groupBy(agentTasksTable.executiveId),
      db.select({ n: count() }).from(aiExecutivesTable),
      getLearningTotals(),
      db
        .select({ id: agentObjectivesTable.id, title: agentObjectivesTable.title })
        .from(agentObjectivesTable)
        .where(
          and(
            eq(agentObjectivesTable.status, "completed"),
            gt(agentObjectivesTable.updatedAt, milestoneSince),
          ),
        ),
    ]);

  const objByStatus = Object.fromEntries(objGroups.map((g) => [g.status, g.n]));
  const taskByStatus = Object.fromEntries(taskGroups.map((g) => [g.status, g.n]));
  const planning = objByStatus["planning"] ?? 0;
  const inProgress = objByStatus["in_progress"] ?? 0;
  const needsApproval = objByStatus["needs_approval"] ?? 0;
  const open =
    (taskByStatus["backlog"] ?? 0) +
    (taskByStatus["in_progress"] ?? 0) +
    (taskByStatus["blocked"] ?? 0) +
    (taskByStatus["review"] ?? 0);
  const peak = workloadRows.reduce((m, r) => Math.max(m, r.n), 0);
  const totalExecs = execCount[0]?.n ?? 0;
  const busyExecs = workloadRows.length;

  const sortedAssets = [...portfolio.assets].sort(
    (a, b) => (DIM_RANK[b.overall] ?? 0) - (DIM_RANK[a.overall] ?? 0),
  );
  const worstAsset = sortedAssets[0]
    ? { slug: sortedAssets[0].slug, name: sortedAssets[0].name, overall: sortedAssets[0].overall }
    : null;

  return {
    portfolio: {
      totalAssets: portfolio.totalAssets,
      healthy: portfolio.healthy,
      attention: portfolio.attention,
      critical: portfolio.critical,
      worstAsset,
      worstDimension: pickWorstDimension(portfolio.assets),
    },
    objectives: { planning, inProgress, needsApproval, open: planning + inProgress + needsApproval },
    tasks: { open, blocked: blocked[0]?.n ?? 0 },
    approvals: { pending: pendingApprovals[0]?.n ?? 0 },
    reports: { critical: criticalReports[0]?.n ?? 0 },
    execWorkload: { peak, idle: Math.max(0, totalExecs - busyExecs) },
    learning,
    milestones: {
      completedSince: completedObjectives.length,
      titles: completedObjectives.map((o) => o.title),
    },
  };
}

// ─── Objective idempotency ─────────────────────────────────────────────────────

/** Max autonomous retries before escalating an objective to the founder. */
const MAX_OBJECTIVE_RETRIES = 3;

/**
 * Stable dedup key helper. Callers supply a structured identifier such as
 * "portfolio:user_growth:vybe-live" or "engineering:vybe-live" — NOT a free-form
 * title — so the key stays stable across scheduler cycles regardless of how the
 * detail text varies.
 */
function normalizeDedupKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\w:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Core idempotency check. Before any autonomous creation path inserts a new
 * objective it must call this. Returns the existing objectiveId if one should
 * be reused (active) or has already been handled (failed+exhausted), or null
 * when a fresh insert is appropriate.
 *
 * State machine:
 *   planning | in_progress | blocked → already being worked; return id (skip).
 *   failed, retryCount < MAX         → reset to in_progress; return id (resume).
 *   failed, retryCount >= MAX        → escalate to founder once; return id (stop).
 *   not found                        → return null (create new).
 */
async function findOrResumeObjective(
  dedupKey: string,
  quinnId: string,
  title: string,
): Promise<string | null> {
  const existing = await db
    .select()
    .from(agentObjectivesTable)
    .where(
      and(
        sql`"dedup_key" = ${dedupKey}`,
        inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval", "failed"]),
      ),
    )
    .orderBy(desc(agentObjectivesTable.createdAt))
    .limit(1);

  if (existing.length === 0) return null;
  const obj = existing[0];

  if (obj.status === "failed") {
    if (obj.retryCount >= MAX_OBJECTIVE_RETRIES) {
      // Exhausted — raise one founder approval and stop creating new objectives.
      await ensureApproval(
        quinnId,
        `Objective exhausted retries: ${title.slice(0, 100)}`,
        `"${obj.title}" has failed ${obj.retryCount} time(s) and cannot continue autonomously. ` +
          `Founder decision required: abandon, reassign, or unblock?`,
        "high",
        obj.id,
      );
      return obj.id;
    }
    // Still within the retry budget — reset for another attempt.
    await db
      .update(agentObjectivesTable)
      .set({ status: "in_progress", retryCount: obj.retryCount + 1, updatedAt: new Date() })
      .where(eq(agentObjectivesTable.id, obj.id));
    logger.info(
      { objectiveId: obj.id, retryCount: obj.retryCount + 1, dedupKey },
      "autonomy: resumed failed objective instead of creating duplicate",
    );
    return obj.id;
  }

  // Active state — already being worked on; nothing to do.
  return obj.id;
}

// ─── Autonomous objective creation (a SAFE action) ────────────────────────────
// Creates an objective and fans it out into per-executive backlog tasks. It does
// NOT auto-run capability passes (that stays founder/route-driven) — keeping each
// cycle cheap. Returns the created objective id, or null if it couldn't build a
// plan.
//
// dedupKey — supply a STABLE structured key (e.g. "portfolio:user_growth:vybe-live")
// so the idempotency check survives repeated cycles. If omitted, a key is derived
// from the request string (less stable but better than nothing).
async function createObjectiveAutonomously(
  quinn: AiExecutive,
  request: string,
  dedupKey?: string,
): Promise<{ objectiveId: string; title: string; assigned: number } | null> {
  const key = dedupKey ?? normalizeDedupKey(request);

  // ── Idempotency: never duplicate an active/failed objective for the same intent.
  const resumedId = await findOrResumeObjective(key, quinn.id, request);
  if (resumedId !== null) {
    const existing = await db
      .select({ title: agentObjectivesTable.title })
      .from(agentObjectivesTable)
      .where(eq(agentObjectivesTable.id, resumedId))
      .limit(1);
    return {
      objectiveId: resumedId,
      title: existing[0]?.title ?? request.slice(0, 120),
      assigned: 0,
    };
  }

  const execs = await db.select().from(aiExecutivesTable);
  const briefs: ExecutiveBrief[] = execs.map((e) => ({ role: e.role, name: e.name, title: e.title }));
  const plan = await decomposeObjective(request, briefs);
  if (plan.assignments.length === 0) return null;

  const objectiveId = randomUUID();
  await db.insert(agentObjectivesTable).values({
    id: objectiveId,
    title: plan.title,
    request,
    dedupKey: key,
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
      description: `Autonomously assigned by Quinn for objective "${plan.title}".`,
      status: "backlog",
      priority: a.priority,
      origin: "agent",
      createdByExecutiveId: quinn.id,
      objectiveId,
    });
    assigned += 1;
  }

  await recordActivity(
    "objective",
    quinn.id,
    `Quinn opened a new objective: "${plan.title}"`,
    `${assigned} executive workstream(s) assigned autonomously. ${plan.rationale}`,
  );
  return { objectiveId, title: plan.title, assigned };
}

// Write a short, non-pinned knowledge note to Quinn's memory summarizing the
// cycle's reasoning (the "update knowledge" autonomous capability).
async function updateQuinnKnowledge(quinnId: string, note: string): Promise<void> {
  await db
    .insert(agentMemoryTable)
    .values({ id: randomUUID(), executiveId: quinnId, kind: "context", content: note, pinned: false })
    .catch(() => {});
}

// ─── Cycle ────────────────────────────────────────────────────────────────────

export async function runAutonomousCycle(opts: {
  trigger: AutonomyTrigger;
}): Promise<AutonomyCycleRow> {
  const startedAt = new Date();
  const cycleId = randomUUID();
  const actions: AutonomyAction[] = [];
  const escalations: AutonomyEscalation[] = [];
  let signals: Signals | null = null;

  try {
    signals = await gatherSignals();
    const quinn = await loadQuinn();

    // ── Escalations (founder-only decisions) ──────────────────────────────────
    // 1. Approval required — there are pending approvals awaiting the founder.
    if (signals.approvals.pending > 0) {
      escalations.push({
        reason: "approval_required",
        detail: `${signals.approvals.pending} approval(s) are awaiting your decision.`,
      });
    }

    // 2. Critical blocker — blocked tasks or critical executive reports.
    if (signals.tasks.blocked > 0 || signals.reports.critical > 0) {
      const detail =
        `${signals.tasks.blocked} blocked task(s) and ${signals.reports.critical} critical report(s) ` +
        `are gating progress and need your attention.`;
      escalations.push({ reason: "critical_blocker", detail });
      if (quinn) {
        await ensureApproval(
          quinn.id,
          "Critical blocker needs founder attention",
          detail,
          "high",
          null,
        );
      }
    }

    // 3. Milestone completed — one or more objectives reached "completed" since
    //    the previous cycle. This is a founder-visible win, not an action.
    if (signals.milestones.completedSince > 0) {
      const preview = signals.milestones.titles.slice(0, 3).join(", ");
      const more = signals.milestones.completedSince > 3 ? `, +${signals.milestones.completedSince - 3} more` : "";
      const detail = `${signals.milestones.completedSince} objective(s) completed since the last cycle: ${preview}${more}.`;
      escalations.push({ reason: "milestone_completed", detail });
      await recordEvent({
        type: "milestone",
        title: `Milestone: ${signals.milestones.completedSince} objective(s) completed`,
        summary: detail,
        actorExecutiveId: quinn?.id ?? null,
        importance: "high",
        keywords: ["milestone", "objective", "completed"],
        metadata: { titles: signals.milestones.titles, outcome: "completed" },
      });
    }

    // 4. Strategic decision — a portfolio asset is in critical health overall.
    if (signals.portfolio.critical > 0 && signals.portfolio.worstAsset) {
      const detail = `Portfolio asset "${signals.portfolio.worstAsset.name}" is in critical health and may need a strategic call.`;
      escalations.push({ reason: "strategic_decision", detail });
      if (quinn) {
        await ensureApproval(
          quinn.id,
          `Strategic decision: ${signals.portfolio.worstAsset.name}`,
          detail,
          "high",
          null,
        );
      }
    }

    // ── Safe autonomous actions ───────────────────────────────────────────────
    if (quinn) {
      // Prioritize: always state the current top focus (cheap, explainable).
      const focus =
        signals.portfolio.worstDimension
          ? `${signals.portfolio.worstDimension.label} on ${signals.portfolio.worstDimension.assetSlug} (${signals.portfolio.worstDimension.status})`
          : signals.objectives.open > 0
            ? `advancing ${signals.objectives.open} open objective(s)`
            : "portfolio is steady — no urgent focus";
      actions.push({ type: "prioritize", detail: `Top focus this cycle: ${focus}.` });

      // Create objective: if the org is idle (no open objectives) but a portfolio
      // dimension is attention/critical, spin up one objective to address it.
      if (signals.objectives.open === 0 && signals.portfolio.worstDimension) {
        const wd = signals.portfolio.worstDimension;
        const request = `Address ${wd.label} on ${wd.assetSlug}: ${wd.detail}`;
        // Stable key scoped to dimension+asset — survives across cycles regardless of detail text.
        const portfolioDedupKey = `portfolio:${wd.key}:${wd.assetSlug}`;
        const created = await createObjectiveAutonomously(quinn, request, portfolioDedupKey);
        if (created) {
          actions.push({
            type: "create_objective",
            detail: `Opened "${created.title}" and assigned ${created.assigned} workstream(s) to address ${wd.label}.`,
          });
          await recordEvent({
            type: "objective",
            title: `Quinn opened an objective: "${created.title}"`,
            summary: `Autonomously created to address ${wd.label} on ${wd.assetSlug}. ${created.assigned} workstream(s) assigned.`,
            actorExecutiveId: quinn.id,
            refType: "objective",
            refId: created.objectiveId,
            importance: "normal",
            keywords: ["objective", "autonomy", wd.key],
            metadata: { outcome: "created" },
          });
        }
      }

      // Update knowledge: persist a short, non-pinned note so Quinn carries this
      // cycle's read of the portfolio forward.
      const knowledge =
        `Cycle (${opts.trigger}) @ ${startedAt.toISOString()}: ` +
        `portfolio ${signals.portfolio.healthy} healthy / ${signals.portfolio.attention} attention / ${signals.portfolio.critical} critical; ` +
        `${signals.objectives.open} open objective(s), ${signals.tasks.blocked} blocked task(s), ` +
        `${signals.approvals.pending} pending approval(s).`;
      await updateQuinnKnowledge(quinn.id, knowledge);
      actions.push({ type: "update_knowledge", detail: "Recorded the current portfolio read to Quinn's knowledge." });

      // Resolve blockers: classify, route, and progress every blocker. This is
      // the V11.1 continuous resolution loop — it resolves autonomously, retries
      // connected/transient failures, and escalates ONLY when a path is
      // exhausted (founder approval) or only a human can act.
      try {
        const bp = await runBlockerResolutionPass();
        if (bp.sync.created > 0 || bp.resolvedThisPass > 0 || bp.active > 0) {
          actions.push({
            type: "resolve_blockers",
            detail:
              `Blocker pass: ${bp.sync.created} new, ${bp.resolvedThisPass} resolved, ${bp.active} active ` +
              `(${bp.byCategory.autonomous} autonomous, ${bp.byCategory.connected} connected, ` +
              `${bp.byCategory.founder_approval} awaiting approval, ${bp.byCategory.human_required} need a human).`,
          });
        }
        // A human-only blocker is the one case besides approval where the founder
        // must be looped in — surface it as an escalation so it is never silent.
        if (bp.humanRequired > 0) {
          escalations.push({
            reason: "critical_blocker",
            detail: `${bp.humanRequired} blocker(s) require a human action only you can take (identity, legal, billing, or connecting a provider).`,
          });
        }
      } catch (err) {
        logger.warn({ err }, "autonomy: blocker resolution pass failed");
      }

      // Brief: leave a founder-facing activity summary of what Quinn did/saw.
      await recordActivity(
        "message",
        quinn.id,
        "Quinn ran an autonomous cycle",
        `${actions.length} action(s), ${escalations.length} escalation(s). ${knowledge}`,
      );
      actions.push({ type: "brief", detail: "Posted a cycle brief to the activity feed." });
    }

    const status: AutonomyCycleRow["status"] =
      actions.length > 0 || escalations.length > 0 ? "completed" : "noop";
    const finishedAt = new Date();
    const summary = buildSummary(signals, actions, escalations, status);

    const [row] = await db
      .insert(autonomyCyclesTable)
      .values({
        id: cycleId,
        trigger: opts.trigger,
        status,
        signals: signals as unknown as Record<string, unknown>,
        actions,
        escalations,
        summary,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        startedAt,
        finishedAt,
      })
      .returning();
    logger.info(
      { cycleId, trigger: opts.trigger, status, actions: actions.length, escalations: escalations.length },
      "autonomy: cycle complete",
    );
    return row!;
  } catch (err) {
    logger.error({ err, cycleId }, "autonomy: cycle failed");
    const finishedAt = new Date();
    const [row] = await db
      .insert(autonomyCyclesTable)
      .values({
        id: cycleId,
        trigger: opts.trigger,
        status: "failed",
        signals: (signals ?? {}) as unknown as Record<string, unknown>,
        actions,
        escalations,
        summary: `Cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        startedAt,
        finishedAt,
      })
      .returning();
    return row!;
  }
}

function buildSummary(
  signals: Signals,
  actions: AutonomyAction[],
  escalations: AutonomyEscalation[],
  status: AutonomyCycleRow["status"],
): string {
  if (status === "noop") {
    return "Nothing actionable this cycle — portfolio steady, no blockers, no approvals pending.";
  }
  const parts: string[] = [];
  if (actions.length > 0) parts.push(`${actions.length} autonomous action(s)`);
  if (escalations.length > 0) {
    const reasons = [...new Set(escalations.map((e) => e.reason))].join(", ");
    parts.push(`${escalations.length} escalation(s) (${reasons})`);
  }
  return `Quinn took ${parts.join(" and ")}. Portfolio: ${signals.portfolio.healthy} healthy / ${signals.portfolio.attention} attention / ${signals.portfolio.critical} critical.`;
}

// Recent cycles for the Autonomy page + Diagnostics.
export async function getRecentCycles(limit = 20): Promise<AutonomyCycleRow[]> {
  return db
    .select()
    .from(autonomyCyclesTable)
    .orderBy(desc(autonomyCyclesTable.createdAt))
    .limit(limit);
}

// ─── Reflection (Quinn's continuous thinking) ─────────────────────────────────
// The idle loop that makes the org feel alive: Quinn asks five questions, turns
// the answers into observations recorded to the organization timeline, and
// opportunistically sparks an executive conversation or a fresh round of
// recommendations when the company is quiet. Cheap and deterministic — safe to
// run on the 15-minute PROD cadence and from the DEV button.

// ─── Engineering Intelligence pass (V10) ──────────────────────────────────────
// Quinn reasons ONLY from the normalized Engineering Snapshot. Each cycle she
// collects a fresh snapshot, compares it with the previous one, and acts ONLY on
// meaningful change: updates the timeline, teaches the relevant executives
// (permanent memory), creates an objective when confidence is high and a blocker
// exists, and escalates critical engineering blockers to the founder. When no
// meaningful change exists she does nothing. Degrades gracefully — a provider or
// snapshot failure skips the pass without breaking the rest of the cycle.

export type EngineeringPassResult = {
  collected: boolean;
  changes: number;
  memoriesRecorded: number;
  objectiveCreated: boolean;
  escalated: boolean;
  healthScore: number | null;
};

const ENG_OBJECTIVE_MARKER = "Resolve engineering blocker(s):";

// Per-product marker prefix so an open objective for one product does not
// suppress objective creation for another.
function engObjectiveMarker(productSlug: string): string {
  return `${ENG_OBJECTIVE_MARKER} [${productSlug}]`;
}

async function hasOpenEngineeringObjective(productSlug: string): Promise<boolean> {
  // Primary check: indexed dedup key lookup (covers all non-terminal statuses,
  // including failed — so a failed objective blocks creating a fresh duplicate).
  const byKey = await db
    .select({ id: agentObjectivesTable.id })
    .from(agentObjectivesTable)
    .where(
      and(
        sql`"dedup_key" = ${"engineering:" + productSlug}`,
        inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval", "failed"]),
      ),
    )
    .limit(1);
  if (byKey.length > 0) return true;
  // Fallback: legacy rows created before the dedup key existed — check by request prefix.
  const marker = engObjectiveMarker(productSlug);
  const rows = await db
    .select({ request: agentObjectivesTable.request, status: agentObjectivesTable.status })
    .from(agentObjectivesTable)
    .where(inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval", "failed"]));
  return rows.some((r) => typeof r.request === "string" && r.request.startsWith(marker));
}

async function runEngineeringIntelligencePass(
  quinn: AiExecutive | undefined,
): Promise<EngineeringPassResult> {
  const result: EngineeringPassResult = {
    collected: false,
    changes: 0,
    memoriesRecorded: 0,
    objectiveCreated: false,
    escalated: false,
    healthScore: null,
  };

  // V10: portfolio-aware. Run the intelligence pass for every active product.
  // Each product runs its own registered providers, persists its snapshot and
  // typed events, and feeds the timeline / executive memory / objectives.
  let products: EngineeringProduct[];
  try {
    products = await getActiveProducts();
  } catch (err) {
    logger.warn({ err }, "autonomy: could not load products; skipping engineering pass");
    return result;
  }

  const execs = await db.select().from(aiExecutivesTable);
  const roleToExec = new Map<string, AiExecutive>(execs.map((e) => [e.role, e]));
  const flagship = products.find((p) => p.slug === "vybe-live") ?? products[0];

  for (const product of products) {
    try {
      await runProductEngineeringPass(
        product,
        quinn,
        roleToExec,
        result,
        flagship ? product.id === flagship.id : false,
      );
    } catch (err) {
      logger.warn({ err, product: product.slug }, "autonomy: product engineering pass failed");
    }
  }

  return result;
}

async function runProductEngineeringPass(
  product: EngineeringProduct,
  quinn: AiExecutive | undefined,
  roleToExec: Map<string, AiExecutive>,
  result: EngineeringPassResult,
  isFlagship: boolean,
): Promise<void> {
  let curr: EngineeringSnapshot;
  try {
    curr = await collectSnapshot(product);
  } catch (err) {
    logger.warn(
      { err, product: product.slug },
      "autonomy: engineering snapshot collection failed; skipping product",
    );
    return;
  }
  result.collected = true;
  if (isFlagship) result.healthScore = curr.healthScore;

  const prev = await getPreviousSnapshot(product.id);
  const changes = detectChanges(prev, curr);
  if (changes.length === 0) return; // no meaningful change for this product → skip
  result.changes += changes.length;

  // Typed engineering events emitted while collecting this snapshot — surface
  // them alongside the timeline change summary.
  const recentEvents = await getRecentEvents(product.id, 30);
  const snapEvents = recentEvents.filter((e) => e.snapshotId === curr.id);

  // 1. Update the organization timeline (scoped to the product).
  const regressed = changes.some((c) => c.significance === "regression");
  const summary = changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join("; ");
  await recordEvent({
    type: "learning",
    title: `${product.name}: engineering snapshot changed (health ${curr.healthScore}/100, launch readiness ${curr.launchReadiness.score}/100)`,
    summary: snapEvents.length
      ? `${summary}. Events: ${snapEvents.map((e) => e.title).join(", ")}`
      : summary,
    actorExecutiveId: quinn?.id ?? null,
    importance: curr.blockers.length > 0 ? "critical" : regressed ? "high" : "normal",
    keywords: ["engineering", "snapshot", product.slug, ...changes.map((c) => c.field)],
    metadata: {
      productId: product.id,
      productSlug: product.slug,
      changes,
      events: snapEvents,
      healthScore: curr.healthScore,
      launchReadiness: curr.launchReadiness,
      blockers: curr.blockers,
      deploymentRisk: curr.deploymentRisk,
      launchRisk: curr.launchRisk,
    },
  });

  // 2. Update role-scoped executive awareness as permanent memory (learning):
  // executives permanently remember deploy/build failures, successful releases,
  // and architecture/engineering decisions.
  const remember = async (
    role: string,
    kind: Parameters<typeof accumulateMemory>[0]["kind"],
    content: string,
    keywords: string[],
  ): Promise<void> => {
    const exec = roleToExec.get(role);
    if (!exec) return;
    const id = await accumulateMemory({
      executiveId: exec.id,
      kind,
      content: `[${product.name}] ${content}`,
      keywords: [...keywords, product.slug],
      refType: "engineering_snapshot",
      refId: curr.id,
    });
    if (id) result.memoriesRecorded += 1;
  };

  for (const c of changes) {
    if (c.field === "build.status") {
      if (c.significance === "regression")
        await remember("qa_director", "risk_area", `Build went ${c.to} (was ${c.from}) — guard against regressions before release.`, ["build", "regression"]);
      else
        await remember("qa_director", "success", `Build recovered to ${c.to}.`, ["build", "recovery"]);
    } else if (c.field === "deployment.productionHealth") {
      if (c.significance === "regression")
        await remember("release_manager", "risk_area", `Production health dropped to ${c.to} — hold rollout until healthy.`, ["deployment", "production"]);
      else
        await remember("release_manager", "success", `Production health restored to ${c.to}.`, ["deployment", "production"]);
    } else if (c.field === "deployment.status" && c.to === "deployed") {
      await remember("release_manager", "success", "Successful release: deployment status is now deployed.", ["release", "deployment"]);
    } else if (c.field === "repository.latestCommit") {
      await remember("cto", "project", `New commit shipped: ${curr.repository.latestCommit?.message ?? c.to}.`, ["commit", "architecture", "engineering_decision"]);
    } else if (c.field === "runtime.errors" && c.significance === "regression") {
      await remember("qa_director", "risk_area", `Runtime errors rose to ${c.to} — investigate before the next deploy.`, ["runtime", "errors"]);
    }
  }

  // 3. Create an objective ONLY when confidence is high (all providers connected)
  // and a blocker exists — and never duplicate an already-open one for the product.
  const highConfidence =
    curr.providers.length > 0 && curr.providers.every((p) => p.status === "connected");
  if (quinn && highConfidence && curr.blockers.length > 0) {
    const alreadyOpen = await hasOpenEngineeringObjective(product.slug);
    if (!alreadyOpen) {
      const request = `${engObjectiveMarker(product.slug)} ${curr.blockers.join("; ")}. ${product.name} engineering health is ${curr.healthScore}/100 with ${curr.deploymentRisk} deployment risk.`;
      // Stable key scoped to the product — detail text varies per cycle but the product never changes.
      const created = await createObjectiveAutonomously(quinn, request, `engineering:${product.slug}`);
      if (created) result.objectiveCreated = true;
    }
  }

  // 4. Escalate critical engineering blockers to the founder (approval boundary).
  if (quinn && curr.blockers.length > 0 && (curr.deploymentRisk === "high" || curr.launchRisk === "high")) {
    const escalated = await ensureApproval(
      quinn.id,
      `${product.name}: critical engineering blocker: ${curr.blockers[0]}`,
      `${product.name} engineering health ${curr.healthScore}/100. Blockers: ${curr.blockers.join("; ")}. Founder awareness required before release.`,
      "Release readiness",
      null,
    );
    if (escalated) result.escalated = true;
  }
}

export type ReflectionResult = {
  observations: { question: string; answer: string }[];
  conversationStarted: boolean;
  recommendationsProposed: number;
  memoriesAccumulated: number;
  patternsDetected: number;
  recommendationsEnriched: number;
  engineering: EngineeringPassResult;
  blockers: BlockerSummary;
};

export async function runReflection(): Promise<ReflectionResult> {
  const signals = await gatherSignals();
  const quinn = await loadQuinn();

  // 1. What changed? 2. What needs attention? 3. What can improve?
  // 4. Who needs help? 5. What would the founder notice?
  const changed =
    signals.milestones.completedSince > 0
      ? `${signals.milestones.completedSince} objective(s) completed since the last cycle.`
      : `${signals.objectives.inProgress} objective(s) advancing; portfolio ${signals.portfolio.healthy} healthy / ${signals.portfolio.attention} attention / ${signals.portfolio.critical} critical.`;

  const needsAttention =
    signals.tasks.blocked > 0 || signals.reports.critical > 0
      ? `${signals.tasks.blocked} blocked task(s) and ${signals.reports.critical} critical report(s) are gating progress.`
      : signals.portfolio.worstDimension
        ? `${signals.portfolio.worstDimension.label} on ${signals.portfolio.worstDimension.assetSlug} is ${signals.portfolio.worstDimension.status}.`
        : "Nothing urgent — the org is steady.";

  const canImprove = signals.portfolio.worstDimension
    ? `Improving ${signals.portfolio.worstDimension.label} on ${signals.portfolio.worstDimension.assetSlug} would lift overall health.`
    : "Invest idle capacity in quality and onboarding while things are calm.";

  const whoNeedsHelp =
    signals.execWorkload.peak >= 4
      ? `An executive is carrying ${signals.execWorkload.peak} active task(s) — consider rebalancing.`
      : signals.execWorkload.idle > 0
        ? `${signals.execWorkload.idle} executive(s) have spare capacity for proactive work.`
        : "Workload looks balanced across the team.";

  const founderWouldNotice =
    signals.approvals.pending > 0
      ? `${signals.approvals.pending} approval(s) are waiting on the founder.`
      : signals.milestones.completedSince > 0
        ? `Recent wins worth surfacing: ${signals.milestones.titles.slice(0, 2).join(", ")}.`
        : "No founder-facing decisions pending right now.";

  const observations = [
    { question: "What changed?", answer: changed },
    { question: "What needs attention?", answer: needsAttention },
    { question: "What can be improved?", answer: canImprove },
    { question: "Who needs help?", answer: whoNeedsHelp },
    { question: "What would the founder notice?", answer: founderWouldNotice },
  ];

  await recordEvent({
    type: "reflection",
    title: "Quinn reflected on the state of the company",
    summary: observations.map((o) => `${o.question} ${o.answer}`).join(" "),
    actorExecutiveId: quinn?.id ?? null,
    importance: "low",
    keywords: ["reflection", "quinn", "coordination"],
    metadata: { observations },
  });

  // Opportunistic liveliness: if no executive conversation is currently open,
  // spark one seeded by the most pressing signal.
  let conversationStarted = false;
  const openConversations = await getOpenConversationCount();
  if (openConversations === 0) {
    const hint = signals.tasks.blocked > 0 || signals.reports.critical > 0
      ? "deployment risk"
      : signals.portfolio.worstDimension?.label;
    const conv = await generateConversation({ topicHint: hint });
    conversationStarted = conv !== null;
  }

  // If there are no pending recommendations, have executives propose some.
  let recommendationsProposed = 0;
  const pendingRecs = await getPendingRecommendationCount();
  if (pendingRecs === 0) {
    const proposed = await proposeRecommendations({ count: 2 });
    recommendationsProposed = proposed.created;
  }

  // V9 Connected Intelligence: each cycle the org learns from its own history.
  // 1. Executives accumulate professional memory from recent work.
  const accumulated = await accumulateFromRecentWork({ perType: 6 });
  // 2. Repeated discussion patterns become proactive recommendations.
  const patterns = await detectRepeatedDiscussionPatterns({});
  // 3. Pending recommendations are re-enriched with fresh evidence + citations.
  const enriched = await enrichPendingRecommendations();

  // V10 Engineering Intelligence: Quinn reasons from the normalized snapshot and
  // acts only on meaningful engineering change.
  const engineering = await runEngineeringIntelligencePass(quinn);

  // V11.1 Autonomous Blocker Resolution: the actual classify/route/progress pass
  // runs once per cycle inside runAutonomousCycle. Reflection only reads the
  // resulting summary so a single scheduled tick never advances retries twice.
  const blockers = await getBlockerSummary();
  observations.push({
    question: "How are blockers being resolved?",
    answer:
      blockers.active === 0 && blockers.resolved === 0
        ? "No active blockers — the resolution engine found nothing to route."
        : `${blockers.active} active blocker(s): ${blockers.byCategory.autonomous} autonomous, ` +
          `${blockers.byCategory.connected} connected, ${blockers.byStatus.awaiting_approval} awaiting approval, ` +
          `${blockers.byCategory.human_required} need a human. ${blockers.resolved} resolved all-time` +
          `${blockers.failed > 0 ? `, ${blockers.failed} with no autonomous path left` : ""}.`,
  });

  logger.info(
    {
      conversationStarted,
      recommendationsProposed,
      memoriesAccumulated: accumulated.created,
      patternsDetected: patterns.created,
      recommendationsEnriched: enriched.enriched,
      engineeringChanges: engineering.changes,
      engineeringHealth: engineering.healthScore,
      blockersActive: blockers.active,
      blockersResolved: blockers.resolved,
      blockersFailed: blockers.failed,
    },
    "autonomy: reflection complete",
  );
  return {
    observations,
    conversationStarted,
    recommendationsProposed,
    memoriesAccumulated: accumulated.created,
    patternsDetected: patterns.created,
    recommendationsEnriched: enriched.enriched,
    engineering,
    blockers,
  };
}

// ─── Operational Review (V11.2) ─────────────────────────────────────────────────
//
// When the founder's approval queue is empty, Quinn must NEVER passively wait.
// Instead she runs a full operational review: an autonomy cycle (which refreshes
// the portfolio read, retries connected/autonomous blockers, and opens objectives
// for launch-critical gaps), refreshes Engineering Intelligence, rebalances
// workload from overloaded executives to idle ones, and reports an operational
// summary. She only falls back to "what would you like me to prepare?" when work
// is genuinely impossible: autonomy disabled, no projects, or nothing left to do.

/** Rebalance backlog work from the most-loaded executives onto idle ones. */
async function reassignWorkload(quinnId: string | null): Promise<number> {
  const execs = await db
    .select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name, role: aiExecutivesTable.role })
    .from(aiExecutivesTable);
  if (execs.length === 0) return 0;

  // Active (in-flight) task load per executive across reassignable states.
  const activeRows = await db
    .select({ executiveId: agentTasksTable.executiveId })
    .from(agentTasksTable)
    .where(inArray(agentTasksTable.status, ["backlog", "in_progress", "blocked", "review"]));
  const load = new Map<string, number>();
  for (const e of execs) load.set(e.id, 0);
  for (const r of activeRows) load.set(r.executiveId, (load.get(r.executiveId) ?? 0) + 1);

  // Idle targets: zero active load AND not the Chief of Staff (Quinn coordinates,
  // she does not take fan-out tasks).
  const idle = execs.filter((e) => e.role !== "chief_of_staff" && (load.get(e.id) ?? 0) === 0);
  if (idle.length === 0) return 0;

  // Only un-started backlog tasks are safe to move (never in-progress work).
  const movable = await db
    .select({ id: agentTasksTable.id, executiveId: agentTasksTable.executiveId, title: agentTasksTable.title })
    .from(agentTasksTable)
    .where(eq(agentTasksTable.status, "backlog"));
  if (movable.length === 0) return 0;

  const backlogByExec = new Map<string, { id: string; title: string }[]>();
  for (const t of movable) {
    const arr = backlogByExec.get(t.executiveId) ?? [];
    arr.push({ id: t.id, title: t.title });
    backlogByExec.set(t.executiveId, arr);
  }

  const idleQueue = [...idle];
  let reassigned = 0;

  // Greedily move one backlog task at a time from the currently most-loaded exec
  // (that has a spare backlog task AND more than one active task) to an idle exec,
  // re-evaluating load after each move so we converge toward balance.
  while (idleQueue.length > 0) {
    let donorId: string | null = null;
    let donorLoad = 1;
    for (const e of execs) {
      const l = load.get(e.id) ?? 0;
      const hasSpare = (backlogByExec.get(e.id)?.length ?? 0) > 0;
      if (hasSpare && l > donorLoad) {
        donorLoad = l;
        donorId = e.id;
      }
    }
    if (!donorId) break;

    const task = backlogByExec.get(donorId)!.shift()!;
    const target = idleQueue.shift()!;
    await db
      .update(agentTasksTable)
      .set({ executiveId: target.id, createdByExecutiveId: quinnId, updatedAt: new Date() })
      .where(eq(agentTasksTable.id, task.id));
    load.set(donorId, (load.get(donorId) ?? 1) - 1);
    load.set(target.id, (load.get(target.id) ?? 0) + 1);
    reassigned += 1;

    const donor = execs.find((e) => e.id === donorId);
    await recordEvent({
      type: "reflection",
      title: `Workload rebalanced: ${target.name} picked up "${task.title}"`,
      summary: `Quinn reassigned a backlog task from ${donor?.name ?? "an overloaded executive"} to ${target.name} to keep launch work moving.`,
      actorExecutiveId: quinnId,
      refType: "task",
      refId: task.id,
      importance: "low",
      keywords: ["workload", "reassignment", "autonomy"],
      metadata: { from: donorId, to: target.id, outcome: "reassigned" },
    }).catch(() => {});
  }

  return reassigned;
}

export type OperationalReviewResult = {
  /** true when Quinn actually advanced work; false only when genuinely idle. */
  ran: boolean;
  idleReason?: "autonomy_disabled" | "no_projects" | "no_work_remaining";
  launchBlockers: number;
  activeObjectives: number;
  executivesReassigned: number;
  objectivesCreated: number;
  engineeringHealth: number | null;
  launchReadiness: number | null;
  summary: string;
};

/**
 * Run a full operational review. Called when the approval queue is empty so Quinn
 * keeps the launch moving instead of waiting on the founder.
 */
export async function runOperationalReview(): Promise<OperationalReviewResult> {
  const idle = (n: OperationalReviewResult["idleReason"]): OperationalReviewResult => ({
    ran: false,
    idleReason: n,
    launchBlockers: 0,
    activeObjectives: 0,
    executivesReassigned: 0,
    objectivesCreated: 0,
    engineeringHealth: null,
    launchReadiness: null,
    summary: "",
  });

  // Guard 1: autonomy explicitly disabled.
  if (process.env.MISSION_CONTROL_AUTONOMY_DISABLED === "true") {
    return idle("autonomy_disabled");
  }

  // Guard 2: no projects to operate on.
  const products = await getActiveProducts();
  if (products.length === 0) {
    return idle("no_projects");
  }

  const quinn = await loadQuinn();

  // 1. Full autonomy cycle: refreshes portfolio, retries connected/autonomous
  //    blockers, and opens objectives for launch-critical gaps.
  const cycle = await runAutonomousCycle({ trigger: "manual" });
  const objectivesCreated = cycle.actions.filter((a) => a.type === "create_objective").length;

  // 2. Refresh Engineering Intelligence (the cycle itself does not run this pass).
  if (quinn) {
    await runEngineeringIntelligencePass(quinn).catch((err) => {
      logger.warn({ err }, "operational review: engineering pass failed");
    });
  }

  // 3. Rebalance workload from overloaded to idle executives.
  const executivesReassigned = await reassignWorkload(quinn?.id ?? null).catch((err) => {
    logger.warn({ err }, "operational review: workload reassignment failed");
    return 0;
  });

  // 4. Gather metrics for the operational summary.
  const blockerSummary = await getBlockerSummary();
  const launchBlockers = blockerSummary.active;

  const objRows = await db
    .select({ status: agentObjectivesTable.status, n: count() })
    .from(agentObjectivesTable)
    .where(inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval"]))
    .groupBy(agentObjectivesTable.status);
  const activeObjectives = objRows.reduce((sum, r) => sum + r.n, 0);

  let engineeringHealth: number | null = null;
  let launchReadiness: number | null = null;
  try {
    const snap = await getFlagshipSnapshot();
    engineeringHealth = snap.healthScore;
    launchReadiness = computeLaunchReadiness(snap).score;
  } catch (err) {
    logger.warn({ err }, "operational review: snapshot metrics unavailable");
  }

  // 5. Update the timeline with the review outcome.
  await recordEvent({
    type: "reflection",
    title: "Quinn completed an operational review",
    summary:
      `Approval queue clear — ran an operational review: ${launchBlockers} launch blocker(s), ` +
      `${activeObjectives} active objective(s), ${objectivesCreated} new objective(s), ` +
      `${executivesReassigned} reassignment(s)` +
      `${engineeringHealth !== null ? `, engineering health ${engineeringHealth}%` : ""}` +
      `${launchReadiness !== null ? `, launch readiness ${launchReadiness}%` : ""}.`,
    actorExecutiveId: quinn?.id ?? null,
    importance: "normal",
    keywords: ["operational_review", "autonomy", "launch"],
    metadata: { launchBlockers, activeObjectives, objectivesCreated, executivesReassigned },
  }).catch(() => {});

  // 6. Decide whether there was genuinely any work. Only when every monitored
  //    surface is clear do we let Quinn ask the founder what to prepare.
  const hasWork =
    launchBlockers > 0 ||
    activeObjectives > 0 ||
    objectivesCreated > 0 ||
    executivesReassigned > 0 ||
    (engineeringHealth !== null && engineeringHealth < 100) ||
    (launchReadiness !== null && launchReadiness < 100);

  const summary =
    `Approval queue is clear.\n\n` +
    `I completed an operational review.\n\n` +
    `• ${launchBlockers} launch blocker${launchBlockers !== 1 ? "s" : ""} remain.\n` +
    `• ${activeObjectives} objective${activeObjectives !== 1 ? "s" : ""} ${activeObjectives === 1 ? "is" : "are"} active.\n` +
    `• ${executivesReassigned} executive${executivesReassigned !== 1 ? "s were" : " was"} reassigned.\n` +
    `• ${objectivesCreated} new objective${objectivesCreated !== 1 ? "s were" : " was"} created.\n` +
    `• Engineering health: ${engineeringHealth !== null ? `${engineeringHealth}%` : "unknown"}.\n` +
    `• Launch readiness: ${launchReadiness !== null ? `${launchReadiness}%` : "unknown"}.\n\n` +
    `No Founder action is required at this time.`;

  if (!hasWork) {
    return { ...idle("no_work_remaining"), engineeringHealth, launchReadiness };
  }

  return {
    ran: true,
    launchBlockers,
    activeObjectives,
    executivesReassigned,
    objectivesCreated,
    engineeringHealth,
    launchReadiness,
    summary,
  };
}

// ─── Phase 8: processObjectives + Autonomy Scheduler ──────────────────────────
// processObjectives scans every in_progress objective that has no active Agent Zero
// job and triggers a CoS cycle to auto-dispatch one (via Quinn's runCycle Step 7).
// startAutonomyScheduler drives a recurring autonomy loop with a configurable cadence.

let _schedulerRunning = false;
let _schedulerStartedAt: string | null = null;
let _schedulerIntervalMs = 5 * 60 * 1000;
let _stopScheduler: (() => void) | null = null;

export async function processObjectives(): Promise<{ ran: boolean; cycleId?: string; summary?: string }> {
  try {
    const { getQuinnChiefOfStaff } = await import("./os/QuinnChiefOfStaff.js");
    const cos = getQuinnChiefOfStaff();
    const result = await cos.runCycle();
    return { ran: true, cycleId: result.cycleId, summary: result.summary };
  } catch (err) {
    logger.warn({ err }, "autonomy: processObjectives cycle failed");
    return { ran: false };
  }
}

export function startAutonomyScheduler(intervalMs = 5 * 60 * 1000): () => void {
  if (_schedulerRunning) {
    logger.warn("autonomy: scheduler already running — ignoring duplicate start");
    return _stopScheduler ?? (() => {});
  }

  _schedulerRunning = true;
  _schedulerStartedAt = new Date().toISOString();
  _schedulerIntervalMs = intervalMs;

  logger.info({ intervalMs }, "autonomy: scheduler started");

  const timer = setInterval(async () => {
    try {
      await processObjectives();
    } catch (err) {
      logger.warn({ err }, "autonomy: scheduled processObjectives failed");
    }
  }, intervalMs);

  timer.unref?.(); // don't hold the process open in test environments

  const stop = () => {
    clearInterval(timer);
    _schedulerRunning = false;
    logger.info("autonomy: scheduler stopped");
  };
  _stopScheduler = stop;
  return stop;
}

export function getAutonomySchedulerStatus(): {
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
} {
  return {
    running: _schedulerRunning,
    intervalMs: _schedulerIntervalMs,
    startedAt: _schedulerStartedAt,
  };
}