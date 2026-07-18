import { useParams } from "wouter";
import { useGetReport, useGenerateReportNarrative, getGetReportQueryKey, type AiReportNarrative } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, FileText, MapPin, User, Calendar, AlertTriangle, CheckCircle2, ShieldCheck, Lightbulb, Download, Eye, Lock, Users, Sparkles, RefreshCw, ClipboardCheck } from "lucide-react";
import { Link } from "wouter";
import { FindingConfidenceRow } from "@/components/finding-confidence-chips";
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { pdf } from "@react-pdf/renderer";
import { PDFViewer } from "@react-pdf/renderer";
import { ReportPDF, type ReportMode } from "@/components/report-pdf";
import { useReportPdfData } from "@/hooks/use-report-pdf-data";

function FindingSeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-slate-500" };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[severity] ?? colors.low} shrink-0 mt-1.5`} />;
}

function ProseSection({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  if (!text) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{text}</p>
      </CardContent>
    </Card>
  );
}

function ListSection({ icon: Icon, title, items }: { icon: typeof FileText; title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{it}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AiNarrativeView({ narrative }: { narrative: AiReportNarrative }) {
  return (
    <div className="space-y-5">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI-Generated Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {narrative.propertyType && (
              <span className="px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary font-medium">{narrative.propertyType}</span>
            )}
            {narrative.generatedAt && (
              <span className="text-muted-foreground">Generated {new Date(narrative.generatedAt).toLocaleString()}</span>
            )}
          </div>
          {narrative.executiveSummary && (
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{narrative.executiveSummary}</p>
          )}
        </CardContent>
      </Card>

      <ProseSection icon={FileText} title="Inspection Findings" text={narrative.inspectionFindings} />
      <ProseSection icon={Eye} title="Evidence Observed" text={narrative.evidenceObserved} />
      <ProseSection icon={AlertTriangle} title="Pest Activity Assessment" text={narrative.pestActivityAssessment} />
      <ProseSection icon={ShieldCheck} title="Structural Deficiencies" text={narrative.structuralDeficiencies} />
      <ProseSection icon={AlertTriangle} title="Conducive Conditions" text={narrative.conduciveConditions ?? ""} />
      <ProseSection icon={Lightbulb} title="Sanitation Concerns" text={narrative.sanitationConcerns} />
      <ListSection icon={CheckCircle2} title="Recommended Corrective Actions" items={narrative.recommendedCorrectiveActions} />
      <ListSection icon={User} title="Customer Recommendations" items={narrative.customerRecommendations ?? []} />
      <ListSection icon={ShieldCheck} title="Monitoring Recommendations" items={narrative.monitoringRecommendations} />
      <ProseSection icon={Calendar} title="Follow-Up Schedule" text={narrative.followUpSchedule} />
      <ProseSection icon={User} title="Technician Notes" text={narrative.technicianNotes} />

      {narrative.managerReviewNotes && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-400">
              <ClipboardCheck className="h-4 w-4" /> Manager Review Notes
              <span className="ml-1 text-[10px] uppercase tracking-wide font-semibold text-amber-500/80">Internal</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{narrative.managerReviewNotes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ReportDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const { data: report, isLoading } = useGetReport(id);

  const [mode, setMode] = useState<ReportMode>("customer");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { report: pdfReport, inspection, branding, propertyFeed, isReady } = useReportPdfData(
    isLoading ? null : id,
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const generateNarrative = useGenerateReportNarrative();

  const handleGenerateNarrative = useCallback(async () => {
    const wasRegenerate = !!report?.aiNarrative;
    try {
      await generateNarrative.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
      toast({ title: wasRegenerate ? "Report regenerated" : "AI report generated" });
    } catch {
      toast({ title: "Error", description: "Failed to generate AI report.", variant: "destructive" });
    }
  }, [generateNarrative, id, queryClient, report?.aiNarrative, toast]);

  const handleDownload = useCallback(async () => {
    if (!isReady || !pdfReport || !inspection || !branding) return;
    setGenerating(true);
    try {
      const blob = await pdf(
        <ReportPDF
          report={pdfReport}
          inspection={inspection}
          branding={branding}
          propertyFeed={propertyFeed}
          mode={mode}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pdfReport.title ?? "inspection-report"}-${mode}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  }, [isReady, pdfReport, inspection, branding, propertyFeed, mode]);

  if (isLoading) return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );

  if (!report) return <div className="text-center py-16 text-muted-foreground">Report not found.</div>;

  const findings = report.findings ?? [];
  const recommendations = report.recommendations ?? [];
  const exclusionOpportunities = report.exclusionOpportunities ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/reports">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{report.title}</h1>
          <p className="text-muted-foreground text-sm">Report #{report.id}</p>
        </div>

        {/* Mode selector + PDF actions */}
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-border/60 bg-card overflow-hidden">
            <button
              onClick={() => setMode("customer")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "customer"
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-3 w-3" />
              Customer
            </button>
            <button
              onClick={() => setMode("internal")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "internal"
                  ? "bg-amber-500 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Lock className="h-3 w-3" />
              Internal
            </button>
          </div>

          {report.aiNarrative && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleGenerateNarrative}
              disabled={generateNarrative.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${generateNarrative.isPending ? "animate-spin" : ""}`} />
              {generateNarrative.isPending ? "Regenerating…" : "Regenerate"}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setPreviewOpen(true)}
            disabled={!isReady}
          >
            <Eye className="h-4 w-4" /> Preview
          </Button>

          <Button
            size="sm"
            className="gap-2"
            onClick={handleDownload}
            disabled={!isReady || generating}
          >
            <Download className="h-4 w-4" />
            {generating ? "Generating…" : "Download PDF"}
          </Button>
        </div>
      </div>

      {/* Mode hint */}
      {mode === "internal" && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-400">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Internal report includes property intelligence, service history, hotspots, recurring issues, and management insights.
        </div>
      )}

      {/* Report Header */}
      <Card className="bg-card border-border">
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold">Pest Control Service Report</h2>
              <div className="flex items-center gap-2 mt-1">
                {report.severity && (
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                    report.severity === "critical" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                    report.severity === "high" ? "bg-orange-500/15 text-orange-400 border-orange-500/30" :
                    "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  }`}>{report.severity} severity</span>
                )}
                <span className="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30 font-medium">{report.status}</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-6 w-6 text-primary" />
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Site Address</p>
                <p className="font-medium">{report.siteAddress}</p>
              </div>
            </div>
            {report.clientName && (
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Client</p>
                  <p className="font-medium">{report.clientName}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Technician</p>
                <p className="font-medium">{report.technicianName}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Inspection Date</p>
                <p className="font-medium">{report.inspectionDate ? new Date(report.inspectionDate).toLocaleDateString() : "—"}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI-Generated Narrative Report */}
      {report.aiNarrative ? (
        <AiNarrativeView narrative={report.aiNarrative} />
      ) : (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Generate AI Report</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Turn this inspection's findings, photos, and field notes into a professional, multi-section narrative report.
              </p>
            </div>
            <Button onClick={handleGenerateNarrative} disabled={generateNarrative.isPending} className="gap-2">
              <Sparkles className="h-4 w-4" />
              {generateNarrative.isPending ? "Generating…" : "Generate AI Report"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Findings */}
      {findings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Findings ({findings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {findings.map((f: any) => (
              <div key={f.id} className="flex gap-3 text-sm">
                <FindingSeverityDot severity={f.severity} />
                <div className="flex-1 space-y-1.5">
                  <div>
                    <span className="font-medium">{f.category}</span>
                    {f.location && <span className="text-muted-foreground"> · {f.location}</span>}
                    <p className="text-muted-foreground mt-0.5">{f.description}</p>
                  </div>
                  <FindingConfidenceRow finding={f} reportStatus={report.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" /> Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Treatment Notes / Technician Observations */}
      {report.treatmentNotes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-400" /> Technician Observations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{report.treatmentNotes}</p>
          </CardContent>
        </Card>
      )}

      {/* Exclusion Opportunities */}
      {exclusionOpportunities.length > 0 && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-400" /> Exclusion Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {exclusionOpportunities.map((opp, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-blue-400 shrink-0">•</span>
                  <span className="text-muted-foreground">{opp}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Signature Area */}
      <Card className="border-dashed">
        <CardContent className="py-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-6">Technician Signature</p>
              <div className="border-b border-border" />
              <p className="text-xs text-muted-foreground mt-1">{report.technicianName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-6">Client Signature</p>
              <div className="border-b border-border" />
              <p className="text-xs text-muted-foreground mt-1">Date: {report.inspectionDate ? new Date(report.inspectionDate).toLocaleDateString() : "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PDF Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl w-full h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base">
                PDF Preview — {mode === "customer" ? "Customer Report" : "Internal Report"}
              </DialogTitle>
              <Button
                size="sm"
                className="gap-2 mr-8"
                onClick={() => { handleDownload(); setPreviewOpen(false); }}
                disabled={generating}
              >
                <Download className="h-3.5 w-3.5" />
                {generating ? "Generating…" : "Download"}
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {isReady && pdfReport && inspection && branding && previewOpen ? (
              <PDFViewer width="100%" height="100%" showToolbar={false} style={{ border: "none" }}>
                <ReportPDF
                  report={pdfReport}
                  inspection={inspection}
                  branding={branding}
                  propertyFeed={propertyFeed}
                  mode={mode}
                />
              </PDFViewer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Loading report data…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
