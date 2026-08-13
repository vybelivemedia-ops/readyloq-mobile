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
  Clock,
  Bug,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { format, formatDistanceToNow } from 'date-fns';
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
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#84cc16', '#f97316',
];

function severityBadge(sev: string | null) {
  if (!sev) return null;
  const cls = SEVERITY_STYLES[sev.toLowerCase()] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${cls}`}>
      {sev}
    </span>
  );
}

function TrendChart({ address }: { address: string }) {
  const { data: trends, isLoading } = useBuildingTrends(address);

  if (isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (!trends || trends.pestTrends.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
        <Bug className="w-8 h-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">No pest trend data yet</p>
      </div>
    );
  }

  // Pivot: month → { month, [pestType]: count }
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
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {allPests.map((pest, i) => (
          <Area
            key={pest}
            type="monotone"
            dataKey={pest}
            stackId="pests"
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.15}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BuildingDetail() {
  const [, params] = useRoute('/buildings/:address');
  const address = params ? decodeURIComponent(params.address) : '';

  const { data: inspections, isLoading: inspLoading } = useClientInspections(address);
  const { data: reports, isLoading: rptLoading } = useClientReports(address);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back nav */}
      <Link href="/">
        <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ChevronLeft className="w-4 h-4" />
          My Buildings
        </button>
      </Link>

      {/* Header */}
      <div className="flex items-start gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{address}</h1>
          <p className="text-sm text-muted-foreground">
            {inspections?.filter((i) => i.status === 'completed').length ?? '–'} completed
            inspection{inspections?.filter((i) => i.status === 'completed').length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Pest trend chart */}
      <Card className="mb-6 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">12-Month Pest Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart address={address} />
        </CardContent>
      </Card>

      {/* Tabs: Reports | Inspections */}
      <Tabs defaultValue="reports">
        <TabsList className="mb-4">
          <TabsTrigger value="reports">
            Reports{reports ? ` (${reports.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="inspections">
            Inspection History{inspections ? ` (${inspections.length})` : ''}
          </TabsTrigger>
        </TabsList>

        {/* Reports tab */}
        <TabsContent value="reports">
          {rptLoading && (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
            </div>
          )}
          {!rptLoading && (!reports || reports.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">
                No approved reports available yet
              </p>
            </div>
          )}
          {!rptLoading && reports && reports.length > 0 && (
            <div className="space-y-3">
              {reports.map((r) => (
                <Link key={r.id} href={`/reports/${r.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer border-border group">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-foreground text-sm truncate">
                              {r.title}
                            </h3>
                            {severityBadge(r.severity)}
                          </div>
                          <div className="flex flex-wrap gap-3 mt-1">
                            <span className="text-xs text-muted-foreground">
                              {r.technicianName}
                            </span>
                            {r.inspectionDate && (
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(r.inspectionDate), 'MMM d, yyyy')}
                              </span>
                            )}
                            {r.exclusionOpportunities.length > 0 && (
                              <span className="text-xs text-amber-600 font-medium">
                                {r.exclusionOpportunities.length} exclusion
                                {r.exclusionOpportunities.length !== 1 ? 's' : ''} identified
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground flex-shrink-0 mt-0.5" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Inspection history tab */}
        <TabsContent value="inspections">
          {inspLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          )}
          {!inspLoading && (!inspections || inspections.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">No inspections on record yet</p>
            </div>
          )}
          {!inspLoading && inspections && inspections.length > 0 && (
            <div className="space-y-3">
              {inspections.map((insp) => (
                <Card key={insp.id} className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {insp.status === 'completed' ? (
                            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                          ) : (
                            <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium text-foreground">
                            {insp.completedAt
                              ? format(new Date(insp.completedAt), 'MMM d, yyyy')
                              : format(new Date(insp.createdAt), 'MMM d, yyyy')}
                          </span>
                          {severityBadge(insp.severity)}
                        </div>
                        <div className="flex flex-wrap gap-3 mt-1 pl-6">
                          <span className="text-xs text-muted-foreground">{insp.technicianName}</span>
                          <span className="text-xs text-muted-foreground capitalize">{insp.status}</span>
                          {insp.findingsCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {insp.findingsCount} finding{insp.findingsCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {insp.pestTypes.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 pl-6">
                            {insp.pestTypes.map((p) => (
                              <span key={p} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
