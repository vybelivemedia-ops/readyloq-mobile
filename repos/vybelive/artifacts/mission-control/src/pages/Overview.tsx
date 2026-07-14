import { useGetMissionControlOverview, useGetBriefing, useRefreshBriefing, getGetBriefingQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle2, Zap, RefreshCw, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ReportView } from "@/components/ReportView";
import { execStatusStyle } from "@/lib/execStatus";

export default function Overview() {
  const { data: overview, isLoading } = useGetMissionControlOverview();
  const queryClient = useQueryClient();
  const { data: briefingResult } = useGetBriefing({ query: { queryKey: getGetBriefingQueryKey() } });
  const refreshBriefing = useRefreshBriefing();
  const briefing = briefingResult?.briefing ?? null;

  const handleRefreshBriefing = () => {
    refreshBriefing.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBriefingQueryKey() });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground font-mono animate-pulse">
        [ INITIALIZING TELEMETRY... ]
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end border-b border-border/50 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 uppercase font-sans">Daily Briefing</h1>
          <p className="text-muted-foreground font-mono text-sm">
            {briefing
              ? `Compiled by Chief of Staff ${formatDistanceToNow(new Date(briefing.createdAt), { addSuffix: true })}`
              : `Generated ${formatDistanceToNow(new Date(overview.briefing.generatedAt), { addSuffix: true })}`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefreshBriefing}
          disabled={refreshBriefing.isPending}
          className="font-mono text-xs gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshBriefing.isPending ? "animate-spin" : ""}`} />
          {refreshBriefing.isPending ? "COMPILING..." : "REFRESH BRIEFING"}
        </Button>
      </header>

      <section className="bg-primary/5 border border-primary/20 rounded-lg p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <div className="flex items-center gap-2 mb-4 text-[10px] font-mono uppercase tracking-wider text-primary/80">
          <ClipboardList className="w-3.5 h-3.5" /> Chief of Staff &mdash; Aggregated Briefing
        </div>
        {briefing ? (
          <ReportView report={briefing} />
        ) : (
          <div className="py-6">
            <h2 className="text-xl font-bold text-primary mb-3">{overview.briefing.headline}</h2>
            <p className="text-foreground/90 leading-relaxed mb-4">{overview.briefing.summary}</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {overview.briefing.focus.map((focusItem, i) => (
                <span key={i} className="px-3 py-1 bg-primary/10 text-primary border border-primary/20 text-xs font-mono uppercase tracking-wider rounded">
                  {focusItem}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              Hit Refresh Briefing to compile a live report from all executives.
            </p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Open Tasks" value={overview.stats.openTasks} icon={CheckCircle2} />
        <StatsCard title="Blocked" value={overview.stats.blockedTasks} icon={AlertCircle} valueColor="text-destructive" />
        <StatsCard title="Critical Priority" value={overview.stats.criticalTasks} icon={Zap} valueColor="text-accent" />
        <StatsCard title="Handoffs Today" value={overview.stats.handoffsToday} icon={Activity} />
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold uppercase tracking-wider">Top Priorities</h3>
              <Link href="/tasks" className="text-sm text-primary hover:underline font-mono">View All &rarr;</Link>
            </div>
            <div className="space-y-3">
              {overview.priorities.map((task) => (
                <div key={task.id} className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors flex items-start gap-4">
                  <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${task.priority === 'critical' ? 'bg-destructive' : 'bg-primary'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <h4 className="font-medium truncate text-foreground">{task.title}</h4>
                      <span className="text-xs font-mono text-muted-foreground uppercase shrink-0">{task.status}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{task.executiveName}</span>
                      <span>&bull;</span>
                      <span className="uppercase">{task.priority}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold uppercase tracking-wider mb-4">Executive Roster</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {overview.executives.map((exec) => (
                <Link key={exec.id} href={`/executives/${exec.id}`}>
                  <div className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center font-mono font-bold border border-border" style={{ color: exec.accentColor, borderColor: `${exec.accentColor}30` }}>
                        {exec.avatarInitials}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm group-hover:text-primary transition-colors">{exec.name}</h4>
                        <p className="text-xs text-muted-foreground">{exec.title}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${execStatusStyle(exec.status).dot}`} />
                        <span className="text-xs font-mono uppercase text-muted-foreground">{exec.status}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold uppercase tracking-wider mb-4">Live Activity</h3>
          <div className="relative pl-4 space-y-6 before:absolute before:inset-y-0 before:left-[7px] before:w-[2px] before:bg-border">
            {overview.activity.map((item) => (
              <div key={item.id} className="relative text-sm">
                <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full border-2 border-background bg-primary/80 shadow-[0_0_5px_rgba(var(--primary),0.5)]" />
                <p className="text-foreground/90">{item.summary}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground font-mono">
                  <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
                  {item.executiveName && (
                    <>
                      <span>&bull;</span>
                      <span>{item.executiveName}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsCard({ title, value, icon: Icon, valueColor = "text-foreground" }: { title: string, value: number, icon: any, valueColor?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold font-mono ${valueColor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
