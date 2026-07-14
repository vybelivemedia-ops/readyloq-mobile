import { useGetFounderProfile, useGetFounderDecisionModel } from "@workspace/api-client-react";
import {
  MessageSquare, GitBranch, Shield, Rocket, Star, Target,
  CheckCircle, Clock, Users, TrendingUp, Eye, AlertCircle, RefreshCw,
  Brain, XCircle, HelpCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Category icon map ────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageSquare, GitBranch, Shield, Rocket, Star, Target,
  CheckCircle, Clock, Users, TrendingUp,
};

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Target;
  return <Icon className={className} />;
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

const CONFIDENCE_CONFIG = {
  high:   { stars: "★★★", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", label: "High" },
  medium: { stars: "★★☆", color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/30",   label: "Medium" },
  low:    { stars: "★☆☆", color: "text-zinc-400",    bg: "bg-zinc-400/10",    border: "border-zinc-400/30",    label: "Low" },
};

function ConfidenceBadge({ level }: { level: "low" | "medium" | "high" }) {
  const cfg = CONFIDENCE_CONFIG[level];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      {cfg.stars} {cfg.label}
    </span>
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: "observed" | "explicit" }) {
  return source === "explicit" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border bg-primary/10 text-primary border-primary/30">
      <Star className="w-2.5 h-2.5" /> Stated
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border bg-secondary text-muted-foreground border-border">
      <Eye className="w-2.5 h-2.5" /> Observed
    </span>
  );
}

// ─── Insight card ─────────────────────────────────────────────────────────────

type InsightData = {
  id: string;
  category: string;
  insight: string;
  confidence: "low" | "medium" | "high";
  source: "observed" | "explicit";
  evidence: string[];
  observationCount: number;
  lastObservedAt: string;
};

function InsightCard({ insight }: { insight: InsightData }) {
  return (
    <div className="bg-background border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground leading-snug flex-1">{insight.insight}</p>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <ConfidenceBadge level={insight.confidence} />
          <SourceBadge source={insight.source} />
        </div>
      </div>

      {insight.evidence.length > 0 && (
        <div className="space-y-1.5">
          {insight.evidence.slice(-3).map((ev, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <span className="text-primary/40 flex-shrink-0 mt-0.5">›</span>
              <span className="italic">"{ev.slice(0, 100)}"</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/50">
        <span>{insight.observationCount} observation{insight.observationCount !== 1 ? "s" : ""}</span>
        <span>{formatDistanceToNow(new Date(insight.lastObservedAt), { addSuffix: true })}</span>
      </div>
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

type CategoryMeta = { label: string; description: string; icon: string };

function CategorySection({
  categoryKey,
  meta,
  insights,
}: {
  categoryKey: string;
  meta: CategoryMeta;
  insights: InsightData[];
}) {
  const hasInsights = insights.length > 0;
  const highestConfidence = insights.reduce<"low" | "medium" | "high" | null>((best, ins) => {
    if (ins.confidence === "high") return "high";
    if (ins.confidence === "medium" && best !== "high") return "medium";
    if (best === null) return "low";
    return best;
  }, null);

  return (
    <div className={`rounded-xl border ${hasInsights ? "border-border bg-card" : "border-dashed border-border/40 bg-card/30"} p-5 space-y-4`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${hasInsights ? "bg-primary/10 border border-primary/20" : "bg-secondary border border-border"}`}>
          <CategoryIcon name={meta.icon} className={`w-4 h-4 ${hasInsights ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-foreground">{meta.label}</h3>
            {highestConfidence && <ConfidenceBadge level={highestConfidence} />}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{meta.description}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-lg font-bold font-mono text-foreground">{insights.length}</span>
          <p className="text-[10px] font-mono text-muted-foreground">insights</p>
        </div>
      </div>

      {/* Insights or empty state */}
      {hasInsights ? (
        <div className="space-y-3">
          {insights.map((ins) => (
            <InsightCard key={ins.id} insight={ins} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>No data yet — Quinn learns this from your behavior over time.</span>
        </div>
      )}
    </div>
  );
}

// ─── Completeness meter ───────────────────────────────────────────────────────

function CompletenessMeter({ filledCategories, total }: { filledCategories: number; total: number }) {
  const pct = Math.round((filledCategories / total) * 100);
  const color = pct >= 70 ? "bg-emerald-400" : pct >= 40 ? "bg-amber-400" : "bg-primary";

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-mono font-bold text-foreground flex-shrink-0">{pct}%</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = [
  "communication_style", "decision_patterns", "risk_tolerance", "release_philosophy",
  "product_priorities", "company_priorities", "approval_habits", "work_schedule",
  "executive_trust", "strategic_goals",
];

// ─── Decision Model section ───────────────────────────────────────────────────

const OUTCOME_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  approve: { icon: CheckCircle, color: "text-emerald-400" },
  approved: { icon: CheckCircle, color: "text-emerald-400" },
  reject: { icon: XCircle, color: "text-rose-400" },
  rejected: { icon: XCircle, color: "text-rose-400" },
  defer: { icon: Clock, color: "text-amber-400" },
  deferred: { icon: Clock, color: "text-amber-400" },
  uncertain: { icon: HelpCircle, color: "text-zinc-400" },
};

function OutcomeIcon({ choice }: { choice: string }) {
  const cfg = OUTCOME_CONFIG[choice.toLowerCase()] ?? OUTCOME_CONFIG.uncertain;
  const Icon = cfg.icon;
  return <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />;
}

function DecisionModelSection() {
  const { data } = useGetFounderDecisionModel();
  if (!data || data.totalPredictions === 0) return null;

  const accuracy = data.accuracyPct;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Brain className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider font-sans">Founder Decision Model</h2>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 max-w-xl">
            Before recommending, Quinn predicts what you'd likely choose, then scores that prediction
            against your actual decision. The model improves continuously.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill value={data.totalPredictions} label="Predictions Made" />
        <StatPill value={data.scoredPredictions} label="Scored" />
        <StatPill value={data.correctPredictions} label="Correct" color="text-emerald-400" />
        <div className="bg-secondary border border-border rounded-lg px-4 py-3 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold font-mono ${accuracy != null && accuracy >= 60 ? "text-emerald-400" : "text-amber-400"}`}>
            {accuracy != null ? `${Math.round(accuracy)}%` : "—"}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase text-center leading-tight mt-0.5">Accuracy</span>
        </div>
      </div>

      {data.recent.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Recent Predictions</p>
          {data.recent.map((p, idx) => (
            <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border/50">
              <div className="flex-shrink-0 mt-0.5">
                {p.wasCorrect === true ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : p.wasCorrect === false ? (
                  <XCircle className="w-4 h-4 text-rose-400" />
                ) : (
                  <Clock className="w-4 h-4 text-zinc-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground truncate">{p.context}</p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                    <OutcomeIcon choice={p.predictedChoice} /> Predicted: {p.predictedChoice}
                  </span>
                  {p.actualOutcome && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                      <OutcomeIcon choice={p.actualOutcome} /> Actual: {p.actualOutcome}
                    </span>
                  )}
                  <ConfidenceBadge level={p.confidence} />
                  <span className="text-[10px] font-mono text-muted-foreground/70">
                    {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FounderProfile() {
  const { data, isLoading, refetch } = useGetFounderProfile();

  const profile = data?.profile ?? {};
  const categoryMeta = data?.categoryMeta ?? {};
  const totalInsights = data?.totalInsights ?? 0;
  const filledCategories = CATEGORY_ORDER.filter((k) => (profile[k]?.length ?? 0) > 0).length;

  const highConfidence = Object.values(profile).flat().filter((i: InsightData) => i.confidence === "high").length;
  const mediumConfidence = Object.values(profile).flat().filter((i: InsightData) => i.confidence === "medium").length;
  const explicitInsights = Object.values(profile).flat().filter((i: InsightData) => i.source === "explicit").length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <header className="border-b border-border/50 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-1 uppercase font-sans flex items-center gap-3">
              <Users className="w-7 h-7 text-primary" />
              Founder Operating Profile
            </h1>
            <p className="text-muted-foreground font-mono text-sm max-w-xl">
              Quinn learns how you operate — never assumes, never invents. Every insight is earned
              from your actual messages, decisions, and approval patterns.
            </p>
          </div>
          <button
            onClick={() => void refetch()}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-card transition-colors text-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* Stats row */}
        {!isLoading && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="col-span-2 md:col-span-1">
              <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Profile Completeness</p>
              <CompletenessMeter filledCategories={filledCategories} total={CATEGORY_ORDER.length} />
            </div>
            <StatPill value={totalInsights} label="Total Insights" />
            <StatPill value={highConfidence} label="High Confidence" color="text-emerald-400" />
            <StatPill value={mediumConfidence} label="Medium Confidence" color="text-amber-400" />
            <StatPill value={explicitInsights} label="Explicitly Stated" color="text-primary" />
          </div>
        )}
      </header>

      {/* V6.8: Founder Decision Model — how Quinn predicts your choices */}
      {!isLoading && <DecisionModelSection />}

      {/* Empty state — no profile yet */}
      {!isLoading && totalInsights === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-card border border-border flex items-center justify-center">
            <Users className="w-7 h-7 text-muted-foreground" />
          </div>
          <div className="text-center max-w-sm">
            <p className="font-semibold text-foreground mb-2">Profile is being built</p>
            <p className="text-sm text-muted-foreground font-mono">
              Quinn starts learning from your first message. Every decision, approval, and
              directive adds to your profile. Come back after a few interactions.
            </p>
          </div>
          <div className="mt-2 flex flex-col items-start gap-2 bg-card border border-border rounded-xl p-5 text-sm max-w-sm">
            <p className="font-medium text-foreground text-xs font-mono uppercase tracking-wider mb-1">What Quinn learns from</p>
            {["Your messages to Quinn", "How you approve or reject recommendations", "What time you're typically active", "What priorities you repeat across sessions", "Whether you prefer speed or stability"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-muted-foreground">
                <span className="text-primary">›</span> {item}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-20 font-mono animate-pulse text-muted-foreground">
          [ LOADING FOUNDER PROFILE... ]
        </div>
      )}

      {/* Profile grid */}
      {!isLoading && totalInsights > 0 && (
        <>
          {/* Disclaimer */}
          <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">Quinn never assumes.</span>{" "}
              Every insight below was learned from repeated behavior or something you stated directly.
              Low-confidence insights (1–2 observations) are tracked but not yet used in Quinn's recommendations.
              Medium and high confidence insights influence how Quinn plans and advises.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {CATEGORY_ORDER.map((catKey) => {
              const meta = categoryMeta[catKey];
              if (!meta) return null;
              const insights = (profile[catKey] ?? []) as InsightData[];
              return (
                <CategorySection
                  key={catKey}
                  categoryKey={catKey}
                  meta={meta as CategoryMeta}
                  insights={insights}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function StatPill({ value, label, color = "text-foreground" }: { value: number; label: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col items-center justify-center">
      <span className={`text-2xl font-bold font-mono ${color}`}>{value}</span>
      <span className="text-[10px] font-mono text-muted-foreground uppercase text-center leading-tight mt-0.5">{label}</span>
    </div>
  );
}
