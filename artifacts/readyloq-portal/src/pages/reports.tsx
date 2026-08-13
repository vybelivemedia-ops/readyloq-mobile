import { useState } from 'react';
import { useListReports } from '@workspace/api-client-react';
import { Loader2, FileText, Download, Eye, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiUrl } from '@/config';

export function Reports() {
  const { data: reports, isLoading } = useListReports();
  const [selectedReport, setSelectedReport] = useState<number | null>(null);

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
                        {report.siteAddress || report.clientName || `Inspection #${report.inspectionId}`}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                        report.status === 'completed' ? 'bg-green-500/10 text-green-500' :
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
