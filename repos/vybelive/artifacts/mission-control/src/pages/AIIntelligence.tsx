import {
  Brain,
  Zap,
  DollarSign,
  Clock,
  Server,
  Users,
  BarChart3,
  ShieldCheck,
  ChevronRight,
  CircleDot,
  Cpu,
  Loader2,
  Trash2,
  Target,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useGetAIMetrics,
  getGetAIMetricsQueryKey,
  useGetAIModelConfig,
  getGetAIModelConfigQueryKey,
  useSetGlobalAIModelConfig,
  useDeleteObjectiveAIModelConfig,
  type AIModelConfigEntry,
  type AIModelConfigInput,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";

// ─── Formatting helpers ─────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `<$0.001`;
  return `$${usd.toFixed(4)}`;
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function providerColor(name: string): string {
  const map: Record<string, string> = {
    openai: "text-green-400",
    anthropic: "text-orange-400",
    google: "text-blue-400",
    mock: "text-slate-400",
  };
  return map[name.toLowerCase()] ?? "text-slate-300";
}

function providerBadgeVariant(name: string): "default" | "secondary" | "outline" {
  if (name === "mock") return "outline";
  return "default";
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${accent ?? "text-slate-400"}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 leading-none mb-1.5">{label}</p>
            <p className="text-2xl font-semibold text-white tracking-tight">{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BarRow({
  label,
  value,
  max,
  sub,
  accent,
}: {
  label: string;
  value: number;
  max: number;
  sub: string;
  accent: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300 truncate">{label}</span>
        <span className="text-slate-500 text-xs ml-4 shrink-0">{sub}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${accent}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Model selection panel (per-scope AI model config) ──────────────────────

function ModelSelectionPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetAIModelConfig({
    query: { queryKey: getGetAIModelConfigQueryKey() },
  });
  const setGlobal = useSetGlobalAIModelConfig();
  const deleteOverride = useDeleteObjectiveAIModelConfig();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAIModelConfigQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAIMetricsQueryKey() });
  };

  const applyGlobal = (patch: Partial<AIModelConfigInput>) => {
    const current = data?.global ?? null;
    const body: AIModelConfigInput = {
      provider: (patch.provider !== undefined ? patch.provider : (current?.provider as AIModelConfigInput["provider"])) ?? null,
      modelHint: (patch.modelHint !== undefined ? patch.modelHint : (current?.modelHint as AIModelConfigInput["modelHint"])) ?? null,
    };
    setGlobal.mutate({ data: body }, { onSuccess: invalidate });
  };

  const removeOverride = (o: AIModelConfigEntry) => {
    if (!o.scopeId) return;
    deleteOverride.mutate({ objectiveId: o.scopeId }, { onSuccess: invalidate });
  };

  if (isLoading) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading model configuration…
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-6 text-sm text-rose-400">Failed to load model configuration.</CardContent>
      </Card>
    );
  }

  const { global, overrides, providers, modelHints } = data;
  const selectedProvider = global?.provider ?? "";
  const selectedHint = global?.modelHint ?? "";
  const busy = setGlobal.isPending;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <Cpu className="h-4 w-4 text-violet-400" />
          Model Selection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500">Global provider</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => applyGlobal({ provider: null })}
                disabled={busy}
                className={`rounded border px-2.5 py-1 font-mono text-xs uppercase transition-colors disabled:opacity-50 ${
                  selectedProvider === ""
                    ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                    : "border-slate-700 text-slate-400 hover:border-slate-600"
                }`}
              >
                Auto
              </button>
              {providers.map((p) => (
                <button
                  key={p}
                  onClick={() => applyGlobal({ provider: p as AIModelConfigInput["provider"] })}
                  disabled={busy}
                  className={`rounded border px-2.5 py-1 font-mono text-xs uppercase transition-colors disabled:opacity-50 ${
                    selectedProvider === p
                      ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500">Reasoning tier</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => applyGlobal({ modelHint: null })}
                disabled={busy}
                className={`rounded border px-2.5 py-1 font-mono text-xs uppercase transition-colors disabled:opacity-50 ${
                  selectedHint === ""
                    ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
                    : "border-slate-700 text-slate-400 hover:border-slate-600"
                }`}
              >
                Auto
              </button>
              {modelHints.map((h) => (
                <button
                  key={h}
                  onClick={() => applyGlobal({ modelHint: h as AIModelConfigInput["modelHint"] })}
                  disabled={busy}
                  className={`rounded border px-2.5 py-1 font-mono text-xs uppercase transition-colors disabled:opacity-50 ${
                    selectedHint === h
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="flex items-center gap-2 text-xs text-slate-500">
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {global?.updatedAt
            ? `Global config updated ${formatDistanceToNow(new Date(global.updatedAt), { addSuffix: true })}.`
            : "No global override — the platform auto-selects the best available provider and tier."}
        </p>

        <div className="space-y-2 border-t border-slate-800 pt-4">
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Target className="h-3.5 w-3.5" /> Objective overrides ({overrides.length})
          </p>
          {overrides.length === 0 ? (
            <p className="text-xs text-slate-600">
              No per-objective overrides. Objectives inherit the global configuration.
            </p>
          ) : (
            <div className="space-y-2">
              {overrides.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-300">{o.objectiveTitle ?? o.scopeId}</p>
                    <p className="font-mono text-[10px] text-slate-600">
                      {(o.provider ?? "auto")} · {(o.modelHint ?? "auto")}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-slate-500 hover:text-rose-400"
                    disabled={deleteOverride.isPending}
                    onClick={() => removeOverride(o)}
                    title="Remove override"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AIIntelligence() {
  const { data: metrics, isLoading, isError, dataUpdatedAt } = useGetAIMetrics({
    query: { queryKey: getGetAIMetricsQueryKey(), refetchInterval: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 gap-2">
        <Brain className="h-5 w-5 animate-pulse" />
        <span className="text-sm">Loading AI intelligence metrics…</span>
      </div>
    );
  }

  if (isError || !metrics) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm gap-2">
        <span>Failed to load AI intelligence metrics.</span>
      </div>
    );
  }

  const { totals, byProvider, byExecutive, byDay, providerStatus } = metrics;
  const maxExecTokens = Math.max(...byExecutive.map((e) => e.totalTokens), 1);
  const maxDayTokens = Math.max(...byDay.map((d) => d.totalTokens), 1);
  const aiRequests = totals.requests - totals.fallbackCount;
  const fallbackPct = totals.requests > 0 ? Math.round((totals.fallbackCount / totals.requests) * 100) : 0;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-violet-400" />
          <div>
            <h1 className="text-lg font-semibold text-white">AI Intelligence Layer</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Token usage, cost, provider health, and model selection across all executives
            </p>
          </div>
        </div>
        {dataUpdatedAt > 0 && (
          <p className="text-xs text-slate-600">Refreshed {new Date(dataUpdatedAt).toLocaleTimeString()}</p>
        )}
      </div>

      {/* Active provider banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-900 border border-slate-800">
        <CircleDot className="h-4 w-4 text-green-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium">
            Active provider: <span className={providerColor(providerStatus.active)}>{providerStatus.active}</span>{" "}
            <span className="text-slate-500 text-xs font-normal">/ {providerStatus.model}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(providerStatus.available).map(([name, avail]) => (
            <Badge key={name} variant={providerBadgeVariant(name)} className={`text-xs ${avail ? "" : "opacity-40"}`}>
              {name} {avail ? "✓" : "—"}
            </Badge>
          ))}
        </div>
      </div>

      {/* Model selection */}
      <ModelSelectionPanel />

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Zap}
          label="Total AI requests"
          value={aiRequests.toLocaleString()}
          sub={`${totals.fallbackCount} deterministic fallbacks (${fallbackPct}%)`}
          accent="text-violet-400"
        />
        <StatCard
          icon={BarChart3}
          label="Total tokens"
          value={fmtTokens(totals.totalTokens)}
          sub={`${fmtTokens(totals.promptTokens)} in / ${fmtTokens(totals.completionTokens)} out`}
          accent="text-blue-400"
        />
        <StatCard
          icon={DollarSign}
          label="Estimated cost"
          value={fmtCost(totals.estimatedCostUsd)}
          sub="Based on public model pricing"
          accent="text-emerald-400"
        />
        <StatCard
          icon={Clock}
          label="Avg latency"
          value={fmtMs(totals.avgLatencyMs)}
          sub="Per AI request, end-to-end"
          accent="text-amber-400"
        />
      </div>

      {/* Providers + Executives side-by-side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Provider breakdown */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Server className="h-4 w-4 text-slate-500" />
              Provider breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {byProvider.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4">
                No AI calls recorded yet. Send a message to Quinn to get started.
              </p>
            ) : (
              byProvider.map((p) => (
                <div key={`${p.provider}-${p.model}`} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${providerColor(p.provider)}`}>{p.provider}</p>
                    <p className="text-xs text-slate-600 truncate">{p.model}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm text-slate-300">{fmtTokens(p.totalTokens)}</p>
                    <p className="text-xs text-slate-600">
                      {p.requests.toLocaleString()} req · {fmtCost(p.estimatedCostUsd)}
                    </p>
                  </div>
                  <ChevronRight className="h-3 w-3 text-slate-700 shrink-0" />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Executive breakdown */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              By executive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {byExecutive.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4">No per-executive usage yet.</p>
            ) : (
              byExecutive.slice(0, 6).map((e) => (
                <BarRow
                  key={e.executiveId}
                  label={e.executiveName}
                  value={e.totalTokens}
                  max={maxExecTokens}
                  sub={`${fmtTokens(e.totalTokens)} · ${fmtCost(e.estimatedCostUsd)}`}
                  accent="bg-violet-500"
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Last 7 days */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-slate-500" />
            Last 7 days — daily token usage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {byDay.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-4">No usage in the last 7 days.</p>
          ) : (
            byDay.map((d) => (
              <BarRow
                key={d.day}
                label={d.day}
                value={d.totalTokens}
                max={maxDayTokens}
                sub={`${fmtTokens(d.totalTokens)} · ${d.requests} req · ${fmtCost(d.estimatedCostUsd)}`}
                accent="bg-blue-500"
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Safety notice */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-900/60 border border-slate-800/60">
        <ShieldCheck className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-600 leading-relaxed">
          All AI requests are sanitized before transmission — no secrets, API keys, database credentials, or personal
          user data are ever sent to a provider. Facts always come from deterministic inspectors. AI is used only for
          reasoning, planning, and natural language generation.
        </p>
      </div>
    </div>
  );
}
