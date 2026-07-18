import { useListAnalysisResults, useGetAnalysisSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Camera, AlertTriangle, ChevronRight } from "lucide-react";

function riskColor(risk: string | null | undefined) {
  if (risk === "critical") return "text-red-400 bg-red-500/10 border-red-500/30";
  if (risk === "high")     return "text-orange-400 bg-orange-500/10 border-orange-500/30";
  if (risk === "medium")   return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  return "text-slate-400 bg-slate-500/10 border-slate-500/30";
}

function confidenceBar(confidence: number | null | undefined) {
  const pct = Math.round((confidence ?? 0) * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-8">{pct}%</span>
    </div>
  );
}

export default function EvidenceList() {
  const { data: results, isLoading } = useListAnalysisResults();
  const { data: summary } = useGetAnalysisSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Evidence</h1>
        <p className="text-muted-foreground text-sm mt-1">Review captured findings from field inspections</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border/60 rounded-2xl">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Records</p>
              <p className="text-2xl font-bold mt-1">{summary.totalAnalyses}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/60 rounded-2xl">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Avg Confidence</p>
              <p className="text-2xl font-bold mt-1 text-primary">{Math.round(summary.avgConfidence * 100)}%</p>
            </CardContent>
          </Card>
          {summary.topFindings.slice(0, 2).map(f => (
            <Card key={f.category} className="bg-card border-border/60 rounded-2xl">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Top: {f.category}</p>
                <p className="text-2xl font-bold mt-1">{f.count}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
        ) : (results ?? []).length === 0 ? (
          <div className="bg-card border border-border/60 rounded-2xl p-10 text-center text-muted-foreground">
            <Camera className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm font-medium">No evidence records yet</p>
            <p className="text-xs mt-1">Complete inspections to capture field evidence</p>
          </div>
        ) : (
          (results ?? []).map(r => (
            <Link key={r.id} href={`/analysis/${r.id}`}>
              <div className="bg-card border border-border/60 rounded-2xl px-4 py-3.5 active:bg-primary/5 transition-all cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Camera className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">Inspection #{r.inspectionId}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${riskColor(r.riskLevel)}`}>
                        {r.riskLevel ?? "pending"} risk
                      </span>
                      {r.feedbackStatus && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {r.feedbackStatus}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      {confidenceBar(r.overallConfidence)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {(r.findings ?? []).length} findings · {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
