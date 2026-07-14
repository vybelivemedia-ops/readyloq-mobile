import { useState } from "react";
import {
  useGetActiveCollaboration,
  useGetCollaborationTimeline,
  useListObjectives,
  type ExecCollabEvent,
  type CollabDependencyNode,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import {
  MessageSquare, Share2, ArrowRightLeft, Eye, AlertCircle, TrendingUp,
  ChevronRight, Radio, Clock, Users, Zap, GitBranch,
} from "lucide-react";

// ─── Event type config ────────────────────────────────────────────────────────

type EventConfigEntry = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
};

const EVENT_CONFIG: Record<string, EventConfigEntry> = {
  ask_assistance: {
    label: "Asked for Help",
    icon: MessageSquare,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
  },
  share_findings: {
    label: "Shared Findings",
    icon: Share2,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
  },
  transfer_task: {
    label: "Transferred Task",
    icon: ArrowRightLeft,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/30",
  },
  request_review: {
    label: "Requested Review",
    icon: Eye,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/30",
  },
  report_dependency: {
    label: "Blocked / Dependency",
    icon: AlertCircle,
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
  },
  update_progress: {
    label: "Progress Update",
    icon: TrendingUp,
    color: "text-green-400",
    bg: "bg-green-400/10",
    border: "border-green-400/30",
  },
};

function getEventConfig(type: string): EventConfigEntry {
  return EVENT_CONFIG[type] ?? {
    label: type.replace(/_/g, " "),
    icon: MessageSquare,
    color: "text-muted-foreground",
    bg: "bg-secondary",
    border: "border-border",
  };
}

// ─── Summary pill ─────────────────────────────────────────────────────────────

function SummaryPill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-3 bg-card border border-border rounded-lg min-w-[80px]">
      <span className={`text-2xl font-bold font-mono ${color}`}>{count}</span>
      <span className="text-[10px] font-mono text-muted-foreground uppercase mt-0.5 text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event }: { event: ExecCollabEvent }) {
  const cfg = getEventConfig(event.eventType);
  const Icon = cfg.icon;
  const isBroadcast = !event.toExecutiveId;
  const fromColor = event.fromExecutiveColor ?? "#888888";

  return (
    <div className="flex gap-4">
      {/* Timeline spine */}
      <div className="flex flex-col items-center flex-shrink-0 w-8">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${cfg.bg} ${cfg.border}`}>
          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-5 min-w-0">
        <div className="flex items-start gap-2 flex-wrap mb-1.5">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded border font-mono uppercase"
            style={{
              backgroundColor: `${fromColor}15`,
              color: fromColor,
              borderColor: `${fromColor}40`,
            }}
          >
            {event.fromExecutiveName ?? event.fromExecutiveRole ?? "exec"}
          </span>

          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${cfg.bg} ${cfg.color} ${cfg.border}`}>
            {cfg.label}
          </span>

          {isBroadcast ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
              <Radio className="w-3 h-3" />
              broadcast
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
              <ChevronRight className="w-3 h-3" />
              <span style={{ color: fromColor }}>{event.toExecutiveName ?? "—"}</span>
            </span>
          )}

          <span className="ml-auto text-[10px] font-mono text-muted-foreground flex-shrink-0">
            {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
          </span>
        </div>

        <p className="text-sm text-foreground/80 leading-relaxed">{event.content}</p>

        {Object.keys(event.metadata).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(event.metadata)
              .filter(([k]) => k !== "objectiveTitle")
              .map(([k, v]) => (
                <span key={k} className="text-[10px] font-mono text-muted-foreground bg-secondary border border-border rounded px-1.5 py-0.5">
                  {k}: <span className="text-foreground/70">{v}</span>
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dependency node ──────────────────────────────────────────────────────────

function DependencyNode({ node }: { node: CollabDependencyNode }) {
  const hasBlock = node.waitingOn.length > 0;
  const nodeColor = node.executiveColor ?? "#888888";

  return (
    <div className={`rounded-lg border p-4 ${hasBlock ? "border-red-400/30 bg-red-400/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: nodeColor }} />
        <span className="font-medium text-sm text-foreground">{node.executiveName}</span>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto opacity-60 uppercase">
          {node.executiveRole.replace(/_/g, " ")}
        </span>
      </div>

      {hasBlock && (
        <div className="flex items-start gap-2 text-xs text-red-400 mb-2.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Waiting on: <span className="font-medium">{node.waitingOn.join(", ")}</span></span>
        </div>
      )}

      {node.nextAction && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-primary/50" />
          <span>{node.nextAction}</span>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground">
          {node.eventCount} event{node.eventCount !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Active snapshot (no objective selected) ─────────────────────────────────

function ActiveSnapshot() {
  const { data, isLoading } = useGetActiveCollaboration();

  if (isLoading) {
    return (
      <div className="text-center py-20 font-mono animate-pulse text-muted-foreground">
        [ SCANNING ACTIVE CHANNELS... ]
      </div>
    );
  }

  if (!data || data.totalActiveEvents === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-16 h-16 rounded-full bg-card border border-border flex items-center justify-center">
          <Users className="w-7 h-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="font-medium text-foreground mb-1">No active collaboration</p>
          <p className="text-sm text-muted-foreground font-mono">
            Launch an objective to watch the team coordinate in real time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active objective pills */}
      <div className="flex flex-wrap gap-3">
        {data.activeObjectives.map((obj) => (
          <div key={obj.objectiveId} className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium truncate max-w-[200px]">{obj.objectiveTitle}</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-1">{obj.eventCount} events</span>
          </div>
        ))}
      </div>

      {/* Recent events */}
      <div>
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">
          Recent events
        </h2>
        <div className="space-y-0">
          {data.recentEvents.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Objective timeline ───────────────────────────────────────────────────────

function ObjectiveTimeline({ objectiveId }: { objectiveId: string }) {
  const { data, isLoading } = useGetCollaborationTimeline(objectiveId);

  if (isLoading) {
    return (
      <div className="text-center py-16 font-mono animate-pulse text-muted-foreground">
        [ LOADING COLLABORATION DATA... ]
      </div>
    );
  }

  if (!data) return null;

  const { events, dependencyChain, summary } = data;

  return (
    <div className="space-y-8">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-3">
        <SummaryPill count={summary.totalEvents} label="Total Events" color="text-foreground" />
        <SummaryPill count={summary.sharesCount} label="Findings Shared" color="text-blue-400" />
        <SummaryPill count={summary.dependenciesCount} label="Dependencies" color="text-red-400" />
        <SummaryPill count={summary.reviewRequestsCount} label="Reviews" color="text-orange-400" />
        <SummaryPill count={summary.progressUpdatesCount} label="Updates" color="text-green-400" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Left: Timeline */}
        <div>
          <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-5 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Collaboration Timeline
          </h2>

          {events.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm font-mono">
              No collaboration events yet — objective still in progress.
            </div>
          ) : (
            <div className="space-y-0">
              {events.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>

        {/* Right: Dependency chain */}
        <div className="space-y-4">
          <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5" /> Dependency Chain
          </h2>
          {dependencyChain.length === 0 ? (
            <p className="text-sm text-muted-foreground font-mono">No executives involved yet.</p>
          ) : (
            dependencyChain.map((node) => (
              <DependencyNode key={node.executiveId} node={node} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Collaboration() {
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);
  const { data: objectives = [] } = useListObjectives();

  const relevantObjectives = objectives.filter((o) =>
    ["planning", "in_progress", "needs_approval", "completed"].includes(o.status),
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-4 md:flex-row md:items-end justify-between border-b border-border/50 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1 uppercase font-sans flex items-center gap-3">
            <Users className="w-7 h-7 text-primary" />
            Executive Collaboration
          </h1>
          <p className="text-muted-foreground font-mono text-sm">
            Real-time inter-executive communication — findings shared, tasks transferred, dependencies resolved.
          </p>
        </div>
      </header>

      {/* Objective selector */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedObjectiveId(null)}
          className={`px-3 py-1.5 rounded-md text-sm font-mono transition-colors border ${
            selectedObjectiveId === null
              ? "bg-primary/15 text-primary border-primary/30"
              : "text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5" />
            Active Channels
          </span>
        </button>
        {relevantObjectives.slice(0, 8).map((obj) => (
          <button
            key={obj.id}
            onClick={() => setSelectedObjectiveId(obj.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-mono transition-colors border truncate max-w-[240px] ${
              selectedObjectiveId === obj.id
                ? "bg-primary/15 text-primary border-primary/30"
                : "text-muted-foreground border-border hover:bg-secondary hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {obj.status === "in_progress" || obj.status === "planning" ? (
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground flex-shrink-0" />
              )}
              <span className="truncate">{obj.title}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {selectedObjectiveId === null ? (
        <ActiveSnapshot />
      ) : (
        <ObjectiveTimeline objectiveId={selectedObjectiveId} />
      )}
    </div>
  );
}
