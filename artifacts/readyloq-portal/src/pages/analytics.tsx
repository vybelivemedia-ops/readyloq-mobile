import { useGetAnalyticsDashboard, useGetTechnicianPerformance } from '@workspace/api-client-react';
import { Loader2, PieChart, BarChart2, Activity } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export function Analytics() {
  const { data: dashboard, isLoading: isLoadingDash } = useGetAnalyticsDashboard();
  const { data: techPerf, isLoading: isLoadingTech } = useGetTechnicianPerformance();

  const isLoading = isLoadingDash || isLoadingTech;

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
        <p className="text-muted-foreground mt-1">High-level view of company performance and AI metrics.</p>
      </div>

      {dashboard && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">Total Inspections</p>
              <p className="text-3xl font-bold mt-2">{dashboard.totalInspections}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">Completed</p>
              <p className="text-3xl font-bold mt-2 text-green-500">{dashboard.completedInspections}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">AI Analyses</p>
              <p className="text-3xl font-bold mt-2 text-primary">{dashboard.aiAnalysesCompleted || 0}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">Avg AI Confidence</p>
              <p className="text-3xl font-bold mt-2">
                {dashboard.avgAiConfidence ? `${Math.round(dashboard.avgAiConfidence * 100)}%` : '--'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-muted-foreground" />
                Monthly Inspections
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard.monthlyInspections}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{fontSize: 12}} tickMargin={10} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{fontSize: 12}} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                      itemStyle={{ color: 'hsl(var(--primary))' }}
                    />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={3} dot={{r: 4, fill: 'hsl(var(--primary))'}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-muted-foreground" />
                Top Pest Types
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.topPestTypes} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{fontSize: 12}} stroke="hsl(var(--muted-foreground))" />
                    <YAxis type="category" dataKey="pestType" tick={{fontSize: 12}} tickFormatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)} stroke="hsl(var(--muted-foreground))" width={80} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                      cursor={{fill: 'hsl(var(--muted)/0.5)'}}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {techPerf && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-muted-foreground" />
              Technician Performance
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-4">Technician</th>
                  <th className="px-6 py-4 text-center">Inspections</th>
                  <th className="px-6 py-4 text-center">Avg Findings</th>
                  <th className="px-6 py-4 text-center">AI Confidence</th>
                  <th className="px-6 py-4 text-right">Completion Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {/* TechPerf is normally a list, but the hook returns a single object if it's the current tech, or an array? The API schema says TechnicianPerformance is an object. Wait, useGetTechnicianPerformance returns a single object? Let's treat it as single for now, or wrap in array. */}
                {[techPerf].flat().map((tech, i) => (
                  <tr key={i} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-medium">{tech.technicianName}</td>
                    <td className="px-6 py-4 text-center">{tech.inspectionCount}</td>
                    <td className="px-6 py-4 text-center">{tech.avgFindingsPerInspection.toFixed(1)}</td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{width: `${tech.avgAiConfidence * 100}%`}} />
                        </div>
                        <span className="text-xs">{Math.round(tech.avgAiConfidence * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">
                      {Math.round(tech.completionRate * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
