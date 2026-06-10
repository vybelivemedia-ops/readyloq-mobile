import {
  useGetOpportunityIntelligence,
  useGetCallbackIntelligence,
  useGetPropertyRiskInsights,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Crosshair, PhoneIncoming, ShieldAlert, Lightbulb, AlertTriangle, ArrowRight,
  TrendingDown, Building2, Sparkles, EyeOff, MapPin, CheckCircle2, RotateCcw,
} from "lucide-react";
import { useRole } from "@/hooks/use-role";

const COLORS = ["#0ea5e9", "#06b6d4", "#22d3ee", "#38bdf8", "#7dd3fc", "#bae6fd"];

const chartTooltip = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
  borderRadius: 8,
};

function severityColor(sev: string) {
  if (sev === "critical") return "text-red-400";
  if (sev === "high") return "text-orange-400";
  if (sev === "medium") return "text-amber-400";
  return "text-slate-400";
}

function outcomeStyle(outcome: string) {
  switch (outcome) {
    case "callback_occurred": return { color: "text-red-400", bg: "bg-red-500/10", icon: PhoneIncoming };
    case "resolved": return { color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 };
    case "activity_reduced": return { color: "text-sky-400", bg: "bg-sky-500/10", icon: TrendingDown };
    default: return { color: "text-slate-400", bg: "bg-slate-500/10", icon: RotateCcw };
  }
}

function ManagementOnly() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <ShieldAlert className="h-7 w-7 text-primary" />
      </div>
      <h2 className="text-xl font-bold mb-1">ReadyLoq Command</h2>
      <p className="text-muted-foreground text-sm max-w-sm">
        This intelligence workspace is available to management accounts. Switch to the Manager view in Settings to access it.
      </p>
    </div>
  );
}

export default function CommandCenter() {
  const { isManager } = useRole();
  const { data: opp, isLoading: loadingOpp } = useGetOpportunityIntelligence();
  const { data: cb, isLoading: loadingCb } = useGetCallbackIntelligence();
  const { data: risk, isLoading: loadingRisk } = useGetPropertyRiskInsights();

  if (!isManager) return <ManagementOnly />;

  const oppByType = (opp?.byType ?? []).map(t => ({ name: t.label, value: t.count }));
  const causeData = (cb?.topCauses ?? []).map(c => ({ name: c.label, value: c.count }));
  const trendData = (cb?.trend ?? []).map(t => ({ month: t.label, Chains: t.total, Callbacks: t.callbacks }));
  const indicatorData = (risk?.riskIndicators ?? []).map(r => ({ name: r.condition, value: r.count }));
  const riskTrendData = (risk?.riskTrend ?? []).map(t => ({ month: t.label, value: t.value }));
  const unreported = (opp?.opportunities ?? []).filter(o => !o.documented);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Crosshair className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ReadyLoq <span className="text-primary">Command</span></h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Management intelligence — opportunity, callback prevention &amp; property risk
          </p>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Opportunities", value: opp?.totalOpportunities ?? 0, sub: "evidence-based", icon: Lightbulb, color: "text-primary" },
          { label: "Unreported", value: opp?.unreportedCount ?? 0, sub: "needs documentation", icon: EyeOff, color: "text-amber-400" },
          { label: "Callback Rate", value: `${cb?.callbackRate ?? 0}%`, sub: `${cb?.totalCallbacks ?? 0} of ${cb?.totalChains ?? 0} chains`, icon: PhoneIncoming, color: "text-red-400" },
          { label: "High-Risk Properties", value: opp?.highRiskPropertyCount ?? 0, sub: "risk score ≥ 60", icon: ShieldAlert, color: "text-orange-400" },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-card">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              {loadingOpp || loadingCb ? <Skeleton className="h-8 w-12" /> : (
                <>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── CALLBACK INTELLIGENCE ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        <PhoneIncoming className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Callback Intelligence</h2>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Callback Causes</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCb ? <Skeleton className="h-48 w-full" /> : causeData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No callbacks recorded</div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={causeData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={chartTooltip} cursor={{ fill: "hsl(var(--muted)/0.2)" }} />
                  <Bar dataKey="value" fill="#0ea5e9" radius={[0, 3, 3, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Callback Trend (6 months)</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCb ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="cbChains" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cbCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Area type="monotone" dataKey="Chains" stroke="#0ea5e9" fill="url(#cbChains)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Callbacks" stroke="#ef4444" fill="url(#cbCalls)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Callback chains */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" /> Finding → Recommendation → Follow-Up → Outcome
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingCb ? <Skeleton className="h-40 w-full" /> : (cb?.chains ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No chains recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {(cb?.chains ?? []).slice(0, 8).map(chain => {
                const os = outcomeStyle(chain.outcome);
                return (
                  <div key={chain.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{chain.propertyType}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{chain.pestType}</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${os.bg} ${os.color} flex items-center gap-1`}>
                        <os.icon className="h-3 w-3" /> {chain.outcomeLabel}
                      </span>
                    </div>
                    <div className="grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-xs">
                      <div className="text-foreground">{chain.finding}</div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground hidden sm:block" />
                      <div className={chain.recommendation ? "text-muted-foreground" : "text-amber-400 italic"}>
                        {chain.recommendation ?? "No recommendation logged"}
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground hidden sm:block" />
                      <div className="text-muted-foreground">{chain.followUpVisit ?? "—"}</div>
                    </div>
                    {chain.callbackCauseLabel && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
                        <AlertTriangle className="h-3 w-3" /> Cause: {chain.callbackCauseLabel}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recurrence + conducive conditions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pest Recurrence by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCb ? <Skeleton className="h-40 w-full" /> : (cb?.pestRecurrence ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No data.</p>
            ) : (
              <div className="space-y-2">
                {(cb?.pestRecurrence ?? []).slice(0, 6).map(p => (
                  <div key={p.pestType} className="flex items-center gap-3">
                    <span className="text-xs w-28 truncate shrink-0">{p.pestType}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${p.recurrenceRate}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-10 text-right shrink-0">{p.recurrenceRate}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conducive Conditions</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCb ? <Skeleton className="h-40 w-full" /> : (cb?.conduciveConditions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No conditions recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(cb?.conduciveConditions ?? []).map(c => (
                  <span key={c.condition} className="text-xs px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50 flex items-center gap-1.5">
                    {c.condition}
                    <span className="text-[10px] font-mono text-primary">{c.count}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── OPPORTUNITY DETECTION ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Opportunity Detection</h2>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Opportunities by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingOpp ? <Skeleton className="h-48 w-full" /> : oppByType.every(o => o.value === 0) ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No opportunities detected</div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={oppByType.filter(o => o.value > 0)} cx="50%" cy="50%" outerRadius={68} dataKey="value" nameKey="name"
                    label={({ name, value }) => `${name} (${value})`} labelLine={false} fontSize={9}>
                    {oppByType.filter(o => o.value > 0).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={chartTooltip} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <EyeOff className="h-4 w-4 text-amber-400" /> Unreported Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingOpp ? <Skeleton className="h-48 w-full" /> : unreported.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-2">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                Every detected opportunity has been documented.
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs text-muted-foreground">
                  Evidence-based opportunities present in findings but not yet reflected in the recommendations.
                </p>
                {unreported.map(o => (
                  <div key={o.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 flex gap-3">
                    {o.imageUrl && (
                      <img src={o.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">{o.typeLabel}</span>
                        <span className="text-[10px] text-muted-foreground truncate">{o.siteAddress}</span>
                      </div>
                      <p className="text-xs text-foreground line-clamp-2">{o.finding}</p>
                      <p className="text-[11px] text-amber-400 mt-0.5">{o.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Evidence-based opportunities list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Detected Opportunities — Evidence
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingOpp ? <Skeleton className="h-40 w-full" /> : (opp?.opportunities ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No opportunities detected.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {(opp?.opportunities ?? []).map(o => (
                <div key={o.id} className="rounded-lg border border-border/60 bg-muted/20 p-2.5 flex gap-3">
                  {o.imageUrl && <img src={o.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">{o.typeLabel}</span>
                      <span className={`text-[10px] font-medium ${severityColor(o.severity)}`}>{o.severity}</span>
                    </div>
                    <p className="text-xs text-foreground line-clamp-2">{o.finding}</p>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{o.location ?? o.siteAddress}</span>
                      {!o.documented && <span className="ml-auto text-amber-400 shrink-0">unreported</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── PROPERTY RISK INSIGHTS ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        <ShieldAlert className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Property Risk Insights</h2>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Risk Indicators (properties affected)</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRisk ? <Skeleton className="h-48 w-full" /> : indicatorData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No risk indicators</div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={indicatorData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={chartTooltip} cursor={{ fill: "hsl(var(--muted)/0.2)" }} />
                  <Bar dataKey="value" fill="#06b6d4" radius={[0, 3, 3, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conducive Condition Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRisk ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={riskTrendData}>
                  <defs>
                    <linearGradient id="riskTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Area type="monotone" dataKey="value" stroke="#06b6d4" fill="url(#riskTrend)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recurring conditions + high-risk properties */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recurring Conditions</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRisk ? <Skeleton className="h-24 w-full" /> : (risk?.recurringConditions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No conditions recur across properties.</p>
            ) : (
              <div className="space-y-2">
                {(risk?.recurringConditions ?? []).map(c => (
                  <div key={c.condition} className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2">
                    <span className="flex items-center gap-2"><RotateCcw className="h-3.5 w-3.5 text-primary" /> {c.condition}</span>
                    <span className="text-xs text-muted-foreground">{c.count} properties</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" /> High-Risk Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRisk ? <Skeleton className="h-40 w-full" /> : (risk?.highRiskProperties ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No high-risk properties.</p>
            ) : (
              <div className="space-y-2.5">
                {(risk?.highRiskProperties ?? []).map(p => (
                  <div key={p.inspectionId} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-medium truncate">{p.siteAddress}</span>
                      <span className={`text-xs font-bold shrink-0 ${p.riskScore >= 80 ? "text-red-400" : p.riskScore >= 60 ? "text-orange-400" : "text-amber-400"}`}>
                        {p.riskScore}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.conditions.map(c => (
                        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
