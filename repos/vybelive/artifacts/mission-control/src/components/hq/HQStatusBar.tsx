import { Link } from "wouter";
import { Target, CheckCircle2, AlertTriangle, Zap, Server } from "lucide-react";

interface HQStatusBarProps {
  activeObjectives: number;
  tasksRunning: number;
  activeBlockers: number;
  aiCostUsd: number;
  systemLoad: number;
  loading?: boolean;
}

function Pill({
  icon: Icon,
  label,
  value,
  href,
  colorClass = "text-muted-foreground",
  alertClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  href: string;
  colorClass?: string;
  alertClass?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-3 py-1.5 transition-colors hover:border-primary/40 hover:bg-card"
    >
      <Icon className={`h-3 w-3 flex-shrink-0 ${alertClass ?? colorClass}`} />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs font-semibold ${alertClass ?? colorClass}`}>{value}</span>
    </Link>
  );
}

export default function HQStatusBar({
  activeObjectives,
  tasksRunning,
  activeBlockers,
  aiCostUsd,
  systemLoad,
  loading,
}: HQStatusBarProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 pb-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 w-28 animate-pulse rounded-md bg-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pb-4">
      <Pill
        icon={Target}
        label="Objectives"
        value={activeObjectives}
        href="/objectives"
        colorClass="text-primary"
      />
      <Pill
        icon={CheckCircle2}
        label="Tasks"
        value={tasksRunning}
        href="/tasks"
        colorClass="text-emerald-400"
      />
      <Pill
        icon={AlertTriangle}
        label="Blockers"
        value={activeBlockers}
        href="/blockers"
        colorClass="text-muted-foreground"
        alertClass={activeBlockers > 0 ? "text-red-400" : undefined}
      />
      <Pill
        icon={Zap}
        label="AI Spend"
        value={`$${aiCostUsd.toFixed(2)}`}
        href="/ai-intelligence"
        colorClass="text-amber-400"
      />
      <Pill
        icon={Server}
        label="Load"
        value={systemLoad.toFixed(2)}
        href="/diagnostics"
        colorClass="text-muted-foreground"
        alertClass={systemLoad > 2 ? "text-red-400" : undefined}
      />
    </div>
  );
}
