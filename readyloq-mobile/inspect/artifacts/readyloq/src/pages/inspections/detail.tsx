import { useParams, useLocation } from "wouter";
import { useGetInspection, useListAnalysisResults, useUpdateInspection } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Camera, Mic, Video, BrainCircuit, FileText, MapPin, User, Calendar, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

function statusColor(status: string) {
  if (status === "completed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (status === "in-progress") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}

/** Format a duration in seconds as m:ss for video playback timestamps. */
function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function severityColor(severity: string | null) {
  if (severity === "critical") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (severity === "high") return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  if (severity === "medium") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

export default function InspectionDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: inspection, isLoading } = useGetInspection(id, { query: { enabled: !!id } });
  const { data: analyses } = useListAnalysisResults({ inspectionId: id }, { query: { enabled: !!id } });

  const updateInspection = useUpdateInspection();

  const handleComplete = async () => {
    try {
      await updateInspection.mutateAsync({ id, data: { status: "completed", completedAt: new Date().toISOString() } });
      toast({ title: "Inspection completed", description: "Status updated successfully." });
    } catch {
      toast({ title: "Error", description: "Failed to update status.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p>Inspection not found.</p>
        <Link href="/inspections"><Button variant="ghost" className="mt-4">Back to Inspections</Button></Link>
      </div>
    );
  }

  const mediaItems = inspection.media ?? [];
  const photos = mediaItems.filter(m => m.mediaType === "photo");
  const videos = mediaItems.filter(m => m.mediaType === "video");
  const voices = mediaItems.filter(m => m.mediaType === "voice");
  const latestAnalysis = analyses?.[analyses.length - 1];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/inspections">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold truncate">{inspection.siteAddress}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor(inspection.status)}`}>
              {inspection.status}
            </span>
            {inspection.severity && (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${severityColor(inspection.severity)}`}>
                {inspection.severity}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">Inspection #{inspection.id}</p>
        </div>
      </div>

      {/* Info Card */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-4 w-4 shrink-0" />
            <span className="truncate">{inspection.technicianName}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4 shrink-0" />
            <span>{new Date(inspection.createdAt).toLocaleDateString()}</span>
          </div>
          {inspection.clientName && (
            <div className="flex items-center gap-2 text-muted-foreground col-span-2">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{inspection.clientName}</span>
            </div>
          )}
          {(inspection.pestTypes?.length ?? 0) > 0 && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Pest Types</p>
              <div className="flex flex-wrap gap-1">
                {(inspection.pestTypes ?? []).map(p => (
                  <span key={p} className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{p}</span>
                ))}
              </div>
            </div>
          )}
          {inspection.notes && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{inspection.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Media Gallery */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Media ({mediaItems.length})</span>
            <Link href="/inspections/new">
              <Button variant="ghost" size="sm" className="text-primary text-xs h-7">+ Add Media</Button>
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mediaItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Camera className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>No media uploaded yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {photos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Camera className="h-3 w-3" /> Photos ({photos.length})
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map(m => (
                      <div key={m.id} className="aspect-square rounded-md overflow-hidden bg-muted">
                        <img src={m.url} alt={m.caption ?? ""} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {videos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Video className="h-3 w-3" /> Videos ({videos.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {videos.map(m => (
                      <div key={m.id} className="rounded-md overflow-hidden bg-card border border-border/60">
                        <video
                          src={m.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full max-h-64 bg-black"
                        />
                        <div className="flex items-center justify-between gap-2 p-2.5">
                          <span className="text-xs truncate">{m.filename ?? m.caption ?? "Inspection video"}</span>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {m.durationSec ? formatClock(m.durationSec) : null}
                            {m.durationSec ? " · " : ""}
                            {new Date(m.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {voices.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Mic className="h-3 w-3" /> Voice Notes ({voices.length})
                  </p>
                  {voices.map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-3 rounded-md bg-emerald-950/20 border border-emerald-900/30">
                      <Mic className="h-4 w-4 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{m.filename ?? "Voice note"}</p>
                        {m.durationSec && <p className="text-xs text-muted-foreground">{m.durationSec}s</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Analysis Panel */}
      {latestAnalysis ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-primary" />
              AI Analysis
              <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary ml-auto">
                {Math.round((latestAnalysis.overallConfidence ?? 0) * 100)}% confidence
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${severityColor(latestAnalysis.riskLevel)}`}>
                {latestAnalysis.riskLevel ?? "unknown"} risk
              </span>
              <span className="text-xs text-muted-foreground">{(latestAnalysis.findings ?? []).length} findings</span>
            </div>
            {(latestAnalysis.findings ?? []).slice(0, 3).map((f: any) => (
              <div key={f.id} className="flex items-start gap-2 text-sm">
                <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${f.severity === 'critical' ? 'text-red-400' : f.severity === 'high' ? 'text-orange-400' : 'text-amber-400'}`} />
                <div>
                  <span className="font-medium">{f.category}: </span>
                  <span className="text-muted-foreground">{f.description}</span>
                </div>
              </div>
            ))}
            <Link href={`/analysis/${latestAnalysis.id}`}>
              <Button variant="outline" size="sm" className="w-full mt-2">View Full Analysis</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-muted-foreground text-sm">
            <BrainCircuit className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No AI analysis yet for this inspection.</p>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {inspection.status !== "completed" && (
          <Button variant="outline" onClick={handleComplete} disabled={updateInspection.isPending} className="flex-1">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Mark Complete
          </Button>
        )}
        <Button className="flex-1" onClick={() => navigate(`/reports?inspectionId=${inspection.id}`)}>
          <FileText className="mr-2 h-4 w-4" />
          Generate Report
        </Button>
      </div>
    </div>
  );
}
