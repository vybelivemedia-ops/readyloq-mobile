import { useState } from "react";
import {
  History,
  Loader2,
  Target,
  MessagesSquare,
  ClipboardCheck,
  GraduationCap,
  Gavel,
  Building2,
  Flag,
  FileText,
  Lightbulb,
  Brain,
  Clock,
  CornerDownRight,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  useGetOrganizationTimeline,
  getGetOrganizationTimelineQueryKey,
  OrganizationEventType,
  type OrganizationEvent,
} from "@workspace/api-client-react";

const TYPE_META: Record<
  string,
  { label: string; icon: LucideIcon; tone: string }
> = {
  objective: { label: "Objective", icon: Target, tone: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  conversation: { label: "Conversation", icon: MessagesSquare, tone: "text-violet-300 border-violet-500/30 bg-violet-500/10" },
  approval: { label: "Approval", icon: ClipboardCheck, tone: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  learning: { label: "Learning", icon: GraduationCap, tone: "text-teal-300 border-teal-500/30 bg-teal-500/10" },
  founder_decision: { label: "Founder Decision", icon: Gavel, tone: "text-rose-300 border-rose-500/30 bg-rose-500/10" },
  portfolio: { label: "Portfolio", icon: Building2, tone: "text-indigo-300 border-indigo-500/30 bg-indigo-500/10" },
  milestone: { label: "Milestone", icon: Flag, tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  briefing: { label: "Briefing", icon: FileText, tone: "text-cyan-300 border-cyan-500/30 bg-cyan-500/10" },
  recommendation: { label: "Recommendation", icon: Lightbulb, tone: "text-yellow-300 border-yellow-500/30 bg-yellow-500/10" },
  reflection: { label: "Reflection", icon: Brain, tone: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10" },
};

const IMPORTANCE_DOT: Record<string, string> = {
  low: "bg-zinc-500",
  normal: "bg-sky-400",
  high: "bg-amber-400",
  critical: "bg-rose-400",
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { label: type, icon: History, tone: "text-zinc-300 border-border bg-secondary" };
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...Object.values(OrganizationEventType).map((v) => ({
    value: v,
    label: typeMeta(v).label,
  })),
];

function TimelineRow({ event }: { event: OrganizationEvent }) {
  const meta = typeMeta(event.type);
  const Icon = meta.icon;
  return (
    <div className="relative flex gap-4 pl-2">
      {/* rail */}
      <div className="flex flex-col items-center">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border ${meta.tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.tone}`}>
            {meta.label}
          </span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${IMPORTANCE_DOT[event.importance] ?? "bg-zinc-500"}`}
            title={`Importance: ${event.importance}`}
          />
          {event.actorName && (
            <span className="font-mono text-[10px] text-muted-foreground">{event.actorName}</span>
          )}
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatWhen(event.createdAt)}
          </span>
        </div>
        <h3 className="mt-1.5 text-sm font-semibold text-foreground">{event.title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{event.summary}</p>
        {event.causedBy && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-1.5">
            <CornerDownRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              <span className="uppercase tracking-wider text-foreground/60">Caused by</span>{" "}
              <span className="text-foreground/90">{event.causedBy.title}</span>
            </p>
          </div>
        )}
        {event.leadsTo.length > 0 && (
          <div className="mt-2 space-y-1">
            {event.leadsTo.map((next) => (
              <div key={next.id} className="flex items-start gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5">
                <ArrowRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
                <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                  <span className="uppercase tracking-wider text-primary/70">Led to</span>{" "}
                  <span className="text-foreground/90">{next.title}</span>
                </p>
              </div>
            ))}
          </div>
        )}
        {event.keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {event.keywords.map((k) => (
              <span
                key={k}
                className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
              >
                {k}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Timeline() {
  const [filter, setFilter] = useState("");
  const params = { limit: 100, ...(filter ? { type: filter } : {}) };
  const { data, isLoading, isError } = useGetOrganizationTimeline(params, {
    query: {
      queryKey: getGetOrganizationTimelineQueryKey(params),
      refetchInterval: 20_000,
    },
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Organization · Memory</p>
        <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Timeline</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          The company's curated memory — every major objective, conversation, decision, milestone, and lesson the
          organization has lived through. Quinn and the executives draw on this history when reasoning about new work.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            onClick={() => setFilter(f.value)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              filter === f.value
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading organization memory…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to load the organization timeline.
        </div>
      )}

      {data && data.events.length === 0 && (
        <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
          No events recorded yet{filter ? ` for "${typeMeta(filter).label}"` : ""}. As the organization works, its
          memory will accumulate here.
        </div>
      )}

      {data && data.events.length > 0 && (
        <div>
          <p className="mb-4 font-mono text-[11px] text-muted-foreground">
            {data.events.length} of {data.total} event{data.total === 1 ? "" : "s"}
          </p>
          <div>
            {data.events.map((event) => (
              <TimelineRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
