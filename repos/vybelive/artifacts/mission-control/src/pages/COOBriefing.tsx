import { useGetCOOBriefing, useRegenerateCOOBriefing, getGetCOOBriefingQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isToday } from "date-fns";
import {
  RefreshCw, AlertTriangle, CheckCircle, Clock, Users, Zap,
  TrendingUp, Calendar, BarChart2, Lightbulb, FileText,
  Shield, ChevronRight, Sparkles,
} from "lucide-react";
import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Urgency = "low" | "medium" | "high" | "critical";

interface COOSection {
  headline: string;
  content: string;
  items: string[];
  urgency: Urgency;
}

// ─── Section config ───────────────────────────────────────────────────────────

const SECTION_CONFIG: {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  { key: "executiveSummary",       label: "Executive Summary",          Icon: FileText,    description: "Overall company state" },
  { key: "overnightChanges",       label: "Overnight Changes",          Icon: Clock,       description: "Last 12 hours" },
  { key: "completedObjectives",    label: "Completed Objectives",       Icon: CheckCircle, description: "Recent wins" },
  { key: "blockers",               label: "Blockers",                   Icon: Shield,      description: "Items requiring unblocking" },
  { key: "pendingApprovals",       label: "Pending Approvals",         Icon: AlertTriangle, description: "Awaiting your decision" },
  { key: "highRiskItems",          label: "High-Risk Items",            Icon: Zap,         description: "Needs immediate attention" },
  { key: "recommendedPriorities",  label: "Recommended Priorities",     Icon: TrendingUp,  description: "Where to focus today" },
  { key: "estimatedCompletionDates", label: "Completion Estimates",     Icon: Calendar,    description: "Projected timelines" },
  { key: "executiveWorkload",      label: "Executive Workload",         Icon: Users,       description: "Team capacity snapshot" },
  { key: "aiUsageSummary",         label: "AI Usage",                   Icon: BarChart2,   description: "Last 24 hours" },
  { key: "newRecommendations",     label: "New Recommendations",        Icon: Lightbulb,   description: "Quinn's strategic read" },
];

// ─── Urgency styling ──────────────────────────────────────────────────────────

const URGENCY_STYLE: Record<Urgency, { badge: string; border: string; glow: string; dot: string }> = {
  low:      { badge: "bg-zinc-800 text-zinc-400 border-zinc-700",                      border: "border-border",           glow: "",                                       dot: "bg-zinc-500" },
  medium:   { badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",             border: "border-amber-500/20",     glow: "",                                       dot: "bg-amber-400" },
  high:     { badge: "bg-orange-500/10 text-orange-400 border-orange-500/30",          border: "border-orange-500/30",    glow: "shadow-[0_0_12px_rgba(249,115,22,0.1)]", dot: "bg-orange-400" },
  critical: { badge: "bg-red-500/10 text-red-400 border-red-500/30",                  border: "border-red-500/40",       glow: "shadow-[0_0_16px_rgba(239,68,68,0.15)]", dot: "bg-red-400 animate-pulse" },
};

// ─── Greeting ─────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ cfg, section }: { cfg: (typeof SECTION_CONFIG)[number]; section: COOSection }) {
  const [expanded, setExpanded] = useState(false);
  const urgency = section.urgency ?? "low";
  const style = URGENCY_STYLE[urgency];
  const Icon = cfg.Icon;
  const hasItems = section.items.length > 0;

  return (
    <div
      className={`rounded-xl border bg-card transition-all duration-200 ${style.border} ${style.glow} hover:border-opacity-60`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-5 flex items-start gap-4"
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border ${urgency === "critical" ? "bg-red-500/10 border-red-500/30" : urgency === "high" ? "bg-orange-500/10 border-orange-500/30" : "bg-secondary border-border"}`}>
          <Icon className={`w-4 h-4 ${urgency === "critical" ? "text-red-400" : urgency === "high" ? "text-orange-400" : "text-muted-foreground"}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{cfg.label}</span>
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${style.badge} uppercase`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${style.dot}`} />
              {urgency}
            </span>
          </div>
          <h3 className="font-bold text-sm text-foreground leading-snug">{section.headline}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{section.content}</p>
        </div>

        {hasItems && (
          <ChevronRight className={`w-4 h-4 text-muted-foreground flex-shrink-0 mt-1 transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </button>

      {/* Expanded items */}
      {expanded && hasItems && (
        <div className="px-5 pb-5 pt-0 space-y-2 border-t border-border/50">
          <div className="pt-4 space-y-1.5">
            {section.items.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <span className="text-primary flex-shrink-0 mt-0.5">›</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BriefingSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Hero */}
      <div className="border-b border-border/50 pb-6 space-y-3">
        <div className="h-8 w-64 rounded bg-secondary animate-pulse" />
        <div className="h-4 w-48 rounded bg-secondary animate-pulse" />
        <div className="h-20 rounded-xl bg-primary/5 border border-primary/10 animate-pulse" />
      </div>
      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ─── Generating state ─────────────────────────────────────────────────────────

function GeneratingState() {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-2 border-primary/20 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="font-mono text-primary font-bold tracking-widest text-sm uppercase">
          Quinn is preparing your briefing{dots}
        </p>
        <p className="text-xs text-muted-foreground mt-2 font-mono">
          Analyzing all executives, tasks, objectives, and AI activity
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-xs w-full">
        {["Reading overnight activity", "Assessing blockers", "Weighing priorities", "Drafting recommendations"].map((step) => (
          <div key={step} className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse flex-shrink-0" />
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function COOBriefing() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching } = useGetCOOBriefing({
    query: { queryKey: getGetCOOBriefingQueryKey() },
  });
  const regenerate = useRegenerateCOOBriefing();

  const briefing = data?.briefing ?? null;
  const sections = briefing?.sections as Record<string, COOSection> | undefined;

  // Is Quinn generating for the first time today (server still computing)?
  const isGenerating = isFetching && !briefing;

  const handleRegenerate = () => {
    regenerate.mutate(undefined, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetCOOBriefingQueryKey() });
      },
    });
  };

  if (isLoading) return <BriefingSkeleton />;
  if (isGenerating || regenerate.isPending) return <GeneratingState />;
  if (!briefing || !sections) return <GeneratingState />;

  const generatedAt = new Date(briefing.generatedAt);
  const todayFlag = isToday(generatedAt);

  // Identify critical/high sections for the hero strip
  const alertSections = SECTION_CONFIG.filter((cfg) => {
    const s = sections[cfg.key];
    return s && (s.urgency === "critical" || s.urgency === "high");
  });

  // Executive summary section for the hero
  const heroSection = sections["executiveSummary"];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="border-b border-border/50 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-mono text-primary uppercase tracking-widest mb-1">
              {getGreeting()} — {format(new Date(), "EEEE, MMMM d")}
            </p>
            <h1 className="text-3xl font-bold tracking-tight uppercase font-sans">
              Daily Briefing
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-1">
              {todayFlag
                ? `Prepared by Quinn Harlow ${formatDistanceToNow(generatedAt, { addSuffix: true })}`
                : `From ${format(generatedAt, "MMM d")} — refresh for today's update`}
              {briefing.promptTokens > 0 && (
                <span className="ml-2 text-muted-foreground/50">
                  · {(briefing.promptTokens + briefing.completionTokens).toLocaleString()} tokens
                  · ${briefing.estimatedCostUsd.toFixed(4)}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleRegenerate}
            disabled={regenerate.isPending}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-card transition-colors text-sm font-mono disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerate.isPending ? "animate-spin" : ""}`} />
            {regenerate.isPending ? "GENERATING..." : "REFRESH"}
          </button>
        </div>

        {/* ── Hero: executive summary ──────────────────────────────────────── */}
        {heroSection && (
          <div className="mt-5 bg-primary/5 border border-primary/20 rounded-xl p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-xl" />
            <div className="flex items-start gap-4 pl-2">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">
                    Quinn Harlow · Chief of Staff
                  </span>
                  {alertSections.length > 0 && (
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                      {alertSections.length} alert{alertSections.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-foreground mb-1">{heroSection.headline}</h2>
                <p className="text-sm text-foreground/80 leading-relaxed">{heroSection.content}</p>
                {heroSection.items.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {heroSection.items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="text-primary flex-shrink-0">›</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Alert strip for critical/high items ─────────────────────────── */}
        {alertSections.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {alertSections.map((cfg) => {
              const s = sections[cfg.key]!;
              const Icon = cfg.Icon;
              return (
                <div
                  key={cfg.key}
                  className={`flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-full border ${URGENCY_STYLE[s.urgency].badge}`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{cfg.label}: {s.headline}</span>
                </div>
              );
            })}
          </div>
        )}
      </header>

      {/* ── Section grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {SECTION_CONFIG.filter((c) => c.key !== "executiveSummary").map((cfg) => {
          const section = sections[cfg.key];
          if (!section) return null;
          return <SectionCard key={cfg.key} cfg={cfg} section={section} />;
        })}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="text-center text-[10px] font-mono text-muted-foreground/40 pt-4 border-t border-border/30">
        QUINN HARLOW · CHIEF OF STAFF · VYBE LIVE · {format(generatedAt, "HH:mm 'UTC'")}
        {" · "}
        This briefing was generated once for {briefing.date} and will refresh tomorrow.
      </footer>
    </div>
  );
}
