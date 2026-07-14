import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Lightbulb,
  Loader2,
  ArrowUpRight,
  X,
  CheckCircle2,
  AlertTriangle,
  History,
  Clock,
  Gauge,
  Dot,
  TrendingUp,
  Brain,
  MessagesSquare,
  Target,
} from "lucide-react";
import {
  useGetRecommendations,
  getGetRecommendationsQueryKey,
  useDecideRecommendation,
  type ExecutiveRecommendation,
} from "@workspace/api-client-react";

const CATEGORY_TONE: Record<string, string> = {
  onboarding: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  technical_debt: "text-orange-300 border-orange-500/30 bg-orange-500/10",
  launch: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  process: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  growth: "text-teal-300 border-teal-500/30 bg-teal-500/10",
  quality: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  strategy: "text-indigo-300 border-indigo-500/30 bg-indigo-500/10",
};

const STATUS_TONE: Record<string, string> = {
  pending: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  converted: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  accepted: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  dismissed: "text-zinc-400 border-border bg-secondary",
};

function fmtCategory(c: string) {
  return c.replace(/_/g, " ");
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RecommendationCard({
  rec,
  onDecide,
  pending,
}: {
  rec: ExecutiveRecommendation;
  onDecide: (decision: "convert" | "dismiss") => void;
  pending: boolean;
}) {
  const catTone = CATEGORY_TONE[rec.category] ?? "text-zinc-300 border-border bg-secondary";
  const statusTone = STATUS_TONE[rec.status] ?? "text-zinc-400 border-border bg-secondary";
  const isPendingDecision = rec.status === "pending";

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${catTone}`}>
          {fmtCategory(rec.category)}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusTone}`}>
          {rec.status}
        </span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatWhen(rec.createdAt)}
        </span>
      </div>

      <h3 className="mt-3 text-base font-semibold text-foreground">{rec.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-foreground/80">{rec.rationale}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Proposed by <span className="text-foreground">{rec.proposedByName}</span>
        </p>
        <div className="flex items-center gap-1.5" title="Proposing executive's confidence">
          <Gauge className="h-3 w-3 text-primary/70" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Confidence <span className="text-foreground">{rec.confidence}%</span>
          </span>
        </div>
      </div>

      {(rec.evidence.length > 0 ||
        rec.citedMemories.length > 0 ||
        rec.supportingConversations.length > 0 ||
        rec.relatedObjectives.length > 0 ||
        rec.expectedImpact) && (
        <div className="mt-3 space-y-2.5 rounded-md border border-border bg-secondary/40 p-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-primary/80">Justification</p>

          {rec.evidence.length > 0 && (
            <ul className="space-y-1">
              {rec.evidence.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-foreground/80">
                  <Dot className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/60" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}

          {rec.expectedImpact && (
            <div className="flex items-start gap-1.5">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-300" />
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                <span className="uppercase tracking-wider text-emerald-300">Expected impact: </span>
                {rec.expectedImpact}
              </p>
            </div>
          )}

          {rec.citedMemories.length > 0 && (
            <div className="space-y-1">
              {rec.citedMemories.map((m) => (
                <div key={m.id} className="flex items-start gap-1.5">
                  <Brain className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-fuchsia-300" />
                  <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                    <span className="uppercase tracking-wider text-fuchsia-300">{m.kind.replace(/_/g, " ")}: </span>
                    {m.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          {rec.supportingConversations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <MessagesSquare className="h-3.5 w-3.5 flex-shrink-0 text-violet-300" />
              {rec.supportingConversations.map((c) => (
                <span
                  key={c.id}
                  className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-200"
                >
                  {c.topic}
                </span>
              ))}
            </div>
          )}

          {rec.relatedObjectives.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Target className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
              {rec.relatedObjectives.map((o) => (
                <Link
                  key={o.id}
                  href={`/objectives/${o.id}`}
                  className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-200 hover:underline"
                >
                  {o.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {rec.priorContext && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-secondary/50 p-2.5">
          <History className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-fuchsia-300" />
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-fuchsia-300">Organizational memory: </span>
            {rec.priorContext}
          </p>
        </div>
      )}

      {rec.decisionNote && (
        <p className="mt-3 border-l-2 border-border pl-2 font-mono text-[11px] italic text-muted-foreground">
          {rec.decisionNote}
        </p>
      )}

      {rec.status === "converted" && rec.objectiveId && (
        <Link
          href={`/objectives/${rec.objectiveId}`}
          className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-emerald-300 hover:underline"
        >
          View resulting objective <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}

      {isPendingDecision && (
        <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-4">
          <button
            onClick={() => onDecide("convert")}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
            Convert to objective
          </button>
          <button
            onClick={() => onDecide("dismiss")}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default function Recommendations() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetRecommendations({
    query: {
      queryKey: getGetRecommendationsQueryKey(),
      refetchInterval: 20_000,
    },
  });
  const decide = useDecideRecommendation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ status: "success" | "error"; message: string } | null>(null);

  const onDecide = (rec: ExecutiveRecommendation, decision: "convert" | "dismiss") => {
    const verb = decision === "convert" ? "convert this recommendation into an objective" : "dismiss this recommendation";
    if (!window.confirm(`Quinn will ${verb}. Continue?`)) return;
    setActiveId(rec.id);
    decide.mutate(
      { recommendationId: rec.id, data: { decision } },
      {
        onSuccess: (res) => {
          setBanner({ status: "success", message: res?.message ?? "Decision recorded." });
          void queryClient.invalidateQueries();
        },
        onError: () => {
          setBanner({ status: "error", message: "Decision failed — see server logs." });
        },
        onSettled: () => setActiveId(null),
      },
    );
  };

  const recs = data?.recommendations ?? [];
  const pending = recs.filter((r) => r.status === "pending");
  const decided = recs.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Executive · Initiative</p>
        <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Recommendations</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Executives proactively propose work — referencing the organization's past outcomes. Quinn reviews each one and
          either converts it into an objective or dismisses it.
        </p>
      </header>

      {banner && (
        <div
          className={`flex items-center gap-2 rounded-md border p-3 font-mono text-xs ${
            banner.status === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          {banner.status === "success" ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          )}
          {banner.message}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading recommendations…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to load executive recommendations.
        </div>
      )}

      {data && recs.length === 0 && (
        <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
          No recommendations yet. Executives propose initiatives during reflection cycles.
        </div>
      )}

      {pending.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-300" />
            <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Awaiting Quinn ({pending.length})</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pending.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onDecide={(d) => onDecide(rec, d)}
                pending={decide.isPending && activeId === rec.id}
              />
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-sans text-lg font-bold uppercase tracking-tight text-muted-foreground">
            Decided ({decided.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {decided.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} onDecide={() => {}} pending={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
