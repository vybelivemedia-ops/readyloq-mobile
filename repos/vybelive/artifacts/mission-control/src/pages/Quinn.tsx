import {
  useListExecutives,
  useListExecutiveMessages,
  useSendExecutiveMessage,
  useListObjectives,
  useListApprovals,
  useListExecutiveMemory,
  useDeleteExecutiveMemory,
  useGetQuinnReasoning,
  getListExecutiveMessagesQueryKey,
  getListObjectivesQueryKey,
  getListApprovalsQueryKey,
  getListExecutiveMemoryQueryKey,
  getGetQuinnReasoningQueryKey,
} from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import {
  Brain,
  Loader2,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Activity,
  Target,
  ShieldAlert,
  BookOpen,
  Trash2,
  Star,
  Sparkles,
  HelpCircle,
  Users,
  Layers,
  RefreshCw,
  TrendingUp,
  ArrowRightLeft,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { execStatusStyle } from "@/lib/execStatus";

type AwarenessItem = {
  id: string;
  name: string;
  role: string;
  status: string;
  statusMessage: string | null;
  openTaskCount: number;
};

function useAwarenessPolling(intervalMs = 4000) {
  const [data, setData] = useState<AwarenessItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetch_ = async () => {
      try {
        const r = await fetch("/api/mission-control/awareness");
        if (!r.ok) return;
        const json = await r.json() as AwarenessItem[];
        if (!cancelled) setData(json);
      } catch {
        // silent — polling is best-effort
      }
    };
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);
  return data;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  idle: <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />,
  standby: <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />,
  active: <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />,
  planning: <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />,
  collaborating: <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />,
  needs_approval: <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />,
  busy: <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />,
};

function AwarenessPanel({ items }: { items: AwarenessItem[] }) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((e) => (
        <Link key={e.id} href={`/executives/${e.id}`}>
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md hover:bg-secondary transition-colors cursor-pointer group">
            <div className="mt-1 flex-shrink-0">
              {STATUS_ICONS[e.status] ?? <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium truncate group-hover:text-foreground transition-colors">
                  {e.name}
                </span>
                {e.openTaskCount > 0 && (
                  <span className="text-[9px] font-mono text-muted-foreground/60 flex-shrink-0">
                    {e.openTaskCount}t
                  </span>
                )}
              </div>
              {e.statusMessage && (
                <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5 leading-tight">
                  {e.statusMessage}
                </p>
              )}
              {!e.statusMessage && (
                <p className="text-[10px] text-muted-foreground/40 font-mono uppercase mt-0.5">
                  {e.status}
                </p>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

type ObjectiveStatus = "planning" | "in_progress" | "needs_approval" | "done" | "failed";

function objectiveStatusIcon(status: ObjectiveStatus) {
  if (status === "done") return <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />;
  if (status === "failed") return <AlertTriangle className="w-3 h-3 text-destructive flex-shrink-0" />;
  if (status === "needs_approval") return <ShieldAlert className="w-3 h-3 text-amber-500 flex-shrink-0" />;
  return <Clock className="w-3 h-3 text-blue-500 flex-shrink-0 animate-pulse" />;
}

const MEMORY_KIND_STYLES: Record<string, { label: string; className: string }> = {
  fact: { label: "fact", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  preference: { label: "pref", className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  directive: { label: "directive", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  context: { label: "context", className: "bg-secondary text-muted-foreground border-border" },
  decision: { label: "decision", className: "bg-green-500/15 text-green-400 border-green-500/30" },
};

type MemoryEntry = {
  id: string;
  executiveId: string;
  kind: string;
  content: string;
  pinned: boolean;
  createdAt: string;
};

function MemoryPanel({
  entries,
  onDelete,
  isDeleting,
}: {
  entries: MemoryEntry[];
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6 py-10">
        <div className="w-14 h-14 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-center">
          <BookOpen className="w-7 h-7 text-primary/40" />
        </div>
        <div>
          <p className="font-semibold mb-1 text-sm">No memories yet</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Tell Quinn to remember something — e.g.{" "}
            <span className="font-mono text-primary/70">"remember that we're raising a round next quarter"</span>
          </p>
        </div>
      </div>
    );
  }

  const pinned = entries.filter((e) => e.pinned);
  const rest = entries.filter((e) => !e.pinned);
  const sorted = [...pinned, ...rest];

  return (
    <div className="flex flex-col gap-1 p-3">
      {sorted.map((entry) => {
        const style = MEMORY_KIND_STYLES[entry.kind] ?? MEMORY_KIND_STYLES.context!;
        return (
          <div
            key={entry.id}
            className="group flex items-start gap-3 px-3 py-2.5 rounded-md bg-secondary/40 border border-border hover:border-border/80 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${style.className}`}
                >
                  {style.label}
                </span>
                {entry.pinned && <Star className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />}
                <span className="text-[9px] font-mono text-muted-foreground/40 ml-auto flex-shrink-0">
                  {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="text-xs text-foreground/90 leading-relaxed">{entry.content}</p>
            </div>
            <button
              onClick={() => onDelete(entry.id)}
              disabled={isDeleting}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 p-1 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground/40 disabled:opacity-30"
              title="Delete memory"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

type TabId = "chat" | "memory" | "reasoning" | "cos";

type ReasoningStep = { question: string; answer: string };
type ReasoningTrace = {
  id: string;
  founderMessage?: string | null;
  steps: ReasoningStep[];
  reply?: string | null;
  reasoningIntent?: string | null;
  coordinated: boolean;
  coordinationNote?: string | null;
  createdAt: string;
};

function ReasoningPanel({ traces }: { traces: ReasoningTrace[] }) {
  if (traces.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
        <div className="w-16 h-16 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-primary/60" />
        </div>
        <div>
          <p className="font-semibold mb-1">No reasoning traces yet</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Each time you message Quinn, she works through six internal questions before replying. Those traces appear here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-4">
      {traces.map((trace) => (
        <div key={trace.id} className="rounded-lg border border-border bg-background overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {trace.founderMessage && (
                <p className="text-xs text-foreground leading-snug">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground/70">Founder: </span>
                  {trace.founderMessage}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                {trace.reasoningIntent && (
                  <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
                    {trace.reasoningIntent.replace(/_/g, " ")}
                  </span>
                )}
                {trace.coordinated && (
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                    Coordinated team
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
                  {format(new Date(trace.createdAt), "MMM d, HH:mm:ss")}
                </span>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            {trace.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <HelpCircle className="w-3.5 h-3.5 text-primary/60 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-foreground/70">{step.question}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{step.answer}</p>
                </div>
              </div>
            ))}
          </div>
          {trace.coordinationNote && (
            <div className="px-4 pb-4">
              <p className="border-l-2 border-emerald-500/40 pl-2 font-mono text-[11px] italic text-muted-foreground">
                {trace.coordinationNote}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Chief of Staff types (mirrors backend CoS types) ────────────────────────

type WorkloadItem = {
  role: string;
  name: string | null;
  execId: string;
  objectiveCount: number;
  byPriority: Record<string, number>;
  overloaded: boolean;
};

type BlockedObjective = {
  id: string;
  title: string;
  status: string;
  blockedReason: "unmet_dependency" | "stalled_progress" | "no_owner";
  dependencyIds?: string[];
  lastActivityAt?: string | null;
  stalledForMs?: number;
};

type CoSDecision = {
  kind: string;
  objectiveId: string;
  objectiveTitle: string;
  from?: string;
  to?: string;
  reason: string;
  appliedAt: string;
};

type CoSCycleResult = {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  decisions: CoSDecision[];
  workload: WorkloadItem[];
  blocked: BlockedObjective[];
  summary: string;
};

// ─── CoS polling hooks ────────────────────────────────────────────────────────

function useWorkloadPolling(enabled: boolean, intervalMs = 30_000) {
  const [data, setData] = useState<WorkloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetch_ = async () => {
      try {
        const r = await fetch("/api/mission-control/quinn/cos/workload");
        if (!r.ok) return;
        const json = await r.json() as { workload: WorkloadItem[] };
        if (!cancelled) { setData(json.workload ?? []); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    };
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, intervalMs]);
  return { data, loading };
}

function useBlockedPolling(enabled: boolean, intervalMs = 30_000) {
  const [data, setData] = useState<BlockedObjective[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetch_ = async () => {
      try {
        const r = await fetch("/api/mission-control/quinn/cos/blocked");
        if (!r.ok) return;
        const json = await r.json() as { blocked: BlockedObjective[] };
        if (!cancelled) { setData(json.blocked ?? []); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    };
    void fetch_();
    const id = setInterval(() => { void fetch_(); }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, intervalMs]);
  return { data, loading };
}

// ─── CoS display helpers ──────────────────────────────────────────────────────

const BLOCKED_REASON_STYLES: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  no_owner: {
    label: "Unassigned",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    icon: <Users className="w-3 h-3" />,
  },
  unmet_dependency: {
    label: "Blocked",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  stalled_progress: {
    label: "Stalled",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    icon: <Clock className="w-3 h-3" />,
  },
};

const DECISION_KIND_STYLES: Record<string, { label: string; className: string }> = {
  assign:          { label: "assigned",  className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  priority_change: { label: "priority",  className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  escalate:        { label: "escalated", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  flag_blocked:    { label: "blocked",   className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  balance:         { label: "workload",  className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  no_change:       { label: "no change", className: "bg-secondary text-muted-foreground border-border" },
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-400",
  medium:   "bg-blue-400",
  low:      "bg-muted-foreground/40",
};

// ─── CoSDashboard component ───────────────────────────────────────────────────

function CoSDashboard({
  workload,
  blocked,
  workloadLoading,
  blockedLoading,
  lastCycle,
  isCycleRunning,
  onRunCycle,
}: {
  workload: WorkloadItem[];
  blocked: BlockedObjective[];
  workloadLoading: boolean;
  blockedLoading: boolean;
  lastCycle: CoSCycleResult | null;
  isCycleRunning: boolean;
  onRunCycle: () => void;
}) {
  const overloadedCount = workload.filter((w) => w.overloaded).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* CoS cycle trigger */}
      <div className="rounded-lg border border-border bg-secondary/30 p-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-0.5">Chief of Staff Cycle</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Quinn will prioritize objectives, assign unowned work, flag blockers, and balance the team's workload.
            She will never write code or trigger deployments.
          </p>
          {lastCycle && (
            <p className="text-[10px] font-mono text-muted-foreground/60 mt-1.5">
              Last run: {format(new Date(lastCycle.completedAt), "MMM d, HH:mm:ss")} ·{" "}
              {lastCycle.decisions.length} decision(s)
            </p>
          )}
        </div>
        <Button
          onClick={onRunCycle}
          disabled={isCycleRunning}
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono flex-shrink-0 gap-1.5"
        >
          {isCycleRunning ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {isCycleRunning ? "Running…" : "Run Cycle"}
        </Button>
      </div>

      {/* Last cycle summary + decisions */}
      {lastCycle && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary/20 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-primary">
              Cycle Result
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
              {lastCycle.cycleId.slice(0, 8)}
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-foreground/90 leading-relaxed mb-3">{lastCycle.summary}</p>
            {lastCycle.decisions.length > 0 && (
              <div className="space-y-1.5">
                {lastCycle.decisions.map((d, i) => {
                  const style = DECISION_KIND_STYLES[d.kind] ?? DECISION_KIND_STYLES.no_change!;
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <span
                        className={`flex-shrink-0 mt-0.5 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${style.className}`}
                      >
                        {style.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        {d.objectiveTitle && (
                          <p className="text-[11px] font-medium truncate leading-tight">
                            {d.objectiveTitle}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 leading-snug">
                          {d.from && d.to ? (
                            <span className="font-mono">
                              {d.from} <ArrowRightLeft className="w-2.5 h-2.5 inline mx-0.5" /> {d.to}
                              {" · "}
                            </span>
                          ) : null}
                          {d.reason}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Executive workload */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-primary" />
          <span className="font-mono text-xs font-bold uppercase tracking-wider">
            Executive Workload
          </span>
          {overloadedCount > 0 && (
            <span className="ml-auto text-[10px] font-mono text-amber-400">
              {overloadedCount} overloaded
            </span>
          )}
        </div>
        {workloadLoading ? (
          <div className="px-4 py-6 text-center font-mono text-xs text-muted-foreground animate-pulse">
            [ LOADING WORKLOAD... ]
          </div>
        ) : workload.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No executives in registry. Run the seed script to populate.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-border">
            {workload.map((item) => (
              <div
                key={item.execId}
                className={`bg-card px-3 py-2.5 ${item.overloaded ? "bg-amber-500/5" : ""}`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground/70 truncate">
                    {item.role.replace(/_/g, " ")}
                  </span>
                  {item.overloaded && (
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-xl font-bold font-mono ${item.overloaded ? "text-amber-400" : "text-foreground"}`}
                  >
                    {item.objectiveCount}
                  </span>
                  <span className="text-[10px] text-muted-foreground">objective{item.objectiveCount !== 1 ? "s" : ""}</span>
                </div>
                {Object.keys(item.byPriority).length > 0 && (
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {(["critical", "high", "medium", "low"] as const).map((p) =>
                      item.byPriority[p] ? (
                        <div key={p} className="flex items-center gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[p]}`} />
                          <span className="text-[9px] font-mono text-muted-foreground/60">
                            {item.byPriority[p]}{p[0]?.toUpperCase()}
                          </span>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Blocked objectives */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-primary" />
          <span className="font-mono text-xs font-bold uppercase tracking-wider">
            Blocked Work
          </span>
          {blocked.length > 0 && (
            <span className="ml-auto text-[10px] font-mono text-destructive/80">
              {blocked.length} blocked
            </span>
          )}
        </div>
        {blockedLoading ? (
          <div className="px-4 py-6 text-center font-mono text-xs text-muted-foreground animate-pulse">
            [ SCANNING OBJECTIVES... ]
          </div>
        ) : blocked.length === 0 ? (
          <div className="px-4 py-6 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="w-6 h-6 text-green-500/60" />
            <p className="text-xs text-muted-foreground">All active objectives are unblocked.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {blocked.map((b) => {
              const style = BLOCKED_REASON_STYLES[b.blockedReason] ?? BLOCKED_REASON_STYLES.stalled_progress!;
              return (
                <div key={b.id} className="px-4 py-3 flex items-start gap-3">
                  <div className={`flex-shrink-0 mt-0.5 ${style.className.split(" ").find((c) => c.startsWith("text-"))}`}>
                    {style.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${style.className}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="text-xs font-medium leading-tight truncate">{b.title}</p>
                    {b.blockedReason === "stalled_progress" && b.stalledForMs != null && (
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                        Stalled {Math.round(b.stalledForMs / 3_600_000)}h · last activity{" "}
                        {b.lastActivityAt
                          ? formatDistanceToNow(new Date(b.lastActivityAt), { addSuffix: true })
                          : "unknown"}
                      </p>
                    )}
                    {b.blockedReason === "unmet_dependency" && b.dependencyIds && (
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                        {b.dependencyIds.length} unresolved dep{b.dependencyIds.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Quinn() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [lastCycleResult, setLastCycleResult] = useState<CoSCycleResult | null>(null);
  const [isCycleRunning, setIsCycleRunning] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: executives = [] } = useListExecutives();
  const quinn = executives.find((e) => e.role === "chief_of_staff");
  const quinnId = quinn?.id ?? "";

  const { data: messages = [], isLoading: messagesLoading } = useListExecutiveMessages(quinnId, {
    query: {
      enabled: !!quinnId,
      queryKey: getListExecutiveMessagesQueryKey(quinnId),
      refetchInterval: isLaunching ? 2000 : 5000,
    },
  });

  const { data: objectives = [] } = useListObjectives({
    query: {
      queryKey: getListObjectivesQueryKey(),
      refetchInterval: isLaunching ? 3000 : 10000,
    },
  });

  const { data: approvals = [] } = useListApprovals(
    { status: "pending" },
    { query: { queryKey: getListApprovalsQueryKey({ status: "pending" }), refetchInterval: 15000 } },
  );

  const { data: memoryEntries = [], isLoading: memoryLoading } = useListExecutiveMemory(quinnId, {
    query: {
      enabled: !!quinnId,
      queryKey: getListExecutiveMemoryQueryKey(quinnId),
    },
  });

  const deleteMemory = useDeleteExecutiveMemory();

  const { data: reasoningData } = useGetQuinnReasoning(
    { limit: 20 },
    {
      query: {
        queryKey: getGetQuinnReasoningQueryKey({ limit: 20 }),
        refetchInterval: isLaunching ? 3000 : 15000,
      },
    },
  );
  const reasoningTraces = (reasoningData?.reasoning ?? []) as ReasoningTrace[];

  const awareness = useAwarenessPolling(isLaunching ? 2500 : 5000);
  const { data: workload, loading: workloadLoading } = useWorkloadPolling(activeTab === "cos");
  const { data: blocked, loading: blockedLoading } = useBlockedPolling(activeTab === "cos");
  const sendMessage = useSendExecutiveMessage();

  const nonQuinnAwareness = awareness.filter((e) => e.role !== "chief_of_staff");

  // Stop launch polling once Quinn is idle again
  const quinnAwareness = awareness.find((e) => e.role === "chief_of_staff");
  useEffect(() => {
    if (isLaunching && quinnAwareness && quinnAwareness.status === "idle") {
      setIsLaunching(false);
      queryClient.invalidateQueries({ queryKey: getListExecutiveMessagesQueryKey(quinnId) });
      queryClient.invalidateQueries({ queryKey: getListObjectivesQueryKey() });
    }
  }, [isLaunching, quinnAwareness, quinnId, queryClient]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !quinnId || sendMessage.isPending) return;
    const content = message.trim();
    setMessage("");

    sendMessage.mutate(
      { executiveId: quinnId, data: { content } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({
            queryKey: getListExecutiveMessagesQueryKey(quinnId),
          });
          // Refresh memory list if Quinn performed a memory op
          if (data.memoryOp) {
            queryClient.invalidateQueries({
              queryKey: getListExecutiveMemoryQueryKey(quinnId),
            });
          }
          if (data.command?.detected || data.intent === "launch") {
            setIsLaunching(true);
            queryClient.invalidateQueries({ queryKey: getListObjectivesQueryKey() });
          }
        },
        onError: () => {
          setMessage(content);
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (message.trim() && quinnId && !sendMessage.isPending) {
        handleSend(e as unknown as React.FormEvent);
      }
    }
  };

  const handleRunCycle = async () => {
    setIsCycleRunning(true);
    try {
      const r = await fetch("/api/mission-control/quinn/cos/cycle", { method: "POST" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; result: CoSCycleResult };
      if (json.ok) setLastCycleResult(json.result);
    } catch { /* silent — UI remains unlocked */ } finally {
      setIsCycleRunning(false);
    }
  };

  const handleDeleteMemory = (memoryId: string) => {
    deleteMemory.mutate(
      { memoryId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListExecutiveMemoryQueryKey(quinnId) });
        },
      },
    );
  };

  const activeCount = nonQuinnAwareness.filter(
    (e) => ["active", "planning", "collaborating"].includes(e.status),
  ).length;
  const approvalCount = approvals.length;
  const memoryCount = (memoryEntries as MemoryEntry[]).length;
  const recentObjectives = (objectives as Array<{ id: string; title: string; status: ObjectiveStatus; createdAt: string }>)
    .slice(0, 5);

  return (
    <div className="h-[calc(100vh-4rem)] flex gap-6 animate-in fade-in duration-300">
      {/* Chat + Memory — main column */}
      <div className="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden min-w-0">
        {/* Quinn header */}
        <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-card to-primary/5 flex items-center gap-4">
          {quinn && (
            <div
              className="w-10 h-10 rounded-md flex items-center justify-center text-base font-bold font-mono border flex-shrink-0"
              style={{
                backgroundColor: `${quinn.accentColor}15`,
                color: quinn.accentColor,
                borderColor: `${quinn.accentColor}40`,
              }}
            >
              {quinn.avatarInitials}
            </div>
          )}
          {!quinn && (
            <div className="w-10 h-10 rounded-md flex items-center justify-center bg-primary/10 border border-primary/30 flex-shrink-0">
              <Brain className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="font-bold text-base">{quinn?.name ?? "Quinn Harlow"}</h2>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${quinn ? execStatusStyle(quinn.status).dot : "bg-muted-foreground/40"}`} />
                <span className="text-[10px] font-mono text-muted-foreground uppercase">
                  {quinnAwareness?.statusMessage ?? quinn?.status ?? "idle"}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground truncate">{quinn?.tagline ?? "Chief of Staff — Primary Command Interface"}</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground flex-shrink-0">
            {activeCount > 0 && (
              <div className="flex items-center gap-1.5 text-green-500">
                <Activity className="w-3 h-3" />
                <span>{activeCount} active</span>
              </div>
            )}
            {approvalCount > 0 && (
              <Link href="/objectives">
                <div className="flex items-center gap-1.5 text-amber-500 hover:text-amber-400 cursor-pointer">
                  <ShieldAlert className="w-3 h-3" />
                  <span>{approvalCount} pending</span>
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border bg-secondary/30 flex-shrink-0">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-semibold uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === "chat"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Brain className="w-3 h-3" />
            Chat
          </button>
          <button
            onClick={() => setActiveTab("memory")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-semibold uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === "memory"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookOpen className="w-3 h-3" />
            Memory
            {memoryCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-primary/15 text-primary font-mono">
                {memoryCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("reasoning")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-semibold uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === "reasoning"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Reasoning
            {reasoningTraces.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-primary/15 text-primary font-mono">
                {reasoningTraces.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("cos")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-semibold uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === "cos"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-3 h-3" />
            Chief of Staff
            {blocked.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-destructive/20 text-destructive font-mono">
                {blocked.length}
              </span>
            )}
          </button>
        </div>

        {/* Launch progress indicator */}
        {isLaunching && activeTab === "chat" && (
          <div className="px-5 py-2.5 border-b border-border bg-primary/5 flex items-center gap-3">
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />
            <span className="font-mono text-[11px] text-primary uppercase tracking-wider flex-1">
              Quinn is coordinating the team…
            </span>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Chat tab */}
        {activeTab === "chat" && (
          <>
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {messagesLoading && (
                <div className="h-full flex items-center justify-center font-mono text-xs text-muted-foreground animate-pulse">
                  [ ESTABLISHING SECURE CHANNEL... ]
                </div>
              )}
              {!messagesLoading && messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                  <div className="w-16 h-16 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-center">
                    <Brain className="w-8 h-8 text-primary/60" />
                  </div>
                  <div>
                    <p className="font-semibold mb-1">
                      {quinn?.name ?? "Quinn"} is ready
                    </p>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Tell me what you need. I'll understand the intent, coordinate the right executives, and report back with a full briefing.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center mt-2">
                    {[
                      "Give me a full status report",
                      "Audit our product roadmap",
                      "How is the team doing?",
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => setMessage(prompt)}
                        className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors font-mono"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === "founder" ? "items-end ml-12" : "items-start mr-12"}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">
                      {msg.role === "founder" ? "Founder" : (quinn?.name ?? "Quinn")}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/40">
                      {format(new Date(msg.createdAt), "HH:mm:ss")}
                    </span>
                  </div>
                  <div
                    className={`p-3.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "founder"
                        ? "bg-primary/15 text-primary-foreground border border-primary/25 rounded-tr-sm"
                        : "bg-secondary text-secondary-foreground border border-border rounded-tl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border bg-background/50">
              <form onSubmit={handleSend} className="flex gap-2 items-end">
                <Textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${quinn?.name ?? "Quinn"}… (Enter to send, Shift+Enter for new line)`}
                  className="flex-1 font-mono text-sm bg-secondary/50 border-border focus-visible:ring-primary resize-none min-h-[44px] max-h-[120px]"
                  disabled={sendMessage.isPending || !quinnId}
                  rows={1}
                />
                <Button
                  type="submit"
                  disabled={!message.trim() || sendMessage.isPending || !quinnId}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono h-11 w-24 flex-shrink-0"
                >
                  {sendMessage.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </form>
              <p className="text-[10px] text-muted-foreground/50 font-mono mt-1.5 pl-1">
                Quinn coordinates the full executive team on your behalf · say "remember that…" to save context
              </p>
            </div>
          </>
        )}

        {/* Memory tab */}
        {activeTab === "memory" && (
          <div className="flex-1 overflow-y-auto">
            {memoryLoading ? (
              <div className="h-full flex items-center justify-center font-mono text-xs text-muted-foreground animate-pulse">
                [ LOADING MEMORY... ]
              </div>
            ) : (
              <MemoryPanel
                entries={memoryEntries as MemoryEntry[]}
                onDelete={handleDeleteMemory}
                isDeleting={deleteMemory.isPending}
              />
            )}
          </div>
        )}

        {/* Reasoning tab */}
        {activeTab === "reasoning" && (
          <div className="flex-1 overflow-y-auto">
            <ReasoningPanel traces={reasoningTraces} />
          </div>
        )}

        {/* Chief of Staff tab */}
        {activeTab === "cos" && (
          <CoSDashboard
            workload={workload}
            blocked={blocked}
            workloadLoading={workloadLoading}
            blockedLoading={blockedLoading}
            lastCycle={lastCycleResult}
            isCycleRunning={isCycleRunning}
            onRunCycle={() => { void handleRunCycle(); }}
          />
        )}
      </div>

      {/* Right sidebar — awareness + objectives */}
      <div className="w-72 flex flex-col gap-4 flex-shrink-0">
        {/* Live team state */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/50 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Live Team State</h3>
            {activeCount > 0 && (
              <span className="ml-auto text-[10px] font-mono text-green-500">{activeCount} active</span>
            )}
          </div>
          <div className="py-1">
            {nonQuinnAwareness.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground font-mono">Loading…</p>
            ) : (
              <AwarenessPanel items={nonQuinnAwareness} />
            )}
          </div>
        </div>

        {/* Recent objectives */}
        <div className="bg-card border border-border rounded-lg overflow-hidden flex-1 min-h-0">
          <div className="px-4 py-3 border-b border-border bg-secondary/50 flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Recent Objectives</h3>
            <Link href="/objectives" className="ml-auto text-[10px] font-mono text-muted-foreground hover:text-foreground">
              view all →
            </Link>
          </div>
          <div className="overflow-y-auto p-2 space-y-1.5">
            {recentObjectives.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground font-mono text-center">
                No objectives yet — tell Quinn what to do.
              </p>
            ) : (
              recentObjectives.map((obj) => (
                <Link key={obj.id} href={`/objectives/${obj.id}`}>
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-secondary transition-colors cursor-pointer">
                    {objectiveStatusIcon(obj.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{obj.title}</p>
                      <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                        {formatDistanceToNow(new Date(obj.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Pending approvals nudge */}
        {approvalCount > 0 && (
          <Link href="/objectives">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-amber-500/15 transition-colors">
              <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-400">
                  {approvalCount} approval{approvalCount !== 1 ? "s" : ""} pending
                </p>
                <p className="text-[10px] text-muted-foreground">Tap to review and decide</p>
              </div>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
