import { useGetMissionControlOverview, useListExecutives, useListObjectives, useListTasks, useGetAgentZeroOperations, useGetBlockerSummary, useGetDiagnostics, useListApprovals, useGetAIMetrics, getGetMissionControlOverviewQueryKey, getListExecutivesQueryKey, getListObjectivesQueryKey, getListTasksQueryKey, getGetAgentZeroOperationsQueryKey, getGetBlockerSummaryQueryKey, getGetDiagnosticsQueryKey, getListApprovalsQueryKey, getGetAIMetricsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, ShieldAlert, Cpu, AlertTriangle, Zap, Server, Database, BrainCircuit, ArrowRight, Gauge, Coins, Target } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import VHeadquartersV2, { type ExecDeptData, type VHQObjective } from "@/components/VHeadquartersV2";

function KPICard({ title, value, subtext, icon: Icon, colorClass = "text-primary", loading, href }: { title: string, value: string | number, subtext?: string, icon: React.ComponentType<{ className?: string }>, colorClass?: string, loading?: boolean, href?: string }) {
  const inner = (
    <div className="glass-card p-4 rounded-lg flex flex-col relative overflow-hidden group h-full">
      <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity ${colorClass}`}>
        <Icon className="w-16 h-16" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${colorClass}`} />
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 rounded bg-white/5 animate-pulse mt-1" />
      ) : (
        <div className={`text-3xl font-bold font-mono ${colorClass}`}>{value}</div>
      )}
      {subtext && !loading && <div className="text-xs font-mono text-muted-foreground mt-1">{subtext}</div>}
    </div>
  );
  if (href) return <Link href={href} className="block h-full">{inner}</Link>;
  return inner;
}

export default function CommandCenter() {
  const refetchInterval = 15000;

  const { data: overview } = useGetMissionControlOverview({ query: { queryKey: getGetMissionControlOverviewQueryKey(), refetchInterval } });
  const { data: execsData, isError: execsError } = useListExecutives({ query: { queryKey: getListExecutivesQueryKey(), refetchInterval } });
  const executives = execsData ?? [];
  const { data: objsData, isError: objsError } = useListObjectives({ query: { queryKey: getListObjectivesQueryKey(), refetchInterval } });
  const objectives = objsData ?? [];
  const { data: tasksData, isError: tasksError } = useListTasks(undefined, { query: { queryKey: getListTasksQueryKey(), refetchInterval } });
  const tasks = tasksData ?? [];
  const { data: agentZero, isError: agentZeroError } = useGetAgentZeroOperations({ query: { queryKey: getGetAgentZeroOperationsQueryKey(), refetchInterval } });
  const { data: blockerSummary, isError: blockerError } = useGetBlockerSummary({ query: { queryKey: getGetBlockerSummaryQueryKey(), refetchInterval } });
  const { data: diagnostics } = useGetDiagnostics({ query: { queryKey: getGetDiagnosticsQueryKey(), refetchInterval: 60000 } });
  const { data: approvals, isError: approvalsError } = useListApprovals({ status: "pending" }, { query: { queryKey: getListApprovalsQueryKey({ status: "pending" }), refetchInterval } });
  const { data: aiMetrics, isError: aiMetricsError } = useGetAIMetrics({ query: { queryKey: getGetAIMetricsQueryKey(), refetchInterval: 60000 } });

  const objsLoading = objsData === undefined && !objsError;
  const execsLoading = execsData === undefined && !execsError;

  const completedObjectives = objectives.filter(o => o.status === "completed").length;
  const activeObjectives = objectives.filter(o => ["planning", "in_progress", "needs_approval"].includes(o.status)).length;
  const totalObjectives = objectives.length || 1;
  const launchReadiness = Math.round((completedObjectives / totalObjectives) * 100);

  const activeExecutives = executives.filter(e => ["active", "planning", "collaborating", "busy"].includes(e.status)).length;
  const totalExecutives = executives.length;

  const runningTasks = tasks.filter(t => t.status === "in_progress").length;
  const activeBlockers = blockerSummary?.active || 0;
  const failedBlockers = blockerSummary?.failed || 0;
  const agentZeroRunning = (agentZero?.counts?.running ?? 0) > 0;

  const pendingApprovals = approvals?.length ?? 0;
  const aiRequests = aiMetrics?.totals.requests ?? 0;
  const aiTokens = aiMetrics?.totals.totalTokens ?? 0;
  const aiCost = aiMetrics?.totals.estimatedCostUsd ?? 0;
  const heapMb = agentZero?.systemLoad.heapUsedMb;
  const load1 = agentZero?.systemLoad.load1;
  const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

  // Build ExecDeptData for VHeadquartersV2
  const execDepts: ExecDeptData[] = executives.map(e => {
    const execObjectives = objectives.filter(o => o.createdByExecutiveId === e.id);
    const recentDone = execObjectives.some(o => o.status === "completed" && new Date(o.updatedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000);
    return {
      id: e.id,
      name: e.name,
      role: e.role,
      status: e.status,
      statusMessage: overview?.executives.find(oe => oe.id === e.id)?.statusMessage,
      hasBlocker: e.status === "needs_approval",
      recentlyCompleted: recentDone,
    };
  });

  const quinnExec = execDepts.find(e => e.role === "chief_of_staff") ?? null;
  const departmentExecs = execDepts.filter(e => e.role !== "chief_of_staff");

  const hqObjectives: VHQObjective[] = objectives.map(o => ({
    id: o.id,
    title: o.title,
    status: o.status,
    priority: (o as unknown as { priority?: string }).priority ?? "medium",
    ownerRole: (o as unknown as { ownerRole?: string | null }).ownerRole ?? null,
    retryCount: (o as unknown as { retryCount?: number }).retryCount ?? 0,
  }));

  const lastCycleAt = (overview as Record<string, unknown> | undefined)?.lastCycleAt as string | null ?? null;

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-500">

      {/* Top KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 shrink-0">
        <KPICard
          title="Launch Readiness"
          value={objsError ? "—" : `${launchReadiness}%`}
          subtext={objsError ? "Unavailable" : `${completedObjectives} / ${objectives.length} Objectives`}
          icon={Zap}
          colorClass={objsError ? "text-muted-foreground" : "text-accent"}
          loading={objsLoading}
          href="/objectives"
        />
        <KPICard
          title="Active Projects"
          value={objsError ? "—" : activeObjectives}
          subtext={objsError ? "Unavailable" : `${objectives.length} total`}
          icon={Target}
          colorClass={objsError ? "text-muted-foreground" : "text-primary"}
          loading={objsLoading}
          href="/objectives"
        />
        <KPICard
          title="Executives Active"
          value={execsError ? "—" : `${activeExecutives}/${totalExecutives}`}
          subtext={execsError ? "Unavailable" : undefined}
          icon={BrainCircuit}
          colorClass={execsError ? "text-muted-foreground" : "text-primary"}
          loading={execsLoading}
        />
        <KPICard
          title="Tasks Running"
          value={tasksError ? "—" : runningTasks}
          subtext={tasksError ? "Unavailable" : `+ ${agentZero?.counts.running || 0} A0 Jobs`}
          icon={Activity}
          colorClass={tasksError ? "text-muted-foreground" : "text-primary"}
          loading={tasksData === undefined && !tasksError}
          href="/tasks"
        />
        <KPICard
          title="Pending Approvals"
          value={approvalsError ? "—" : pendingApprovals}
          subtext={approvalsError ? "Unavailable" : pendingApprovals > 0 ? "Awaiting sign-off" : "All clear"}
          icon={ShieldAlert}
          colorClass={approvalsError ? "text-muted-foreground" : pendingApprovals > 0 ? "text-amber-400" : "text-emerald-500"}
          loading={approvals === undefined && !approvalsError}
          href="/objectives"
        />
        <KPICard
          title="Active Blockers"
          value={blockerError ? "—" : activeBlockers}
          subtext={blockerError ? "Unavailable" : `${failedBlockers} Failed`}
          icon={AlertTriangle}
          colorClass={blockerError ? "text-muted-foreground" : activeBlockers > 0 ? "text-destructive" : "text-emerald-500"}
          loading={blockerSummary === undefined && !blockerError}
          href="/blockers"
        />
        <KPICard
          title="AI Workload"
          value={aiMetricsError ? "—" : aiRequests > 0 ? `${fmtTokens(aiTokens)}` : "—"}
          subtext={aiMetricsError ? "Unavailable" : aiRequests > 0 ? `${aiRequests} calls · $${aiCost.toFixed(2)}` : "No AI usage logged"}
          icon={Coins}
          colorClass={aiMetricsError ? "text-muted-foreground" : "text-accent"}
          loading={aiMetrics === undefined && !aiMetricsError}
          href="/ai-intelligence"
        />
        <KPICard
          title="Resource Load"
          value={agentZeroError ? "—" : heapMb !== undefined ? `${heapMb}MB` : "—"}
          subtext={agentZeroError ? "Unavailable" : load1 !== undefined ? `load ${load1.toFixed(2)}` : "Unavailable"}
          icon={Gauge}
          colorClass="text-primary"
          loading={agentZero === undefined && !agentZeroError}
          href="/operations"
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">

        {/* Main HQ Stage — VHeadquartersV2 */}
        <div className="flex-1 glass-card rounded-lg overflow-auto p-4">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-primary/70 mb-4">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_currentColor]" />
            Live Telemetry HQ
          </div>

          <VHeadquartersV2
            executives={departmentExecs}
            quinn={quinnExec}
            objectives={hqObjectives}
            agentZero={{
              isRunning: agentZeroRunning,
              workerHealthy: agentZero?.worker.healthy ?? false,
              runningJobs: agentZero?.counts?.running ?? 0,
              queuedJobs: agentZero?.counts?.queued ?? 0,
              completedToday: agentZero?.counts?.completed ?? 0,
              executionConfidence: agentZero?.executionConfidence ?? 100,
              avgRuntimeSeconds: agentZero?.avgRuntimeSeconds ?? 0,
              heapUsedMb: heapMb ?? 0,
              load1: load1 ?? 0,
            }}
            statusBar={{
              activeObjectives,
              tasksRunning: runningTasks,
              activeBlockers,
              aiCostUsd: aiCost,
              systemLoad: load1 ?? 0,
            }}
            pendingApprovals={pendingApprovals}
            lastCycleAt={lastCycleAt}
            loading={execsLoading}
          />
        </div>

        {/* Right Sidebar */}
        <div className="w-full lg:w-80 flex flex-col gap-6 shrink-0 overflow-y-auto custom-scrollbar">

          {/* Quick Actions */}
          <div className="glass-panel rounded-lg p-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Zap className="w-3 h-3" /> Quick Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/objectives" className="flex items-center justify-center p-2 text-xs font-mono border border-primary/20 bg-primary/5 rounded hover:bg-primary/20 text-primary transition-colors">
                New Objective
              </Link>
              <Link href="/operations" className="flex items-center justify-center p-2 text-xs font-mono border border-accent/20 bg-accent/5 rounded hover:bg-accent/20 text-accent transition-colors">
                Dispatch A0
              </Link>
              <Link href="/diagnostics" className="flex items-center justify-center p-2 text-xs font-mono border border-white/10 bg-white/5 rounded hover:bg-white/10 transition-colors">
                Run Diagnostics
              </Link>
              <Link href="/briefing" className="flex items-center justify-center p-2 text-xs font-mono border border-white/10 bg-white/5 rounded hover:bg-white/10 transition-colors">
                View Briefing
              </Link>
            </div>
          </div>

          {/* System Status */}
          <div className="glass-panel rounded-lg p-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Server className="w-3 h-3" /> System Status
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 font-mono"><Server className="w-3 h-3 text-primary" /> API</span>
                <span className={`font-mono text-xs ${diagnostics?.api.status === "ok" ? "text-emerald-500" : "text-destructive"}`}>
                  {diagnostics?.api.status.toUpperCase() || "UNKNOWN"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 font-mono"><Database className="w-3 h-3 text-primary" /> Database</span>
                <span className={`font-mono text-xs ${diagnostics?.database.status === "ok" ? "text-emerald-500" : "text-destructive"}`}>
                  {diagnostics?.database.status.toUpperCase() || "UNKNOWN"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 font-mono"><BrainCircuit className="w-3 h-3 text-primary" /> AI Provider</span>
                <span className={`font-mono text-xs ${diagnostics?.ai.status === "ok" ? "text-emerald-500" : "text-destructive"}`}>
                  {diagnostics?.ai.status.toUpperCase() || "UNKNOWN"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 font-mono"><Cpu className="w-3 h-3 text-primary" /> Agent Zero</span>
                <span className={`font-mono text-xs ${agentZero?.worker.healthy ? "text-emerald-500" : "text-destructive"}`}>
                  {agentZero === undefined ? "UNKNOWN" : agentZero.worker.healthy ? "HEALTHY" : "OFFLINE"}
                </span>
              </div>
            </div>
          </div>

          {/* Live Activity Feed */}
          <div className="glass-panel rounded-lg p-4 flex-1 flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Activity className="w-3 h-3" /> Live Activity
              </h3>
              <Link href="/timeline" className="text-[10px] font-mono text-primary hover:underline flex items-center gap-1">
                View All <ArrowRight className="w-2 h-2" />
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
              {overview?.activity.map((item) => (
                <div key={item.id} className="relative pl-4 border-l border-primary/20 pb-1 last:pb-0">
                  <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-background border border-primary" />
                  <p className="text-xs text-foreground/90 leading-relaxed">{item.summary}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground font-mono">
                    <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
                    {item.executiveName && (
                      <>
                        <span>•</span>
                        <span className="text-primary/70">{item.executiveName.toUpperCase()}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {(!overview?.activity || overview.activity.length === 0) && (
                <div className="text-center text-xs font-mono text-muted-foreground pt-4">No recent activity</div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
