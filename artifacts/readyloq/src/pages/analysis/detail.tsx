import { useParams } from "wouter";
import { useGetAnalysisResult, useSubmitAnalysisFeedback } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BrainCircuit, AlertTriangle, CheckCircle2, XCircle, HelpCircle, Lightbulb, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { EvidenceQualityChip, VerificationChip } from "@/components/finding-confidence-chips";
import { deriveVerificationStatus } from "@/lib/finding-confidence";
import { getVerificationChecks } from "@/lib/verification-kb";
import { useCoaching } from "@/hooks/use-coaching";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  const label = pct >= 80 ? "High" : pct >= 60 ? "Medium" : "Low";
  const labelColor = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold ${labelColor} w-12 text-right`}>{pct}% {label}</span>
    </div>
  );
}

function severityIcon(severity: string) {
  if (severity === "critical") return <AlertTriangle className="h-4 w-4 text-red-400" />;
  if (severity === "high") return <AlertTriangle className="h-4 w-4 text-orange-400" />;
  return <AlertTriangle className="h-4 w-4 text-amber-400" />;
}

export default function AnalysisDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const { toast } = useToast();

  const { data: result, isLoading, refetch } = useGetAnalysisResult(id, { query: { enabled: !!id } });
  const submitFeedback = useSubmitAnalysisFeedback();
  const { coachingEnabled } = useCoaching();

  const handleFeedback = async (status: string) => {
    try {
      await submitFeedback.mutateAsync({ id, data: { feedbackStatus: status } });
      refetch();
      toast({ title: "Feedback submitted", description: `Marked as "${status}"` });
    } catch {
      toast({ title: "Error", description: "Failed to submit feedback.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!result) {
    return <div className="text-center py-16 text-muted-foreground">Analysis not found.</div>;
  }

  const findings = result.findings ?? [];
  const recommendations = result.recommendations ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/analysis">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Analysis #{result.id}</h1>
          <p className="text-muted-foreground text-sm">Inspection #{result.inspectionId}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-primary">{Math.round((result.overallConfidence ?? 0) * 100)}%</p>
          <p className="text-xs text-muted-foreground">AI Confidence</p>
        </div>
      </div>

      {/* Summary */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">Overall Risk:</span>
              <span className={`text-sm font-bold ${result.riskLevel === 'critical' ? 'text-red-400' : result.riskLevel === 'high' ? 'text-orange-400' : result.riskLevel === 'medium' ? 'text-amber-400' : 'text-slate-400'}`}>
                {result.riskLevel ?? "Unknown"}
              </span>
            </div>
            <div className="ml-auto text-sm text-muted-foreground">{findings.length} findings identified</div>
          </div>
          <div className="mt-3">
            <ConfidenceBar value={result.overallConfidence ?? 0} />
          </div>
        </CardContent>
      </Card>

      {/* Technician Feedback */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Technician Feedback</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.feedbackStatus && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Current status:</span>
              <span className="font-medium text-foreground">{result.feedbackStatus}</span>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => handleFeedback("confirmed")} disabled={submitFeedback.isPending}>
              <CheckCircle2 className="h-4 w-4" /> Confirm Findings
            </Button>
            <Button variant="outline" size="sm" className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={() => handleFeedback("disputed")} disabled={submitFeedback.isPending}>
              <XCircle className="h-4 w-4" /> Dispute
            </Button>
            <Button variant="outline" size="sm" className="gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={() => handleFeedback("needs-review")} disabled={submitFeedback.isPending}>
              <HelpCircle className="h-4 w-4" /> Need Review
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Findings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Findings ({findings.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No findings recorded.</p>
          ) : findings.map((f: any) => (
            <div key={f.id} className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
              <div className="flex items-start gap-2">
                {severityIcon(f.severity)}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{f.category}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      f.severity === 'critical' ? 'bg-red-500/15 text-red-400' :
                      f.severity === 'high' ? 'bg-orange-500/15 text-orange-400' : 'bg-amber-500/15 text-amber-400'}`}>
                      {f.severity}
                    </span>
                    {/* RLQ-003: confidence-gated species label */}
                    {f.confidenceLabel === 'identified' && f.species && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                        {f.species}
                      </span>
                    )}
                    {f.confidenceLabel === 'possible' && f.species && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                        {f.species}
                      </span>
                    )}
                    {f.confidenceLabel === 'unidentified' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        Unable to identify
                      </span>
                    )}
                    {/* RLQ-001: technician correction */}
                    {f.reviewStatus === 'corrected' && f.technicianSpecies && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">
                        Tech: {f.technicianSpecies}
                      </span>
                    )}
                    {/* RLQ-001: review status badge */}
                    {f.reviewStatus && f.reviewStatus !== 'pending' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        f.reviewStatus === 'accepted' ? 'bg-emerald-500/10 text-emerald-400' :
                        f.reviewStatus === 'corrected' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-muted text-muted-foreground'}`}>
                        {f.reviewStatus === 'accepted' ? '✓ Accepted' :
                         f.reviewStatus === 'corrected' ? '✎ Corrected' : '✗ Dismissed'}
                      </span>
                    )}
                    {f.exclusionOpportunity && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">Exclusion</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
                  {f.location && <p className="text-xs text-muted-foreground">Location: {f.location}</p>}
                </div>
              </div>
              <ConfidenceBar value={f.confidence} />
              {/* RLQ-002: alternative candidate species from the model */}
              {Array.isArray(f.candidates) && f.candidates.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Other candidates:</span>
                  {f.candidates.slice(1).map((c: { species: string; confidence: number }, i: number) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {c.species} ({Math.round(c.confidence * 100)}%)
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <EvidenceQualityChip finding={f} />
                <VerificationChip status={deriveVerificationStatus({ feedbackStatus: result.feedbackStatus })} />
              </div>
              {coachingEnabled && (
                <div className="rounded bg-background/50 border border-border/60 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Verification suggestions
                  </div>
                  <ul className="space-y-1">
                    {getVerificationChecks(f.category).map((check: string, i: number) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        <span>{check}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {f.treatment && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-background/50 rounded p-2">
                  <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" />
                  <span>{f.treatment}</span>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span className="text-muted-foreground">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
