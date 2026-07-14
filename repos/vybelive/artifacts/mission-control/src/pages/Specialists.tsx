import {
  Users,
  Sparkles,
  Loader2,
  RefreshCw,
  CircleCheck,
  CircleX,
  BookOpen,
  Bot,
} from "lucide-react";
import {
  useListSpecialists,
  getListSpecialistsQueryKey,
  type SpecialistEntry,
} from "@workspace/api-client-react";

const ROLE_LABELS: Record<string, string> = {
  cto: "CTO",
  release_manager: "Release Manager",
  chief_of_staff: "Chief of Staff",
  marketing_director: "Marketing Director",
  product_manager: "Product Manager",
  shared: "Shared Skill",
};

function ConfidenceBar({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-emerald-400" : value >= 50 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">{value}%</span>
    </div>
  );
}

function SpecialistCard({ s }: { s: SpecialistEntry }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {s.kind === "skill" ? (
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Bot className="h-4 w-4 text-muted-foreground" />
          )}
          <h3 className="font-mono text-sm font-bold text-foreground">{s.name}</h3>
          <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {s.kind}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {s.available ? (
            <CircleCheck className="h-4 w-4 text-emerald-400" />
          ) : (
            <CircleX className="h-4 w-4 text-rose-400" />
          )}
          <span
            className={`font-mono text-[10px] uppercase tracking-wider ${s.available ? "text-emerald-300" : "text-rose-300"}`}
          >
            {s.available ? "Installed" : "Missing"}
          </span>
        </div>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">{s.purpose}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
          {s.ownerRole === "shared"
            ? `Shared: ${s.collaboratorRoles.map((r) => ROLE_LABELS[r] ?? r).join(" + ")}`
            : `Owner: ${s.ownerName ?? "—"} (${ROLE_LABELS[s.ownerRole] ?? s.ownerRole})`}
        </span>
        {!s.ownerPresent && (
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
            owner missing
          </span>
        )}
      </div>

      <div className="mb-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">Confidence</span>
          <ConfidenceBar value={s.confidence} />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">Runs</span>
          <span className="font-mono text-sm text-foreground">
            {s.runCount}
            {s.runCount > 0 && <span className="text-muted-foreground"> ({s.successCount} ok)</span>}
          </span>
        </div>
        {s.lastRunAt && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">Last run</span>
            <span className="font-mono text-[11px] text-foreground">{new Date(s.lastRunAt).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div>
          <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">When invoked</p>
          <p className="text-xs text-foreground/80">{s.invocationRules}</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Inputs</p>
            <p className="text-xs text-foreground/80">{s.expectedInputs}</p>
          </div>
          <div>
            <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Outputs</p>
            <p className="text-xs text-foreground/80">{s.expectedOutputs}</p>
          </div>
        </div>
        {s.triggers.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Triggers</p>
            <div className="flex flex-wrap gap-1">
              {s.triggers.map((t) => (
                <span
                  key={t}
                  className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {s.lastRunSummary && (
          <div>
            <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Last run summary
            </p>
            <p className="text-xs italic text-foreground/70">{s.lastRunSummary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Specialists() {
  const { data, isLoading, isError, isFetching, refetch } = useListSpecialists({
    query: { queryKey: getListSpecialistsQueryKey(), refetchInterval: 60_000 },
  });

  const specialists = data?.specialists ?? [];
  const agents = specialists.filter((s) => s.kind === "agent");
  const skills = specialists.filter((s) => s.kind === "skill");
  const availableCount = specialists.filter((s) => s.available).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="font-mono text-lg font-bold uppercase tracking-wider text-foreground">Agent Registry</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Specialist agents on your executives' benches. Quinn routes work through the owning executive — their
            findings appear inside that executive's reports, never as separate chats.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-sm text-rose-300">
          Failed to load the specialist registry.
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            <span className="rounded border border-border bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground">
              Registered: <span className="text-foreground">{specialists.length}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground">
              Installed: <span className="text-emerald-300">{availableCount}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground">
              Agents: <span className="text-foreground">{agents.length}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground">
              Shared skills: <span className="text-foreground">{skills.length}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {agents.map((s) => (
              <SpecialistCard key={s.id} s={s} />
            ))}
          </div>

          {skills.length > 0 && (
            <>
              <div className="mb-3 mt-8 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">Shared Skills</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {skills.map((s) => (
                  <SpecialistCard key={s.id} s={s} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
