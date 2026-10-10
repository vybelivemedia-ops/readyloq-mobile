/**
 * Client Portal — read-only view for property managers.
 *
 * Shows approved inspection reports grouped by building. Property managers
 * see only the siteAddresses their access grant covers, enforced on the server
 * via clientPortalAccessTable. No internal company data (team, analytics,
 * schedule) is exposed here.
 */
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useClientBuildings, useClientReports } from '@/hooks/use-client-portal';
import { apiUrl } from '@/config';
import {
  Building2,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Bug,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  low:      'bg-green-100 text-green-700 border-green-200',
};

function severityClass(sev: string | null) {
  return SEVERITY_BADGE[(sev ?? '').toLowerCase()] ?? 'bg-slate-100 text-slate-700 border-slate-200';
}

const PEST_COLORS: Record<string, string> = {
  rodent:  'bg-red-100 text-red-700',
  roach:   'bg-orange-100 text-orange-700',
  ant:     'bg-yellow-100 text-yellow-700',
  termite: 'bg-amber-100 text-amber-700',
  bed_bug: 'bg-purple-100 text-purple-700',
  fly:     'bg-blue-100 text-blue-700',
  mosquito:'bg-teal-100 text-teal-700',
};

function pestColor(pest: string) {
  return PEST_COLORS[pest.toLowerCase().replace(/\s+/g, '_')] ?? 'bg-slate-100 text-slate-700';
}

// ── Building row (accordion) ──────────────────────────────────────────────────

function BuildingRow({ address, companyName }: { address: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const { data: reports, isLoading, error } = useClientReports(open ? address : '');

  return (
    <Card className="border-border">
      {/* Building header — click to expand */}
      <CardHeader
        className="cursor-pointer select-none py-4 px-5"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold text-foreground truncate">
                {address}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Serviced by {companyName}
              </p>
            </div>
          </div>
          {open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 pb-4 px-5">
          <div className="border-t border-border pt-4">
            {isLoading && (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive py-3">
                <AlertTriangle className="w-4 h-4" />
                Failed to load reports: {(error as Error).message}
              </div>
            )}

            {!isLoading && !error && reports?.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center">
                <FileText className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm font-medium text-foreground">No approved reports yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Reports appear here once your provider approves them.
                </p>
              </div>
            )}

            {!isLoading && !error && reports && reports.length > 0 && (
              <div className="space-y-3">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="rounded-lg border border-border bg-card/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* Title + severity */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground truncate">
                            {report.title}
                          </span>
                          {report.severity && (
                            <span
                              className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${severityClass(report.severity)}`}
                            >
                              {report.severity}
                            </span>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            <CheckCircle className="w-3 h-3 mr-1 text-green-500" />
                            Approved
                          </Badge>
                        </div>

                        {/* Meta */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                          {report.inspectionDate && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3.5 h-3.5" />
                              {format(new Date(report.inspectionDate), 'MMM d, yyyy')}
                            </span>
                          )}
                          {report.technicianName && (
                            <span className="text-xs text-muted-foreground">
                              By {report.technicianName}
                            </span>
                          )}
                        </div>

                        {/* Exclusion opportunities */}
                        {report.exclusionOpportunities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {report.exclusionOpportunities.slice(0, 3).map((opp, idx) => (
                              <span
                                key={idx}
                                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${pestColor(opp)}`}
                              >
                                <Bug className="w-3 h-3" />
                                {opp}
                              </span>
                            ))}
                            {report.exclusionOpportunities.length > 3 && (
                              <span className="text-xs text-muted-foreground self-center">
                                +{report.exclusionOpportunities.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions — preview served via the scoped client endpoint */}
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => setPreviewId(report.id)}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}

      {/* Report preview dialog */}
      <Dialog open={previewId != null} onOpenChange={(open) => !open && setPreviewId(null)}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
            <DialogTitle className="text-base">Inspection Report</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {previewId != null && (
              <iframe
                src={apiUrl(`/client/reports/${previewId}/html`)}
                className="w-full h-full border-0"
                title="Report preview"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ClientPortal() {
  const { me } = useAuth();
  const { data: buildings, isLoading, error } = useClientBuildings();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">My Reports</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {me?.company
            ? `Inspection reports from ${me.company.name}`
            : 'Your approved inspection reports'}
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your properties…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive mb-3" />
          <p className="font-medium text-foreground">Failed to load properties</p>
          <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && buildings?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="font-medium text-foreground">No properties assigned yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Your pest control provider will link your buildings to this account. Check back after your next inspection.
          </p>
        </div>
      )}

      {/* Buildings list */}
      {!isLoading && !error && buildings && buildings.length > 0 && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-6 px-1 mb-2">
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{buildings.length}</span>{' '}
              {buildings.length === 1 ? 'property' : 'properties'}
            </span>
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {buildings.reduce((n, b) => n + b.completedInspections, 0)}
              </span>{' '}
              completed inspections
            </span>
          </div>

          {buildings.map((b) => (
            <BuildingRow
              key={b.siteAddress}
              address={b.siteAddress}
              companyName={me?.company?.name ?? 'your provider'}
            />
          ))}
        </div>
      )}
    </div>
  );
}
