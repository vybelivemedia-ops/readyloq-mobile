import { useGetAnalyticsDashboard, useListInspections } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Plus, ClipboardList, BrainCircuit, Activity, AlertTriangle, FileText, ImageIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: dashboard, isLoading: isLoadingDash } = useGetAnalyticsDashboard();
  const { data: inspections, isLoading: isLoadingInsp } = useListInspections({ limit: 5 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of recent activity and system status.</p>
        </div>
        <Link href="/inspections/new">
          <Button className="w-full sm:w-auto shadow-md">
            <Plus className="mr-2 h-4 w-4" />
            New Inspection
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Inspections</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingDash ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-foreground">{dashboard?.totalInspections || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">+{dashboard?.openInspections || 0} open</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Findings</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingDash ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-foreground">{dashboard?.avgFindingsPerInspection?.toFixed(1) || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Per inspection</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AI Confidence</CardTitle>
            <BrainCircuit className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoadingDash ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-primary">
                {dashboard?.avgAiConfidence ? `${Math.round(dashboard.avgAiConfidence * 100)}%` : 'N/A'}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Average accuracy</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reports Generated</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingDash ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold text-foreground">{dashboard?.totalReports || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">All time</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Quick Links */}
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tools and resources</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Link href="/dataset">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2 bg-card hover:bg-muted/50 hover:text-primary transition-colors border-border/60">
                <ImageIcon className="h-6 w-6" />
                <span>Dataset Library</span>
              </Button>
            </Link>
            <Link href="/analysis">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2 bg-card hover:bg-muted/50 hover:text-primary transition-colors border-border/60">
                <BrainCircuit className="h-6 w-6" />
                <span>AI Analysis</span>
              </Button>
            </Link>
            <Link href="/reports">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2 bg-card hover:bg-muted/50 hover:text-primary transition-colors border-border/60">
                <FileText className="h-6 w-6" />
                <span>Reports</span>
              </Button>
            </Link>
            <Link href="/analytics">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2 bg-card hover:bg-muted/50 hover:text-primary transition-colors border-border/60">
                <Activity className="h-6 w-6" />
                <span>Analytics</span>
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Inspections */}
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Recent Inspections</CardTitle>
            <CardDescription>Latest field activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isLoadingInsp ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))
              ) : inspections?.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No inspections found.
                </div>
              ) : (
                inspections?.slice(0, 4).map((inspection) => (
                  <Link key={inspection.id} href={`/inspections/${inspection.id}`} className="block">
                    <div className="flex items-center justify-between p-3 rounded-md border border-transparent hover:border-border hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          inspection.status === 'completed' ? 'bg-emerald-500' :
                          inspection.status === 'in-progress' ? 'bg-amber-500' : 'bg-blue-500'
                        }`} />
                        <div className="truncate">
                          <p className="text-sm font-medium leading-none truncate">{inspection.siteAddress}</p>
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {inspection.technicianName} • {new Date(inspection.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded">
                          {inspection.findingsCount || 0} findings
                        </span>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <Link href="/inspections">
                <Button variant="ghost" className="w-full text-sm text-primary hover:text-primary/80">
                  View All Inspections
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
