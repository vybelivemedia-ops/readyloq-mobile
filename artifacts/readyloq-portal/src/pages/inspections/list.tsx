import { useState } from 'react';
import { useListInspections } from '@workspace/api-client-react';
import { Loader2, Filter } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function InspectionsList() {
  const [status, setStatus] = useState<string>('all');
  const { data: inspections, isLoading } = useListInspections(
    status !== 'all' ? { status } : undefined,
  );

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground mt-1">Manage field reports and analysis.</p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px] bg-card">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !inspections || inspections.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No inspections found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-4">Site / Client</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Technician</th>
                  <th className="px-6 py-4">Pests</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inspections.map((insp) => (
                  <tr key={insp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">{insp.siteAddress}</div>
                      {insp.clientName && <div className="text-muted-foreground mt-0.5 text-xs">{insp.clientName}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                        insp.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                        insp.status === 'in_progress' ? 'bg-blue-500/10 text-blue-500' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {insp.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{insp.technicianName}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(insp.pestTypes ?? []).slice(0, 2).map((p, i) => (
                          <span key={i} className="bg-accent text-accent-foreground px-2 py-0.5 rounded text-xs capitalize">{p}</span>
                        ))}
                        {(insp.pestTypes?.length ?? 0) > 2 && (
                          <span className="bg-accent text-accent-foreground px-2 py-0.5 rounded text-xs">
                            +{(insp.pestTypes?.length ?? 0) - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {format(new Date(insp.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/inspections/${insp.id}`} className="text-primary font-medium hover:underline">
                        View
                      </Link>
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
