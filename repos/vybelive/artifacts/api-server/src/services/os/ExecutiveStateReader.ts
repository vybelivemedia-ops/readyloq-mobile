// ─── Mission Control OS Layer — Executive State Reader (Phase 3) ──────────────
//
// Read-only query surface that executives use to get their operational context.
// Replaces conversational memory / chat-history lookups entirely.
//
// Every executive that needs context calls one of:
//   getContextForRole(role)   → ExecutiveContext (full workload + system state)
//   getObjectiveContext(id)   → RichObjectiveState | null (single objective)
//   getSummaryText(role)      → string (prompt-injectable summary)
//
// Design rules:
//   • Read-only — no mutations here. Use ObjectiveStateStore to write.
//   • All data comes from ObjectiveStateStore (DB-backed), never from memory
//     or chat session state.
//   • Returns serialisable objects safe for API responses and LLM prompts.
//   • Never throws — returns empty context on error.

import { getObjectiveStateStore } from "./ObjectiveStateStore.js";
import { getStateEngine, STATE_KEYS } from "./StateEngine.js";
import { logger } from "../../lib/logger.js";
import type { RichObjectiveState, ExecutiveContext, ObjectiveStatus } from "./types.js";

// ─── ExecutiveStateReader class ───────────────────────────────────────────────

export class ExecutiveStateReader {
  private readonly _stateStore = getObjectiveStateStore();
  private readonly _engine = getStateEngine();

  /**
   * Returns the full operational context for an executive role.
   *
   * This is the Phase 3 replacement for chat-history and memory lookups.
   * Executives call this to understand their current workload without
   * touching any conversation or session data.
   *
   * Context includes:
   *   • All objectives owned by this role (full rich state)
   *   • Snapshot of global OS state metrics (from StateEngine in-memory store)
   *   • All in-progress objectives across the whole system (cross-role awareness)
   */
  async getContextForRole(role: string): Promise<ExecutiveContext> {
    try {
      const [ownedObjectives, activeSystemObjectives] = await Promise.all([
        this._stateStore.getByOwner(role),
        this._stateStore.getAll({ status: "in_progress" as ObjectiveStatus }),
      ]);

      return {
        role,
        ownedObjectives,
        systemState: {
          activeObjectiveCount:
            this._engine.get<number>(STATE_KEYS.ACTIVE_OBJECTIVE_COUNT) ?? 0,
          pendingApprovalCount:
            this._engine.get<number>(STATE_KEYS.PENDING_APPROVAL_COUNT) ?? 0,
          lastAutonomyCycleAt:
            this._engine.get<string>(STATE_KEYS.LAST_AUTONOMY_CYCLE_AT) ?? null,
          agentZeroHealthy:
            this._engine.get<boolean>(STATE_KEYS.AGENT_ZERO_HEALTHY) ?? false,
        },
        activeSystemObjectives,
        queriedAt: new Date(),
      };
    } catch (err) {
      logger.warn({ err, role }, "os/ExecutiveStateReader.getContextForRole: failed — returning empty context");
      return {
        role,
        ownedObjectives: [],
        systemState: {
          activeObjectiveCount: 0,
          pendingApprovalCount: 0,
          lastAutonomyCycleAt: null,
          agentZeroHealthy: false,
        },
        activeSystemObjectives: [],
        queriedAt: new Date(),
      };
    }
  }

  /**
   * Full rich state for a single objective.
   * Returns null if the objective does not exist.
   */
  async getObjectiveContext(id: string): Promise<RichObjectiveState | null> {
    return this._stateStore.get(id);
  }

  /**
   * Compact text summary of an executive's context suitable for injecting
   * into an LLM system prompt as a state-awareness block.
   *
   * Replaces the pattern of passing recent chat messages as "memory".
   */
  async getSummaryText(role: string): Promise<string> {
    const ctx = await this.getContextForRole(role);

    const owned = ctx.ownedObjectives;
    const inProgress = owned.filter((o) => o.status === "in_progress");
    const planning = owned.filter((o) => o.status === "planning");
    const completed = owned.filter((o) => o.status === "completed");
    const failed = owned.filter((o) => o.status === "failed");

    const lines: string[] = [
      `=== Executive State Context: ${role} ===`,
      `Queried: ${ctx.queriedAt.toISOString()}`,
      ``,
      `System state:`,
      `  Active objectives (system-wide): ${ctx.systemState.activeObjectiveCount}`,
      `  Pending approvals:               ${ctx.systemState.pendingApprovalCount}`,
      `  Agent Zero healthy:              ${ctx.systemState.agentZeroHealthy}`,
      `  Last autonomy cycle:             ${ctx.systemState.lastAutonomyCycleAt ?? "never"}`,
      ``,
      `Owned objectives: ${owned.length} total`,
      `  In progress: ${inProgress.length}  |  Planning: ${planning.length}  |  Completed: ${completed.length}  |  Failed: ${failed.length}`,
    ];

    for (const obj of inProgress) {
      lines.push(``);
      lines.push(`  ▶ [IN PROGRESS] "${obj.title}" (${obj.id.slice(0, 8)}...)`);
      lines.push(`    Priority: ${obj.priority}  |  Progress: ${obj.progressPercent}%  |  Retries: ${obj.retryCount}`);

      if (obj.dependencies.length > 0) {
        lines.push(`    Blocking deps: ${obj.dependencies.join(", ")}`);
      }

      if (obj.nextAction) {
        const na = obj.nextAction;
        lines.push(`    Next action: [${na.kind}] ${na.description}`);
        if (na.assignedTo) lines.push(`      → Assigned to: ${na.assignedTo}`);
        if (na.requiredBy) lines.push(`      → Required by: ${na.requiredBy}`);
        if (na.estimatedEffort) lines.push(`      → Estimated effort: ${na.estimatedEffort}`);
      }

      const lastExec = obj.executionHistory.at(-1);
      if (lastExec) {
        lines.push(
          `    Last execution: "${lastExec.action}" → ${lastExec.outcome}` +
          (lastExec.durationMs ? ` (${lastExec.durationMs}ms)` : "") +
          ` — ${lastExec.source}`,
        );
        if (lastExec.detail) lines.push(`      Detail: ${lastExec.detail}`);
      }

      const lastLearn = obj.learningHistory.at(-1);
      if (lastLearn) {
        lines.push(
          `    Last insight [${lastLearn.topic}]: "${lastLearn.insight}" (confidence: ${lastLearn.confidence}%)`,
        );
      }
    }

    for (const obj of planning) {
      lines.push(``);
      lines.push(`  ◌ [PLANNING] "${obj.title}" (${obj.id.slice(0, 8)}...) — priority: ${obj.priority}`);
    }

    if (failed.length > 0) {
      lines.push(``);
      lines.push(`  ✗ Failed: ${failed.map((o) => `"${o.title}"`).join(", ")}`);
    }

    lines.push(``);
    lines.push(`Active system objectives (all executives): ${ctx.activeSystemObjectives.length}`);

    return lines.join("\n");
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _reader: ExecutiveStateReader | null = null;

/** Returns the process-singleton ExecutiveStateReader, creating it on first call. */
export function getExecutiveStateReader(): ExecutiveStateReader {
  if (!_reader) _reader = new ExecutiveStateReader();
  return _reader;
}
