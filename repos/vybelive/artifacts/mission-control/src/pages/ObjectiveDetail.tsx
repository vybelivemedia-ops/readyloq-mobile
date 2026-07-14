import {
  useGetObjective,
  useDecideApproval,
  getGetObjectiveQueryKey,
  getListObjectivesQueryKey,
} from "@workspace/api-client-react";
import type { AgentApproval, AgentTask, ActivityItem, ObjectiveExecutionEntry } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Target,
  Check,
  X,
  Clock,
  Loader2,
  GitBranch,
  ShieldQuestion,
  Zap,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { ReportView } from "@/components/ReportView";
import { ObjectiveStatusBadge } from "./Objectives";

const TASK_STATUS_DOT: Record<string, string> = {
  todo: "bg-muted-foreground",
  in_progress: "bg-emerald-500",
  blocked: "bg-destructive",
  done: "bg-sky-500",
};

const APPROVAL_STATUS: Record<string, { label: string; text: string }> = {
  pending: { label: "Pending", text: "text-fuchsia-400" },
  approved: { label: "Approved", text: "text-emerald-400" },
  rejected: { label: "Rejected", text: "text-destructive" },
  deferred: { label: "Deferred", text: "text-amber-400" },
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "text-destructive",
  high: "text-amber-400",
  medium: "text-sky-400",
  low: "text-muted-foreground",
};

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ExecutionEntry({ entry }: { entry: ObjectiveExecutionEntry }) {
  const isSuccess = entry.outcome === "success";
  const isFailed = entry.outcome === "failed";
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">
        {isSuccess ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : isFailed ? (
          <XCircle className="w-4 h-4 text-destructive" />
        ) : (
          <Zap className="w-4 h-4 text-sky-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">{entry.action}</p>
        {entry.detail && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-3">{entry.detail}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
          <span>{entry.source}</span>
          {entry.durationMs != null && <span>{entry.durationMs}ms</span>}
          {entry.timestamp && (
            <span>{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: AgentTask }) {
  return (
    <div className="flex items-center gap-3 rounded border border-border bg-background px-3 py-2.5">
      <div className={`w-2 h-2 rounded-full shrink-0 ${TASK_STATUS_DOT[task.status] ?? "bg-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{task.title}</div>
        <div className="text-[11px] font-mono text-muted-foreground">
          {task.executiveName} · {task.status} · {task.progress}%
        </div>
      </div>
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
        {task.priority}
      </span>
    </div>
  );
}

function ApprovalCard({ approval, objectiveId }: { approval: AgentApproval; objectiveId: string }) {
  const queryClient = useQueryClient();
  const decide = useDecideApproval();
  const status = APPROVAL_STATUS[approval.status] ?? APPROVAL_STATUS.pending;
  const isPending = approval.status === "pending";

  const handleDecide = (decision: "approve" | "reject" | "later") => {
    decide.mutate(
      { approvalId: approval.id, data: { decision } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetObjectiveQueryKey(objectiveId) });
          queryClient.invalidateQueries({ queryKey: getListObjectivesQueryKey() });
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/[0.04] p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <ShieldQuestion className="w-4 h-4 text-fuchsia-400 shrink-0" />
          <h4 className="text-sm font-bold text-foreground">{approval.title}</h4>
        </div>
        <span className={`text-[10px] font-mono uppercase tracking-wider shrink-0 ${status.text}`}>
          {status.label}
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed mb-1">{approval.detail}</p>
      <div className="text-[11px] font-mono text-muted-foreground mb-3">
        {approval.executiveName} · impact: {approval.impact}
      </div>
      {isPending ? (
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
      ) : (
        <div className="text-[11px] font-mono text-muted-foreground">
          {approval.decidedAt
            ? `Decided ${formatDistanceToNow(new Date(approval.decidedAt), { addSuffix: true })}`
            : "Deferred"}
        </div>
      )}
    </div>
  );
}

function CollaborationRow({ item }: { item: ActivityItem }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <GitBranch className="w-4 h-4 mt-0.5 shrink-0 text-violet-400" />
      <div>
        <span className="text-foreground/90 leading-relaxed">{item.summary}</span>
        {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export default function ObjectiveDetail() {
  const { objectiveId } = useParams();
  const id = String(objectiveId);
  const { data, isLoading } = useGetObjective(id, {
    query: { queryKey: getGetObjectiveQueryKey(id), refetchInterval: 4000 },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const { objective, tasks, collaborations, approvals, briefing } = data;
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const decidedApprovals = approvals.filter((a) => a.status !== "pending");
  const execHistory = objective.executionHistory ?? [];
  const pct = objective.progressPercent ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/objectives"
        className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All objectives
      </Link>

      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center border border-primary/50 text-primary shrink-0">
            <Target className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <ObjectiveStatusBadge status={objective.status} />
              {objective.priority && (
                <span className={`text-[10px] font-mono uppercase tracking-wider ${PRIORITY_COLOR[objective.priority] ?? "text-muted-foreground"}`}>
                  {objective.priority}
                </span>
              )}
              {objective.ownerRole && (
                <span className="text-[10px] font-mono text-muted-foreground">→ {objective.ownerRole}</span>
              )}
              {objective.createdByName && (
                <span className="text-[11px] font-mono text-muted-foreground">via {objective.createdByName}</span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">{objective.title}</h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{objective.request}</p>

        {pct > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>Progress</span>
              <span>{pct}%</span>
            </div>
            <ProgressBar value={pct} />
          </div>
        )}
      </div>

      {briefing && (
        <Section title="Chief of Staff Briefing">
          <ReportView report={briefing} />
        </Section>
      )}

      {pendingApprovals.length > 0 && (
        <Section title={`Awaiting Your Approval (${pendingApprovals.length})`}>
          <div className="space-y-3">
            {pendingApprovals.map((a) => (
              <ApprovalCard key={a.id} approval={a} objectiveId={id} />
            ))}
          </div>
        </Section>
      )}

      {execHistory.length > 0 && (
        <Section title={`Execution Timeline (${execHistory.length})`}>
          <div className="space-y-4">
            {[...execHistory].reverse().map((entry) => (
              <ExecutionEntry key={entry.id} entry={entry} />
            ))}
          </div>
        </Section>
      )}

      <Section title={`Tasks (${tasks.length})`}>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks dispatched yet.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        )}
      </Section>

      {collaborations.length > 0 && (
        <Section title={`Collaborations (${collaborations.length})`}>
          <div className="space-y-2.5">
            {collaborations.map((c) => (
              <CollaborationRow key={c.id} item={c} />
            ))}
          </div>
        </Section>
      )}

      {decidedApprovals.length > 0 && (
        <Section title="Decision History">
          <div className="space-y-3">
            {decidedApprovals.map((a) => (
              <ApprovalCard key={a.id} approval={a} objectiveId={id} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
