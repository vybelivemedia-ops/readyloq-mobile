// ─── Mission Control OS Layer — Quinn Chief of Staff (Phase 4) ────────────────
//
// Quinn coordinates the executive team. Her role is pure orchestration:
//   • Prioritize objectives by urgency and impact (heuristic-driven)
//   • Assign unowned objectives to the right executive by domain keywords
//   • Monitor blocked and stalled work
//   • Escalate critical issues to the founder (approval records)
//   • Balance executive workload
//
// ─── HARD GUARDRAILS ──────────────────────────────────────────────────────────
// Quinn NEVER:
//   • Writes source code or modifies files
//   • Triggers builds, deployments, or CI/CD pipelines
//   • Invokes EAS, Replit deploy, or any external automation
//   • Self-resolves escalations — she surfaces them to the founder only
//
// Quinn ONLY:
//   • Reads objective state (ObjectiveStateStore)
//   • Updates objective state: owner, priority, nextAction, execution entries
//   • Creates approval records (escalations to founder)
//   • Emits EventBus coordination events
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import { db, agentApprovalsTable, aiExecutivesTable, agentZeroJobsTable, agentObjectivesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { createAgentZeroJob } from "../agentZero.js";
import { getObjectiveStateStore } from "./ObjectiveStateStore.js";
import { getExecutiveRegistry } from "./ExecutiveRegistry.js";
import { getEventBus } from "./EventBus.js";
import type {
  RichObjectiveState,
  ObjectivePriority,
  CoSDecision,
  WorkloadItem,
  BlockedObjective,
  BlockedReason,
  CoSCycleResult,
  ChiefOfStaffStatus,
} from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max objectives per exec before they are flagged as overloaded. */
const OVERLOAD_THRESHOLD = 4;

/** Ms since last execution entry before an objective is flagged as stalled. */
const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 h

/** Objective statuses that are "active" and require CoS attention. */
const ACTIVE_STATUSES = new Set(["planning", "in_progress", "needs_approval"]);

/**
 * Domain keyword → exec role mapping for auto-assignment.
 * Each pattern is tested against the objective title (case-insensitive).
 * First match wins.
 */
const KEYWORD_MAP: Array<[RegExp, string]> = [
  [
    /\b(code|engineer|architect|api|backend|frontend|database|db|schema|typescript|node\.?js|server|refactor|library|package|integration|endpoint|migration)\b/i,
    "cto",
  ],
  [
    /\b(test|qa|quality|bug|regression|coverage|lint|spec|audit|error|crash|fix|debug|flaky)\b/i,
    "qa_director",
  ],
  [
    /\b(release|ship|version|tag|ci|cd|pipeline|production|staging|hotfix|patch|rollout|deploy)\b/i,
    "release_manager",
  ],
  [
    /\b(product|roadmap|feature|backlog|milestone|sprint|requirement|user story|user research|ux research|prd)\b/i,
    "product_manager",
  ],
  [
    /\b(design|ui|ux|visual|brand|branding|theme|colour|color|typography|component|mockup|wireframe|figma|icon|illustration)\b/i,
    "creative_director",
  ],
  [
    /\b(market|marketing|campaign|seo|social media|launch plan|press|blog|content|acquisition|growth|waitlist|ads|copy)\b/i,
    "marketing_director",
  ],
];

/** Roles eligible to receive auto-assigned objectives (never Quinn herself). */
const ASSIGNABLE_ROLES = new Set([
  "cto",
  "qa_director",
  "release_manager",
  "product_manager",
  "creative_director",
  "marketing_director",
]);

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Returns milliseconds since the last recorded execution entry (or since createdAt). */
function msSinceLastActivity(obj: RichObjectiveState): number {
  const history = obj.executionHistory ?? [];
  if (history.length > 0) {
    const last = history[history.length - 1]!;
    return Date.now() - new Date(last.timestamp).getTime();
  }
  const created = obj.createdAt;
  if (created) {
    return Date.now() - created.getTime();
  }
  return 0;
}

/** Heuristically derives the correct priority for an objective. */
function inferPriority(obj: RichObjectiveState): ObjectivePriority {
  if (obj.status === "needs_approval") return "critical";
  const staleMs = msSinceLastActivity(obj);
  if (staleMs > STALL_THRESHOLD_MS * 2) return "high";
  if ((obj.dependencies ?? []).length > 0) return "high";
  if ((obj.retryCount ?? 0) > 1) return "high";
  if (staleMs > STALL_THRESHOLD_MS) return "medium";
  return (obj.priority as ObjectivePriority | null | undefined) ?? "medium";
}

/** Returns the first matching role for a given objective title, or null. */
function matchRole(title: string): string | null {
  for (const [pattern, role] of KEYWORD_MAP) {
    if (pattern.test(title)) return role;
  }
  return null;
}

// ─── QuinnChiefOfStaff ────────────────────────────────────────────────────────

export class QuinnChiefOfStaff {
  private _status: ChiefOfStaffStatus = {
    lastCycleAt: null,
    lastCycleDecisionCount: 0,
    totalCyclesRun: 0,
    blockedCount: 0,
    overloadedExecCount: 0,
  };

  /** Returns a copy of the current CoS runtime status (no I/O). */
  get status(): ChiefOfStaffStatus {
    return { ...this._status };
  }

  // ── 1. Workload assessment ─────────────────────────────────────────────────

  /**
   * Returns a per-executive workload breakdown based on current objective
   * ownership. Read-only — no mutations.
   */
  async assessWorkload(): Promise<WorkloadItem[]> {
    const store = getObjectiveStateStore();
    const registry = getExecutiveRegistry();

    const [allObjectives, execDescriptors] = await Promise.all([
      store.getAll(),
      Promise.resolve(registry.all()),
    ]);

    const active = allObjectives.filter((o) => ACTIVE_STATUSES.has(o.status ?? ""));

    const items: WorkloadItem[] = execDescriptors
      .filter((e) => ASSIGNABLE_ROLES.has(e.role))
      .map((e) => {
        const owned = active.filter((o) => o.ownerRole === e.role);
        const byPriority: Record<string, number> = {};
        for (const o of owned) {
          const p = (o.priority as string | null | undefined) ?? "medium";
          byPriority[p] = (byPriority[p] ?? 0) + 1;
        }
        return {
          role: e.role,
          name: e.name,
          execId: e.role,
          objectiveCount: owned.length,
          byPriority,
          overloaded: owned.length >= OVERLOAD_THRESHOLD,
        };
      });

    return items.sort((a, b) => b.objectiveCount - a.objectiveCount);
  }

  // ── 2. Blocked-work detection ──────────────────────────────────────────────

  /**
   * Scans all active objectives for three blocking signals:
   *   • no_owner          — ownerRole is null (nothing can proceed)
   *   • unmet_dependency  — has deps that aren't done
   *   • stalled_progress  — no execution entry for > STALL_THRESHOLD_MS
   *
   * Read-only — no mutations.
   */
  async findBlockedObjectives(): Promise<BlockedObjective[]> {
    const store = getObjectiveStateStore();
    const allObjectives = await store.getAll();

    const byId = new Map(allObjectives.map((o) => [o.id, o]));
    const active = allObjectives.filter((o) => ACTIVE_STATUSES.has(o.status ?? ""));

    const blocked: BlockedObjective[] = [];

    for (const obj of active) {
      // Priority 1: no owner (nothing can start).
      if (!obj.ownerRole) {
        blocked.push({
          id: obj.id,
          title: obj.title,
          status: obj.status ?? "planning",
          blockedReason: "no_owner" as BlockedReason,
        });
        continue;
      }

      // Priority 2: unmet dependencies.
      const deps = (obj.dependencies as string[] | null | undefined) ?? [];
      if (deps.length > 0) {
        const unmet = deps.filter((depId) => {
          const dep = byId.get(depId);
          return !dep || dep.status !== "completed";
        });
        if (unmet.length > 0) {
          blocked.push({
            id: obj.id,
            title: obj.title,
            status: obj.status ?? "in_progress",
            blockedReason: "unmet_dependency" as BlockedReason,
            dependencyIds: unmet,
          });
          continue;
        }
      }

      // Priority 3: stalled progress.
      const staleMs = msSinceLastActivity(obj);
      if (staleMs > STALL_THRESHOLD_MS) {
        const last = (obj.executionHistory ?? []).slice(-1)[0];
        blocked.push({
          id: obj.id,
          title: obj.title,
          status: obj.status ?? "in_progress",
          blockedReason: "stalled_progress" as BlockedReason,
          lastActivityAt: (last?.timestamp instanceof Date ? last.timestamp.toISOString() : null) ?? (obj.createdAt ? obj.createdAt.toISOString() : null),
          stalledForMs: staleMs,
        });
      }
    }

    return blocked;
  }

  // ── 3. Objective prioritisation ────────────────────────────────────────────

  /**
   * Heuristically reassesses all active objectives and updates priorities via
   * ObjectiveStateStore. Returns decisions for objectives where the priority
   * actually changed.
   */
  async prioritizeObjectives(): Promise<CoSDecision[]> {
    const store = getObjectiveStateStore();
    const allObjectives = await store.getAll();
    const active = allObjectives.filter((o) => ACTIVE_STATUSES.has(o.status ?? ""));

    const decisions: CoSDecision[] = [];

    await Promise.all(
      active.map(async (obj) => {
        const newPriority = inferPriority(obj);
        const oldPriority = (obj.priority as string | null | undefined) ?? "medium";
        if (newPriority === oldPriority) return;

        const ok = await store.updatePriority(obj.id, newPriority, "quinn/chief_of_staff");
        if (!ok) return;

        decisions.push({
          kind: "priority_change",
          objectiveId: obj.id,
          objectiveTitle: obj.title,
          from: oldPriority,
          to: newPriority,
          reason: "Quinn reassessed priority based on objective state, age, and dependencies",
          appliedAt: new Date().toISOString(),
        });
      }),
    );

    logger.info({ changed: decisions.length }, "QuinnCoS: prioritizeObjectives complete");
    return decisions;
  }

  // ── 4. Auto-assignment ─────────────────────────────────────────────────────

  /**
   * Assigns all unowned active objectives to the most appropriate executive
   * using keyword matching on the objective title. Skips when no keyword
   * match is found — Quinn never guesses blindly.
   *
   * Logs every assignment as an execution entry on the objective.
   */
  async autoAssign(): Promise<CoSDecision[]> {
    const store = getObjectiveStateStore();
    const registry = getExecutiveRegistry();
    const allObjectives = await store.getAll();

    const unowned = allObjectives.filter(
      (o) => ACTIVE_STATUSES.has(o.status ?? "") && !o.ownerRole,
    );

    const execsByRole = new Map(registry.all().map((e) => [e.role, e]));
    const decisions: CoSDecision[] = [];

    await Promise.all(
      unowned.map(async (obj) => {
        const role = matchRole(obj.title);
        if (!role || !execsByRole.has(role)) return;

        const exec = execsByRole.get(role)!;
        const ok = await store.updateOwner(obj.id, role, "quinn/chief_of_staff");
        if (!ok) return;

        await store.appendExecutionEntry(obj.id, {
          action: `Assigned to ${exec.name ?? role} by Quinn (Chief of Staff)`,
          source: "quinn/chief_of_staff",
          outcome: "success",
          detail: `Title keyword match → domain "${role}"`,
        });

        decisions.push({
          kind: "assign",
          objectiveId: obj.id,
          objectiveTitle: obj.title,
          from: "unassigned",
          to: role,
          reason: `Objective title matched "${role}" domain keywords`,
          appliedAt: new Date().toISOString(),
        });
      }),
    );

    logger.info({ assigned: decisions.length }, "QuinnCoS: autoAssign complete");
    return decisions;
  }

  // ── 5. Escalation ─────────────────────────────────────────────────────────

  /**
   * Creates a pending approval record (escalation to the founder) for a
   * critical objective issue and logs it as an execution entry.
   *
   * Quinn NEVER self-resolves escalations — she surfaces them to the founder.
   */
  async escalateIssue(
    objectiveId: string,
    objectiveTitle: string,
    reason: string,
  ): Promise<CoSDecision | null> {
    const store = getObjectiveStateStore();
    const registry = getExecutiveRegistry();

    const quinnDesc = registry.all().find((e) => e.role === "chief_of_staff");
    if (!quinnDesc) {
      logger.warn({ objectiveId }, "QuinnCoS: cannot escalate — chief_of_staff not in registry");
      return null;
    }

    try {
      const approvalId = randomUUID();
      const [quinnRow] = await db
        .select({ id: aiExecutivesTable.id })
        .from(aiExecutivesTable)
        .where(eq(aiExecutivesTable.role, "chief_of_staff"))
        .limit(1);
      if (!quinnRow) {
        logger.warn({ objectiveId }, "QuinnCoS: chief_of_staff row not in DB, skipping approval insert");
        return null;
      }
      await db.insert(agentApprovalsTable).values({
        id: approvalId,
        objectiveId,
        executiveId: quinnRow.id,
        title: `[Quinn escalation] ${objectiveTitle}`,
        detail: reason,
        impact: "high",
        status: "pending",
      });

      await store.appendExecutionEntry(objectiveId, {
        action: "Escalated to founder by Quinn (Chief of Staff)",
        source: "quinn/chief_of_staff",
        outcome: "in_progress",
        detail: reason,
      });

      await getEventBus().emit(
        "mc.approval.created",
        {
          approvalId,
          objectiveId,
          reason: `Quinn (Chief of Staff) escalation: ${reason}`,
          requestedBy: quinnDesc.role,
          category: "external" as const,
        },
        "os/QuinnChiefOfStaff",
      );

      logger.info({ approvalId, objectiveId }, "QuinnCoS: escalation created");

      return {
        kind: "escalate",
        objectiveId,
        objectiveTitle,
        reason,
        appliedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err, objectiveId }, "QuinnCoS: escalation failed");
      return null;
    }
  }

  // ── 6. Full cycle ──────────────────────────────────────────────────────────

  /**
   * Orchestrates a complete Chief of Staff coordination cycle:
   *   1. Prioritize all active objectives
   *   2. Auto-assign unowned objectives
   *   3. Find all blocked / stalled work
   *   4. Escalate objectives stalled > 48h to the founder
   *   5. Assess per-executive workload and flag overloaded execs
   *   6. Compile a human-readable summary
   *
   * Returns the full CoSCycleResult. Does NOT write code, trigger builds,
   * or perform deployments.
   */
  async runCycle(): Promise<CoSCycleResult> {
    const cycleId = randomUUID();
    const startedAt = new Date().toISOString();
    const decisions: CoSDecision[] = [];

    logger.info({ cycleId }, "QuinnCoS: cycle started");

    // Step 1 — Prioritize
    const priorityDecisions = await this.prioritizeObjectives();
    decisions.push(...priorityDecisions);

    // Step 2 — Auto-assign unowned objectives
    const assignDecisions = await this.autoAssign();
    decisions.push(...assignDecisions);

    // Step 3 — Find blocked work
    const blocked = await this.findBlockedObjectives();

    // Step 4 — Escalate objectives stalled beyond 48h
    const criticalThreshold = STALL_THRESHOLD_MS * 2;
    const toEscalate = blocked.filter(
      (b) => b.blockedReason === "stalled_progress" && (b.stalledForMs ?? 0) > criticalThreshold,
    );
    for (const b of toEscalate) {
      const hours = Math.round((b.stalledForMs ?? 0) / 3_600_000);
      const decision = await this.escalateIssue(
        b.id,
        b.title,
        `Objective stalled for ${hours}h with no recorded activity. Founder review required.`,
      );
      if (decision) decisions.push(decision);
    }

    // Step 5 — Assess workload
    const workload = await this.assessWorkload();
    const overloaded = workload.filter((w) => w.overloaded);
    for (const exec of overloaded) {
      decisions.push({
        kind: "balance",
        objectiveId: "",
        objectiveTitle: "",
        from: exec.role,
        reason: `${exec.name ?? exec.role} owns ${exec.objectiveCount} active objectives (overload threshold: ${OVERLOAD_THRESHOLD})`,
        appliedAt: new Date().toISOString(),
      });
    }

    const completedAt = new Date().toISOString();

    // Step 6 — Human-readable summary
    const parts: string[] = [];
    if (decisions.length === 0) {
      parts.push("No changes required — all objectives are on track.");
    } else {
      const summaryItems = [
        priorityDecisions.length > 0 ? `${priorityDecisions.length} priority update(s)` : null,
        assignDecisions.length > 0 ? `${assignDecisions.length} auto-assignment(s)` : null,
        toEscalate.length > 0 ? `${toEscalate.length} escalation(s)` : null,
        overloaded.length > 0 ? `${overloaded.length} workload warning(s)` : null,
      ].filter(Boolean);
      parts.push(`${decisions.length} decision(s): ${summaryItems.join(", ")}.`);
    }
    if (blocked.length > 0) {
      parts.push(`${blocked.length} objective(s) currently blocked.`);
    }

    const summary = parts.join(" ");

    // Update runtime status
    this._status = {
      lastCycleAt: completedAt,
      lastCycleDecisionCount: decisions.length,
      totalCyclesRun: this._status.totalCyclesRun + 1,
      blockedCount: blocked.length,
      overloadedExecCount: overloaded.length,
    };

    logger.info(
      { cycleId, decisions: decisions.length, blocked: blocked.length, overloaded: overloaded.length },
      "QuinnCoS: cycle complete",
    );

    // Step 7 — Auto-dispatch Agent Zero for in_progress objectives with no active job.
    void this.autoDispatchAgentZero().catch((err) =>
      logger.warn({ err }, "QuinnCoS: AZ auto-dispatch failed"),
    );

    return { cycleId, startedAt, completedAt, decisions, workload, blocked, summary };
  }

  /** Fire-and-forget: dispatch an execute_objective job for any in_progress
   *  objective that has no currently queued or running Agent Zero job. */
  private async autoDispatchAgentZero(): Promise<void> {
    const inProgressObjs = await db
      .select({ id: agentObjectivesTable.id, title: agentObjectivesTable.title, priority: agentObjectivesTable.priority, ownerRole: agentObjectivesTable.ownerRole })
      .from(agentObjectivesTable)
      .where(inArray(agentObjectivesTable.status, ["in_progress", "planning"]));

    if (inProgressObjs.length === 0) return;

    const activeJobs = await db
      .select({ objectiveId: agentZeroJobsTable.objectiveId })
      .from(agentZeroJobsTable)
      .where(
        and(
          inArray(agentZeroJobsTable.status, ["queued", "running", "paused", "waiting_approval"]),
          inArray(
            agentZeroJobsTable.objectiveId,
            inProgressObjs.map((o) => o.id),
          ),
        ),
      );

    const coveredIds = new Set(activeJobs.map((j) => j.objectiveId).filter(Boolean));

    let dispatched = 0;
    for (const obj of inProgressObjs) {
      if (dispatched >= 3) break; // max 3 dispatches per cycle to avoid flooding
      if (coveredIds.has(obj.id)) continue;
      await createAgentZeroJob({
        commandType: "execute_objective",
        instruction: `Drive the in-progress objective: "${obj.title}". Decompose execution workstreams, collect intelligence, and report findings to Quinn.`,
        title: `Execute objective: ${obj.title.slice(0, 120)}`,
        objectiveId: obj.id,
        priority: obj.priority === "critical" ? 9 : obj.priority === "high" ? 7 : 5,
      }).catch((err: unknown) =>
        logger.warn({ err, objectiveId: obj.id }, "QuinnCoS: failed to auto-dispatch AZ for objective"),
      );
      // Flip the owning executive to "active" so the HQ roster reflects real work in progress.
      if (obj.ownerRole) {
        await db
          .update(aiExecutivesTable)
          .set({ status: "active", statusMessage: `Working on: ${obj.title.slice(0, 80)}`, updatedAt: new Date() })
          .where(sql`"role" = ${obj.ownerRole}`)
          .catch((err: unknown) => logger.warn({ err, role: obj.ownerRole }, "QuinnCoS: exec status update failed"));
      }
      dispatched++;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _cos: QuinnChiefOfStaff | null = null;

/** Returns the process-singleton QuinnChiefOfStaff, creating it on first call. */
export function getQuinnChiefOfStaff(): QuinnChiefOfStaff {
  if (!_cos) _cos = new QuinnChiefOfStaff();
  return _cos;
}
