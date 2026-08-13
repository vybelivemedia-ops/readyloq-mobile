import { useRoute, Link } from 'wouter';
import { useClientReport } from '@/hooks/use-client-portal';
import {
  ChevronLeft,
  FileText,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

function severityBadge(sev: string | null) {
  if (!sev) return null;
  const cls = SEVERITY_STYLES[sev.toLowerCase()] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex text-sm font-medium px-3 py-1 rounded-full border capitalize ${cls}`}>
      {sev} severity
    </span>
  );
}

export function ReportViewer() {
  const [, params] = useRoute('/reports/:id');
  const id = params ? Number(params.id) : null;

  const { data: report, isLoading, error } = useClientReport(id);

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex flex-col items-center py-16 text-center">
        <AlertTriangle className="w-10 h-10 text-destructive mb-3" />
        <p className="font-medium text-foreground">Report not found</p>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {(error as Error)?.message ?? 'This report is unavailable.'}
        </p>
        <Link href="/">
          <Button variant="outline">Back to buildings</Button>
        </Link>
      </div>
    );
  }

  const findings = Array.isArray(report.findings)
    ? (report.findings as Array<{ zone?: string; description?: string; severity?: string }>)
    : [];

  const recommendations = Array.isArray(report.recommendations)
    ? (report.recommendations as string[])
    : [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Back */}
      <Link href="/">
        <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" />
          My Buildings
        </button>
      </Link>

      {/* Report header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">{report.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {severityBadge(report.severity)}
          {report.inspectionDate && (
            <span className="text-sm text-muted-foreground">
              Inspected {format(new Date(report.inspectionDate), 'MMMM d, yyyy')}
            </span>
          )}
          <span className="text-sm text-muted-foreground">by {report.technicianName}</span>
        </div>
      </div>

      {/* Report document — links to client-scoped HTML endpoint (not company-portal URL) */}
      <div className="mb-6 flex gap-3 flex-wrap">
        <a
          href={`/api/client/reports/${report.id}/html`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button className="gap-2">
            <ExternalLink className="w-4 h-4" />
            View Full Report
          </Button>
        </a>
        {report.pdfUrl && (
          <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2">
              <ExternalLink className="w-4 h-4" />
              Download PDF
            </Button>
          </a>
        )}
      </div>

      {/* AI Narrative */}
      {report.aiNarrative && (
        <Card className="mb-5 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              AI Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {report.aiNarrative}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Exclusion opportunities */}
      {report.exclusionOpportunities.length > 0 && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Exclusion Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {report.exclusionOpportunities.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                  <span className="text-amber-500 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Findings */}
      {findings.length > 0 && (
        <Card className="mb-5 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Findings ({findings.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {findings.map((f, i) => (
                <li key={i} className="border-l-2 border-primary/30 pl-3">
                  {f.zone && (
                    <span className="text-xs font-medium text-primary uppercase tracking-wide">
                      {f.zone}
                    </span>
                  )}
                  {f.description && (
                    <p className="text-sm text-foreground mt-0.5">{f.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card className="mb-5 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="text-primary font-bold mt-0.5">{i + 1}.</span>
                  {rec}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
