import { useCompanyMembers } from '@/hooks/use-team';
import { useGetScorecardSummary } from '@workspace/api-client-react';
import { Loader2, ShieldAlert, Award, AlertTriangle, Activity } from 'lucide-react';
import { format } from 'date-fns';

export function Team() {
  const { data: members, isLoading: isLoadingMembers } = useCompanyMembers();
  const { data: summary, isLoading: isLoadingSummary } = useGetScorecardSummary();

  const isLoading = isLoadingMembers || isLoadingSummary;

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const highRiskCount = summary ? (summary.riskDistribution?.['high'] ?? 0) : 0;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Team Performance</h1>
        <p className="text-muted-foreground mt-1">Manage field operators and monitor quality scores.</p>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Quality Score</p>
                <p className="text-2xl font-bold mt-1">{summary.avgQuality.toFixed(1)}%</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-500/10 text-yellow-500 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Risk Inspections</p>
                <p className="text-2xl font-bold mt-1">{highRiskCount}</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Evaluated</p>
                <p className="text-2xl font-bold mt-1">{summary.totalScorecards}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {summary && summary.technicians.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30">
            <h2 className="font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-muted-foreground" />
              Technician Quality Breakdown
            </h2>
          </div>
          <div className="divide-y divide-border">
            {summary.technicians.map((tech, i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-sm">{tech.technicianName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tech.inspections} inspections &middot; {tech.missedOpportunities} missed
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, tech.avgQuality)}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold w-12 text-right">{tech.avgQuality.toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h2 className="font-semibold">Team Roster</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Member ID</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members?.map((member) => (
                <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 font-medium text-foreground">
                    #{member.id}
                    <span className="text-xs text-muted-foreground ml-2 font-normal">
                      ({member.clerkUserId.substring(0, 12)}...)
                    </span>
                  </td>
                  <td className="px-6 py-4 capitalize">
                    <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-xs font-medium">
                      {member.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {format(new Date(member.createdAt), 'MMM d, yyyy')}
                  </td>
                </tr>
              ))}
              {!members?.length && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">
                    No team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
