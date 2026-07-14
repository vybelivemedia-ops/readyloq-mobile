// ─── OS Event Bus — Agent Zero Domain Events ──────────────────────────────────
// Execution-layer events from Agent Zero: job lifecycle, step transitions,
// approval gates, and specialist consultations.
// Phase 1 carried "job.dispatched" as a generic kind — Phase 2 renames
// it to "agent_zero.job.dispatched" and adds the full lifecycle set.
// Backward-compat: the Phase 1 generic "job.dispatched" is preserved in the
// map pointing to the same shape so existing code continues to compile.

export interface AgentZeroJobPayload {
  jobId: string;
  command: string;
  instruction: string;
  objectiveId: string | null;
}

export interface AgentZeroJobCompletedPayload extends AgentZeroJobPayload {
  durationMs: number;
  stepsCompleted: number;
}

export interface AgentZeroJobFailedPayload extends AgentZeroJobPayload {
  reason: string;
  rootCause: string;
  stepsCompleted: number;
  stepsRemaining: number;
}

export interface AgentZeroStepPayload {
  jobId: string;
  stepId: string;
  stepTitle: string;
  /** "analysis" | "specialist" | "engineering_snapshot" | "report" | "approval_gate" */
  kind: "analysis" | "specialist" | "engineering_snapshot" | "report" | "approval_gate";
  attemptNumber: number;
}

export interface AgentZeroApprovalPayload {
  jobId: string;
  approvalId: string;
  /** Why the job is parked */
  reason: string;
  /** Which autonomy bucket triggered the gate */
  category: "deploy" | "merge" | "delete" | "money" | "external";
}

export interface AgentZeroSpecialistPayload {
  jobId: string;
  specialistId: string;
  specialistName: string;
  /** Executive role that owns the specialist */
  ownerRole: string;
  findingCount: number;
}

/** Phase 1 backward-compat: legacy generic dispatch shape */
export interface LegacyJobDispatchedPayload {
  jobId: string;
  providerId: string;
  command: string;
}

export interface AgentZeroEventMap {
  /** Phase 2 canonical dispatch event */
  "agent_zero.job.dispatched": AgentZeroJobPayload;
  "agent_zero.job.step_started": AgentZeroStepPayload;
  "agent_zero.job.step_completed": AgentZeroStepPayload;
  "agent_zero.job.completed": AgentZeroJobCompletedPayload;
  "agent_zero.job.failed": AgentZeroJobFailedPayload;
  "agent_zero.job.approval_required": AgentZeroApprovalPayload;
  "agent_zero.specialist.consulted": AgentZeroSpecialistPayload;
  /** Phase 1 backward-compat aliases (keep until Phase 1 callers are migrated) */
  "job.dispatched": LegacyJobDispatchedPayload;
  "job.completed": AgentZeroJobCompletedPayload;
  "job.failed": AgentZeroJobFailedPayload;
  "job.approval_required": AgentZeroApprovalPayload;
}
