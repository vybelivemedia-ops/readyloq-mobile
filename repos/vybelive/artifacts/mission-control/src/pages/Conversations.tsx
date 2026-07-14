import { useState } from "react";
import { Link } from "wouter";
import {
  MessagesSquare,
  Loader2,
  Radio,
  CheckCircle2,
  ChevronRight,
  Clock,
  ShieldAlert,
  Network,
  ArrowRight,
  Target,
} from "lucide-react";
import {
  useGetConversations,
  getGetConversationsQueryKey,
  useGetConversation,
  getGetConversationQueryKey,
  useListApprovals,
  getListApprovalsQueryKey,
  useGetActiveCollaboration,
  getGetActiveCollaborationQueryKey,
  type ExecConversationSummary,
  type ExecConversationMessage,
  type AgentApproval,
  type ExecCollabEvent,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";

type Tab = "threads" | "approvals" | "collaboration";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "open") {
    return (
      <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
        <Radio className="h-3 w-3 animate-pulse" /> Open
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
      <CheckCircle2 className="h-3 w-3" /> Resolved
    </span>
  );
}

function MessageBubble({ msg }: { msg: ExecConversationMessage }) {
  return (
    <div className="flex gap-3">
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border font-mono text-[10px] font-bold"
        style={{ backgroundColor: `${msg.accentColor}15`, color: msg.accentColor, borderColor: `${msg.accentColor}40` }}
      >
        {msg.fromInitials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{msg.fromName}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{timeAgo(msg.createdAt)}</span>
        </div>
        <p className="mt-1 rounded-lg rounded-tl-none border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-foreground/90">
          {msg.content}
        </p>
      </div>
    </div>
  );
}

function ConversationThread({ conversationId }: { conversationId: string }) {
  const { data, isLoading, isError } = useGetConversation(conversationId, {
    query: { queryKey: getGetConversationQueryKey(conversationId), refetchInterval: 15_000 },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
      </div>
    );
  }
  if (isError || !data) {
    return <p className="font-mono text-xs text-rose-300">Failed to load conversation.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="border-b border-border/50 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={data.conversation.status} />
          {data.conversation.initiatedByName && (
            <span className="font-mono text-[10px] text-muted-foreground">Initiated by {data.conversation.initiatedByName}</span>
          )}
        </div>
        <h2 className="mt-2 font-sans text-xl font-bold text-foreground">{data.conversation.topic}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{data.conversation.summary}</p>
      </div>
      <div className="space-y-5">
        {data.messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
      </div>
    </div>
  );
}

function ConversationListItem({ c, active, onClick }: { c: ExecConversationSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        active ? "border-primary/40 bg-primary/10" : "border-border bg-card hover:border-border/80 hover:bg-secondary/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={c.status} />
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeAgo(c.lastMessageAt)}
        </span>
      </div>
      <h3 className="mt-1.5 flex items-center gap-1 text-sm font-semibold text-foreground">
        <span className="line-clamp-1">{c.topic}</span>
        <ChevronRight className={`ml-auto h-4 w-4 flex-shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
      </h3>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
        {c.messageCount} messages · {c.participants.join(", ")}
      </p>
    </button>
  );
}

function ThreadsTab() {
  const { data, isLoading, isError } = useGetConversations({
    query: { queryKey: getGetConversationsQueryKey(), refetchInterval: 15_000 },
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const convos = data?.conversations ?? [];
  const activeId = selectedId ?? convos[0]?.id ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
        Failed to load conversations.
      </div>
    );
  }
  if (convos.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
        No conversations yet. Executives start talking during reflection cycles and when risks surface.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2.5">
        {convos.map((c) => (
          <ConversationListItem key={c.id} c={c} active={c.id === activeId} onClick={() => setSelectedId(c.id)} />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        {activeId ? (
          <ConversationThread conversationId={activeId} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
            <MessagesSquare className="h-4 w-4" /> Select a conversation
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({ a }: { a: AgentApproval }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{a.title}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {a.executiveName} · requested {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
          </p>
        </div>
        <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[9px] uppercase text-amber-300">
          {a.status}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-foreground/80">{a.detail}</p>
      {a.impact && <p className="mt-2 font-mono text-[10px] text-muted-foreground">Impact: {a.impact}</p>}
      <div className="mt-3 flex items-center gap-3">
        {a.objectiveId && (
          <Link href={`/objectives/${a.objectiveId}`} className="flex items-center gap-1 font-mono text-[10px] text-primary hover:underline">
            <Target className="h-3 w-3" /> View objective
          </Link>
        )}
        <Link href="/quinn" className="font-mono text-[10px] text-amber-300 hover:underline">
          Decide via Quinn →
        </Link>
      </div>
    </div>
  );
}

function ApprovalsTab() {
  const { data: approvals = [], isLoading, isError } = useListApprovals(
    { status: "pending" },
    { query: { queryKey: getListApprovalsQueryKey({ status: "pending" }), refetchInterval: 30_000 } },
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading approvals…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
        Failed to load approvals.
      </div>
    );
  }
  if (approvals.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
        No pending approvals. Executives escalate here when they need founder sign-off on a protected action.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {approvals.map((a) => (
        <ApprovalCard key={a.id} a={a} />
      ))}
    </div>
  );
}

function CollabEventCard({ e }: { e: ExecCollabEvent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded font-mono text-[9px] font-bold"
          style={{ backgroundColor: `${e.fromExecutiveColor ?? "#64748b"}20`, color: e.fromExecutiveColor ?? "#94a3b8" }}
        >
          {(e.fromExecutiveName ?? "??").slice(0, 2).toUpperCase()}
        </span>
        <span className="font-mono text-[11px] text-foreground">{e.fromExecutiveName ?? "Executive"}</span>
        {e.toExecutiveName && (
          <>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono text-[11px] text-foreground">{e.toExecutiveName}</span>
          </>
        )}
        <span className="ml-auto rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary">
          {e.eventType.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-foreground/85">{e.content}</p>
      <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
        <span>{timeAgo(e.createdAt)}</span>
        {e.resolved ? <span className="text-emerald-400">resolved</span> : <span className="text-amber-400">open</span>}
      </div>
    </div>
  );
}

function CollaborationTab() {
  const { data, isLoading, isError } = useGetActiveCollaboration({
    query: { queryKey: getGetActiveCollaborationQueryKey(), refetchInterval: 20_000 },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading collaboration activity…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
        Failed to load collaboration activity.
      </div>
    );
  }

  const { activeObjectives, recentEvents } = data;
  if (activeObjectives.length === 0 && recentEvents.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
        No active cross-executive collaboration. Handoffs and assistance requests will appear here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2.5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Active Objectives ({activeObjectives.length})
        </p>
        {activeObjectives.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-4 font-mono text-[11px] text-muted-foreground">None active.</p>
        ) : (
          activeObjectives.map((o) => (
            <Link
              key={o.objectiveId}
              href={`/objectives/${o.objectiveId}`}
              className="block rounded-md border border-border bg-card p-3 hover:border-primary/40"
            >
              <p className="text-sm font-medium leading-tight text-foreground">{o.objectiveTitle}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {o.eventCount} event{o.eventCount === 1 ? "" : "s"}
                {o.lastEventAt ? ` · ${timeAgo(o.lastEventAt)}` : ""}
              </p>
            </Link>
          ))
        )}
      </div>
      <div className="space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Recent Handoffs & Requests</p>
        {recentEvents.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-4 font-mono text-[11px] text-muted-foreground">No recent events.</p>
        ) : (
          recentEvents.map((e) => <CollabEventCard key={e.id} e={e} />)
        )}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "threads", label: "Threads", icon: MessagesSquare },
  { id: "approvals", label: "Approvals", icon: ShieldAlert },
  { id: "collaboration", label: "Collaboration", icon: Network },
];

export default function Conversations() {
  const [tab, setTab] = useState<Tab>("threads");

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Living · Organization</p>
        <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Coordination Hub</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Executive conversations, founder approvals, and cross-team delegation — the organization coordinating in real time.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
              tab === t.id
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "threads" && <ThreadsTab />}
      {tab === "approvals" && <ApprovalsTab />}
      {tab === "collaboration" && <CollaborationTab />}
    </div>
  );
}
