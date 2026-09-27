import { useAuth } from '@/hooks/use-auth';
import { useGetBriefing, getGetBriefingQueryKey } from '@workspace/api-client-react';
import { Loader2, TrendingUp, ShieldAlert, CheckCircle2, AlertTriangle, ArrowRight, Activity, Clock, Inbox } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { RouteCalendarModule } from '@/components/RouteCalendarModule';

export function Dashboard() {
  const { me } = useAuth();

  // Use a 30s refetch interval to keep the dashboard feeling live and operational.
  const { data: briefing, isLoading, isError } = useGetBriefing({
    query: {
      queryKey: getGetBriefingQueryKey(),
      enabled: !!me,
      refetchInterval: 30000
    },
  });

  if (isLoading) {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[60vh] gap-4" data-testid="dashboard-loading">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground animate-pulse">Syncing operational data...</p>
      </div>
    );
  }

  if (isError || !briefing) {
    return (
      <div className="p-6 md:p-10 max-w-7xl mx-auto" data-testid="dashboard-error">
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-6 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-lg">Connection Interrupted</h3>
            <p className="text-destructive/80 mt-1">Failed to retrieve the latest operational briefing. The system will automatically retry.</p>
          </div>
        </div>
      </div>
    );
  }

  const { owner, manager } = briefing;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-10 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/40 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-dashboard-title">Operational Briefing</h1>
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <p>Company-scoped briefing &middot; refreshes every 30 seconds</p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground font-mono bg-white/5 px-3 py-1.5 rounded-md border border-white/5">
          {format(new Date(), 'EEEE, MMMM d')}
        </div>
      </header>

      <RouteCalendarModule showTechnicianNames={!!manager} />

      {owner && (
        <section className="space-y-6" data-testid="section-owner-kpis">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* KPI Card 1: Completions */}
            <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-sm hover:border-primary/30 transition-colors group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <CheckCircle2 className="w-24 h-24 text-primary" />
              </div>
              <div className="flex justify-between items-start relative z-10">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">30d Completions</p>
                  <p className="text-4xl font-light font-mono mt-2 text-foreground tracking-tight" data-testid="kpi-completions-30d">
                    {owner.kpis.completions30d}
                  </p>
                </div>
                <div className="p-2.5 bg-primary/10 text-primary rounded-lg">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-5 flex items-center text-sm relative z-10">
                <span className="text-primary font-medium mr-2" data-testid="kpi-completions-7d">+{owner.kpis.completions7d}</span>
                <span className="text-muted-foreground">in the last 7 days</span>
              </div>
            </div>

            {/* KPI Card 2: Pipeline */}
            <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-sm hover:border-primary/30 transition-colors group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <TrendingUp className="w-24 h-24 text-primary" />
              </div>
              <div className="flex justify-between items-start relative z-10">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Open Opportunities</p>
                  <p className="text-4xl font-light font-mono mt-2 text-foreground tracking-tight" data-testid="kpi-open-opps">
                    {owner.kpis.openOpportunities}
                  </p>
                </div>
                <div className="p-2.5 bg-primary/10 text-primary rounded-lg">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-5 flex items-center text-sm relative z-10">
                <span className="text-foreground font-mono font-medium mr-2" data-testid="kpi-pipeline-value">
                  ${owner.kpis.pipelineValue.toLocaleString()}
                </span>
                <span className="text-muted-foreground">pipeline value</span>
              </div>
            </div>

            {/* KPI Card 3: Quality */}
            <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-sm hover:border-primary/30 transition-colors group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <ShieldAlert className="w-24 h-24 text-primary" />
              </div>
              <div className="flex justify-between items-start relative z-10">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Quality Score</p>
                  <p className="text-4xl font-light font-mono mt-2 text-foreground tracking-tight" data-testid="kpi-quality-score">
                    {owner.kpis.avgQualityScore30d != null ? `${owner.kpis.avgQualityScore30d}%` : '--'}
                  </p>
                </div>
                <div className="p-2.5 bg-primary/10 text-primary rounded-lg">
                  <ShieldAlert className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-5 flex items-center text-sm relative z-10">
                <span className="text-foreground font-medium mr-2" data-testid="kpi-approved-summaries">{owner.kpis.approvedSummaries30d}</span>
                <span className="text-muted-foreground">approved summaries</span>
              </div>
            </div>
          </div>

          {owner.alerts.length > 0 && (
            <div className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-sm" data-testid="section-owner-alerts">
              <div className="px-6 py-4 border-b border-border/50 bg-black/20 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <h3 className="font-semibold tracking-wide">System Alerts</h3>
                <span className="ml-auto bg-primary/20 text-primary text-xs font-bold px-2 py-0.5 rounded-full">
                  {owner.alerts.length} Action{owner.alerts.length !== 1 ? 's' : ''} Required
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {owner.alerts.map((alert, i) => (
                  <div key={i} className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-white/[0.02] transition-colors" data-testid={`alert-${alert.type}`}>
                    <div className={`p-2.5 rounded-lg shrink-0 w-fit ${
                      alert.severity === 'critical' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                      alert.severity === 'warning' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                      'bg-primary/10 text-primary border border-primary/20'
                    }`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground text-base">{alert.message}</p>
                      <p className="text-sm text-muted-foreground mt-1 uppercase tracking-wider text-[11px] font-semibold">{alert.type.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-6 mt-2 sm:mt-0">
                      <div className="text-2xl font-light font-mono text-foreground" data-testid={`alert-count-${alert.type}`}>{alert.count}</div>
                      {alert.type === 'approvals_aging' && (
                         <Button variant="outline" size="sm" asChild className="h-8 border-border/50 bg-background/50 hover:bg-white/5">
                           <Link href="/reports">Review</Link>
                         </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {manager && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6" data-testid="section-manager-ops">
          {/* Pending Approvals */}
          <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
            <div className="px-6 py-5 border-b border-border/50 flex justify-between items-center bg-black/10">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold tracking-wide">Approval Queue</h3>
              </div>
              {manager.pendingApprovals > 0 && (
                <span className="bg-primary text-primary-foreground text-xs font-bold px-2.5 py-1 rounded-full tabular-nums" data-testid="badge-pending-approvals">
                  {manager.pendingApprovals} Pending
                </span>
              )}
            </div>
            <div className="divide-y divide-border/50 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar bg-card/20">
              {manager.approvalsQueue.length === 0 ? (
                <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground h-full">
                  <Inbox className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm font-medium">Queue is clear</p>
                  <p className="text-xs mt-1">All reports have been processed.</p>
                </div>
              ) : (
                manager.approvalsQueue.map(approval => (
                  <div key={approval.id} className="p-5 hover:bg-white/[0.03] transition-colors flex items-center justify-between group" data-testid={`approval-item-${approval.id}`}>
                    <div className="pr-4">
                      <p className="font-medium text-sm text-foreground line-clamp-1" title={approval.siteAddress}>{approval.siteAddress}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${approval.ageDays > 2 ? 'bg-destructive/20 text-destructive' : 'bg-white/10 text-muted-foreground'}`}>
                          {approval.ageDays}d old
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(approval.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" asChild className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 h-8">
                      <Link href={`/inspections/${approval.inspectionId}`} data-testid={`link-review-${approval.id}`}>
                        Review <ArrowRight className="w-3 h-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                ))
              )}
            </div>
            {manager.approvalsQueue.length > 0 && (
              <div className="p-3 border-t border-border/50 bg-black/20">
                <Button variant="ghost" className="w-full text-xs text-muted-foreground hover:text-foreground h-8" asChild>
                  <Link href="/reports">View All Reports</Link>
                </Button>
              </div>
            )}
          </div>

          {/* Recent Completions */}
          <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
            <div className="px-6 py-5 border-b border-border/50 flex justify-between items-center bg-black/10">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold tracking-wide">Recent Completions</h3>
              </div>
            </div>
            <div className="divide-y divide-border/50 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar bg-card/20">
              {manager.recentCompletions.length === 0 ? (
                <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground h-full">
                  <Activity className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm font-medium">No recent activity</p>
                  <p className="text-xs mt-1">Completed inspections will appear here.</p>
                </div>
              ) : (
                manager.recentCompletions.map(comp => (
                  <div key={comp.id} className="p-5 hover:bg-white/[0.03] transition-colors" data-testid={`completion-item-${comp.id}`}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <Link href={`/inspections/${comp.id}`} className="font-medium text-sm text-foreground hover:text-primary transition-colors line-clamp-1 block" title={comp.siteAddress}>
                          {comp.siteAddress}
                        </Link>
                        <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                          {comp.technicianName}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                          comp.findingsCount > 0 ? 'bg-primary/20 text-primary' : 'bg-white/10 text-muted-foreground'
                        }`}>
                          {comp.findingsCount} finding{comp.findingsCount !== 1 ? 's' : ''}
                        </span>
                        {comp.completedAt && (
                          <p className="text-xs text-muted-foreground font-mono mt-1.5">
                            {format(new Date(comp.completedAt), 'HH:mm')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {manager.recentCompletions.length > 0 && (
              <div className="p-3 border-t border-border/50 bg-black/20">
                <Button variant="ghost" className="w-full text-xs text-muted-foreground hover:text-foreground h-8" asChild>
                  <Link href="/inspections">View All Inspections</Link>
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
