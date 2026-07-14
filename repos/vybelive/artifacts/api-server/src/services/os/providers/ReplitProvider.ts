// ─── Replit Execution Provider ────────────────────────────────────────────────
// Translates Replit workspace operations (create workspace, clone repo, read/write
// files, run tests, install packages, deploy preview, rollback, stream logs) into
// Agent Zero jobs. This is the ONLY path to Replit workspace operations — no
// executive ever calls these APIs directly.
//
// MOCK MODE: set REPLIT_MOCK_MODE=true to return deterministic mocked results
// for every step without touching the filesystem or spawning processes.

import { dispatchJob } from "../../../services/agentZero.js";
import type {
  ExecutionCapability,
  DispatchOptions,
  DispatchResult,
} from "../types.js";
import type { ExecutionProvider } from "../../os/ExecutionProviderRegistry.js";
import { logger } from "../../../lib/logger.js";

export type ReplitOpKind =
  | "create_workspace"
  | "clone_repo"
  | "read_file"
  | "write_file"
  | "run_tests"
  | "install_packages"
  | "deploy_preview"
  | "rollback"
  | "stream_logs";

export interface ReplitDispatchOptions extends DispatchOptions {
  op: ReplitOpKind;
  params?: Record<string, unknown>;
}

const OP_TO_STEP: Record<ReplitOpKind, string> = {
  create_workspace: "replit_create_workspace",
  clone_repo: "replit_clone_repo",
  read_file: "replit_read_file",
  write_file: "replit_write_file",
  run_tests: "replit_run_tests",
  install_packages: "replit_install_packages",
  deploy_preview: "replit_deploy_preview",
  rollback: "replit_rollback",
  stream_logs: "replit_stream_logs",
};

export const ReplitProvider: ExecutionProvider = {
  id: "replit",
  name: "Replit Workspace Provider",
  version: "1.0.0",
  capabilities: ["engineering", "multi_step"] as ExecutionCapability[],
  maxParallelJobs: 2,

  isAvailable(): boolean {
    return (
      process.env["REPLIT_MOCK_MODE"] === "true" ||
      !!process.env["REPLIT_DOMAINS"] ||
      !!process.env["REPLIT_DEV_DOMAIN"]
    );
  },

  async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    const replitOpts = options as ReplitDispatchOptions;
    const op = replitOpts.op ?? "stream_logs";
    const stepKind = OP_TO_STEP[op] ?? "replit_stream_logs";

    const instruction = JSON.stringify({
      op,
      stepKind,
      params: replitOpts.params ?? {},
      originalInstruction: options.instruction,
      mockMode: process.env["REPLIT_MOCK_MODE"] === "true",
    });

    try {
      const job = await dispatchJob({
        commandType: "workspace_op",
        instruction,
        objectiveId: options.objectiveId ?? null,
        priority: options.priority === "high" ? 8 : options.priority === "low" ? 3 : 5,
      });

      logger.info(
        { jobId: job.id, op, objectiveId: options.objectiveId, mockMode: process.env["REPLIT_MOCK_MODE"] },
        "ReplitProvider: dispatched workspace_op job",
      );

      return { jobId: job.id, providerId: "replit", status: "queued" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, op }, "ReplitProvider: dispatch failed");
      return { jobId: "", providerId: "replit", status: "rejected", reason: msg };
    }
  },
};
