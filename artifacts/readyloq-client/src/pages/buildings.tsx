import { useClientBuildings } from '@/hooks/use-client-portal';
import { useClientAuth } from '@/hooks/use-client-auth';
import { Link } from 'wouter';
import { Building2, ChevronRight, AlertTriangle, CheckCircle, Clock, Bug, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';

const PEST_COLORS: Record<string, string> = {
  rodent: 'bg-red-50 text-red-700 border-red-200',
  roach: 'bg-orange-50 text-orange-700 border-orange-200',
  ant: 'bg-amber-50 text-amber-700 border-amber-200',
  termite: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  bed_bug: 'bg-purple-50 text-purple-700 border-purple-200',
  fly: 'bg-blue-50 text-blue-700 border-blue-200',
  mosquito: 'bg-teal-50 text-teal-700 border-teal-200',
};

function pestColor(pest: string) {
  return PEST_COLORS[pest.toLowerCase().replace(/\\s+/g, '_')] ?? 'bg-slate-50 text-slate-700 border-slate-200';
}

export function Buildings() {
  const { me } = useClientAuth();
  const { data: buildings, isLoading, error } = useClientBuildings();

  return (
    <div className="p-4 md:p-8 lg:p-10 max-w-5xl mx-auto min-h-full">
      {/* Header */}
      <div className="mb-8 md:mb-12">
        <div className="flex items-center gap-2 mb-2 text-primary">
          <ShieldCheck className="w-5 h-5" />
          <span className="text-sm font-semibold tracking-wider uppercase">Verified Intelligence</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight mb-2">
          Portfolio Overview
        </h1>
        <p className="text-muted-foreground text-base max-w-2xl">
          {me?.company
            ? `Monitored and verified by ${me.company.name}. Select a property to review evidence, AI insights, and technician findings.`
            : 'Review evidence, AI insights, and technician findings for your properties.'}
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[140px] w-full rounded-2xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-3xl border border-border/50 shadow-sm">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <p className="font-semibold text-lg text-foreground">Failed to load portfolio</p>
          <p className="text-sm text-muted-foreground max-w-sm mt-1">{(error as Error).message}</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && buildings?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-white rounded-3xl border border-border/50 shadow-sm">
          <div className="w-16 h-16 bg-muted/50 rounded-2xl flex items-center justify-center mb-5">
            <Building2 className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <p className="font-semibold text-lg text-foreground">No active properties</p>
          <p className="text-sm text-muted-foreground max-w-md mt-2">
            Verified inspections will appear here once your ReadyLoq provider completes their first site visit and submits evidence.
          </p>
        </div>
      )}

      {/* Buildings list */}
      {!isLoading && !error && buildings && buildings.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {buildings.map((b) => (
            <Link key={b.siteAddress} href={`/buildings/${encodeURIComponent(b.siteAddress)}`}>
              <Card
                className="hover:shadow-md hover:border-primary/30 transition-all duration-300 cursor-pointer border-border/60 bg-white/60 hover:bg-white backdrop-blur-sm group overflow-hidden rounded-2xl"
                data-testid={`card-building-${b.siteAddress}`}
              >
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row md:items-center">

                    {/* Primary Info Zone */}
                    <div className="p-6 flex-1 flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/10 group-hover:scale-105 group-hover:bg-primary group-hover:text-white transition-all duration-300 group-hover:shadow-md group-hover:shadow-primary/20">
                        <Building2 className="w-6 h-6 text-primary group-hover:text-white transition-colors" />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <h3 className="font-semibold text-lg text-foreground truncate tracking-tight group-hover:text-primary transition-colors">
                          {b.siteAddress}
                        </h3>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                            <span className="font-medium text-foreground">{b.completedInspections}</span>
                            {b.completedInspections === 1 ? 'inspection' : 'inspections'}
                          </span>

                          {b.lastVisitedAt && (
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Clock className="w-4 h-4 opacity-70" />
                              Visited {formatDistanceToNow(new Date(b.lastVisitedAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Meta / Findings Zone */}
                    <div className="px-6 py-4 md:py-6 md:w-[320px] bg-muted/20 md:border-l border-t md:border-t-0 border-border/50 flex flex-col justify-center">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detected Activity</span>
                        <ChevronRight className="w-5 h-5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>

                      {b.pestTypes.length > 0 ? (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {b.pestTypes.slice(0, 3).map((p) => (
                            <span
                              key={p}
                              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border font-medium ${pestColor(p)}`}
                            >
                              <Bug className="w-3 h-3 opacity-70" />
                              {p}
                            </span>
                          ))}
                          {b.pestTypes.length > 3 && (
                            <span className="inline-flex items-center text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600 font-medium">
                              +{b.pestTypes.length - 3} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-1 text-sm text-emerald-600">
                          <ShieldCheck className="w-4 h-4" />
                          <span>No recent activity</span>
                        </div>
                      )}
                    </div>

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
