import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  RotateCcw,
  Eraser,
  Sprout,
  Bot,
  BarChart3,
  Brain,
  Users,
  Building2,
  Sparkles,
  Sunrise,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  BookOpen,
  Radar,
  GraduationCap,
  History,
  MessagesSquare,
  Lightbulb,
  ClipboardCheck,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import {
  useDevClearApprovals,
  useDevResetObjectives,
  useDevRemoveTestData,
  useDevReseed,
  useDevResetFounderProfile,
  useDevRegenerateBriefing,
  useDevRebuildFounderMemory,
  useDevResetExecutiveTeam,
  useDevRebuildExecutiveKnowledge,
  useDevResetQuinnReasoning,
  useDevSimulateTomorrow,
  useDevRunAutonomousCycle,
  useDevRunWeeklyReview,
  useDevPortfolioScan,
  useDevResetExecutiveLearning,
  useDevResetQuinnMemory,
  useDevRunReflection,
  useDevSimulateConversation,
  useDevGenerateRecommendations,
  useDevReviewRecommendations,
  useDevAccumulateMemory,
  useDevDetectPatterns,
  useDevEnrichRecommendations,
  useDevCheckEngineering,
} from "@workspace/api-client-react";
import type { UseMutationResult } from "@tanstack/react-query";

type DevToolResult = { ok: boolean; message: string; affected?: number | null };
type DevMutation = UseMutationResult<DevToolResult, unknown, void, unknown>;

type ActionState = { status: "success" | "error"; message: string } | null;

interface ToolConfig {
  key: string;
  group: "living" | "autonomy" | "maintenance" | "reset";
  icon: LucideIcon;
  emoji: string;
  label: string;
  description: string;
  confirm: string;
  danger?: boolean;
}

const TOOLS: ToolConfig[] = [
  // ─── Living Organization (V8) ───────────────────────────────────────────
  {
    key: "run-reflection",
    group: "living",
    icon: History,
    emoji: "🧭",
    label: "Run Quinn Reflection",
    description:
      "Run one continuous-thinking reflection pass: Quinn works through her idle questions, observes org state, and may spawn a conversation or recommendation — all recorded into the organization timeline.",
    confirm: "Run one Quinn reflection pass now? She may start an executive conversation or propose a recommendation.",
  },
  {
    key: "simulate-conversation",
    group: "living",
    icon: MessagesSquare,
    emoji: "💬",
    label: "Simulate Executive Conversation",
    description:
      "Generate a deterministic executive conversation from current autonomy signals (e.g. a deployment-risk thread Ada→Theo→Mara→Quinn) and record it into the organization's memory.",
    confirm: "Generate a new executive conversation now?",
  },
  {
    key: "generate-recommendations",
    group: "living",
    icon: Lightbulb,
    emoji: "💡",
    label: "Generate Executive Recommendations",
    description:
      "Have the executives take initiative — each proposes work referencing prior organizational outcomes. Recommendations land as pending for Quinn to convert into objectives.",
    confirm: "Have the executives propose new recommendations now?",
  },
  {
    key: "review-recommendations",
    group: "living",
    icon: ClipboardCheck,
    emoji: "✅",
    label: "Quinn Reviews Recommendations",
    description:
      "Have Quinn review all pending executive recommendations — accepting and converting the strongest into objectives and dismissing the rest, with her reasoning recorded.",
    confirm: "Have Quinn review and decide on all pending recommendations now?",
  },
  {
    key: "accumulate-memory",
    group: "living",
    icon: Brain,
    emoji: "🧠",
    label: "Accumulate Executive Memory",
    description:
      "Have each executive distill professional memory from their recent work — projects, successes, mistakes, founder corrections, and risk areas — so future recommendations can cite real experience.",
    confirm: "Have the executives accumulate professional memory from recent work now?",
  },
  {
    key: "detect-patterns",
    group: "living",
    icon: Radar,
    emoji: "🔁",
    label: "Detect Conversation Patterns",
    description:
      "Scan executive conversations for repeated discussion topics — a recurring theme becomes a fresh recommendation so persistent concerns get surfaced as proposed work.",
    confirm: "Scan conversations for repeated patterns now?",
  },
  {
    key: "enrich-recommendations",
    group: "living",
    icon: Lightbulb,
    emoji: "✨",
    label: "Enrich Recommendations",
    description:
      "Re-enrich every pending recommendation with concrete evidence, supporting conversations, related objectives, cited executive memory, confidence, and expected impact.",
    confirm: "Re-enrich all pending recommendations with evidence and sources now?",
  },
  // ─── Autonomy & Learning (V7) ───────────────────────────────────────────
  {
    key: "run-autonomous-cycle",
    group: "autonomy",
    icon: Cpu,
    emoji: "🤖",
    label: "Run Autonomous Cycle",
    description:
      "Run one Chief-of-Staff autonomy cycle now: Quinn inspects portfolio + org state, acts on safe actions, and escalates only what needs founder approval. In production this runs every 15 minutes on a schedule.",
    confirm: "Run one autonomous cycle now? Quinn will act on safe actions and escalate anything that needs your approval.",
  },
  {
    key: "run-weekly-review",
    group: "autonomy",
    icon: BookOpen,
    emoji: "📚",
    label: "Run Weekly Learning Review",
    description:
      "Have Quinn distill the team's recent lessons into recurring patterns and distribute org-wide improvements to every executive. Normally runs once per week.",
    confirm: "Run Quinn's weekly learning review now? This runs AI analysis and may take a minute.",
  },
  {
    key: "portfolio-scan",
    group: "autonomy",
    icon: Radar,
    emoji: "🛰️",
    label: "Run Portfolio Scan",
    description:
      "Scan health across every monitored portfolio asset (VYBE Live live monitor + placeholder companies) and report the healthy / attention / critical rollup.",
    confirm: "Run a portfolio health scan across all monitored assets now?",
  },
  {
    key: "reset-executive-learning",
    group: "autonomy",
    icon: GraduationCap,
    emoji: "🧹",
    label: "Reset Executive Learning",
    description:
      "Permanently wipe ALL executive learning — every lesson, objective retrospective, and weekly review. Learning is otherwise permanent.",
    confirm: "Permanently delete ALL executive learning (lessons, retrospectives, weekly reviews)? This cannot be undone.",
    danger: true,
  },
  {
    key: "reset-quinn-memory",
    group: "autonomy",
    icon: Brain,
    emoji: "🧠",
    label: "Reset Quinn Memory",
    description:
      "Clear Quinn's long-term memory rows. Objectives, reports, and the founder profile are preserved.",
    confirm: "Clear Quinn's long-term memory? Objectives, reports, and the founder profile are preserved.",
    danger: true,
  },
  // ─── AI Maintenance (V6.7) ──────────────────────────────────────────────
  {
    key: "rebuild-founder-memory",
    group: "maintenance",
    icon: Brain,
    emoji: "🧠",
    label: "Rebuild Founder Memory",
    description:
      "Re-analyze every founder conversation and recompute insights, decision patterns, and trust — without deleting any conversations.",
    confirm:
      "Rebuild the founder operating profile from scratch? Conversations are preserved; existing insights are replaced. This runs AI analysis and may take a minute.",
  },
  {
    key: "reset-executive-team",
    group: "maintenance",
    icon: Users,
    emoji: "👥",
    label: "Reset Executive Team",
    description:
      "Clear runtime state only — active work flags, collaboration sessions, locks, workload counters, and stuck statuses. Objectives, reports, memories, and the founder profile are kept.",
    confirm: "Reset executive runtime state? Objectives, reports, and memories are preserved.",
  },
  {
    key: "rebuild-executive-knowledge",
    group: "maintenance",
    icon: Building2,
    emoji: "🏢",
    label: "Rebuild Executive Knowledge",
    description:
      "Force every executive to regenerate a fresh report reflecting current project state, objectives, roadmap, and dependencies.",
    confirm: "Force every executive to regenerate fresh reports? This runs AI analysis and may take a minute.",
  },
  {
    key: "reset-quinn-reasoning",
    group: "maintenance",
    icon: Sparkles,
    emoji: "🧠",
    label: "Reset Quinn Reasoning Cache",
    description:
      "Clear Quinn's cached reasoning state. Founder profile, objectives, reports, and memory are all preserved.",
    confirm: "Clear Quinn's reasoning cache? Profile, objectives, reports, and memory are preserved.",
  },
  {
    key: "simulate-tomorrow",
    group: "maintenance",
    icon: Sunrise,
    emoji: "🌅",
    label: "Simulate Tomorrow Morning",
    description:
      "Advance one virtual day: overnight collaboration, fresh executive reports, founder briefing, daily COO briefing, and roadmap reprioritization — without changing the system clock.",
    confirm: "Run a full overnight cycle now? This runs AI analysis and may take a minute.",
  },
  // ─── Data Reset (destructive) ───────────────────────────────────────────
  {
    key: "clear-approvals",
    group: "reset",
    icon: Trash2,
    emoji: "🗑",
    label: "Clear Pending Approvals",
    description: "Delete every approval currently awaiting a founder decision.",
    confirm: "Clear all pending approvals? This cannot be undone.",
    danger: true,
  },
  {
    key: "reset-objectives",
    group: "reset",
    icon: RotateCcw,
    emoji: "🔄",
    label: "Reset Objectives",
    description: "Remove all objectives. Child tasks are detached; their approvals are cleared.",
    confirm: "Delete ALL objectives? This cannot be undone.",
    danger: true,
  },
  {
    key: "remove-test-data",
    group: "reset",
    icon: Eraser,
    emoji: "🧹",
    label: "Remove Test Data",
    description: "Delete objectives, tasks, and approvals tagged with a [TEST] marker.",
    confirm: "Remove all [TEST]-tagged records?",
  },
  {
    key: "reseed",
    group: "reset",
    icon: Sprout,
    emoji: "🌱",
    label: "Reseed Mission Control",
    description: "Wipe and rebuild executives, tasks, memory, and the activity feed from the seed.",
    confirm: "Wipe ALL Mission Control data and reseed from scratch? This cannot be undone.",
    danger: true,
  },
  {
    key: "reset-founder-profile",
    group: "reset",
    icon: Bot,
    emoji: "🤖",
    label: "Reset Founder Profile",
    description: "Clear the learned founder operating profile and decision predictions.",
    confirm: "Reset the founder operating profile?",
  },
  {
    key: "regenerate-briefing",
    group: "reset",
    icon: BarChart3,
    emoji: "📊",
    label: "Regenerate Daily Briefing",
    description: "Force Quinn to recompute today's daily COO briefing now.",
    confirm: "Regenerate today's daily briefing now?",
  },
];

function ToolCard({
  tool,
  mutation,
  result,
  onRun,
}: {
  tool: ToolConfig;
  mutation: DevMutation;
  result: ActionState;
  onRun: () => void;
}) {
  const Icon = tool.icon;
  const pending = mutation.isPending;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-border/80">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border ${
            tool.danger
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-primary/30 bg-primary/10 text-primary"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden>{tool.emoji}</span>
            {tool.label}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          onClick={onRun}
          disabled={pending}
          className={`flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors disabled:opacity-50 ${
            tool.danger
              ? "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
              : "border border-border bg-secondary text-muted-foreground hover:bg-card hover:text-foreground"
          }`}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
          {pending ? "Running…" : "Run"}
        </button>

        {result && (
          <span
            className={`flex items-center gap-1.5 text-right font-mono text-[11px] ${
              result.status === "success" ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {result.status === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            )}
            <span className="truncate">{result.message}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function EngineeringCheckCard() {
  const queryClient = useQueryClient();
  const checkEngineering = useDevCheckEngineering();
  const [result, setResult] = useState<
    { status: "success"; healthScore: number; deploymentRisk: string; blockers: number } | { status: "error"; message: string } | null
  >(null);

  const run = () => {
    checkEngineering.mutate(undefined, {
      onSuccess: (snapshot) => {
        setResult({
          status: "success",
          healthScore: snapshot.healthScore,
          deploymentRisk: snapshot.deploymentRisk,
          blockers: snapshot.blockers.length,
        });
        void queryClient.invalidateQueries();
      },
      onError: () => {
        setResult({ status: "error", message: "Engineering check failed — see server logs" });
      },
    });
  };

  const pending = checkEngineering.isPending;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-border/80">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
          <GitBranch className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden>🛠️</span>
            Check Engineering
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Force a fresh Engineering Snapshot — collect from every provider (GitHub, Replit), recompute the health score
            and risks, and persist it. Bypasses the TTL cache.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          onClick={run}
          disabled={pending}
          className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
          {pending ? "Collecting…" : "Run"}
        </button>

        {result && (
          <span
            className={`flex items-center gap-1.5 text-right font-mono text-[11px] ${
              result.status === "success" ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {result.status === "success" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">
                  Health {result.healthScore} · risk {result.deploymentRisk} · {result.blockers} blocker
                  {result.blockers === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{result.message}</span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DevTools() {
  const queryClient = useQueryClient();
  const [results, setResults] = useState<Record<string, ActionState>>({});

  const mutations: Record<string, DevMutation> = {
    "run-reflection": useDevRunReflection(),
    "simulate-conversation": useDevSimulateConversation(),
    "generate-recommendations": useDevGenerateRecommendations(),
    "review-recommendations": useDevReviewRecommendations(),
    "accumulate-memory": useDevAccumulateMemory(),
    "detect-patterns": useDevDetectPatterns(),
    "enrich-recommendations": useDevEnrichRecommendations(),
    "run-autonomous-cycle": useDevRunAutonomousCycle(),
    "run-weekly-review": useDevRunWeeklyReview(),
    "portfolio-scan": useDevPortfolioScan(),
    "reset-executive-learning": useDevResetExecutiveLearning(),
    "reset-quinn-memory": useDevResetQuinnMemory(),
    "rebuild-founder-memory": useDevRebuildFounderMemory(),
    "reset-executive-team": useDevResetExecutiveTeam(),
    "rebuild-executive-knowledge": useDevRebuildExecutiveKnowledge(),
    "reset-quinn-reasoning": useDevResetQuinnReasoning(),
    "simulate-tomorrow": useDevSimulateTomorrow(),
    "clear-approvals": useDevClearApprovals(),
    "reset-objectives": useDevResetObjectives(),
    "remove-test-data": useDevRemoveTestData(),
    reseed: useDevReseed(),
    "reset-founder-profile": useDevResetFounderProfile(),
    "regenerate-briefing": useDevRegenerateBriefing(),
  };

  const run = (tool: ToolConfig) => {
    if (!window.confirm(tool.confirm)) return;
    const mutation = mutations[tool.key];
    mutation.mutate(undefined, {
      onSuccess: (data) => {
        setResults((prev) => ({
          ...prev,
          [tool.key]: { status: "success", message: data?.message ?? "Done" },
        }));
        // These actions mutate broad swaths of Mission Control data; refresh all.
        void queryClient.invalidateQueries();
      },
      onError: () => {
        setResults((prev) => ({
          ...prev,
          [tool.key]: { status: "error", message: "Action failed — see server logs" },
        }));
      },
    });
  };

  const living = TOOLS.filter((t) => t.group === "living");
  const autonomy = TOOLS.filter((t) => t.group === "autonomy");
  const maintenance = TOOLS.filter((t) => t.group === "maintenance");
  const reset = TOOLS.filter((t) => t.group === "reset");

  const renderGrid = (tools: ToolConfig[]) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {tools.map((tool) => (
        <ToolCard
          key={tool.key}
          tool={tool}
          mutation={mutations[tool.key]}
          result={results[tool.key] ?? null}
          onRun={() => run(tool)}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">System · Maintenance</p>
        <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Developer Tools</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          The AI maintenance center — rebuild memory, reset runtime state, regenerate knowledge, and reset Mission Control between testing cycles.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Engineering Intelligence</h2>
          <p className="font-mono text-xs text-muted-foreground">
            Force a fresh Engineering Snapshot and inspect the result. In production the snapshot refreshes on the
            autonomy cycle and on a TTL.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <EngineeringCheckCard />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Living Organization</h2>
          <p className="font-mono text-xs text-muted-foreground">
            Drive the living company manually: run Quinn's reflection, spawn executive conversations, have executives propose recommendations, and let Quinn review them. In production these run on the 15-minute worker.
          </p>
        </div>
        {renderGrid(living)}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Autonomy &amp; Learning</h2>
          <p className="font-mono text-xs text-muted-foreground">
            Run Quinn's autonomous cycle and weekly learning review manually, scan the portfolio, and reset learning or memory. Cycles run automatically every 15 minutes in production.
          </p>
        </div>
        {renderGrid(autonomy)}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-sans text-lg font-bold uppercase tracking-tight">AI Maintenance</h2>
          <p className="font-mono text-xs text-muted-foreground">
            Rebuild and refresh AI state. These run analysis and preserve your data unless noted.
          </p>
        </div>
        {renderGrid(maintenance)}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Data Reset</h2>
          <p className="font-mono text-xs text-muted-foreground">Destructive actions for resetting data between testing cycles.</p>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>These actions permanently modify or delete data. Each one asks for confirmation before it runs.</p>
        </div>
        {renderGrid(reset)}
      </section>
    </div>
  );
}
