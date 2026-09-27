import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays,
  History,
  FlaskConical,
  ClipboardCheck,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  useRouteCalendar,
  useRouteOutlook,
  useDailyRigLookup,
  type RouteCalendarDay,
  type RouteCalendarStop,
} from '@/hooks/use-schedule';

const DAYS_AHEAD = 6;

// Route Calendar dates are this BROWSER's own local calendar dates —
// matching `technicianDailyRigsTable.rigDate`, which the mobile daily-rig
// client (see readyloq-app's `todayDateString()`) also writes using local
// device date. `useRouteCalendar`/`useRouteOutlook` send this browser's UTC
// offset so the server buckets/labels every stop's calendarDate in the same
// local frame, keeping the calendar and Route Readiness consistent.
function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayChipLabel(dateStr: string, todayStr: string, tomorrowStr: string): string {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function dayHasFlag(day: RouteCalendarDay): boolean {
  return day.stops.some(
    (s) => s.readiness.dailyRigSetUp === false || s.outlook.overdueCount > 0 || s.outlook.dueSoonCount > 0,
  );
}

/**
 * Integrated Route Calendar — Company Portal module.
 *
 * Renders the next 7 days of scheduled stops with Route Readiness and Route
 * Chemical Outlook flags directly on each entry. Placed near the top of
 * Dashboard, Opportunities, and (technician role only) the Inspections list.
 */
export function RouteCalendarModule({ showTechnicianNames = true }: { showTechnicianNames?: boolean }) {
  const { todayStr, tomorrowStr, endStr } = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const end = new Date(now);
    end.setDate(end.getDate() + DAYS_AHEAD);
    return { todayStr: localDateString(now), tomorrowStr: localDateString(tomorrow), endStr: localDateString(end) };
  }, []);

  const { data, isLoading, isError } = useRouteCalendar(todayStr, endStr);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [outlookStopId, setOutlookStopId] = useState<number | null>(null);
  const [readinessStop, setReadinessStop] = useState<RouteCalendarStop | null>(null);

  const days = data ?? [];
  const activeDate =
    selectedDate && days.some((d) => d.date === selectedDate)
      ? selectedDate
      : (days.find((d) => d.date === todayStr)?.date ?? days[0]?.date ?? todayStr);
  const activeDay = days.find((d) => d.date === activeDate);
  const stops = activeDay?.stops ?? [];

  return (
    <section className="space-y-3" data-testid="section-route-calendar">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-wide text-foreground">Route Calendar</h2>
      </div>

      {isLoading ? (
        <div className="bg-card/40 border border-border/50 rounded-xl p-6 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="bg-card/40 border border-border/50 rounded-xl p-4 text-sm text-muted-foreground">
          Couldn't load the route calendar right now.
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.length === 0 ? (
              <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border border-border/50 bg-card/40 whitespace-nowrap">
                No stops scheduled in the next 7 days
              </div>
            ) : (
              days.map((day) => {
                const active = day.date === activeDate;
                const flagged = dayHasFlag(day);
                return (
                  <button
                    key={day.date}
                    onClick={() => setSelectedDate(day.date)}
                    data-testid={`button-route-day-${day.date}`}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 whitespace-nowrap transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/50 bg-card/40 text-foreground hover:border-primary/40'
                    }`}
                  >
                    <span className="flex flex-col items-start">
                      <span className="text-xs font-semibold">{dayChipLabel(day.date, todayStr, tomorrowStr)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {day.stops.length} stop{day.stops.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    {flagged ? <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" /> : null}
                  </button>
                );
              })
            )}
          </div>

          {stops.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stops.map((stop) => (
                <RouteCalendarStopCard
                  key={stop.id}
                  stop={stop}
                  showTechnicianName={showTechnicianNames}
                  onOutlook={() => setOutlookStopId(stop.id)}
                  onReadiness={() => setReadinessStop(stop)}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      <OutlookDialog inspectionId={outlookStopId} onOpenChange={(open) => !open && setOutlookStopId(null)} />
      <ReadinessDialog stop={readinessStop} onOpenChange={(open) => !open && setReadinessStop(null)} />
    </section>
  );
}

function outlookTone(stop: RouteCalendarStop): { label: string; className: string } | null {
  if (stop.outlook.overdueCount > 0) {
    return { label: `${stop.outlook.overdueCount} overdue`, className: 'bg-destructive/10 text-destructive border-destructive/30' };
  }
  if (stop.outlook.dueSoonCount > 0) {
    return { label: `${stop.outlook.dueSoonCount} due soon`, className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' };
  }
  return null;
}

function RouteCalendarStopCard({
  stop,
  showTechnicianName,
  onOutlook,
  onReadiness,
}: {
  stop: RouteCalendarStop;
  showTechnicianName: boolean;
  onOutlook: () => void;
  onReadiness: () => void;
}) {
  const outlook = outlookTone(stop);
  const readinessMissing = stop.readiness.dailyRigSetUp === false;

  return (
    <div
      className="bg-card/40 border border-border/50 rounded-xl p-4 space-y-3"
      data-testid={`card-route-stop-${stop.id}`}
    >
      <div>
        <p className="text-sm font-semibold text-foreground truncate">
          {stop.siteAddress}
          {stop.unitNumber ? ` · Unit ${stop.unitNumber}` : ''}
        </p>
        {showTechnicianName ? <p className="text-xs text-muted-foreground mt-0.5">{stop.technicianName}</p> : null}
      </div>

      {readinessMissing || outlook ? (
        <div className="flex flex-wrap gap-1.5">
          {readinessMissing ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
              Route not ready
            </Badge>
          ) : null}
          {outlook ? (
            <Badge variant="outline" className={outlook.className}>
              {outlook.label}
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Link
          href={`/inspections/${stop.id}`}
          data-testid={`link-route-history-${stop.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-secondary/60 hover:bg-secondary text-xs font-medium py-1.5 transition-colors"
        >
          <History className="w-3.5 h-3.5" /> History
        </Link>
        <button
          onClick={onOutlook}
          data-testid={`button-route-outlook-${stop.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-secondary/60 hover:bg-secondary text-xs font-medium py-1.5 transition-colors"
        >
          <FlaskConical className="w-3.5 h-3.5" /> Outlook
        </button>
        <button
          onClick={onReadiness}
          data-testid={`button-route-readiness-${stop.id}`}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md text-xs font-medium py-1.5 transition-colors ${
            readinessMissing ? 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20' : 'bg-secondary/60 hover:bg-secondary'
          }`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" /> Readiness
        </button>
      </div>
    </div>
  );
}

function OutlookDialog({ inspectionId, onOpenChange }: { inspectionId: number | null; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading, isError } = useRouteOutlook(inspectionId);
  return (
    <Dialog open={inspectionId != null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-route-outlook">
        <DialogHeader>
          <DialogTitle>{data?.address ?? 'Route Chemical Outlook'}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Couldn't load the outlook for this stop.</p>
        ) : data.products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chemical applications on record at this address yet.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.products.map((p) => {
              const tone =
                p.outlookStatus === 'overdue'
                  ? { label: 'Overdue', className: 'bg-destructive/10 text-destructive border-destructive/30' }
                  : p.outlookStatus === 'due-soon'
                    ? { label: 'Due soon', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' }
                    : { label: 'OK', className: 'bg-green-500/10 text-green-600 border-green-500/30' };
              return (
                <div key={p.productId} className="border border-border/50 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{p.productName}</p>
                    <Badge variant="outline" className={tone.className}>
                      {tone.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Target: {p.targetPest} · Last applied {p.daysSinceApplication}d ago
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.retreatmentIntervalDays != null
                      ? `Retreatment interval: ${p.retreatmentIntervalDays}d`
                      : 'No label retreatment interval on record'}
                    {p.applicationsLast90Days > 0 ? ` · ${p.applicationsLast90Days} in last 90d` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadinessDialog({ stop, onOpenChange }: { stop: RouteCalendarStop | null; onOpenChange: (open: boolean) => void }) {
  const hasTechnician = !!stop?.technicianId;
  const { data, isLoading, isError } = useDailyRigLookup(
    hasTechnician ? stop!.technicianId : null,
    hasTechnician ? stop!.calendarDate : null,
  );
  return (
    <Dialog open={stop != null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-route-readiness">
        <DialogHeader>
          <DialogTitle>{stop ? `${stop.technicianName} · Route Readiness` : 'Route Readiness'}</DialogTitle>
        </DialogHeader>
        {!hasTechnician ? (
          <div className="flex items-start gap-2 bg-muted border border-border/50 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">No technician is assigned to this stop yet.</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Couldn't load readiness for this stop.</p>
        ) : !data.setUp ? (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">No chemical kit has been declared for this date yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2 bg-green-500/10 border border-green-500/30 rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                Kit declared · {data.assignments?.length ?? 0} product{(data.assignments?.length ?? 0) === 1 ? '' : 's'} assigned
              </p>
            </div>
            {(data.assignments ?? []).map((a, idx) => (
              <div key={`${a.productId}-${idx}`} className="border border-border/50 rounded-lg p-3 space-y-0.5">
                <p className="text-sm font-medium">{a.product?.name ?? `Product #${a.productId}`}</p>
                <p className="text-xs text-muted-foreground">Target: {a.targetPest}</p>
                {a.notes ? <p className="text-xs text-muted-foreground">{a.notes}</p> : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
