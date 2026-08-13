import { useClientBuildings } from '@/hooks/use-client-portal';
import { useClientAuth } from '@/hooks/use-client-auth';
import { Link } from 'wouter';
import { Building2, ChevronRight, AlertTriangle, CheckCircle, Clock, Bug } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';

const PEST_COLORS: Record<string, string> = {
  rodent: 'bg-red-100 text-red-700',
  roach: 'bg-orange-100 text-orange-700',
  ant: 'bg-yellow-100 text-yellow-700',
  termite: 'bg-amber-100 text-amber-700',
  bed_bug: 'bg-purple-100 text-purple-700',
  fly: 'bg-blue-100 text-blue-700',
  mosquito: 'bg-teal-100 text-teal-700',
};

function pestColor(pest: string) {
  return PEST_COLORS[pest.toLowerCase().replace(/\s+/g, '_')] ?? 'bg-slate-100 text-slate-700';
}

export function Buildings() {
  const { me } = useClientAuth();
  const { data: buildings, isLoading, error } = useClientBuildings();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">My Buildings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {me?.company
            ? `Serviced by ${me.company.name}`
            : 'Pest inspection history for your properties'}
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive mb-3" />
          <p className="font-medium text-foreground">Failed to load buildings</p>
          <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && buildings?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="font-medium text-foreground">No buildings yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Inspections will appear here once your pest control company has completed a visit.
          </p>
        </div>
      )}

      {/* Buildings list */}
      {!isLoading && !error && buildings && buildings.length > 0 && (
        <div className="space-y-4">
          {buildings.map((b) => (
            <Link key={b.siteAddress} href={`/buildings/${encodeURIComponent(b.siteAddress)}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-border group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-foreground truncate">{b.siteAddress}</h3>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {/* Stats */}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                            {b.completedInspections} inspection{b.completedInspections !== 1 ? 's' : ''}
                          </span>
                          {b.lastVisitedAt && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3.5 h-3.5" />
                              Last visit{' '}
                              {formatDistanceToNow(new Date(b.lastVisitedAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                        {/* Pest types */}
                        {b.pestTypes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {b.pestTypes.slice(0, 4).map((p) => (
                              <span
                                key={p}
                                className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${pestColor(p)}`}
                              >
                                <Bug className="w-3 h-3" />
                                {p}
                              </span>
                            ))}
                            {b.pestTypes.length > 4 && (
                              <span className="text-xs text-muted-foreground self-center">
                                +{b.pestTypes.length - 4} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
