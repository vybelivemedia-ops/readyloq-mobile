import { useRoute, Link } from 'wouter';
import {
  useClientInspections,
  useClientReports,
  useBuildingTrends,
} from '@/hooks/use-client-portal';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  CheckCircle,
  AlertCircle,
  MessageSquare,
  PenLine,
  Activity,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PropertyMessagingWidget } from '@/components/PropertyMessagingWidget';
import { EvidenceGallery } from '@/components/evidence-gallery';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const CHART_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#84cc16', '#f97316',
];

function severityBadge(sev: string | null) {
  if (!sev) return null;
  const cls = SEVERITY_STYLES[sev.toLowerCase()] ?? 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-widest ${cls}`}>
      {sev === 'critical' || sev === 'high' ? <Zap className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
      {sev}
    </span>
  );
}

function TrendChart({ address }: { address: string }) {
  const { data: trends, isLoading } = useBuildingTrends(address);

  if (isLoading) return <Skeleton className="h-[280px] w-full rounded-xl" />;
  if (!trends || trends.pestTrends.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[280px] text-center bg-muted/20 rounded-xl border border-dashed border-border/60">
        <Activity className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-foreground">No telemetry available</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">We need more inspection data to generate trends.</p>
      </div>
    );
  }

  const allMonths = Array.from(
    new Set(trends.inspectionCounts.map((r) => r.month))
  ).sort();
  const allPests = Array.from(
    new Set(trends.pestTrends.map((r) => r.pestType))
  );

  const chartData = allMonths.map((month) => {
    const row: Record<string, string | number> = {
      month: format(new Date(`${month}-01`), 'MMM yyyy'),
    };
    allPests.forEach((pest) => {
      const found = trends.pestTrends.find(
        (r) => r.month === month && r.pestType === pest
      );
      row[pest] = found?.count ?? 0;
    });
    return row;
  });

  return (
    <div className="h-[280px] w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
          <defs>
            {allPests.map((pest, i) => (
              <linearGradient key={`grad-${pest}`} id={`color-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
            itemStyle={{ fontSize: '13px', fontWeight: 500 }}
            labelStyle={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: '10px' }} iconType="circle" />
          {allPests.map((pest, i) => (
            <Area
              key={pest}
              type="monotone"
              dataKey={pest}
              stackId="pests"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              fill={`url(#color-${i})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BuildingDetail() {
  const [, params] = useRoute('/buildings/:address');
  const address = params ? decodeURIComponent(params.address) : '';

  const { data: inspections, isLoading: inspLoading } = useClientInspections(address);
  const { data: reports, isLoading: rptLoading } = useClientReports(address);

  return (
    <div className="p-4 md:p-8 lg:p-10 max-w-5xl mx-auto min-h-full">
      {/* Back nav */}
      <Link href="/">
        <button className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-6 md:mb-8 transition-colors bg-white/60 hover:bg-white px-3 py-1.5 rounded-full border border-border/50 shadow-sm backdrop-blur-sm">
          <ChevronLeft className="w-4 h-4" />
          Back to Portfolio
        </button>
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-white border border-border/50 shadow-sm flex items-center justify-center flex-shrink-0 relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/5"></div>
            <Building2 className="w-7 h-7 text-primary relative z-10" />
          </div>
          <div className="pt-0.5">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight mb-2">{address}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="font-medium text-foreground">{inspections?.filter((i) => i.status === 'completed').length ?? '–'}</span> completed
              </span>
              <span className="opacity-40">•</span>
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 opacity-70" />
                Verified Telemetry
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Pest trend chart */}
      <Card className="mb-8 border-border/60 shadow-sm rounded-2xl overflow-hidden bg-white/60 backdrop-blur-sm">
        <CardHeader className="pb-0 border-b border-border/30 bg-white/50 px-6 py-5">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            12-Month Activity Telemetry
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6 bg-white">
          <TrendChart address={address} />
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="reports" className="w-full">
        <TabsList className="mb-6 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="reports" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 py-2 text-sm font-medium">
            Intelligence Reports{reports ? ` (${reports.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="inspections" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 py-2 text-sm font-medium">
            Raw Evidence{inspections ? ` (${inspections.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="messages" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 py-2 text-sm font-medium flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4" />
            Comms
          </TabsTrigger>
        </TabsList>

        {/* Reports tab */}
        <TabsContent value="reports" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
          {rptLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[140px] w-full rounded-2xl" />)}
            </div>
          )}

          {!rptLoading && (!reports || reports.length === 0) && (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-dashed border-border/60">
              <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-semibold text-lg text-foreground">No reports generated</p>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                AI-verified reports will appear here once inspections are approved by your provider.
              </p>
            </div>
          )}

          {!rptLoading && reports && reports.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {reports.map((r) => (
                <Link key={r.id} href={`/reports/${r.id}`}>
                  <Card className="h-full hover:shadow-md hover:border-primary/40 transition-all duration-300 cursor-pointer border-border/60 bg-white group rounded-2xl">
                    <CardContent className="p-5 flex flex-col h-full justify-between gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-base text-foreground tracking-tight line-clamp-2 group-hover:text-primary transition-colors">
                            {r.title}
                          </h3>
                          <div className="flex items-center gap-2 mt-2.5">
                            {severityBadge(r.severity)}
                            {r.exclusionOpportunities.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-bold uppercase tracking-widest">
                                <AlertCircle className="w-3 h-3" />
                                {r.exclusionOpportunities.length} Action{r.exclusionOpportunities.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center group-hover:bg-primary/10 transition-colors flex-shrink-0">
                          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>

                      <div className="pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                            {r.technicianName.charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-foreground">{r.technicianName}</span>
                        </div>
                        {r.inspectionDate && (
                          <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
                            {format(new Date(r.inspectionDate), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Inspections Tab (Raw Evidence) */}
        <TabsContent value="inspections" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
          {inspLoading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px] w-full rounded-2xl" />)}
            </div>
          )}

          {!inspLoading && (!inspections || inspections.length === 0) && (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-dashed border-border/60">
              <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="font-semibold text-lg text-foreground">No raw evidence</p>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                Field evidence and findings will be recorded here during site visits.
              </p>
            </div>
          )}

          {!inspLoading && inspections && inspections.length > 0 && (
            <div className="space-y-4">
              {inspections.map((insp) => (
                <Card key={insp.id} className="border-border/60 shadow-sm bg-white rounded-2xl overflow-hidden relative">
                  {/* Status Indicator Bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${insp.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'}`} />

                  <CardContent className="p-5 pl-7">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <span className="text-base font-semibold text-foreground tracking-tight">
                            {insp.completedAt
                              ? format(new Date(insp.completedAt), "MMMM d, yyyy")
                              : format(new Date(insp.createdAt), "MMMM d, yyyy")}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {insp.completedAt
                              ? format(new Date(insp.completedAt), "h:mm a")
                              : format(new Date(insp.createdAt), "h:mm a")}
                          </span>
                          {severityBadge(insp.severity)}
                        </div>

                        <div className="flex items-center gap-4 text-sm mt-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                              {insp.technicianName.charAt(0)}
                            </div>
                            <span className="font-medium text-foreground">{insp.technicianName}</span>
                          </div>

                          <span className="opacity-30">•</span>

                          <span className={`capitalize font-medium ${insp.status === 'completed' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {insp.status}
                          </span>

                          {insp.findingsCount > 0 && (
                            <>
                              <span className="opacity-30">•</span>
                              <span className="font-medium text-foreground">
                                {insp.findingsCount} finding{insp.findingsCount !== 1 ? 's' : ''}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 md:items-end">
                        {insp.signedAt ? (
                          <div className="flex flex-col gap-1 md:items-end" data-testid={`status-signature-${insp.id}`}>
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200 uppercase tracking-wider">
                              <PenLine className="w-3.5 h-3.5" />
                              Signed {format(new Date(insp.signedAt), 'MMM d, yyyy')}
                            </span>
                            <span className="text-[11px] font-medium text-muted-foreground">
                              {insp.technicianSigned && insp.ownerSigned
                                ? 'Technician + owner'
                                : insp.technicianSigned && insp.ownerNotAvailable
                                  ? 'Technician (owner unavailable)'
                                  : insp.technicianSigned
                                    ? 'Technician only'
                                    : insp.ownerSigned
                                      ? 'Owner only'
                                      : 'Signature on file'}
                            </span>
                          </div>
                        ) : insp.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border bg-amber-50 text-amber-700 border-amber-200 uppercase tracking-wider" data-testid={`status-signature-${insp.id}`}>
                            <PenLine className="w-3.5 h-3.5" />
                            Awaiting signature
                          </span>
                        ) : null}

                        {insp.pestTypes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 justify-end">
                            {insp.pestTypes.map((p) => (
                              <span key={p} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md uppercase tracking-wider border border-slate-200">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-5 border-t border-border/40 pt-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Inspection photos
                      </p>
                      <EvidenceGallery inspectionId={insp.id} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Messages tab */}
        <TabsContent value="messages" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
          <div className="bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden">
            <PropertyMessagingWidget address={address} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
