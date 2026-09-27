import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { useClientReport } from '@/hooks/use-client-portal';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  FileText,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  ShieldCheck,
  Download,
  Loader2,
  Zap,
  Info
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EvidenceGallery } from '@/components/evidence-gallery';
import { format } from 'date-fns';
import { apiUrl } from '@/config';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function severityBadge(sev: string | null) {
  if (!sev) return null;
  const cls = SEVERITY_STYLES[sev.toLowerCase()] ?? 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border uppercase tracking-widest ${cls}`}>
      {sev === 'critical' || sev === 'high' ? <Zap className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
      {sev} SEVERITY
    </span>
  );
}

export function ReportViewer() {
  const [, params] = useRoute('/reports/:id');
  const id = params ? Number(params.id) : null;

  const { data: report, isLoading, error } = useClientReport(id);
  const queryClient = useQueryClient();
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function handleDownloadPdf() {
    if (!id) return;
    setPdfGenerating(true);
    setPdfError(null);
    try {
      const res = await fetch(apiUrl(`/client/reports/${id}/pdf`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? 'Failed to generate PDF');
      }
      const { pdfUrl } = await res.json();
      void queryClient.invalidateQueries({ queryKey: ['client', 'reports', id] });
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setPdfError((err as Error).message ?? 'PDF generation failed');
    } finally {
      setPdfGenerating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-32 rounded-full" />
        <Skeleton className="h-12 w-3/4 rounded-xl" />
        <Skeleton className="h-[200px] w-full rounded-2xl" />
        <Skeleton className="h-[300px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex flex-col items-center justify-center py-24 text-center bg-white rounded-3xl border border-border/50 shadow-sm">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <p className="font-semibold text-xl text-foreground tracking-tight">Report not found</p>
          <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
            {(error as Error)?.message ?? 'This intelligence report is currently unavailable.'}
          </p>
          <Link href="/">
            <Button variant="outline" className="rounded-full px-6">Back to Portfolio</Button>
          </Link>
        </div>
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
    <div className="p-4 md:p-8 lg:p-10 max-w-4xl mx-auto min-h-full">
      {/* Back */}
      <Link href="/">
        <button
          data-testid="button-back-to-portfolio"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-6 md:mb-8 transition-colors bg-white/60 hover:bg-white px-3 py-1.5 rounded-full border border-border/50 shadow-sm backdrop-blur-sm"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
      </Link>

      {/* Report header */}
      <div className="bg-white rounded-3xl p-6 md:p-8 lg:p-10 border border-border/60 shadow-sm mb-6 relative overflow-hidden">
        {/* Subtle decorative background element */}
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2 text-primary">
              <FileText className="w-5 h-5" />
              <span className="text-sm font-semibold tracking-wider uppercase">Verified Intelligence</span>
            </div>
            {severityBadge(report.severity)}
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold text-foreground tracking-tight mb-6 leading-tight">
            {report.title}
          </h1>

          <div className="flex flex-wrap gap-x-8 gap-y-4 items-center p-4 bg-muted/30 rounded-2xl border border-border/50">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Inspection ID</p>
              <p className="text-sm font-medium text-foreground">#{report.inspectionId}</p>
            </div>
            {report.inspectionDate && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Inspected</p>
                <p className="text-sm font-medium text-foreground">
                  {format(new Date(report.inspectionDate), 'MMMM d, yyyy')}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Technician</p>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                  {report.technicianName.charAt(0)}
                </div>
                <p className="text-sm font-medium text-foreground">{report.technicianName}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
              <p className="text-sm font-medium text-foreground capitalize">{report.status}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-8 flex gap-3 flex-wrap items-center">
        <a
          href={apiUrl(`/client/reports/${report.id}/html`)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`link-view-full-report-${report.id}`}
        >
          <Button className="gap-2 rounded-xl shadow-sm hover:shadow">
            <ExternalLink className="w-4 h-4" />
            View Full Report
          </Button>
        </a>

        <Button
          variant="outline"
          className="gap-2 rounded-xl shadow-sm bg-white"
          onClick={handleDownloadPdf}
          disabled={pdfGenerating}
          data-testid={`button-download-report-${report.id}`}
        >
          {pdfGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {pdfGenerating ? 'Generating PDF…' : 'Download PDF'}
        </Button>

        {pdfError && (
          <p className="text-sm font-medium text-destructive flex items-center gap-1.5 ml-2">
            <AlertTriangle className="w-4 h-4" /> {pdfError}
          </p>
        )}
      </div>

      {/* AI Narrative */}
      {report.aiNarrative && (
        <Card className="mb-6 border-border/60 shadow-sm rounded-2xl bg-white overflow-hidden">
          <CardHeader className="bg-primary/5 border-b border-primary/10 px-6 py-4">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-primary">
              <ShieldCheck className="w-5 h-5" />
              AI Verified Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 py-6">
            <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap font-medium">
              {report.aiNarrative}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Exclusion opportunities */}
      {report.exclusionOpportunities.length > 0 && (
        <Card className="mb-6 border-amber-200 shadow-sm rounded-2xl bg-amber-50/50 overflow-hidden">
          <CardHeader className="bg-amber-100/50 border-b border-amber-200 px-6 py-4">
            <CardTitle className="text-base font-semibold text-amber-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-600" />
              Actionable Exclusion Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 py-5">
            <ul className="space-y-3">
              {report.exclusionOpportunities.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-amber-950 font-medium bg-white/60 p-3 rounded-xl border border-amber-100">
                  <div className="w-6 h-6 rounded-full bg-amber-200/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-amber-700 font-bold text-xs">{i + 1}</span>
                  </div>
                  <span className="pt-0.5 leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6 border-border/60 shadow-sm rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-border/30 px-6 py-4 bg-muted/20">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Inspection Evidence
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 py-5">
          <EvidenceGallery inspectionId={report.inspectionId} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Findings */}
        {findings.length > 0 && (
          <Card className="border-border/60 shadow-sm rounded-2xl bg-white overflow-hidden h-full flex flex-col">
            <CardHeader className="border-b border-border/30 px-6 py-4 bg-muted/20">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Info className="w-5 h-5 text-muted-foreground" />
                Raw Findings ({findings.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 py-5 flex-1">
              <ul className="space-y-4">
                {findings.map((f, i) => (
                  <li key={i} className="relative pl-5 before:absolute before:left-0 before:top-1.5 before:bottom-1 before:w-1 before:bg-primary/20 before:rounded-full pb-1">
                    {f.zone && (
                      <span className="block text-[11px] font-bold text-primary uppercase tracking-widest mb-1">
                        {f.zone}
                      </span>
                    )}
                    {f.description && (
                      <p className="text-sm text-foreground leading-relaxed">{f.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <Card className="border-border/60 shadow-sm rounded-2xl bg-white overflow-hidden h-full flex flex-col">
            <CardHeader className="border-b border-border/30 px-6 py-4 bg-muted/20">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 py-5 flex-1">
              <ul className="space-y-3">
                {recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-foreground">
                    <div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                    <span className="pt-0.5 leading-relaxed">{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
