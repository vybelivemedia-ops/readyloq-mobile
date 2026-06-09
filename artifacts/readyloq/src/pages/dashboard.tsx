import { Link } from "wouter";
import { useListInspections, useGetAnalyticsDashboard } from "@workspace/api-client-react";
import { Scan, Mic, ChevronRight, Clock, AlertTriangle, CheckCircle2, BrainCircuit, Zap } from "lucide-react";
import { useState, useEffect } from "react";

const AI_HINTS = [
  "Utility room inspections often reveal conducive conditions.",
  "Common hallways may provide additional evidence.",
  "Similar properties often have activity near floor drains.",
  "Additional documentation near entry points may be beneficial.",
  "Moisture conditions often correlate with cockroach harborage.",
];

function statusDot(status: string) {
  if (status === "completed") return "bg-emerald-500";
  if (status === "in-progress") return "bg-amber-500";
  return "bg-blue-500";
}

function severityLabel(severity: string | null) {
  if (severity === "critical") return "text-red-400";
  if (severity === "high") return "text-orange-400";
  if (severity === "medium") return "text-amber-400";
  return "text-slate-400";
}

export default function Dashboard() {
  const { data: inspections } = useListInspections();
  const { data: stats } = useGetAnalyticsDashboard();
  const [hint, setHint] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setHint(h => (h + 1) % AI_HINTS.length), 6000);
    return () => clearInterval(t);
  }, []);

  const recent = (inspections ?? []).slice(0, 3);

  return (
    <div className="min-h-[calc(100vh-5rem)] flex flex-col">
      {/* Hero — START INSPECTION */}
      <div className="flex-1 flex flex-col items-center justify-center pt-6 pb-8">
        {/* AI Hint chip */}
        <div className="flex items-start gap-2 bg-primary/10 border border-primary/20 rounded-2xl px-4 py-3 mb-10 max-w-sm w-full mx-auto">
          <BrainCircuit className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-primary/90 leading-relaxed transition-all">{AI_HINTS[hint]}</p>
        </div>

        {/* Main CTA */}
        <Link href="/inspections/new" className="block">
          <div className="group relative flex flex-col items-center cursor-pointer select-none">
            {/* Outer glow ring */}
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-3xl scale-150 opacity-60 group-hover:opacity-90 transition-opacity" />

            {/* Pulse rings */}
            <div className="absolute w-48 h-48 rounded-full border border-primary/20 animate-ping" style={{ animationDuration: "2.5s" }} />
            <div className="absolute w-56 h-56 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.5s" }} />

            {/* Main button */}
            <div className="relative w-44 h-44 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/60 flex flex-col items-center justify-center gap-3 shadow-2xl group-hover:border-primary group-hover:from-primary/40 group-hover:scale-105 transition-all duration-300 animate-pulse-glow">
              <div className="w-14 h-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                <Scan className="h-7 w-7 text-primary" />
              </div>
              <span className="text-primary font-bold text-base tracking-wide">START</span>
              <span className="text-primary/70 text-xs tracking-widest uppercase">Inspection</span>
            </div>
          </div>
        </Link>

        {/* Voice hint */}
        <div className="flex items-center gap-2 mt-10 text-muted-foreground text-xs">
          <Mic className="h-3.5 w-3.5" />
          <span>Or say &ldquo;Start inspection&rdquo;</span>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Total", value: stats.totalInspections, color: "text-foreground", icon: null },
            { label: "Open", value: stats.openInspections, color: "text-amber-400", icon: null },
            { label: "AI Conf.", value: `${Math.round(stats.avgAiConfidence * 100)}%`, color: "text-primary", icon: null },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border/60 rounded-2xl px-3 py-3 text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recent inspections */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent</p>
            <Link href="/inspections">
              <button className="text-[11px] text-primary font-medium flex items-center gap-0.5">
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
          </div>
          {recent.map(insp => (
            <Link key={insp.id} href={`/inspections/${insp.id}`}>
              <div className="flex items-center gap-3 bg-card border border-border/60 rounded-2xl px-4 py-3 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
                <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot(insp.status)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate leading-tight">{insp.siteAddress}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {insp.technicianName}
                    {insp.severity && (
                      <span className={`ml-2 font-medium ${severityLabel(insp.severity)}`}>• {insp.severity}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(insp.findingsCount ?? 0) > 0 && (
                    <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {insp.findingsCount} findings
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Quick actions row */}
      <div className="grid grid-cols-4 gap-2 mt-4">
        {[
          { href: "/analysis", icon: BrainCircuit, label: "Analysis", color: "text-primary" },
          { href: "/reports", icon: CheckCircle2, label: "Reports", color: "text-emerald-400" },
          { href: "/training", icon: Zap, label: "Learn", color: "text-amber-400" },
          { href: "/analytics", icon: AlertTriangle, label: "Risk", color: "text-orange-400" },
        ].map(a => (
          <Link key={a.href} href={a.href}>
            <div className="flex flex-col items-center gap-1.5 bg-card border border-border/60 rounded-2xl py-3 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer">
              <a.icon className={`h-5 w-5 ${a.color}`} />
              <span className="text-[10px] text-muted-foreground font-medium">{a.label}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
