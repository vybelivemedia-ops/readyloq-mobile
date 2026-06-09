import {
  useGetAnalyticsDashboard,
  useGetAnalyticsTrends,
  useGetTechnicianPerformance,
  useGetInfestationRisk,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { BarChart3, TrendingUp, Users, AlertTriangle, Shield } from "lucide-react";

const COLORS = ["#0ea5e9", "#06b6d4", "#22d3ee", "#38bdf8", "#7dd3fc", "#bae6fd"];

function RiskGauge({ score }: { score: number }) {
  const color = score >= 60 ? "#ef4444" : score >= 40 ? "#f97316" : score >= 20 ? "#eab308" : "#22c55e";
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-12">
        <svg viewBox="0 0 100 55" className="w-full">
          <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
          <path
            d="M 5 50 A 45 45 0 0 1 95 50"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 141.3} 141.3`}
          />
        </svg>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
          <span className="text-base font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const { data: dashboard, isLoading: loadingDash } = useGetAnalyticsDashboard();
  const { data: trends, isLoading: loadingTrends } = useGetAnalyticsTrends({ period: "30d" });
  const { data: technicians, isLoading: loadingTech } = useGetTechnicianPerformance();
  const { data: risk, isLoading: loadingRisk } = useGetInfestationRisk();

  const trendData = (trends ?? []).map(t => ({ date: t.date.slice(5), value: t.value }));
  const monthlyData = (dashboard?.monthlyInspections ?? []).map(m => ({
    month: m.label ?? m.date.slice(0, 7),
    value: m.value,
  }));
  const pestData = (dashboard?.topPestTypes ?? []).map(p => ({ name: p.pestType, value: p.count }));
  const statusData = (dashboard?.inspectionsByStatus ?? []).map(s => ({ name: s.status, value: s.count }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Performance metrics and inspection intelligence</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Inspections", value: dashboard?.totalInspections ?? 0, icon: BarChart3, color: "text-primary" },
          { label: "Completed", value: dashboard?.completedInspections ?? 0, icon: TrendingUp, color: "text-emerald-400" },
          { label: "Open", value: dashboard?.openInspections ?? 0, icon: AlertTriangle, color: "text-amber-400" },
          { label: "Avg Findings", value: dashboard?.avgFindingsPerInspection?.toFixed(1) ?? 0, icon: Shield, color: "text-blue-400" },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-card">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              {loadingDash ? <Skeleton className="h-8 w-12" /> : (
                <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Trend + Pest Types */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Monthly Inspections</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDash ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke="#0ea5e9" fill="url(#colorValue)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Pest Types</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDash ? <Skeleton className="h-48 w-full" /> : pestData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pestData} cx="50%" cy="50%" outerRadius={65} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                    {pestData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily Trends */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Inspection Trends (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTrends ? <Skeleton className="h-40 w-full" /> : trendData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No trend data</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(trendData.length / 6)} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Bar dataKey="value" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Infestation Risk */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Infestation Risk Assessment
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRisk ? <Skeleton className="h-24 w-full" /> : !risk ? (
            <p className="text-sm text-muted-foreground">No risk data available.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-6">
                <RiskGauge score={risk.riskScore ?? 0} />
                <div>
                  <p className="text-xs text-muted-foreground">Overall Risk Level</p>
                  <p className={`text-lg font-bold capitalize mt-0.5 ${
                    risk.overallRisk === "critical" ? "text-red-400" :
                    risk.overallRisk === "high" ? "text-orange-400" :
                    risk.overallRisk === "medium" ? "text-amber-400" : "text-emerald-400"
                  }`}>{risk.overallRisk}</p>
                </div>
              </div>
              {(risk.riskByPestType ?? []).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(risk.riskByPestType ?? []).slice(0, 6).map(r => (
                    <div key={r.pestType} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                      <span className="truncate mr-1">{r.pestType}</span>
                      <span className={`font-medium shrink-0 ${
                        r.riskLevel === "critical" ? "text-red-400" :
                        r.riskLevel === "high" ? "text-orange-400" :
                        r.riskLevel === "medium" ? "text-amber-400" : "text-slate-400"
                      }`}>{r.riskLevel}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Technician Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4" /> Technician Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTech ? <Skeleton className="h-40 w-full" /> : (technicians ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No technician data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-2 text-xs text-muted-foreground font-medium">Technician</th>
                    <th className="text-right pb-2 text-xs text-muted-foreground font-medium">Inspections</th>
                    <th className="text-right pb-2 text-xs text-muted-foreground font-medium">Completion</th>
                    <th className="text-right pb-2 text-xs text-muted-foreground font-medium">AI Conf.</th>
                    <th className="text-right pb-2 text-xs text-muted-foreground font-medium">Training</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {(technicians ?? []).map(t => (
                    <tr key={t.technicianName} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate max-w-[120px]">{t.technicianName}</span>
                          {t.badge && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t.badge}</span>
                          )}
                        </div>
                      </td>
                      <td className="text-right py-2.5 font-mono text-xs">{t.inspectionCount}</td>
                      <td className="text-right py-2.5">
                        <span className={`text-xs font-medium ${t.completionRate >= 0.8 ? "text-emerald-400" : t.completionRate >= 0.5 ? "text-amber-400" : "text-red-400"}`}>
                          {Math.round(t.completionRate * 100)}%
                        </span>
                      </td>
                      <td className="text-right py-2.5">
                        <span className={`text-xs font-medium ${t.avgAiConfidence >= 80 ? "text-emerald-400" : t.avgAiConfidence >= 60 ? "text-amber-400" : "text-muted-foreground"}`}>
                          {t.avgAiConfidence > 0 ? `${Math.round(t.avgAiConfidence * 100)}%` : "—"}
                        </span>
                      </td>
                      <td className="text-right py-2.5 text-xs text-muted-foreground">
                        {t.trainingScore !== null && t.trainingScore !== undefined ? `${t.trainingScore}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
