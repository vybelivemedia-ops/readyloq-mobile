import {
  Activity,
  Database,
  Cpu,
  Users,
  Brain,
  Sparkles,
  UserCircle,
  Target,
  CheckSquare,
  ClipboardCheck,
  FileText,
  AlertTriangle,
  Loader2,
  RefreshCw,
  CircleCheck,
  CircleAlert,
  CircleX,
  Building2,
  Bot,
  GraduationCap,
  History,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import {
  useGetDiagnostics,
  getGetDiagnosticsQueryKey,
  useGetEngineeringDiagnostics,
  getGetEngineeringDiagnosticsQueryKey,
} from "@workspace/api-client-react";

type Health = "ok" | "degraded" | "down" | "empty" | "present" | "missing";

function healthTone(status: string): { dot: string; text: string; label: string } {
  switch (status) {
    case "ok":
    case "present":
      return { dot: "bg-emerald-400", text: "text-emerald-300", label: status === "present" ? "Present" : "Healthy" };
    case "degraded":
      return { dot: "bg-amber-400", text: "text-amber-300", label: "Degraded" };
    case "down":
      return { dot: "bg-rose-400", text: "text-rose-300", label: "Down" };
    case "empty":
      return { dot: "bg-zinc-500", text: "text-zinc-400", label: "Empty" };
    case "missing":
      return { dot: "bg-amber-400", text: "text-amber-300", label: "Missing" };
    default:
      return { dot: "bg-zinc-500", text: "text-zinc-400", label: status };
  }
}

function HealthIcon({ status }: { status: string }) {
  if (status === "ok" || status === "present") return <CircleCheck className="h-4 w-4 text-emerald-400" />;
  if (status === "down") return <CircleX className="h-4 w-4 text-rose-400" />;
  return <CircleAlert className="h-4 w-4 text-amber-400" />;
}

function Card({
  icon: Icon,
  title,
  status,
  children,
}: {
  icon: LucideIcon;
  title: string;
  status?: Health | string;
  children: React.ReactNode;
}) {
  const tone = status ? healthTone(status) : null;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">{title}</h3>
        </div>
        {tone && (
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className={`font-mono text-[10px] uppercase tracking-wider ${tone.text}`}>{tone.label}</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function StatusBreakdown({ byStatus }: { byStatus: Record<string, number> }) {
  const entries = Object.entries(byStatus);
  if (entries.length === 0) return <p className="font-mono text-[11px] text-muted-foreground">None</p>;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {entries.map(([status, n]) => (
        <span
          key={status}
          className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {status.replace(/_/g, " ")}: <span className="text-foreground">{n}</span>
        </span>
      ))}
    </div>
  );
}

export default function Diagnostics() {
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useGetDiagnostics({
    query: {
      queryKey: getGetDiagnosticsQueryKey(),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  const { data: engineering } = useGetEngineeringDiagnostics(undefined, {
    query: {
      queryKey: getGetEngineeringDiagnosticsQueryKey(),
      refetchInterval: 30_000,
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-mono text-sm">Loading diagnostics…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <p className="font-medium">Failed to load diagnostics.</p>
          <button
            onClick={() => refetch()}
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-rose-500/40 px-2 py-1 font-mono text-xs hover:bg-rose-500/10"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const specialists = data.specialists ?? { total: 0, available: 0, items: [] };
  const portfolio = data.portfolio ?? { totalAssets: 0, healthy: 0, attention: 0, critical: 0 };
  const autonomy = data.autonomy ?? { totalCycles: 0, lastTrigger: null, lastStatus: null, lastRunAt: null };
  const learning = data.learning ?? {
    totalLessons: 0,
    totalRetrospectives: 0,
    totalWeeklyReviews: 0,
    lastReviewWeekOf: null,
  };
  const living = data.living ?? {
    totalEvents: 0,
    openConversations: 0,
    pendingRecommendations: 0,
    executiveMemories: 0,
    reasoningTraces: 0,
    linkedEvents: 0,
    lastEventAt: null,
  };

  const uptime = data.api.uptimeSeconds;
  const uptimeStr =
    uptime >= 3600
      ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
      : uptime >= 60
        ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
        : `${uptime}s`;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex items-start justify-between border-b border-border/50 pb-6">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">System · Health</p>
          <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Diagnostics</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Live system health across the API, database, AI engines, and Mission Control state. Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">
            Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* API */}
        <Card icon={Activity} title="API Server" status={data.api.status}>
          <Stat label="Status" value={<HealthIcon status={data.api.status} />} />
          <Stat label="Uptime" value={uptimeStr} />
        </Card>

        {/* Database */}
        <Card icon={Database} title="Database" status={data.database.status}>
          <Stat label="Status" value={<HealthIcon status={data.database.status} />} />
          <Stat label="Latency" value={data.database.latencyMs != null ? `${data.database.latencyMs} ms` : "—"} />
          {data.database.error && (
            <p className="mt-1 break-words font-mono text-[10px] text-rose-300">{data.database.error}</p>
          )}
        </Card>

        {/* AI providers */}
        <Card icon={Cpu} title="AI Providers" status={data.ai.status}>
          <Stat label="Active" value={data.ai.active} />
          <Stat label="Model" value={<span className="truncate">{data.ai.model}</span>} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.ai.providers.map((p) => (
              <span
                key={p.name}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  p.available
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-secondary text-muted-foreground"
                }`}
              >
                <span className={`h-1 w-1 rounded-full ${p.available ? "bg-emerald-400" : "bg-zinc-500"}`} />
                {p.name}
              </span>
            ))}
          </div>
        </Card>

        {/* Executives */}
        <Card icon={Users} title="Executives" status={data.executives.total > 0 ? "ok" : "empty"}>
          <Stat label="Total" value={data.executives.total} />
          <div className="mt-2 space-y-1">
            {data.executives.items.map((e) => {
              const tone = healthTone(
                e.status === "offline" ? "down" : e.status === "idle" ? "empty" : "ok",
              );
              return (
                <div key={e.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-foreground">{e.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {e.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Memory engine */}
        <Card icon={Brain} title="Memory Engine" status={data.memoryEngine.status}>
          <Stat label="Insights" value={data.memoryEngine.totalInsights} />
          <Stat label="Memories" value={data.memoryEngine.totalMemories} />
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              high: <span className="text-emerald-300">{data.memoryEngine.byConfidence.high}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              med: <span className="text-amber-300">{data.memoryEngine.byConfidence.medium}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              low: <span className="text-zinc-400">{data.memoryEngine.byConfidence.low}</span>
            </span>
          </div>
        </Card>

        {/* Reasoning engine */}
        <Card icon={Sparkles} title="Reasoning Engine" status={data.reasoningEngine.status}>
          <Stat label="Predictions" value={data.reasoningEngine.totalPredictions} />
          <Stat label="Scored" value={data.reasoningEngine.scoredPredictions} />
          <Stat
            label="Accuracy"
            value={data.reasoningEngine.accuracyPct != null ? `${data.reasoningEngine.accuracyPct}%` : "—"}
          />
        </Card>

        {/* Founder profile */}
        <Card
          icon={UserCircle}
          title="Founder Profile"
          status={data.founderProfile.completenessPct >= 50 ? "ok" : "empty"}
        >
          <Stat
            label="Categories"
            value={`${data.founderProfile.categoriesCovered}/${data.founderProfile.totalCategories}`}
          />
          <Stat label="Completeness" value={`${data.founderProfile.completenessPct}%`} />
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${data.founderProfile.completenessPct}%` }}
            />
          </div>
        </Card>

        {/* Objectives */}
        <Card icon={Target} title="Objectives" status={data.objectives.total > 0 ? "ok" : "empty"}>
          <Stat label="Total" value={data.objectives.total} />
          <StatusBreakdown byStatus={data.objectives.byStatus} />
        </Card>

        {/* Tasks */}
        <Card icon={CheckSquare} title="Tasks" status={data.tasks.total > 0 ? "ok" : "empty"}>
          <Stat label="Total" value={data.tasks.total} />
          <StatusBreakdown byStatus={data.tasks.byStatus} />
        </Card>

        {/* Approvals */}
        <Card icon={ClipboardCheck} title="Approvals" status={data.approvals.pending > 0 ? "degraded" : "ok"}>
          <Stat label="Total" value={data.approvals.total} />
          <Stat label="Pending" value={data.approvals.pending} />
        </Card>

        {/* Daily briefing */}
        <Card icon={FileText} title="Daily Briefing" status={data.dailyBriefing.status}>
          <Stat label="Today" value={data.dailyBriefing.date ?? "—"} />
          <Stat
            label="Generated"
            value={
              data.dailyBriefing.generatedAt
                ? new Date(data.dailyBriefing.generatedAt).toLocaleTimeString()
                : "—"
            }
          />
        </Card>

        {/* Latest errors */}
        <Card
          icon={AlertTriangle}
          title="Latest Errors"
          status={data.latestErrors.length > 0 ? "degraded" : "ok"}
        >
          {data.latestErrors.length === 0 ? (
            <p className="font-mono text-[11px] text-emerald-300">No recent errors</p>
          ) : (
            <div className="space-y-1.5">
              {data.latestErrors.map((e, i) => (
                <div key={i} className="border-l-2 border-rose-500/40 pl-2">
                  <p className="font-mono text-[10px] text-rose-300">{e.source}</p>
                  <p className="break-words font-mono text-[10px] text-muted-foreground">{e.message}</p>
                  <p className="font-mono text-[9px] text-muted-foreground/60">
                    {new Date(e.at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Portfolio monitor (V7) */}
        <Card
          icon={Building2}
          title="Portfolio"
          status={
            portfolio.critical > 0
              ? "down"
              : portfolio.attention > 0
                ? "degraded"
                : portfolio.totalAssets > 0
                  ? "ok"
                  : "empty"
          }
        >
          <Stat label="Assets" value={portfolio.totalAssets} />
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              healthy: <span className="text-emerald-300">{portfolio.healthy}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              attention: <span className="text-amber-300">{portfolio.attention}</span>
            </span>
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              critical: <span className="text-rose-300">{portfolio.critical}</span>
            </span>
          </div>
        </Card>

        {/* Autonomy engine (V7) */}
        <Card icon={Bot} title="Autonomy" status={autonomy.totalCycles > 0 ? "ok" : "empty"}>
          <Stat label="Cycles" value={autonomy.totalCycles} />
          <Stat label="Last trigger" value={autonomy.lastTrigger ?? "—"} />
          <Stat label="Last status" value={autonomy.lastStatus ?? "—"} />
          <Stat
            label="Last run"
            value={autonomy.lastRunAt ? new Date(autonomy.lastRunAt).toLocaleString() : "—"}
          />
        </Card>

        {/* Executive learning (V7) */}
        <Card icon={GraduationCap} title="Learning" status={learning.totalLessons > 0 ? "ok" : "empty"}>
          <Stat label="Lessons" value={learning.totalLessons} />
          <Stat label="Retrospectives" value={learning.totalRetrospectives} />
          <Stat label="Weekly reviews" value={learning.totalWeeklyReviews} />
          <Stat label="Last review" value={learning.lastReviewWeekOf ?? "—"} />
        </Card>

        {/* Living organization (V8) */}
        <Card icon={History} title="Living Org" status={living.totalEvents > 0 ? "ok" : "empty"}>
          <Stat label="Timeline events" value={living.totalEvents} />
          <Stat label="Linked (cause→effect)" value={living.linkedEvents} />
          <Stat label="Open conversations" value={living.openConversations} />
          <Stat label="Pending recs" value={living.pendingRecommendations} />
          <Stat label="Exec memories" value={living.executiveMemories} />
          <Stat label="Reasoning traces" value={living.reasoningTraces} />
          <Stat
            label="Last event"
            value={living.lastEventAt ? new Date(living.lastEventAt).toLocaleString() : "—"}
          />
        </Card>

        {/* Engineering Intelligence (V10) */}
        <Card
          icon={GitBranch}
          title="Engineering Intel"
          status={
            !engineering
              ? "empty"
              : engineering.healthScore >= 70
                ? "ok"
                : engineering.healthScore >= 50
                  ? "degraded"
                  : "down"
          }
        >
          {engineering ? (
            <>
              <Stat label="Health score" value={engineering.healthScore} />
              <Stat label="Confidence" value={`${Math.round(engineering.engineeringConfidence)}%`} />
              <Stat label="Snapshot age" value={`${Math.round(engineering.snapshotAgeMs / 1000)}s`} />
              <Stat
                label="Last sync"
                value={
                  engineering.lastSuccessfulSyncAt
                    ? new Date(engineering.lastSuccessfulSyncAt).toLocaleString()
                    : "—"
                }
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {engineering.providers.map((p) => (
                  <span
                    key={p.name}
                    className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      p.status === "connected"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : p.status === "unavailable"
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    <span
                      className={`h-1 w-1 rounded-full ${
                        p.status === "connected"
                          ? "bg-emerald-400"
                          : p.status === "unavailable"
                            ? "bg-rose-400"
                            : "bg-amber-400"
                      }`}
                    />
                    {p.name}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">No engineering snapshot yet.</p>
          )}
        </Card>

        {/* Specialist bench (Engineering Expansion) */}
        <Card
          icon={Users}
          title="Specialist Bench"
          status={
            specialists.total === 0
              ? "empty"
              : specialists.available === specialists.total
                ? "ok"
                : specialists.available > 0
                  ? "degraded"
                  : "down"
          }
        >
          <Stat label="Registered" value={specialists.total} />
          <Stat label="Installed" value={specialists.available} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {specialists.items.map((s) => (
              <span
                key={s.id}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  s.available
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                }`}
              >
                <span className={`h-1 w-1 rounded-full ${s.available ? "bg-emerald-400" : "bg-rose-400"}`} />
                {s.name}
                {s.runCount > 0 && <span className="text-muted-foreground">×{s.runCount}</span>}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
