import { useListReports, useGenerateReport, useDeleteReport, useListInspections } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileText, Plus, Trash2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListReportsQueryKey } from "@workspace/api-client-react";

function severityBadge(severity: string | null | undefined) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
    high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    low: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  if (!severity) return null;
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colors[severity] ?? colors.low}`}>{severity}</span>;
}

function GenerateReportDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [inspectionId, setInspectionId] = useState("");
  const [title, setTitle] = useState("");
  const generateReport = useGenerateReport();
  const { data: inspections } = useListInspections();
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!inspectionId || !title) {
      toast({ title: "Missing fields", variant: "destructive" });
      return;
    }
    try {
      await generateReport.mutateAsync({ data: { inspectionId: parseInt(inspectionId), title, includeAiFindings: true } });
      toast({ title: "Report generated", description: "Your report has been created." });
      setOpen(false);
      onSuccess();
    } catch {
      toast({ title: "Error", description: "Failed to generate report.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Generate Report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Inspection</Label>
            <Select onValueChange={setInspectionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select inspection..." />
              </SelectTrigger>
              <SelectContent>
                {(inspections ?? []).map(i => (
                  <SelectItem key={i.id} value={String(i.id)}>#{i.id} — {i.siteAddress}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Report Title</Label>
            <Input placeholder="e.g. Monthly Service Report" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <Button className="w-full" onClick={handleGenerate} disabled={generateReport.isPending}>
            {generateReport.isPending ? "Generating..." : "Generate Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsList() {
  const queryClient = useQueryClient();
  const { data: reports, isLoading } = useListReports();
  const deleteReport = useDeleteReport();
  const { toast } = useToast();

  const handleDelete = async (id: number) => {
    try {
      await deleteReport.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      toast({ title: "Report deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete report.", variant: "destructive" });
    }
  };

  const refetch = () => queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">{(reports ?? []).length} reports generated</p>
        </div>
        <GenerateReportDialog onSuccess={refetch} />
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (reports ?? []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No reports yet</p>
            <p className="text-sm mt-1">Generate a report from a completed inspection</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(reports ?? []).map(r => (
            <Card key={r.id} className="bg-card hover:bg-muted/20 transition-colors">
              <CardContent className="py-4 px-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/reports/${r.id}`} className="text-sm font-semibold hover:text-primary transition-colors truncate">{r.title}</Link>
                      {severityBadge(r.severity)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {r.clientName ?? r.siteAddress} • {r.technicianName} • {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{(r.findings ?? []).length} findings • {(r.recommendations ?? []).length} recommendations</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/reports/${r.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
