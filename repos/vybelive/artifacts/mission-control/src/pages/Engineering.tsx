import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  GitBranch,
  GitCommit,
  GitPullRequest,
  CircleAlert,
  CircleCheck,
  CircleX,
  Cpu,
  Layers,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Server,
  History,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  useGetEngineeringSnapshot,
  getGetEngineeringSnapshotQueryKey,
  useGetEngineeringHistory,
  getGetEngineeringHistoryQueryKey,
  useGetEngineeringDiagnostics,
  getGetEngineeringDiagnosticsQueryKey,
  useGetEngineeringProducts,
  getGetEngineeringProductsQueryKey,
  useGetEngineeringPortfolio,
  getGetEngineeringPortfolioQueryKey,
  useGetEngineeringEvents,
  getGetEngineeringEventsQueryKey,
} from "@workspace/api-client-react";
import type {
  EngineeringSnapshotView,
  EngineeringLaunchReadiness,
  EngineeringLaunchReadinessFactor,
  EngineeringEventView,
} from "@workspace/api-client-react";

function healthTone(score: number): { ring: string; text: string; label: string } {
  if (score >= 85) return { ring: "text-emerald-400", text: "text-emerald-300", label: "Healthy" };
  if (score >= 70) return { ring: "text-lime-400", text: "text-lime-300", label: "Stable" };
  if (score >= 50) return { ring: "text-amber-400", text: "text-amber-300", label: "Degraded" };
  return { ring: "text-rose-400", text: "text-rose-300", label: "At Risk" };
}

function readinessTone(state: string): { ring: string; text: string; label: string } {
  switch (state) {
    case "ready":
      return { ring: "text-emerald-400", text: "text-emerald-300", label: "Ready" };
    case "approaching":
      return { ring: "text-amber-400", text: "text-amber-300", label: "Approaching" };
    case "not_ready":
      return { ring: "text-rose-400", text: "text-rose-300", label: "Not Ready" };
    default:
      return { ring: "text-zinc-500", text: "text-zinc-400", label: "Unknown" };
  }
}

function factorTone(state: string): { dot: string; text: string } {
  switch (state) {
    case "strong":
      return { dot: "bg-emerald-400", text: "text-emerald-300" };
    case "watch":
      return { dot: "bg-amber-400", text: "text-amber-300" };
    case "at_risk":
      return { dot: "bg-rose-400", text: "text-rose-300" };
    default:
      return { dot: "bg-zinc-500", text: "text-zinc-400" };
  }
}

function statusTone(status: string): { dot: string; text: string } {
  switch (status) {
    case "passing":
    case "deployed":
    case "healthy":
    case "connected":
      return { dot: "bg-emerald-400", text: "text-emerald-300" };
    case "degraded":
    case "stale":
    case "development":
      return { dot: "bg-amber-400", text: "text-amber-300" };
    case "failing":
    case "down":
    case "unavailable":
      return { dot: "bg-rose-400", text: "text-rose-300" };
    default:
      return { dot: "bg-zinc-500", text: "text-zinc-400" };
  }
}

function riskTone(risk: string): string {
  switch (risk) {
    case "low":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "medium":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "high":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-border bg-secondary text-muted-foreground";
  }
}

function eventTone(severity: string): { border: string; icon: string } {
  switch (severity) {
    case "critical":
      return { border: "border-rose-500/30 bg-rose-500/10", icon: "text-rose-300" };
    case "warning":
      return { border: "border-amber-500/30 bg-amber-500/10", icon: "text-amber-300" };
    default:
      return { border: "border-border bg-secondary/40", icon: "text-sky-300" };
  }
}

function Card({
  icon: Icon,
  title,
  status,
  children,
}: {
  icon: LucideIcon;
  title: string;
  status?: string;
  children: React.ReactNode;
}) {
  const tone = status ? statusTone(status) : null;
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
            <span className={`font-mono text-[10px] uppercase tracking-wider ${tone.text}`}>{status}</span>
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

function ScoreRing({
  score,
  ring,
  text,
  label,
}: {
  score: number;
  ring: string;
  text: string;
  label: string;
}) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (Math.max(0, Math.min(100, score)) / 100) * circ;
  return (
    <div className="relative h-32 w-32 flex-shrink-0">
      <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="8" className="stroke-secondary" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className={`${ring} transition-all duration-500`}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-3xl font-bold ${text}`}>{score}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function LaunchReadinessCard({
  readiness,
  heading,
  subtitle,
}: {
  readiness: EngineeringLaunchReadiness;
  heading: string;
  subtitle: string;
}) {
  const tone = readinessTone(readiness.state);
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Rocket className="h-4 w-4 text-primary" />
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">{heading}</h3>
      </div>
      <div className="flex items-center gap-6">
        <ScoreRing score={readiness.score} ring={tone.ring} text={tone.text} label={tone.label} />
        <div className="flex-1 space-y-1.5">
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">{subtitle}</p>
          {readiness.factors.map((f: EngineeringLaunchReadinessFactor) => {
            const ft = factorTone(f.state);
            return (
              <div key={f.key} className="flex items-center justify-between gap-3" title={f.detail}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${ft.dot}`} />
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{f.label}</span>
                </div>
                <span className={`font-mono text-[11px] font-medium ${ft.text}`}>
                  {f.score == null ? "—" : f.score}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProviderPills({ providers }: { providers: EngineeringSnapshotView["providers"] }) {
  if (providers.length === 0) {
    return <p className="font-mono text-[11px] text-muted-foreground">No providers reporting.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {providers.map((p) => {
        const tone = statusTone(p.status);
        return (
          <span
            key={p.name}
            className="flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            <span className={`h-1 w-1 rounded-full ${tone.dot}`} />
            {p.name}: <span className={tone.text}>{p.status}</span>
          </span>
        );
      })}
    </div>
  );
}

function EventsFeed({ events }: { events: EngineeringEventView[] }) {
  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <CircleCheck className="h-3.5 w-3.5 text-emerald-300" /> No engineering events recorded yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {events.slice(0, 12).map((e) => {
        const tone = eventTone(e.severity);
        return (
          <li key={e.id} className={`flex items-start gap-2 rounded border px-2 py-1.5 ${tone.border}`}>
            <Zap className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${tone.icon}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] font-medium text-foreground">{e.title}</span>
                <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
              </div>
              {e.detail && <p className="mt-0.5 line-clamp-2 font-mono text-[10px] text-muted-foreground">{e.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Engineering() {
  const { data: productsData } = useGetEngineeringProducts({
    query: {
      queryKey: getGetEngineeringProductsQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const products = productsData?.products ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? products[0]?.id ?? null;

  const { data: portfolio } = useGetEngineeringPortfolio({
    query: {
      queryKey: getGetEngineeringPortfolioQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const snapshotParams = activeId ? { productId: activeId } : undefined;
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useGetEngineeringSnapshot(snapshotParams, {
    query: {
      queryKey: getGetEngineeringSnapshotQueryKey(snapshotParams),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  const { data: history } = useGetEngineeringHistory(snapshotParams, {
    query: {
      queryKey: getGetEngineeringHistoryQueryKey(snapshotParams),
      refetchInterval: 30_000,
    },
  });

  const eventParams = activeId ? { productId: activeId } : undefined;
  const { data: eventsData } = useGetEngineeringEvents(eventParams, {
    query: {
      queryKey: getGetEngineeringEventsQueryKey(eventParams),
      refetchInterval: 30_000,
    },
  });

  const { data: diagnostics } = useGetEngineeringDiagnostics(snapshotParams, {
    query: {
      queryKey: getGetEngineeringDiagnosticsQueryKey(snapshotParams),
      refetchInterval: 30_000,
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-mono text-sm">Loading engineering intelligence…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <p className="font-medium">Failed to load the engineering snapshot.</p>
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

  const recentSnapshots = history?.snapshots ?? [];
  const events = eventsData?.events ?? [];
  const isMonitored = data.providers.length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex items-start justify-between border-b border-border/50 pb-6">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">System · Engineering</p>
          <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Engineering Intelligence</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Portfolio-aware engineering backbone — each product normalized into one snapshot with launch readiness,
            change-detected events, and provider diagnostics. Auto-refreshes every 30s.
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

      {/* Product selector */}
      {products.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Product</span>
          {products.map((p) => {
            const isActive = p.id === activeId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                  isActive
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-secondary text-muted-foreground hover:bg-secondary/70"
                }`}
              >
                <Layers className="h-3 w-3" />
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      {!isMonitored && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sky-300">
          <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p className="font-mono text-[11px]">
            <span className="font-medium">{data.productName}</span> has no engineering providers registered yet. This is a
            placeholder product — the snapshot is well-formed with all fields at known-safe defaults. Register a provider
            to begin monitoring.
          </p>
        </div>
      )}

      {/* Launch readiness: per-product + portfolio */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LaunchReadinessCard
          readiness={data.launchReadiness}
          heading={`${data.productName} · Launch Readiness`}
          subtitle="Weighted launch readiness for this product."
        />
        {portfolio && (
          <LaunchReadinessCard
            readiness={portfolio.portfolioLaunchReadiness}
            heading="Portfolio · Launch Readiness"
            subtitle={`Aggregate across ${portfolio.products.filter((p) => p.monitored).length} monitored product(s).`}
          />
        )}
      </div>

      {/* Health score + risks */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex items-center gap-6 rounded-md border border-border bg-card p-6 lg:col-span-1">
          <ScoreRing
            score={data.healthScore}
            ring={healthTone(data.healthScore).ring}
            text={healthTone(data.healthScore).text}
            label={healthTone(data.healthScore).label}
          />
          <div className="space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Health Score</p>
            <div className="flex flex-col gap-1.5">
              <span className={`inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${riskTone(data.deploymentRisk)}`}>
                <Rocket className="h-3 w-3" /> Deploy risk: {data.deploymentRisk}
              </span>
              <span className={`inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${riskTone(data.launchRisk)}`}>
                <ShieldAlert className="h-3 w-3" /> Launch risk: {data.launchRisk}
              </span>
            </div>
          </div>
        </div>

        {/* Blockers */}
        <div className="rounded-md border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">Blockers</h3>
          </div>
          {data.blockers.length === 0 ? (
            <p className="flex items-center gap-2 font-mono text-sm text-emerald-300">
              <CircleCheck className="h-4 w-4" /> No engineering blockers detected.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.blockers.map((b, i) => (
                <li key={i} className="flex items-start gap-2 font-mono text-[12px] text-rose-300">
                  <CircleX className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Engineering events feed */}
      <Card icon={Zap} title="Engineering Events">
        <EventsFeed events={events} />
      </Card>

      {/* Provider diagnostics */}
      <Card icon={Cpu} title="Provider Diagnostics">
        <ProviderPills providers={data.providers} />
        {diagnostics && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            <Stat label="Confidence" value={`${Math.round(diagnostics.engineeringConfidence)}%`} />
            <Stat label="Snapshot age" value={`${Math.round(diagnostics.snapshotAgeMs / 1000)}s`} />
            <Stat
              label="Last sync"
              value={diagnostics.lastSuccessfulSyncAt ? new Date(diagnostics.lastSuccessfulSyncAt).toLocaleTimeString() : "—"}
            />
            <Stat label="Health" value={diagnostics.healthScore} />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Repository */}
        <Card icon={GitBranch} title="Repository">
          <Stat label="Branch" value={data.repository.branch || "—"} />
          <Stat label="Open PRs" value={data.repository.openPullRequests.length} />
          <Stat label="Open issues" value={data.repository.openIssues} />
          {data.repository.latestCommit && (
            <div className="mt-2 rounded border border-border bg-secondary/50 p-2">
              <div className="flex items-center gap-1.5">
                <GitCommit className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {data.repository.latestCommit.sha.slice(0, 7)} · {data.repository.latestCommit.author}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 font-mono text-[11px] text-foreground">
                {data.repository.latestCommit.message}
              </p>
            </div>
          )}
        </Card>

        {/* Build */}
        <Card icon={Activity} title="Build" status={data.build.status}>
          <Stat label="Status" value={data.build.status} />
          <Stat label="Failed builds" value={data.build.failedBuilds} />
          <Stat
            label="Last success"
            value={data.build.lastSuccessfulBuildAt ? new Date(data.build.lastSuccessfulBuildAt).toLocaleString() : "—"}
          />
          {data.build.artifactPath && (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{data.build.artifactPath}</p>
          )}
        </Card>

        {/* Deployment */}
        <Card icon={Rocket} title="Deployment" status={data.deployment.status}>
          <Stat label="Status" value={data.deployment.status} />
          <Stat label="Production" value={data.deployment.productionHealth} />
          <Stat label="Services" value={data.deployment.activeServices.length} />
          {data.deployment.urls.length > 0 && (
            <p className="mt-1 truncate font-mono text-[10px] text-primary">{data.deployment.urls[0]}</p>
          )}
        </Card>

        {/* Runtime */}
        <Card icon={Server} title="Runtime">
          <Stat label="Errors" value={data.runtime.errors.length} />
          <Stat label="Warnings" value={data.runtime.warnings.length} />
          <Stat label="Unhealthy services" value={data.runtime.unhealthyServices.length} />
          {data.runtime.unhealthyServices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {data.runtime.unhealthyServices.map((s) => (
                <span key={s} className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                  {s}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Pull requests */}
        <Card icon={GitPullRequest} title="Open Pull Requests">
          {data.repository.openPullRequests.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">No open pull requests.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.repository.openPullRequests.slice(0, 5).map((pr) => (
                <li key={pr.number} className="font-mono text-[11px] text-foreground">
                  <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Active services */}
        <Card icon={Server} title="Active Services">
          {data.deployment.activeServices.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">No services reporting.</p>
          ) : (
            <div className="space-y-1">
              {data.deployment.activeServices.map((s) => {
                const tone = statusTone(s.status);
                return (
                  <div key={s.name} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px] text-foreground">{s.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {s.latencyMs != null ? `${s.latencyMs}ms` : s.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Portfolio overview */}
      {portfolio && portfolio.products.length > 0 && (
        <Card icon={Layers} title="Portfolio Overview">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Product", "Monitored", "Health", "Readiness", "Deploy", "Launch", "Blockers"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {portfolio.products.map((p) => {
                  const ht = healthTone(p.healthScore);
                  const rt = readinessTone(p.launchReadiness.state);
                  return (
                    <tr key={p.product.id} className="border-b border-border/40">
                      <td className="px-2 py-1.5 font-mono text-[11px] font-medium text-foreground">{p.product.name}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">
                        {p.monitored ? (
                          <span className="text-emerald-300">yes</span>
                        ) : (
                          <span className="text-muted-foreground">placeholder</span>
                        )}
                      </td>
                      <td className={`px-2 py-1.5 font-mono text-[11px] font-medium ${ht.text}`}>{p.healthScore}</td>
                      <td className={`px-2 py-1.5 font-mono text-[11px] font-medium ${rt.text}`}>
                        {p.launchReadiness.score} · {rt.label}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{p.deploymentRisk}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{p.launchRisk}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{p.blockers.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Build / deployment history */}
      <Card icon={History} title="Snapshot History">
        {recentSnapshots.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">No historical snapshots yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Captured", "Health", "Readiness", "Build", "Deployment", "Prod", "Blockers"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentSnapshots.slice(0, 12).map((s) => {
                  const tone = healthTone(s.healthScore);
                  return (
                    <tr key={s.id} className="border-b border-border/40">
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {new Date(s.capturedAt).toLocaleString()}
                      </td>
                      <td className={`px-2 py-1.5 font-mono text-[11px] font-medium ${tone.text}`}>{s.healthScore}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{s.launchReadiness.score}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{s.build.status}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{s.deployment.status}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{s.deployment.productionHealth}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">{s.blockers.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isMonitored && data.providers.some((p) => p.status !== "connected") && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
          <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p className="font-mono text-[11px]">
            Some providers are degraded or unavailable. The snapshot is still well-formed — fields from missing providers
            fall back to known-safe defaults.
          </p>
        </div>
      )}
    </div>
  );
}
