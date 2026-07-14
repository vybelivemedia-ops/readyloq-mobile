// ─── Mission Control OS Layer — Agent Zero Execution Provider ─────────────────
//
// Adapts the existing `agentZero.ts` service into the `ExecutionProvider`
// interface so the OS `ExecutionProviderRegistry` can dispatch jobs through it
// without depending on Agent Zero's internal types.
//
// This is a pure adapter — it adds no new logic. All job creation, step
// planning, worker management, and approval routing remain in `agentZero.ts`.
//
// Design rules:
//   • Never import from other OS layer components (would create a circular dep).
//     Use only types.ts for the interface it implements.
//   • `isAvailable()` is synchronous — it delegates to `getWorkerHealth()`.
//   • `dispatch()` delegates to `createAgentZeroJob()` and translates the
//     result into a `DispatchResult`. Never throws.

import { logger } from "../../../lib/logger.js";
import {
  createAgentZeroJob,
  getWorkerHealth,
  COMMAND_CATALOG,
  DEFAULT_MAX_ATTEMPTS,
  type AgentZeroCommand,
} from "../../agentZero.js";
import type {
  ExecutionCapability,
  DispatchOptions,
  DispatchResult,
} from "../types.js";
import type { ExecutionProvider } from "../ExecutionProviderRegistry.js";

// ─── AgentZeroProvider ────────────────────────────────────────────────────────

export class AgentZeroProvider implements ExecutionProvider {
  readonly id = "agent-zero";
  readonly name = "Agent Zero";
  readonly version = "1.0.0";
  readonly maxParallelJobs = 2;

  readonly capabilities: ExecutionCapability[] = [
    "multi_step",
    "analysis",
    "monitoring",
    "specialist",
    "engineering",
    "social",
  ];

  /** Synchronous availability check. True when the Agent Zero worker is healthy. */
  isAvailable(): boolean {
    try {
      const health = getWorkerHealth();
      return health.healthy;
    } catch {
      return false;
    }
  }

  /**
   * Dispatch a job through Agent Zero.
   * Maps `DispatchOptions` onto `createAgentZeroJob` and returns a
   * `DispatchResult`. Never throws.
   */
  async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    try {
      const command = this._resolveCommand(options.command);

      // `maxAttempts` is managed internally by agentZero (DEFAULT_MAX_ATTEMPTS).
      // `priority` maps to an optional numeric field — we leave it at the default.
      const job = await createAgentZeroJob({
        commandType: command,
        instruction: options.instruction,
        objectiveId: options.objectiveId ?? null,
      });

      logger.info(
        { jobId: job.id, command, objectiveId: options.objectiveId },
        "os/AgentZeroProvider: job dispatched",
      );

      return {
        jobId: job.id,
        providerId: this.id,
        status: "queued",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, command: options.command },
        "os/AgentZeroProvider: createAgentZeroJob failed",
      );
      return {
        jobId: "",
        providerId: this.id,
        status: "rejected",
        reason: msg,
      };
    }
  }

  /**
   * Resolve the command string to a valid AgentZeroCommand.
   * Falls back to "custom" if the command isn't in COMMAND_CATALOG.
   */
  private _resolveCommand(raw: string): AgentZeroCommand {
    const valid = raw as AgentZeroCommand;
    if (valid in COMMAND_CATALOG) return valid;
    logger.warn(
      { command: raw },
      "os/AgentZeroProvider: unknown command — falling back to 'custom'",
    );
    return "custom";
  }
}
