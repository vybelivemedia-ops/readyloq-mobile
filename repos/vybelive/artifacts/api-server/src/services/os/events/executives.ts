// ─── OS Event Bus — Executive Domain Events ───────────────────────────────────
// Events emitted when AI executives produce reports, exchange handoffs,
// collaborate, send messages, or complete tasks.
// Replacing direct-call patterns: other executives subscribe to these instead
// of importing and calling each other's functions.

export interface ExecReportPayload {
  /** Executive DB row ID */
  executiveId: string;
  /** Role slug, e.g. "cto", "product_manager" */
  role: string;
  executiveName: string;
  objectiveId: string | null;
  /** "healthy" | "attention" | "critical" */
  reportStatus: "healthy" | "attention" | "critical";
  headline: string;
  /** Number of findings in the report */
  findingCount: number;
  confidence: number;
}

export interface ExecHandoffPayload {
  fromExecutiveId: string;
  fromRole: string;
  toExecutiveId: string;
  toRole: string;
  objectiveId: string | null;
  /** Why the handoff was requested */
  reason: string;
  context: string;
}

export interface ExecCollaborationPayload {
  collabEventId: string;
  participants: Array<{ executiveId: string; role: string }>;
  objectiveId: string | null;
  topic: string;
  initiatorRole: string;
}

export interface ExecMessagePayload {
  messageId: string;
  fromExecutiveId: string;
  toExecutiveId: string;
  objectiveId: string | null;
  /** Brief preview of the message (first 200 chars) */
  preview: string;
}

export interface ExecTaskAssignedPayload {
  taskId: string;
  executiveId: string;
  role: string;
  title: string;
  objectiveId: string | null;
  priority: "low" | "medium" | "high" | "critical";
}

export interface ExecTaskCompletedPayload extends ExecTaskAssignedPayload {
  durationMs: number;
  outcome: "success" | "partial" | "failed";
}

export interface ExecutivesEventMap {
  "exec.report.generated": ExecReportPayload;
  "exec.handoff.requested": ExecHandoffPayload;
  "exec.collaboration.started": ExecCollaborationPayload;
  "exec.message.sent": ExecMessagePayload;
  "exec.task.assigned": ExecTaskAssignedPayload;
  "exec.task.completed": ExecTaskCompletedPayload;
}
