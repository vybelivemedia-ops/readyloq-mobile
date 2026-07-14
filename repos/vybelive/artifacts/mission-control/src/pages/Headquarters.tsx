import { Link } from "wouter";
import {
  Building2,
  MessagesSquare,
  Lightbulb,
  History,
  Bot,
  Loader2,
  ArrowUpRight,
  Radio,
  Clock,
  CornerDownRight,
  ArrowRight,
} from "lucide-react";
import {
  useGetOrganizationTimeline,
  getGetOrganizationTimelineQueryKey,
  useGetConversations,
  getGetConversationsQueryKey,
  useGetRecommendations,
  getGetRecommendationsQueryKey,
  useGetAutonomyCycles,
  type OrganizationEvent,
  type ExecConversationSummary,
  type ExecutiveRecommendation,
} from "@workspace/api-client-react";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

const TYPE_DOT: Record<string, string> = {
  objective: "bg-sky-400",
  conversation: "bg-violet-400",
  approval: "bg-amber-400",
  learning: "bg-teal-400",
  founder_decision: "bg-rose-400",
  portfolio: "bg-indigo-400",
  milestone: "bg-emerald-400",
  briefing: "bg-cyan-400",
  recommendation: "bg-yellow-400",
  reflection: "bg-fuchsia-400",
};

function MetricTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Building2;
  label: string;
  value: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 font-sans text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  href,
}: {
  icon: typeof Building2;
  title: string;
  href: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">{title}</h2>
      </div>
      <Link href={href} className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-primary">
        Open <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function ConversationRow({ c }: { c: ExecConversationSummary }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-2">
        {c.status === "open" && (
          <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
            <Radio className="h-3 w-3 animate-pulse" /> Live
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
      </div>
      <h3 className="mt-1 text-sm font-semibold text-foreground">{c.topic}</h3>
      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-foreground/70">{c.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{c.messageCount} messages</span>
        {c.participants.length > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">· {c.participants.join(", ")}</span>
        )}
      </div>
    </div>
  );
}

function EventRow({ e }: { e: OrganizationEvent }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${TYPE_DOT[e.type] ?? "bg-zinc-500"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{e.title}</span>
          <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-muted-foreground">
            {timeAgo(e.createdAt)}
          </span>
        </div>
        <p className="line-clamp-1 text-xs text-muted-foreground">{e.summary}</p>
        {e.causedBy && (
          <p className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground/70">
            <CornerDownRight className="h-3 w-3 flex-shrink-0" />
            caused by <span className="truncate text-foreground/70">{e.causedBy.title}</span>
          </p>
        )}
        {e.leadsTo.length > 0 && (
          <p className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-primary/70">
            <ArrowRight className="h-3 w-3 flex-shrink-0" />
            led to <span className="truncate text-foreground/70">{e.leadsTo.map((l) => l.title).join(", ")}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function RecRow({ r }: { r: ExecutiveRecommendation }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-yellow-300">
          {r.category.replace(/_/g, " ")}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
      </div>
      <h3 className="mt-1.5 text-sm font-semibold text-foreground">{r.title}</h3>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">by {r.proposedByName}</p>
    </div>
  );
}

export default function Headquarters() {
  const timeline = useGetOrganizationTimeline(
    { limit: 12 },
    { query: { queryKey: getGetOrganizationTimelineQueryKey({ limit: 12 }), refetchInterval: 15_000 } },
  );
  const conversations = useGetConversations({
    query: { queryKey: getGetConversationsQueryKey(), refetchInterval: 15_000 },
  });
  const recommendations = useGetRecommendations({
    query: { queryKey: getGetRecommendationsQueryKey(), refetchInterval: 15_000 },
  });
  const autonomy = useGetAutonomyCycles();

  const events = timeline.data?.events ?? [];
  const convos = conversations.data?.conversations ?? [];
  const openConvos = convos.filter((c) => c.status === "open");
  const recs = recommendations.data?.recommendations ?? [];
  const pendingRecs = recs.filter((r) => r.status === "pending");
  const cycles = autonomy.data?.cycles ?? [];
  const lastCycle = cycles[0];

  const loading = timeline.isLoading || conversations.isLoading || recommendations.isLoading;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex items-start justify-between border-b border-border/50 pb-6">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Living · Organization</p>
          <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Headquarters</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            A live view of the organization at work — executives in conversation, work moving through the timeline, and
            initiatives awaiting Quinn. Auto-refreshes continuously.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
          <Radio className="h-3 w-3 animate-pulse" /> Live
        </span>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Bringing headquarters online…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile
              icon={History}
              label="Timeline events"
              value={timeline.data?.total ?? 0}
              tone="text-sky-300"
            />
            <MetricTile
              icon={MessagesSquare}
              label="Open conversations"
              value={openConvos.length}
              tone="text-violet-300"
            />
            <MetricTile
              icon={Lightbulb}
              label="Pending initiatives"
              value={pendingRecs.length}
              tone="text-yellow-300"
            />
            <MetricTile
              icon={Bot}
              label="Autonomy cycles"
              value={cycles.length}
              tone="text-emerald-300"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Executives talking */}
            <div className="rounded-lg border border-border bg-card p-5">
              <PanelHeader icon={MessagesSquare} title="Executives talking" href="/conversations" />
              {convos.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">No conversations yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {convos.slice(0, 4).map((c) => (
                    <Link key={c.id} href="/conversations" className="block">
                      <ConversationRow c={c} />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Initiatives */}
            <div className="rounded-lg border border-border bg-card p-5">
              <PanelHeader icon={Lightbulb} title="Executive initiative" href="/recommendations" />
              {pendingRecs.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">No initiatives awaiting review.</p>
              ) : (
                <div className="space-y-2.5">
                  {pendingRecs.slice(0, 4).map((r) => (
                    <Link key={r.id} href="/recommendations" className="block">
                      <RecRow r={r} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Timeline feed */}
            <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
              <PanelHeader icon={History} title="Organization timeline" href="/timeline" />
              {events.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">No events yet.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </div>
              )}
            </div>

            {/* Autonomy pulse */}
            <div className="rounded-lg border border-border bg-card p-5">
              <PanelHeader icon={Bot} title="Quinn's pulse" href="/autonomy" />
              {lastCycle ? (
                <div className="space-y-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Last cycle</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {timeAgo(lastCycle.startedAt)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted-foreground">Status</span>
                    <span className="font-mono text-xs text-foreground">{lastCycle.status}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted-foreground">Safe actions</span>
                    <span className="font-mono text-xs text-emerald-300">{lastCycle.actions.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted-foreground">Escalations</span>
                    <span className="font-mono text-xs text-amber-300">{lastCycle.escalations.length}</span>
                  </div>
                  {lastCycle.summary && (
                    <p className="border-t border-border/50 pt-3 text-xs leading-relaxed text-foreground/80">
                      {lastCycle.summary}
                    </p>
                  )}
                </div>
              ) : (
                <p className="font-mono text-[11px] text-muted-foreground">No autonomy cycles yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
