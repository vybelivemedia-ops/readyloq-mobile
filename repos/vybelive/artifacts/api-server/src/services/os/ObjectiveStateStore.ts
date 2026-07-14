// ─── Mission Control OS Layer — Objective State Store (Phase 3) ───────────────
//
// Persistent, typed source of truth for all objective state. Objectives exist
// independently of chat — executives query this store instead of reconstructing
// context from conversation history or in-memory session state.
//
// Every mutation:
//   1. Writes to the `agent_objectives` table atomically.
//   2. Emits an "objective.updated" event on the EventBus.
//
// Design rules:
//   • All reads go to the DB — never to in-memory state or chat logs.
//   • History fields (executionHistory, learningHistory) are append-only.
//   • Never throws — returns null / false on error and logs the cause.
//   • Idempotent where possible (addDependency, etc.).

import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  agentObjectivesTable,
  type AgentObjectiveRow,
  type ObjectiveExecutionEntry,
  type ObjectiveLearningEntry,
  type ObjectiveNextAction,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { getEventBus } from "./EventBus.js";
import type {
  RichObjectiveState,
  ObjectivePriority,
  ExecutionEntry,
  LearningEntry,
  NextActionDescriptor,
  ObjectiveStatus,
  ObjectiveSource,
} from "./types.js";

// ─── Row → RichObjectiveState ──────────────────────────────────────────────────

function rowToRichState(row: AgentObjectiveRow): RichObjectiveState {
  return {
    // OSObjective base fields
    id: row.id,
    title: row.title,
    description: row.request,
    status: row.status as ObjectiveStatus,
    source: "founder" as ObjectiveSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: {},
    // Phase 3 fields
    ownerRole: row.ownerRole ?? null,
    priority: (row.priority ?? "medium") as ObjectivePriority,
    dependencies: (row.dependencies as string[]) ?? [],
    progressPercent: row.progressPercent ?? 0,
    retryCount: row.retryCount ?? 0,
    executionHistory: ((row.executionHistory as ObjectiveExecutionEntry[]) ?? []).map(
      dbExecToEntry,
    ),
    learningHistory: ((row.learningHistory as ObjectiveLearningEntry[]) ?? []).map(
      dbLearnToEntry,
    ),
    nextAction: row.nextAction ? dbNextActionToDescriptor(row.nextAction as ObjectiveNextAction) : null,
  };
}

function dbExecToEntry(e: ObjectiveExecutionEntry): ExecutionEntry {
  return {
    id: e.id,
    timestamp: new Date(e.timestamp),
    action: e.action,
    source: e.source,
    outcome: e.outcome,
    durationMs: e.durationMs,
    detail: e.detail,
  };
}

function dbLearnToEntry(e: ObjectiveLearningEntry): LearningEntry {
  return {
    id: e.id,
    timestamp: new Date(e.timestamp),
    topic: e.topic,
    insight: e.insight,
    confidence: e.confidence,
    source: e.source,
  };
}

function dbNextActionToDescriptor(n: ObjectiveNextAction): NextActionDescriptor {
  return {
    kind: n.kind,
    description: n.description,
    assignedTo: n.assignedTo,
    requiredBy: n.requiredBy,
    estimatedEffort: n.estimatedEffort,
  };
}

function entryToDbExec(e: ExecutionEntry): ObjectiveExecutionEntry {
  return {
    id: e.id,
    timestamp: e.timestamp.toISOString(),
    action: e.action,
    source: e.source,
    outcome: e.outcome,
    durationMs: e.durationMs,
    detail: e.detail,
  };
}

function entryToDbLearn(e: LearningEntry): ObjectiveLearningEntry {
  return {
    id: e.id,
    timestamp: e.timestamp.toISOString(),
    topic: e.topic,
    insight: e.insight,
    confidence: e.confidence,
    source: e.source,
  };
}

// ─── ObjectiveStateStore class ─────────────────────────────────────────────────

export class ObjectiveStateStore {
  private readonly _bus = getEventBus();

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Full rich state for one objective. Returns null if not found. */
  async get(id: string): Promise<RichObjectiveState | null> {
    try {
      const [row] = await db
        .select()
        .from(agentObjectivesTable)
        .where(eq(agentObjectivesTable.id, id))
        .limit(1);
      return row ? rowToRichState(row) : null;
    } catch (err) {
      logger.warn({ err, id }, "os/ObjectiveStateStore.get: DB read failed");
      return null;
    }
  }

  /**
   * All objectives with rich state.
   * Filters are applied in-process (not via SQL) to keep the query simple
   * and avoid per-filter index sprawl for the Phase 3 column set.
   */
  async getAll(
    filter?: {
      status?: ObjectiveStatus | ObjectiveStatus[];
      ownerRole?: string;
      priority?: ObjectivePriority;
    },
    limit = 100,
  ): Promise<RichObjectiveState[]> {
    try {
      const rows = await db
        .select()
        .from(agentObjectivesTable)
        .orderBy(desc(agentObjectivesTable.createdAt))
        .limit(limit);

      let results = rows.map(rowToRichState);

      if (filter?.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        results = results.filter((o) => statuses.includes(o.status));
      }
      if (filter?.ownerRole !== undefined) {
        results = results.filter((o) => o.ownerRole === filter.ownerRole);
      }
      if (filter?.priority !== undefined) {
        results = results.filter((o) => o.priority === filter.priority);
      }

      return results;
    } catch (err) {
      logger.warn({ err }, "os/ObjectiveStateStore.getAll: DB read failed");
      return [];
    }
  }

  /**
   * All objectives owned by a given executive role slug.
   * Primary replacement for chat-history lookups — call this to get an
   * executive's current workload without touching any message history.
   */
  async getByOwner(role: string): Promise<RichObjectiveState[]> {
    return this.getAll({ ownerRole: role });
  }

  // ── Scalar mutations ───────────────────────────────────────────────────────

  /** Update completion progress (clamped to 0–100). */
  async updateProgress(id: string, progressPercent: number, source: string): Promise<boolean> {
    const pct = Math.max(0, Math.min(100, Math.round(progressPercent)));
    return this._patch(id, { progressPercent: pct }, "progress", source);
  }

  /** Assign or reassign the executive role owner. */
  async updateOwner(id: string, ownerRole: string, source: string): Promise<boolean> {
    return this._patch(id, { ownerRole }, "owner", source);
  }

  /** Change objective priority. */
  async updatePriority(id: string, priority: ObjectivePriority, source: string): Promise<boolean> {
    return this._patch(id, { priority }, "priority", source);
  }

  /**
   * Set (or clear) the next-action descriptor.
   * Pass null to remove the current next-action recommendation.
   */
  async setNextAction(
    id: string,
    action: NextActionDescriptor | null,
    source: string,
  ): Promise<boolean> {
    const dbVal: ObjectiveNextAction | null = action
      ? {
          kind: action.kind,
          description: action.description,
          assignedTo: action.assignedTo,
          requiredBy: action.requiredBy,
          estimatedEffort: action.estimatedEffort,
        }
      : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this._patch(id, { nextAction: dbVal as any }, "next_action", source);
  }

  /** Increment the retry counter by 1. */
  async incrementRetryCount(id: string, source: string): Promise<boolean> {
    try {
      const current = await this.get(id);
      if (!current) return false;
      return this._patch(id, { retryCount: current.retryCount + 1 }, "retry_count", source);
    } catch (err) {
      logger.warn({ err, id }, "os/ObjectiveStateStore.incrementRetryCount: failed");
      return false;
    }
  }

  /**
   * Add a dependency. Idempotent — adding an already-present dep is a no-op.
   * Returns false if the objective does not exist.
   */
  async addDependency(id: string, dependencyId: string, source: string): Promise<boolean> {
    try {
      const current = await this.get(id);
      if (!current) return false;
      if (current.dependencies.includes(dependencyId)) return true;
      const updated = [...current.dependencies, dependencyId];
      return this._patch(id, { dependencies: updated }, "dependency_add", source);
    } catch (err) {
      logger.warn({ err, id, dependencyId }, "os/ObjectiveStateStore.addDependency: failed");
      return false;
    }
  }

  /** Remove a dependency. Idempotent. */
  async removeDependency(id: string, dependencyId: string, source: string): Promise<boolean> {
    try {
      const current = await this.get(id);
      if (!current) return false;
      const updated = current.dependencies.filter((d) => d !== dependencyId);
      if (updated.length === current.dependencies.length) return true; // already absent
      return this._patch(id, { dependencies: updated }, "dependency_remove", source);
    } catch (err) {
      logger.warn({ err, id, dependencyId }, "os/ObjectiveStateStore.removeDependency: failed");
      return false;
    }
  }

  // ── Append-only history mutations ──────────────────────────────────────────

  /**
   * Append one entry to the objective's execution history.
   * This is how executives log actions taken — replacing chat messages as the
   * durable record of what happened.
   */
  async appendExecutionEntry(
    id: string,
    entry: Omit<ExecutionEntry, "id" | "timestamp">,
  ): Promise<ExecutionEntry | null> {
    try {
      const current = await this.get(id);
      if (!current) return null;

      const newEntry: ExecutionEntry = {
        id: randomUUID(),
        timestamp: new Date(),
        ...entry,
      };

      const updatedHistory: ObjectiveExecutionEntry[] = [
        ...current.executionHistory.map(entryToDbExec),
        entryToDbExec(newEntry),
      ];

      const ok = await this._patch(id, { executionHistory: updatedHistory }, "exec_entry", entry.source);
      return ok ? newEntry : null;
    } catch (err) {
      logger.warn({ err, id }, "os/ObjectiveStateStore.appendExecutionEntry: failed");
      return null;
    }
  }

  /**
   * Append one entry to the objective's learning history.
   * Replaces conversational memory as the durable store of extracted insights.
   */
  async appendLearningEntry(
    id: string,
    entry: Omit<LearningEntry, "id" | "timestamp">,
  ): Promise<LearningEntry | null> {
    try {
      const current = await this.get(id);
      if (!current) return null;

      const newEntry: LearningEntry = {
        id: randomUUID(),
        timestamp: new Date(),
        ...entry,
        confidence: Math.max(0, Math.min(100, entry.confidence)),
      };

      const updatedHistory: ObjectiveLearningEntry[] = [
        ...current.learningHistory.map(entryToDbLearn),
        entryToDbLearn(newEntry),
      ];

      const ok = await this._patch(id, { learningHistory: updatedHistory }, "learn_entry", entry.source);
      return ok ? newEntry : null;
    } catch (err) {
      logger.warn({ err, id }, "os/ObjectiveStateStore.appendLearningEntry: failed");
      return null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Atomic DB patch + EventBus emission.
   * Uses a wide `any` cast on setFields to avoid fighting Drizzle's internal
   * insert/update type inference — individual mutators type-check their inputs.
   */
  private async _patch(
    id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setFields: Record<string, any>,
    mutationKind: string,
    source: string,
  ): Promise<boolean> {
    try {
      const [row] = await db
        .update(agentObjectivesTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ ...(setFields as any), updatedAt: new Date() })
        .where(eq(agentObjectivesTable.id, id))
        .returning();

      if (!row) return false;

      const rich = rowToRichState(row);

      await this._bus.emit(
        "objective.updated",
        { objective: rich, newStatus: rich.status },
        `os/StateStore/${mutationKind}/${source}`,
      );

      logger.debug(
        { id, mutationKind, source },
        "os/ObjectiveStateStore: state patched",
      );
      return true;
    } catch (err) {
      logger.warn(
        { err, id, mutationKind },
        "os/ObjectiveStateStore._patch: DB write failed",
      );
      return false;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _store: ObjectiveStateStore | null = null;

/** Returns the process-singleton ObjectiveStateStore, creating it on first call. */
export function getObjectiveStateStore(): ObjectiveStateStore {
  if (!_store) _store = new ObjectiveStateStore();
  return _store;
}
