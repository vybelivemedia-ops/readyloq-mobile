// ─── Mission Control OS Layer — Objective Manager ─────────────────────────────
//
// The OS-layer facade for objective lifecycle management. It wraps the existing
// `agentObjectivesTable` (Drizzle) so the rest of the OS layer never touches
// the DB directly and all objective mutations flow through one place.
//
// Every mutation emits an event on the EventBus so the rest of the system can
// react without coupling (e.g. StateEngine updates its active-count counter).
//
// Design rules:
//   • Only reads/writes the agentObjectivesTable — all other business logic
//     (decomposition, executive assignment, briefing) remains in the existing
//     chiefOrchestrator.ts and missionControl route.
//   • Never throws — returns null / empty-array rather than crashing callers.
//   • All returned OSObjective values are plain serialisable objects.
//   • DB column "request" maps to OS-layer field "description" for clarity.
//   • DB status enum: "planning" | "in_progress" | "needs_approval" | "completed" | "failed"

import { eq, desc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  agentObjectivesTable,
  aiExecutivesTable,
  type AgentObjectiveRow,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { getEventBus } from "./EventBus.js";
import type {
  OSObjective,
  CreateObjectiveInput,
  ObjectiveStatus,
  ObjectiveSource,
} from "./types.js";

// ─── DB status enum values (must match objectiveStatusEnum in db schema) ──────

type DBObjectiveStatus = AgentObjectiveRow["status"];

const DB_STATUS_VALUES: DBObjectiveStatus[] = [
  "planning",
  "in_progress",
  "needs_approval",
  "completed",
  "failed",
];

function isValidDBStatus(s: string): s is DBObjectiveStatus {
  return DB_STATUS_VALUES.includes(s as DBObjectiveStatus);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToOSObjective(row: AgentObjectiveRow): OSObjective {
  return {
    id: row.id,
    title: row.title,
    // DB column is named "request"; OS layer exposes it as "description".
    description: row.request,
    status: row.status as ObjectiveStatus,
    // Legacy rows from the existing route don't carry an OS source tag;
    // we default to "founder" as all existing objectives come from founder input.
    source: "founder" as ObjectiveSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: {},
  };
}

// ─── ObjectiveManager class ───────────────────────────────────────────────────

export class ObjectiveManager {
  private readonly _bus = getEventBus();

  // ── Queries ──────────────────────────────────────────────────────────────────

  /** Fetch a single objective by ID. Returns null if not found. */
  async get(id: string): Promise<OSObjective | null> {
    try {
      const [row] = await db
        .select()
        .from(agentObjectivesTable)
        .where(eq(agentObjectivesTable.id, id))
        .limit(1);

      return row ? rowToOSObjective(row) : null;
    } catch (err) {
      logger.warn({ err, id }, "os/ObjectiveManager.get: DB read failed");
      return null;
    }
  }

  /** List objectives, optionally filtered by status. Most-recent first. */
  async list(
    filter?: { status?: ObjectiveStatus | ObjectiveStatus[] },
    limit = 50,
  ): Promise<OSObjective[]> {
    try {
      const rawStatuses = filter?.status
        ? Array.isArray(filter.status)
          ? filter.status
          : [filter.status]
        : null;

      // Only pass statuses that are actually in the DB enum.
      const dbStatuses = rawStatuses
        ? (rawStatuses.filter(isValidDBStatus) as [DBObjectiveStatus, ...DBObjectiveStatus[]])
        : null;

      const rows = await db
        .select()
        .from(agentObjectivesTable)
        .where(
          dbStatuses && dbStatuses.length > 0
            ? inArray(agentObjectivesTable.status, dbStatuses)
            : undefined,
        )
        .orderBy(desc(agentObjectivesTable.createdAt))
        .limit(limit);

      return rows.map(rowToOSObjective);
    } catch (err) {
      logger.warn({ err }, "os/ObjectiveManager.list: DB read failed");
      return [];
    }
  }

  /** Count objectives in a given status (or all statuses). */
  async count(status?: ObjectiveStatus): Promise<number> {
    try {
      const rows = await db
        .select({ id: agentObjectivesTable.id })
        .from(agentObjectivesTable)
        .where(
          status && isValidDBStatus(status)
            ? eq(agentObjectivesTable.status, status as DBObjectiveStatus)
            : undefined,
        );
      return rows.length;
    } catch (err) {
      logger.warn({ err }, "os/ObjectiveManager.count: DB read failed");
      return 0;
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────

  /**
   * Create a new objective.
   * Looks up the first available AI executive as owner if `ownerId` is not supplied.
   * Emits "objective.created" on success.
   */
  async create(input: CreateObjectiveInput): Promise<OSObjective | null> {
    try {
      let ownerId = input.ownerId;

      if (!ownerId) {
        const [exec] = await db
          .select({ id: aiExecutivesTable.id })
          .from(aiExecutivesTable)
          .limit(1);
        ownerId = exec?.id ?? randomUUID();
      }

      const [row] = await db
        .insert(agentObjectivesTable)
        .values({
          id: randomUUID(),
          title: input.title,
          request: input.description,
          // Start in "planning" — the DB default and the first valid state.
          status: "planning",
          createdByExecutiveId: ownerId,
        })
        .returning();

      if (!row) return null;

      const objective = rowToOSObjective(row);

      await this._bus.emit("objective.created", { objective }, "os/ObjectiveManager");

      logger.info(
        { objectiveId: objective.id, source: input.source },
        "os/ObjectiveManager: objective created",
      );

      return objective;
    } catch (err) {
      logger.warn({ err, input }, "os/ObjectiveManager.create: failed");
      return null;
    }
  }

  /**
   * Update the status of an existing objective.
   * Emits "objective.updated", plus a domain-specific event when status is
   * terminal ("objective.completed" or "objective.failed").
   */
  async updateStatus(
    id: string,
    status: ObjectiveStatus,
  ): Promise<OSObjective | null> {
    if (!isValidDBStatus(status)) {
      logger.warn({ id, status }, "os/ObjectiveManager.updateStatus: invalid status");
      return null;
    }

    try {
      const [row] = await db
        .update(agentObjectivesTable)
        .set({ status: status as DBObjectiveStatus, updatedAt: new Date() })
        .where(eq(agentObjectivesTable.id, id))
        .returning();

      if (!row) return null;

      const objective = rowToOSObjective(row);

      await this._bus.emit("objective.updated", { objective, newStatus: status }, "os/ObjectiveManager");

      if (status === "completed") {
        await this._bus.emit("objective.completed", { objective }, "os/ObjectiveManager");
      } else if (status === "failed") {
        await this._bus.emit("objective.failed", { objective, reason: "status transition to failed" }, "os/ObjectiveManager");
      }

      return objective;
    } catch (err) {
      logger.warn({ err, id, status }, "os/ObjectiveManager.updateStatus: failed");
      return null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _manager: ObjectiveManager | null = null;

/** Returns the process-singleton ObjectiveManager, creating it on first call. */
export function getObjectiveManager(): ObjectiveManager {
  if (!_manager) _manager = new ObjectiveManager();
  return _manager;
}
