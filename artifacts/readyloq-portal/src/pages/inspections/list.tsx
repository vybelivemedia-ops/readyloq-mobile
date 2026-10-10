import { useState } from 'react';
import { useListInspections } from '@workspace/api-client-react';
import { Loader2, Filter, PenLine } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getInspectionList } from './list-response';
import { useAuth } from '@/hooks/use-auth';
import { RouteCalendarModule } from '@/components/RouteCalendarModule';

// The portal generated client predates the signature and unit-number columns;
// extend the generated type locally.
interface InspectionSignatureFields {
  signedAt?: string | null;
  ownerNotAvailable?: boolean | null;
  unitNumber?: string | null;
}

function SignatureBadge({ insp }: { insp: InspectionSignatureFields & { status: string } }) {
  const isCompleted = insp.status === 'completed' || insp.status === 'complete';
  if (!isCompleted) return null;
  if (insp.signedAt) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-600">
        <PenLine className="w-3 h-3" /> Signed
      </span>
    );
  }
  if (insp.ownerNotAvailable) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-600">
        <PenLine className="w-3 h-3" /> Declined
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      <PenLine className="w-3 h-3" /> Unsigned
    </span>
  );
}

export function InspectionsList() {
  const [status, setStatus] = useState<string>('all');
  const { me } = useAuth();
  const { data, isLoading } = useListInspections(
    status !== 'all' ? { status } : undefined,
  );
  const inspections = data === undefined ? [] : getInspectionList(data);

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

      {/* /inspections is shared across all four roles; the calendar module only
          renders for technicians here since managers/owners/sales already see
          it on Dashboard/Opportunities. */}
      {me?.effectiveRole === 'technician' ? <RouteCalendarModule showTechnicianNames={false} /> : null}

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
                  <th className="px-6 py-4">Signature</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inspections.map((insp) => {
                  const inspSig = insp as typeof insp & InspectionSignatureFields;
                  return (
                    <tr key={insp.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{insp.siteAddress}</div>
                        {inspSig.unitNumber && (
                          <div className="text-xs font-medium text-primary/80 mt-0.5">Unit {inspSig.unitNumber}</div>
                        )}
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
                        {format(new Date(insp.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </td>
                      <td className="px-6 py-4">
                        <SignatureBadge insp={{ ...inspSig, status: insp.status }} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/inspections/${insp.id}`} className="text-primary font-medium hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
