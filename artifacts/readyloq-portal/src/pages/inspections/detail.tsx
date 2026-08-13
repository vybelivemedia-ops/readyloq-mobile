import {
  useGetInspection,
  useGetInspectionScorecard,
  useGetCustomerSummaryForInspection,
  getGetInspectionQueryKey,
  getGetInspectionScorecardQueryKey,
  getGetCustomerSummaryForInspectionQueryKey,
} from '@workspace/api-client-react';
import { useParams, Link } from 'wouter';
import { Loader2, ArrowLeft, Bug, MapPin, Calendar, User, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';

export function InspectionDetail() {
  const params = useParams();
  const id = Number(params.id);

  const { data: inspection, isLoading: isLoadingInsp } = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id), enabled: !!id },
  });
  const { data: scorecard, isLoading: isLoadingScore } = useGetInspectionScorecard(id, {
    query: { queryKey: getGetInspectionScorecardQueryKey(id), enabled: !!id },
  });
  const { data: summary, isLoading: isLoadingSum } = useGetCustomerSummaryForInspection(id, {
    query: { queryKey: getGetCustomerSummaryForInspectionQueryKey(id), enabled: !!id },
  });

  const isLoading = isLoadingInsp || isLoadingScore || isLoadingSum;

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!inspection) {
    return <div className="p-8 text-center text-muted-foreground">Inspection not found.</div>;
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div>
        <Link href="/inspections" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Inspections
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{inspection.siteAddress}</h1>
            {inspection.clientName && <p className="text-lg text-muted-foreground mt-1">{inspection.clientName}</p>}
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize ${
            inspection.status === 'completed' ? 'bg-green-500/10 text-green-500' :
            inspection.status === 'in_progress' ? 'bg-blue-500/10 text-blue-500' :
            'bg-muted text-muted-foreground'
          }`}>
            {inspection.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><User className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Technician</p>
            <p className="font-semibold mt-0.5 text-sm">{inspection.technicianName}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><Calendar className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Date</p>
            <p className="font-semibold mt-0.5 text-sm">{format(new Date(inspection.createdAt), 'MMM d, yyyy')}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><Bug className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Findings</p>
            <p className="font-semibold mt-0.5 text-sm">{inspection.findingsCount ?? 0}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><MapPin className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pests</p>
            <p className="font-semibold mt-0.5 text-sm capitalize">{(inspection.pestTypes ?? []).join(', ') || 'None'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <h2 className="text-xl font-bold mb-4">Customer Summary</h2>
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              {summary ? (
                <div className="space-y-4">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium uppercase tracking-wider ${
                    summary.status === 'approved' ? 'bg-green-500/10 text-green-500' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {summary.status}
                  </span>
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary.body}</p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No summary drafted yet. Complete the inspection to generate one.</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-4">Media ({inspection.mediaCount ?? 0})</h2>
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <p className="text-muted-foreground text-sm">
                {inspection.mediaCount ? 'Media assets captured. Use the mobile app to review photos.' : 'No media captured for this inspection.'}
              </p>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-bold mb-4">Quality Scorecard</h2>
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {scorecard ? (
                <div>
                  <div className="p-6 border-b border-border bg-muted/20 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Overall Score</p>
                      <div className="flex items-end gap-1 mt-1">
                        <span className="text-4xl font-bold">{scorecard.qualityScore}</span>
                        <span className="text-muted-foreground mb-1">/ 100</span>
                      </div>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-sm font-semibold capitalize ${
                      scorecard.riskLevel === 'critical' ? 'bg-destructive/10 text-destructive' :
                      scorecard.riskLevel === 'high' ? 'bg-orange-500/10 text-orange-500' :
                      scorecard.riskLevel === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-green-500/10 text-green-500'
                    }`}>
                      {scorecard.riskLevel} risk
                    </div>
                  </div>

                  <div className="p-4 space-y-3 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Components</p>
                    {(Object.entries(scorecard.components) as [string, number][]).map(([key, val]) => (
                      <div key={key}>
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-medium capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                          <span className="text-xs font-semibold">{Math.round(val)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {scorecard.missedOpportunities.length > 0 && (
                    <div className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Missed Opportunities ({scorecard.missedOpportunities.length})
                      </p>
                      <ul className="space-y-2">
                        {scorecard.missedOpportunities.map((opp, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground capitalize">{opp.serviceType}</span>
                              {' — '}{opp.description}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  Scorecard not available. Inspection must be completed and analyzed.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
