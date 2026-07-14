import { useState } from "react";
import {
  ShieldAlert,
  Bot,
  Plug,
  UserCheck,
  Hand,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Layers,
  type LucideIcon,
} from "lucide-react";
import {
  useGetBlockers,
  getGetBlockersQueryKey,
  useGetBlockerSummary,
  getGetBlockerSummaryQueryKey,
  useRunBlockerResolution,
} from "@workspace/api-client-react";
import type {
  BlockerView,
  BlockerSummaryView,
  BlockerViewCategory,
  BlockerViewStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_LABELS: Record<BlockerViewCategory, string> = {
  autonomous: "Autonomous",
  connected: "Connected",
  founder_approval: "Founder Approval",
  human_required: "Human Required",
  unclassified: "Unclassified",
};

const CATEGORY_ICONS: Record<BlockerViewCategory, LucideIcon> = {
  autonomous: Bot,
  connected: Plug,
  founder_approval: UserCheck,
  human_required: Hand,
  unclassified: AlertTriangle,
};

const CATEGORY_BLURB: Record<BlockerViewCategory, string> = {
  autonomous: "The team resolves these without you.",
  connected: "A connected provider resolves these; transient failures retry.",
  founder_approval: "Prep is done — they wait on one approval from you.",
  human_required: "These need a human action only you can take.",
  unclassified: "Awaiting classification on the next pass.",
};

function categoryTone(category: BlockerViewCategory): { text: string; bg: string; ring: string } {
  switch (category) {
    case "autonomous":
      return { text: "text-emerald-300", bg: "bg-emerald-500/10", ring: "ring-emerald-500/30" };
    case "connected":
      return { text: "text-sky-300", bg: "bg-sky-500/10", ring: "ring-sky-500/30" };
    case "founder_approval":
      return { text: "text-amber-300", bg: "bg-amber-500/10", ring: "ring-amber-500/30" };
    case "human_required":
      return { text: "text-rose-300", bg: "bg-rose-500/10", ring: "ring-rose-500/30" };
    default:
      return { text: "text-zinc-400", bg: "bg-zinc-500/10", ring: "ring-zinc-500/30" };
  }
}

function statusTone(status: BlockerViewStatus): { dot: string; text: string; label: string } {
  switch (status) {
    case "resolved":
      return { dot: "bg-emerald-400", text: "text-emerald-300", label: "Resolved" };
    case "in_progress":
      return { dot: "bg-sky-400", text: "text-sky-300", label: "In Progress" };
    case "awaiting_approval":
      return { dot: "bg-amber-400", text: "text-amber-300", label: "Awaiting Approval" };
    case "awaiting_human":
      return { dot: "bg-rose-400", text: "text-rose-300", label: "Awaiting Human" };
    case "failed":
      return { dot: "bg-rose-500", text: "text-rose-400", label: "Failed" };
    default:
      return { dot: "bg-zinc-400", text: "text-zinc-300", label: "Open" };
  }
}

function severityTone(severity: string): string {
  switch (severity) {
    case "critical":
      return "text-rose-400 border-rose-500/40 bg-rose-500/10";
    case "high":
      return "text-amber-300 border-amber-500/40 bg-amber-500/10";
    case "medium":
      return "text-sky-300 border-sky-500/40 bg-sky-500/10";
    default:
      return "text-zinc-400 border-zinc-600/40 bg-zinc-500/10";
  }
}

function outcomeTone(outcome: string): { dot: string; text: string } {
  switch (outcome) {
    case "success":
      return { dot: "bg-emerald-400", text: "text-emerald-300" };
    case "failed":
      return { dot: "bg-rose-400", text: "text-rose-300" };
    case "deferred":
      return { dot: "bg-amber-400", text: "text-amber-300" };
    default:
      return { dot: "bg-zinc-500", text: "text-zinc-400" };
  }
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CountCard({
  icon: Icon,
  label,
  value,
  blurb,
  tone,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  blurb?: string;
  tone: { text: string; bg: string; ring: string };
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border border-border bg-card p-4 transition-colors ${
        onClick ? "hover:border-primary/50 cursor-pointer" : "cursor-default"
      } ${active ? `ring-2 ${tone.ring}` : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone.bg}`}>
          <Icon className={`h-4 w-4 ${tone.text}`} />
        </span>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <div className={`mt-3 text-3xl font-semibold ${tone.text}`}>{value}</div>
      {blurb ? <p className="mt-1 text-xs text-muted-foreground leading-snug">{blurb}</p> : null}
    </button>
  );
}

function BlockerRow({ blocker }: { blocker: BlockerView }) {
  const [open, setOpen] = useState(false);
  const cat = categoryTone(blocker.category);
  const CatIcon = CATEGORY_ICONS[blocker.category];
  const status = statusTone(blocker.status);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cat.bg}`}>
          <CatIcon className={`h-4 w-4 ${cat.text}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{blocker.title}</span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${severityTone(
                blocker.severity,
              )}`}
            >
              {blocker.severity}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{blocker.rootCause}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-1.5 ${cat.text}`}>
              {CATEGORY_LABELS[blocker.category]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              <span className={status.text}>{status.label}</span>
            </span>
            {blocker.ownerName ? <span>Owner: {blocker.ownerName}</span> : null}
            {blocker.connectorProvider ? <span>Provider: {blocker.connectorProvider}</span> : null}
            {blocker.retryCount > 0 ? <span>Retries: {blocker.retryCount}</span> : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {timeAgo(blocker.updatedAt)}
            </span>
          </div>
        </div>
      </button>

      {open ? (
        <div className="border-t border-border px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Detail label="Root cause" value={blocker.rootCause} />
            <Detail label="Resolution plan" value={blocker.resolutionPlan} />
            <Detail label="Estimated completion" value={blocker.estimatedCompletion || "—"} />
            <Detail label="Source" value={blocker.sourceType} />
            {blocker.humanAction ? (
              <Detail label="Human action needed" value={blocker.humanAction} highlight />
            ) : null}
            {blocker.detail ? <Detail label="Detail" value={blocker.detail} /> : null}
          </div>

          {blocker.retryHistory.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Resolution attempts
              </p>
              <ol className="space-y-2">
                {blocker.retryHistory.map((entry, i) => {
                  const tone = outcomeTone(entry.outcome);
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-foreground">{entry.action}</span>
                          <span className={`text-xs ${tone.text}`}>{entry.outcome}</span>
                          <span className="text-xs text-muted-foreground">{timeAgo(entry.at)}</span>
                        </div>
                        {entry.detail ? (
                          <p className="text-xs text-muted-foreground">{entry.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm ${highlight ? "text-amber-300" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function BlockerCenter() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<BlockerViewCategory | null>(null);

  const summaryQuery = useGetBlockerSummary({
    query: {
      queryKey: getGetBlockerSummaryQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const listParams = categoryFilter ? { category: categoryFilter } : undefined;
  const blockersQuery = useGetBlockers(listParams, {
    query: {
      queryKey: getGetBlockersQueryKey(listParams),
      refetchInterval: 30_000,
    },
  });

  const runPass = useRunBlockerResolution();

  const summary: BlockerSummaryView | undefined = summaryQuery.data;
  const blockers = blockersQuery.data?.blockers ?? [];

  async function handleRun() {
    try {
      const result = await runPass.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetBlockerSummaryQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetBlockersQueryKey(listParams) });
      toast({
        title: "Resolution pass complete",
        description: `${result.resolvedThisPass} resolved · ${result.active} active · ${result.escalatedToFounder} escalated`,
      });
    } catch {
      toast({
        title: "Resolution pass failed",
        description: "Could not run the blocker resolution pass.",
        variant: "destructive",
      });
    }
  }

  const sorted = [...blockers].sort((a, b) => {
    const rank: Record<string, number> = {
      awaiting_approval: 0,
      awaiting_human: 1,
      failed: 2,
      in_progress: 3,
      open: 4,
      resolved: 5,
    };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <ShieldAlert className="h-6 w-6 text-primary" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Blocker Center</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every blocker is classified, routed, and progressed each autonomy cycle — exhausting
              every autonomous path before anything reaches you.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={runPass.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {runPass.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Run resolution pass
        </button>
      </div>

      {summaryQuery.isLoading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading blocker intelligence…
        </div>
      ) : summary ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CountCard
              icon={Layers}
              label="Active"
              value={summary.active}
              blurb={`${summary.resolved} resolved · ${summary.failed} failed all-time`}
              tone={{ text: "text-foreground", bg: "bg-primary/10", ring: "ring-primary/40" }}
              active={categoryFilter === null}
              onClick={() => setCategoryFilter(null)}
            />
            {(
              ["autonomous", "connected", "founder_approval", "human_required"] as BlockerViewCategory[]
            ).map((c) => (
              <CountCard
                key={c}
                icon={CATEGORY_ICONS[c]}
                label={CATEGORY_LABELS[c]}
                value={summary.byCategory[c]}
                blurb={CATEGORY_BLURB[c]}
                tone={categoryTone(c)}
                active={categoryFilter === c}
                onClick={() => setCategoryFilter((cur) => (cur === c ? null : c))}
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            <StatusPill icon={CheckCircle2} label="Resolved" value={summary.resolved} tone="text-emerald-300" />
            <StatusPill icon={UserCheck} label="Awaiting approval" value={summary.byStatus.awaiting_approval} tone="text-amber-300" />
            <StatusPill icon={Hand} label="Awaiting human" value={summary.byStatus.awaiting_human} tone="text-rose-300" />
            <StatusPill icon={XCircle} label="Failed" value={summary.failed} tone="text-rose-400" />
          </div>

          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {categoryFilter ? `${CATEGORY_LABELS[categoryFilter]} blockers` : "All blockers"}
              </h2>
              {blockersQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            {sorted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                <p className="mt-3 text-sm font-medium text-foreground">No blockers in this view</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The resolution engine has nothing to route right now.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sorted.map((b) => (
                  <BlockerRow key={b.id} blocker={b} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mt-10 rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
          <p className="mt-3 text-sm font-medium text-foreground">Could not load blocker data</p>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
      <Icon className={`h-4 w-4 ${tone}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${tone}`}>{value}</span>
    </span>
  );
}
