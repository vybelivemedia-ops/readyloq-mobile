// ─── OS Event Bus — Replit Platform Domain Events ─────────────────────────────
// Events originating from the Replit environment: workflow lifecycle,
// deployments, DB migrations, and checkpoints.

export interface ReplitWorkflowPayload {
  /** Workflow name as configured in .replit */
  workflowName: string;
  /** Artifact the workflow belongs to, e.g. "artifacts/api-server" */
  artifact: string;
  /** Exit code; 0 = success */
  exitCode: number;
  /** Last few lines of stdout/stderr for quick diagnosis */
  tailLog: string;
  durationMs: number;
}

export interface ReplitDeployPayload {
  /** Replit deployment target domain */
  domain: string;
  /** Which artifact was deployed */
  artifact: string;
  /** Build SHA or version tag */
  version: string;
  /** "web" | "scheduled" | "reserved_vm" */
  deploymentKind: "web" | "scheduled" | "reserved_vm";
  region: string;
}

export interface ReplitDeployFailedPayload extends ReplitDeployPayload {
  error: string;
  phase: "build" | "health_check" | "route_swap";
}

export interface ReplitDbMigrationPayload {
  /** Human-readable description of what changed */
  description: string;
  /** Tables added/removed/altered */
  tables: string[];
  appliedAt: string; // ISO timestamp
  durationMs: number;
}

export interface ReplitCheckpointPayload {
  /** Checkpoint label (if set) */
  label: string | null;
  /** Checkpoint ID returned by the platform */
  checkpointId: string;
  /** Short SHA of the git HEAD at checkpoint time */
  sha: string;
}

export interface ReplitEventMap {
  "replit.workflow.started": ReplitWorkflowPayload;
  "replit.workflow.failed": ReplitWorkflowPayload;
  "replit.deploy.published": ReplitDeployPayload;
  "replit.deploy.failed": ReplitDeployFailedPayload;
  "replit.db.migrated": ReplitDbMigrationPayload;
  "replit.checkpoint.created": ReplitCheckpointPayload;
}
