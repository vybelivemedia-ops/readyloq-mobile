import { useAuth } from '@/hooks/use-auth';
import { useGetBriefing, getGetBriefingQueryKey } from '@workspace/api-client-react';
import { Loader2, TrendingUp, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';

export function Dashboard() {
  const { me } = useAuth();
  const { data: briefing, isLoading, isError } = useGetBriefing({
    query: { queryKey: getGetBriefingQueryKey(), enabled: !!me },
  });

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !briefing) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          <span>Failed to load dashboard briefing.</span>
        </div>
      </div>
    );
  }

  const { owner, manager } = briefing;

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Here's what's happening today.</p>
      </div>

      {owner && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">30d Completions</p>
                  <p className="text-3xl font-bold mt-1">{owner.kpis.completions30d}</p>
                </div>
                <div className="p-2 bg-primary/10 text-primary rounded-md">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">{owner.kpis.completions7d} this week</p>
            </div>

            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Open Opportunities</p>
                  <p className="text-3xl font-bold mt-1">{owner.kpis.openOpportunities}</p>
                </div>
                <div className="p-2 bg-primary/10 text-primary rounded-md">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">${owner.kpis.pipelineValue.toLocaleString()} pipeline value</p>
            </div>

            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Quality Score</p>
                  <p className="text-3xl font-bold mt-1">
                    {owner.kpis.avgQualityScore30d != null ? `${owner.kpis.avgQualityScore30d}%` : '--'}
                  </p>
                </div>
                <div className="p-2 bg-primary/10 text-primary rounded-md">
                  <ShieldAlert className="w-5 h-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">{owner.kpis.approvedSummaries30d} approved summaries</p>
            </div>
          </div>

          {owner.alerts.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-border bg-muted/30">
                <h3 className="font-semibold">Action Required</h3>
              </div>
              <div className="divide-y divide-border">
                {owner.alerts.map((alert, i) => (
                  <div key={i} className="p-5 flex items-start gap-4">
                    <div className={`p-2 rounded-full ${
                      alert.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
                      alert.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-blue-500/10 text-blue-500'
                    }`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{alert.message}</p>
                      <p className="text-sm text-muted-foreground mt-1 capitalize">{alert.type.replace('_', ' ')}</p>
                    </div>
                    <div className="text-lg font-semibold">{alert.count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {manager && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold">Pending Approvals</h3>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-1 rounded-full">
                {manager.pendingApprovals}
              </span>
            </div>
            <div className="divide-y divide-border flex-1">
              {manager.approvalsQueue.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No pending approvals.</div>
              ) : (
                manager.approvalsQueue.map(approval => (
                  <div key={approval.id} className="p-4 hover:bg-muted/50 transition-colors flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{approval.siteAddress}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(approval.createdAt), 'MMM d, yyyy')} &middot; {approval.ageDays}d old
                      </p>
                    </div>
                    <Link href={`/inspections/${approval.inspectionId}`} className="text-sm text-primary font-medium hover:underline">
                      Review
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-semibold">Recent Completions</h3>
            </div>
            <div className="divide-y divide-border flex-1">
              {manager.recentCompletions.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No recent completions.</div>
              ) : (
                manager.recentCompletions.map(comp => (
                  <div key={comp.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">{comp.siteAddress}</p>
                        <p className="text-xs text-muted-foreground mt-1">{comp.technicianName}</p>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500">
                          {comp.findingsCount} findings
                        </span>
                        {comp.completedAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(comp.completedAt), 'h:mm a')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
