import { useState } from 'react';
import { useListSalesOpportunities, useListProposals } from '@workspace/api-client-react';
import { Loader2, Filter } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDistanceToNow } from 'date-fns';
import { RouteCalendarModule } from '@/components/RouteCalendarModule';

export function Opportunities() {
  const [status, setStatus] = useState<string>('all');
  const { data: opportunities, isLoading: isLoadingOpp } = useListSalesOpportunities(
    status !== 'all' ? { status } : undefined,
  );
  const { data: proposals, isLoading: isLoadingProp } = useListProposals();

  const isLoading = isLoadingOpp || isLoadingProp;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales Pipeline</h1>
          <p className="text-muted-foreground mt-1">Manage AI-identified opportunities and proposals.</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px] bg-card">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="quoted">Quoted</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <RouteCalendarModule />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border bg-muted/30 flex justify-between items-center">
              <h2 className="font-semibold">Opportunities</h2>
              <span className="text-xs text-muted-foreground">{opportunities?.length ?? 0} found</span>
            </div>

            {isLoadingOpp ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : !opportunities?.length ? (
              <div className="p-12 text-center text-muted-foreground text-sm">No opportunities matching filters.</div>
            ) : (
              <div className="divide-y divide-border overflow-y-auto">
                {opportunities.map(opp => (
                  <div key={opp.id} className="p-5 hover:bg-muted/30 transition-colors">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            opp.status === 'new' ? 'bg-blue-500/10 text-blue-500' :
                            opp.status === 'won' ? 'bg-green-500/10 text-green-500' :
                            opp.status === 'lost' ? 'bg-destructive/10 text-destructive' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {opp.status}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground">{opp.category}</span>
                        </div>
                        <h3 className="font-semibold text-foreground text-lg leading-tight">{opp.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{opp.propertyAddress}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-foreground capitalize">
                          {opp.estimatedValueTier.replace('_', ' ')}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(opp.createdAt))} ago
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border bg-muted/30">
              <h2 className="font-semibold">Recent Proposals</h2>
            </div>

            {isLoadingProp ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : !proposals?.length ? (
              <div className="p-12 text-center text-muted-foreground text-sm">No proposals created yet.</div>
            ) : (
              <div className="divide-y divide-border">
                {proposals.map(prop => (
                  <div key={prop.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div>
                      <p className="font-medium text-sm text-foreground">{prop.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{prop.propertyAddress}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      prop.status === 'accepted' ? 'text-green-500 bg-green-500/10' :
                      prop.status === 'draft' ? 'text-yellow-500 bg-yellow-500/10' :
                      'text-muted-foreground bg-muted'
                    }`}>
                      {prop.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
