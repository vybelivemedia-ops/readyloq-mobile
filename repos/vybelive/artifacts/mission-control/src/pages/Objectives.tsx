import {
  useListObjectives,
  getListObjectivesQueryKey,
  useListApprovals,
  getListApprovalsQueryKey,
  useDecideApproval,
  getGetObjectiveQueryKey,
} from "@workspace/api-client-react";
import type { AgentObjective, AgentApproval } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Target, ChevronRight, Loader2, ShieldQuestion, Check, X, Clock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";

const OBJECTIVE_STATUS: Record<string, { label: string; text: string; bg: string; border: string; dot: string }> = {
  planning: { label: "Planning", text: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/30", dot: "bg-sky-500" },
  in_progress: { label: "In Progress", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-500" },
  needs_approval: { label: "Needs Approval", text: "text-fuchsia-400", bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", dot: "bg-fuchsia-500" },
  completed: { label: "Completed", text: "text-muted-foreground", bg: "bg-muted/10", border: "border-border", dot: "bg-muted-foreground" },
  failed: { label: "Failed", text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", dot: "bg-destructive" },
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "text-destructive",
  high: "text-amber-400",
  medium: "text-sky-400",
  low: "text-muted-foreground",
};

export function ObjectiveStatusBadge({ status }: { status: string }) {
  const s = OBJECTIVE_STATUS[status] ?? OBJECTIVE_STATUS.planning;
  return (
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider border ${s.bg} ${s.text} ${s.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full h-1 rounded-full bg-border overflow-hidden">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ObjectiveCard({ objective }: { objective: AgentObjective }) {
  const history = objective.executionHistory ?? [];
  const lastEntry = history[history.length - 1];
  const pct = objective.progressPercent ?? 0;

  return (
    <Link
      href={`/objectives/${objective.id}`}
      className="group block rounded-lg border border-border bg-card hover:border-primary/40 transition-colors p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <ObjectiveStatusBadge status={objective.status} />
            {objective.pendingApprovalCount > 0 && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-fuchsia-400">
                {objective.pendingApprovalCount} awaiting approval
              </span>
            )}
            {objective.priority && (
              <span className={`text-[10px] font-mono uppercase tracking-wider ${PRIORITY_COLOR[objective.priority] ?? "text-muted-foreground"}`}>
                {objective.priority}
              </span>
            )}
            {objective.ownerRole && (
              <span className="text-[10px] font-mono text-muted-foreground">
                → {objective.ownerRole}
              </span>
            )}
          </div>

          <h3 className="text-base font-bold text-foreground leading-snug truncate">{objective.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1 line-clamp-2">{objective.request}</p>

          {pct > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>{history.length} AZ run{history.length !== 1 ? "s" : ""}</span>
                <span>{pct}%</span>
              </div>
              <ProgressBar value={pct} />
            </div>
          )}

          {lastEntry && (
            <div className="flex items-center gap-1.5 mt-2.5 text-[11px] font-mono text-muted-foreground">
              <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="truncate">{lastEntry.action}</span>
            </div>
          )}

          <div className="flex items-center gap-4 mt-2 text-[11px] font-mono text-muted-foreground">
            <span>{objective.taskCount} tasks</span>
            <span>{objective.openTaskCount} open</span>
            <span>{formatDistanceToNow(new Date(objective.createdAt), { addSuffix: true })}</span>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </div>
    </Link>
  );
}

function PendingApprovalCard({ approval }: { approval: AgentApproval }) {
  const queryClient = useQueryClient();
  const decide = useDecideApproval();

  const handleDecide = (decision: "approve" | "reject" | "later") => {
    decide.mutate(
      { approvalId: approval.id, data: { decision } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListApprovalsQueryKey({ status: "pending" }) });
          queryClient.invalidateQueries({ queryKey: getListObjectivesQueryKey() });
          if (approval.objectiveId) {
            queryClient.invalidateQueries({ queryKey: getGetObjectiveQueryKey(approval.objectiveId) });
          }
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/[0.04] p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldQuestion className="w-4 h-4 text-fuchsia-400 shrink-0" />
          <h4 className="text-sm font-bold text-foreground">{approval.title}</h4>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider shrink-0 text-fuchsia-400">
          Pending
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed mb-1">{approval.detail}</p>
      <div className="text-[11px] font-mono text-muted-foreground mb-3">
        {approval.executiveName} · impact: {approval.impact}
        {approval.objectiveId ? (
          <>
            {" · "}
            <Link href={`/objectives/${approval.objectiveId}`} className="underline hover:text-foreground">
              view objective
            </Link>
          </>
        ) : (
          " · standalone escalation (no objective)"
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => handleDecide("approve")}
          disabled={decide.isPending}
          className="bg-emerald-600 hover:bg-emerald-500 text-white h-8"
        >
          <Check className="w-3.5 h-3.5 mr-1" /> Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleDecide("reject")}
          disabled={decide.isPending}
          className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <X className="w-3.5 h-3.5 mr-1" /> Reject
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleDecide("later")}
          disabled={decide.isPending}
          className="h-8 text-muted-foreground"
        >
          <Clock className="w-3.5 h-3.5 mr-1" /> Later
        </Button>
        {decide.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}

export default function Objectives() {
  const { data: objectives = [], isLoading: loadingObjs } = useListObjectives({
    query: { queryKey: getListObjectivesQueryKey(), refetchInterval: 8000 },
  });
  const { data: pendingApprovals = [], isLoading: loadingApprovals } = useListApprovals(
    { status: "pending" },
    { query: { queryKey: getListApprovalsQueryKey({ status: "pending" }), refetchInterval: 8000 } },
  );

  const active = objectives.filter((o) => !["completed", "failed"].includes(o.status));
  const done = objectives.filter((o) => ["completed", "failed"].includes(o.status));

  if (loadingObjs || loadingApprovals) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/20 flex items-center justify-center border border-primary/50 text-primary shrink-0">
          <Target className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Objectives</h1>
          <p className="text-sm text-muted-foreground">Quinn's mission queue — execution tracked by Agent Zero</p>
        </div>
      </div>

      {pendingApprovals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-mono uppercase tracking-wider text-fuchsia-400">
            Awaiting Your Decision ({pendingApprovals.length})
          </h2>
          <div className="space-y-3">
            {pendingApprovals.map((a) => (
              <PendingApprovalCard key={a.id} approval={a} />
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Active ({active.length})
          </h2>
          <div className="space-y-2">
            {active.map((o) => (
              <ObjectiveCard key={o.id} objective={o} />
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Resolved ({done.length})
          </h2>
          <div className="space-y-2">
            {done.map((o) => (
              <ObjectiveCard key={o.id} objective={o} />
            ))}
          </div>
        </div>
      )}

      {objectives.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Target className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No objectives yet. Quinn will create them automatically during her next cycle.</p>
        </div>
      )}
    </div>
  );
}
