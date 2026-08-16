import { useState } from 'react';
import { useListProperties, useGetInfestationRisk } from '@workspace/api-client-react';
import { Loader2, Building, AlertTriangle, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { BuildingMessagingPanel } from '@/components/BuildingMessagingPanel';

export function Properties() {
  const { data: properties, isLoading: isLoadingProps } = useListProperties();
  const { data: risk, isLoading: isLoadingRisk } = useGetInfestationRisk();
  const [messagingAddress, setMessagingAddress] = useState<string | null>(null);
  const [messagingClientName, setMessagingClientName] = useState<string | null>(null);

  const isLoading = isLoadingProps || isLoadingRisk;

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
    {messagingAddress && (
      <BuildingMessagingPanel
        address={messagingAddress}
        clientName={messagingClientName}
        onClose={() => { setMessagingAddress(null); setMessagingClientName(null); }}
      />
    )}
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        <p className="text-muted-foreground mt-1">Property risk profiles and historical trends.</p>
      </div>

      {risk && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-center items-center text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
              risk.overallRisk === 'high' ? 'bg-destructive/10 text-destructive' :
              risk.overallRisk === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
              'bg-green-500/10 text-green-500'
            }`}>
              <AlertTriangle className="w-8 h-8" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Overall Portfolio Risk</p>
            <p className="text-2xl font-bold mt-1 capitalize">{risk.overallRisk}</p>
          </div>

          <div className="md:col-span-2 bg-card border border-border rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Risk by Pest Type</h3>
            <div className="space-y-4">
              {risk.riskByPestType.map((r, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-32 text-sm font-medium capitalize truncate">{r.pestType}</div>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${
                      r.riskLevel === 'high' ? 'bg-destructive' :
                      r.riskLevel === 'medium' ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`} style={{ width: `${Math.min(100, r.count * 10)}%` }} />
                  </div>
                  <div className="w-12 text-right text-sm font-bold">{r.count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h2 className="font-semibold">Properties</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Property</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Last Inspected</th>
                <th className="px-6 py-4 text-center">Visits</th>
                <th className="px-6 py-4 text-center">Open Issues</th>
                <th className="px-6 py-4 text-center">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {properties?.map((prop) => (
                <tr key={prop.addressKey} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-foreground flex items-center gap-2">
                      <Building className="w-4 h-4 text-primary shrink-0" />
                      {prop.siteAddress}
                    </div>
                    {prop.clientName && (
                      <div className="text-xs text-muted-foreground mt-0.5 ml-6">{prop.clientName}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 capitalize text-muted-foreground">
                    {prop.propertyType.replace('_', ' ')}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {prop.lastVisit ? format(new Date(prop.lastVisit), 'MMM d, yyyy') : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-muted text-muted-foreground text-xs font-medium">
                      {prop.inspectionCount}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {prop.openIssueCount > 0 ? (
                      <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-destructive/10 text-destructive text-xs font-medium">
                        {prop.openIssueCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => {
                        setMessagingAddress(prop.siteAddress);
                        setMessagingClientName(prop.clientName ?? null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                      title="Open message thread"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Message
                    </button>
                  </td>
                </tr>
              ))}
              {!properties?.length && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No properties tracked yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </>
  );
}
