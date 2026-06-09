import { useParams } from "wouter";
import { useGetReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, FileText, MapPin, User, Calendar, AlertTriangle, CheckCircle2, ShieldCheck, Lightbulb, Download } from "lucide-react";
import { Link } from "wouter";

function FindingSeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-slate-500" };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[severity] ?? colors.low} shrink-0 mt-1.5`} />;
}

export default function ReportDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const { data: report, isLoading } = useGetReport(id, { query: { enabled: !!id } });

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
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" /> Export PDF
        </Button>
      </div>

      {/* Report Header */}
      <Card className="bg-card border-border">
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold">Pest Control Service Report</h2>
              <div className="flex items-center gap-2 mt-1">
                {report.severity && (
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                    report.severity === 'critical' ? 'bg-red-500/15 text-red-400 border-red-500/30' :
                    report.severity === 'high' ? 'bg-orange-500/15 text-orange-400 border-orange-500/30' :
                    'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  }`}>{report.severity} severity</span>
                )}
                <span className="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30 font-medium">{report.status}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="h-6 w-6 text-primary" />
              </div>
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
                <p className="font-medium">{new Date(report.inspectionDate).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
                <div className="flex-1">
                  <span className="font-medium">{f.category}</span>
                  {f.location && <span className="text-muted-foreground"> • {f.location}</span>}
                  <p className="text-muted-foreground mt-0.5">{f.description}</p>
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

      {/* Treatment Notes */}
      {report.treatmentNotes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-400" /> Treatment Notes
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
              <p className="text-xs text-muted-foreground mt-1">Date: {new Date(report.inspectionDate).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
