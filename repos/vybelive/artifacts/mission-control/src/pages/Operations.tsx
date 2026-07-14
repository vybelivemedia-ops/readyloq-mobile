import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  RefreshCw,
  Zap,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  XCircle,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Send,
  Activity,
} from "lucide-react";
import {
  useGetAgentZeroOperations,
  getGetAgentZeroOperationsQueryKey,
  useDispatchAgentZeroJob,
  useControlAgentZeroJob,
  useGetAIMetrics,
  getGetAIMetricsQueryKey,
} from "@workspace/api-client-react";
import type {
  AgentZeroJobWithSteps,
  AgentZeroStep,
  AgentZeroDispatchInputCommandType,
} from "@workspace/api-client-react";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-secondary text-muted-foreground border-border",
  running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  waiting_approval: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-secondary text-muted-foreground border-border",
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />,
  failed: <AlertTriangle className="h-3.5 w-3.5 text-red-400" />,
  skipped: <XCircle className="h-3.5 w-3.5 text-muted-foreground" />,
  pending: <div className="h-3.5 w-3.5 rounded-full border border-border" />,
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLES[status] ?? STATUS_STYLES.queued}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function StepRow({ step }: { step: AgentZeroStep }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5">{STEP_ICONS[step.status] ?? STEP_ICONS.pending}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground">{step.title}</span>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">{step.kind}</span>
          {step.attempts > 1 && (
            <span className="font-mono text-[10px] text-amber-400">retry ×{step.attempts - 1}</span>
          )}
        </div>
        {step.summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{step.summary}</p>}
      </div>
    </div>
  );
}

function JobCard({
  job,
  onControl,
  controlPending,
}: {
  job: AgentZeroJobWithSteps;
  onControl: (jobId: string, action: "pause" | "resume" | "retry" | "cancel") => void;
  controlPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = job.status === "queued" || job.status === "running";
  const canResume = job.status === "paused" || job.status === "waiting_approval";
  const canRetry = job.status === "failed" || job.status === "cancelled";

  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid={`job-card-${job.id}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => setExpanded((e) => !e)}
          data-testid={`job-expand-${job.id}`}
        >
          {expanded ? (
            <ChevronDown className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{job.title}</span>
              <StatusBadge status={job.status} />
              {job.status === "waiting_approval" && (
                <span className="flex items-center gap-1 font-mono text-[10px] text-purple-400">
                  <ShieldAlert className="h-3 w-3" /> founder sign-off required
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {job.commandType} · priority {job.priority} · attempt {job.attempts}/{job.maxAttempts}
              {job.currentStep ? ` · ${job.currentStep}` : ""}
            </p>
            {job.lastError && job.status === "failed" && (
              <p className="mt-1 line-clamp-2 text-[11px] text-red-400">
                {job.rootCause ? `[${job.rootCause}] ` : ""}
                {job.lastError}
              </p>
            )}
            {job.resultSummary && job.status === "completed" && (
              <p className="mt-1 line-clamp-2 text-[11px] text-emerald-400/80">{job.resultSummary}</p>
            )}
          </div>
        </button>
        <div className="flex flex-shrink-0 items-center gap-1">
          {active && (
            <button
              title="Pause"
              disabled={controlPending}
              onClick={() => onControl(job.id, "pause")}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-amber-400"
              data-testid={`job-pause-${job.id}`}
            >
              <PauseCircle className="h-4 w-4" />
            </button>
          )}
          {canResume && (
            <button
              title="Resume"
              disabled={controlPending}
              onClick={() => onControl(job.id, "resume")}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-emerald-400"
              data-testid={`job-resume-${job.id}`}
            >
              <PlayCircle className="h-4 w-4" />
            </button>
          )}
          {canRetry && (
            <button
              title="Retry"
              disabled={controlPending}
              onClick={() => onControl(job.id, "retry")}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-blue-400"
              data-testid={`job-retry-${job.id}`}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {(active || canResume) && (
            <button
              title="Cancel"
              disabled={controlPending}
              onClick={() => onControl(job.id, "cancel")}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-red-400"
              data-testid={`job-cancel-${job.id}`}
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${
            job.status === "failed" ? "bg-red-500/60" : job.status === "completed" ? "bg-emerald-500/70" : "bg-blue-500/70"
          }`}
          style={{ width: `${Math.max(2, job.progress)}%` }}
        />
      </div>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Instruction
          </p>
          <p className="mb-3 text-xs text-muted-foreground">{job.instruction}</p>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Step timeline ({job.steps.filter((s) => s.status === "completed").length}/{job.steps.length})
          </p>
          {job.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Operations() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useGetAgentZeroOperations({
    query: { queryKey: getGetAgentZeroOperationsQueryKey(), refetchInterval: 5_000 },
  });
  const { data: aiMetrics, isError: aiMetricsError } = useGetAIMetrics({
    query: { queryKey: getGetAIMetricsQueryKey(), refetchInterval: 60_000 },
  });

  const [commandType, setCommandType] = useState<AgentZeroDispatchInputCommandType>("audit_database");
  const [instruction, setInstruction] = useState("");
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetAgentZeroOperationsQueryKey() });

  const dispatchMutation = useDispatchAgentZeroJob({
    mutation: {
      onSuccess: () => {
        setInstruction("");
        setDispatchError(null);
        void invalidate();
      },
      onError: () => setDispatchError("Dispatch failed — check the instruction and try again."),
    },
  });
  const controlMutation = useControlAgentZeroJob({
    mutation: { onSuccess: () => void invalidate() },
  });

  const snapshot = data;
  const jobs = snapshot?.jobs ?? [];
  const counts = snapshot?.counts ?? {};
  const activeJobs = jobs.filter((j) => ["queued", "running", "paused", "waiting_approval"].includes(j.status));
  const doneJobs = jobs.filter((j) => ["completed", "failed", "cancelled"].includes(j.status));

  const handleDispatch = () => {
    if (instruction.trim().length < 3) {
      setDispatchError("Instruction must be at least 3 characters.");
      return;
    }
    dispatchMutation.mutate({ data: { commandType, instruction: instruction.trim() } });
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <h1 className="font-mono text-lg font-bold uppercase tracking-wider text-foreground">
              Operations Center
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Agent Zero — Mission Control's execution engine. Quinn dispatches jobs here; protected actions always
            park for your sign-off.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          data-testid="button-refresh-operations"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Metrics strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-wider">Worker</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground" data-testid="metric-worker">
            {snapshot?.worker.healthy ? "Online" : "Offline"}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {snapshot?.worker.runningJobs ?? 0} running · {counts.queued ?? 0} queued
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-wider">Execution confidence</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground" data-testid="metric-confidence">
            {snapshot?.executionConfidence ?? "—"}%
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {counts.completed ?? 0} done · {counts.failed ?? 0} failed
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-wider">Avg runtime</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {snapshot ? `${snapshot.avgRuntimeSeconds}s` : "—"}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">{snapshot?.totalRetries ?? 0} retries total</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-wider">System load</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">{snapshot?.systemLoad.load1 ?? "—"}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            heap {snapshot?.systemLoad.heapUsedMb ?? 0}MB · rss {snapshot?.systemLoad.rssMb ?? 0}MB
          </p>
        </div>
      </div>

      {/* AI usage strip */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <Zap className="h-3.5 w-3.5" /> AI usage
          </p>
          {aiMetrics && (
            <span className="font-mono text-[10px] text-muted-foreground">
              provider{" "}
              <span className="text-primary">{aiMetrics.providerStatus.active}</span> ·{" "}
              {aiMetrics.providerStatus.model}
            </span>
          )}
        </div>
        {aiMetricsError ? (
          <p className="font-mono text-xs text-destructive">AI metrics unavailable.</p>
        ) : !aiMetrics ? (
          <p className="font-mono text-xs text-muted-foreground">Loading AI metrics…</p>
        ) : aiMetrics.totals.requests === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">No AI requests have been logged yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <p className="text-lg font-semibold text-foreground" data-testid="ai-requests">
                {aiMetrics.totals.requests}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">requests</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground" data-testid="ai-tokens">
                {aiMetrics.totals.totalTokens >= 1000
                  ? `${(aiMetrics.totals.totalTokens / 1000).toFixed(1)}k`
                  : aiMetrics.totals.totalTokens}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">tokens</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground" data-testid="ai-cost">
                ${aiMetrics.totals.estimatedCostUsd.toFixed(2)}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">est. cost</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground" data-testid="ai-latency">
                {aiMetrics.totals.avgLatencyMs}ms
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">
                avg latency · {aiMetrics.totals.fallbackCount} fallbacks
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Dispatch form */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Dispatch job (as Quinn)
        </p>
        <div className="flex flex-col gap-2 md:flex-row">
          <select
            value={commandType}
            onChange={(e) => setCommandType(e.target.value as AgentZeroDispatchInputCommandType)}
            className="rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs text-foreground"
            data-testid="select-command-type"
          >
            {(snapshot?.commands ?? []).map((c) => (
              <option key={c.commandType} value={c.commandType}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDispatch()}
            placeholder="What should Agent Zero execute?"
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            data-testid="input-instruction"
          />
          <button
            onClick={handleDispatch}
            disabled={dispatchMutation.isPending}
            className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            data-testid="button-dispatch"
          >
            {dispatchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Dispatch
          </button>
        </div>
        {dispatchError && <p className="mt-2 text-xs text-red-400">{dispatchError}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {(snapshot?.commands ?? []).find((c) => c.commandType === commandType)?.describe ?? ""}
        </p>
      </div>

      {/* Job queues */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading operations…
        </div>
      ) : (
        <>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Active ({activeJobs.length})
          </p>
          <div className="mb-6 flex flex-col gap-3">
            {activeJobs.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No active jobs. Quinn dispatches work here, or use the form above.
              </p>
            )}
            {activeJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                controlPending={controlMutation.isPending}
                onControl={(jobId, action) => controlMutation.mutate({ jobId, data: { action } })}
              />
            ))}
          </div>

          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            History ({doneJobs.length})
          </p>
          <div className="flex flex-col gap-3">
            {doneJobs.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No completed jobs yet.
              </p>
            )}
            {doneJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                controlPending={controlMutation.isPending}
                onControl={(jobId, action) => controlMutation.mutate({ jobId, data: { action } })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
