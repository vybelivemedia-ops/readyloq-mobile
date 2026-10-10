import { useState } from 'react';
import { useListReports } from '@workspace/api-client-react';
import { Loader2, FileText, Eye, Calendar, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiUrl } from '@/config';
import { useAuth } from '@/hooks/use-auth';
import { useApproveReport } from '@/hooks/use-report-approval';

export function Reports() {
  const { data: reports, isLoading } = useListReports();
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<{ id: number; title: string } | null>(null);
  const { me } = useAuth();
  const approveReport = useApproveReport();
  const canApprove = me?.effectiveRole === 'manager' || me?.effectiveRole === 'owner';

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">Generated service and inspection reports.</p>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !reports || reports.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No reports found.
          </div>
        ) : (
          <div>
            {approveReport.isError && (
              <div role="alert" className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {approveReport.error.message}
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-4">Report Details</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Technician</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        {report.title}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        Inspection #{report.inspectionId} · {report.siteAddress || report.clientName || 'Address unavailable'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                        report.status === 'complete' || report.status === 'approved' ? 'bg-green-500/10 text-green-500' :
                        report.status === 'draft' ? 'bg-yellow-500/10 text-yellow-500' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {report.technicianName || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {format(new Date(report.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2" onClick={() => setSelectedReport(report.id)}>
                            <Eye className="w-4 h-4" /> Preview
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden">
                          <DialogHeader className="px-6 py-4 border-b border-border bg-card z-10">
                            <DialogTitle>{report.title}</DialogTitle>
                          </DialogHeader>
                          <div className="flex-1 bg-white relative">
                            {selectedReport === report.id && (
                              <iframe
                                src={apiUrl(`/reports/${report.id}/html`)}
                                className="w-full h-full border-0 absolute inset-0"
                                title="Report Preview"
                              />
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                      {canApprove && report.status === 'complete' && (
                        <Button
                          size="sm"
                          className="gap-2"
                          onClick={() => setApprovalTarget({ id: report.id, title: report.title })}
                          disabled={approveReport.isPending}
                        >
                          <Check className="w-4 h-4" />
                          Approve
                        </Button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
      <AlertDialog
        open={!!approvalTarget}
        onOpenChange={(open) => {
          if (!open && !approveReport.isPending) setApprovalTarget(null);
        }}
      >
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve report for the customer?</AlertDialogTitle>
            <AlertDialogDescription>
              Approving “{approvalTarget?.title}” makes it customer-visible in the customer portal. Confirm only if it is ready to share.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {approveReport.isError && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {approveReport.error.message}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveReport.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                if (approvalTarget) {
                  approveReport.mutate(approvalTarget.id, {
                    onSuccess: () => setApprovalTarget(null),
                  });
                }
              }}
              disabled={!approvalTarget || approveReport.isPending}
            >
              {approveReport.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm approval
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
