import { useState, useMemo } from 'react';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks,
  eachDayOfInterval, isSameDay, parseISO, isValid, addDays,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, Users, AlertCircle,
  CheckCircle2, Clock, MapPin, X, RefreshCw, Calendar,
} from 'lucide-react';
import { useSchedule, useReassignInspection, type ScheduleEntry } from '@/hooks/use-schedule';
import { useCompanyMembers } from '@/hooks/use-team';

// ─── helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending:     { label: 'Scheduled',   color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',   icon: Clock },
  'in-progress': { label: 'In Progress', color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', icon: RefreshCw },
  completed:   { label: 'Completed',   color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30',  icon: CheckCircle2 },
  overdue:     { label: 'Overdue',     color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30',      icon: AlertCircle },
};

function statusMeta(status: string, calendarDate: string) {
  if (status === 'pending') {
    const d = parseISO(calendarDate);
    if (isValid(d) && d < new Date()) return STATUS_META['overdue'];
  }
  return STATUS_META[status] ?? STATUS_META['pending'];
}

// ─── Reassign modal ────────────────────────────────────────────────────────────

function ReassignModal({
  entry,
  members,
  onClose,
  onSave,
  saving,
}: {
  entry: ScheduleEntry;
  members: { id: number; clerkUserId: string; role: string }[];
  onClose: () => void;
  onSave: (technicianName: string, scheduledDate: string) => void;
  saving: boolean;
}) {
  const [techName, setTechName] = useState(entry.technicianName);
  const [date, setDate] = useState(entry.scheduledDate?.slice(0, 10) ?? entry.calendarDate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Edit Inspection</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Address */}
          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Address</p>
            <p className="text-sm text-foreground font-medium">{entry.siteAddress}</p>
            {entry.clientName && (
              <p className="text-xs text-muted-foreground mt-0.5">{entry.clientName}</p>
            )}
          </div>

          {/* Status badge */}
          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Status</p>
            {(() => {
              const m = statusMeta(entry.status, entry.calendarDate);
              const Icon = m.icon;
              return (
                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${m.bg} ${m.color}`}>
                  <Icon className="w-3 h-3" /> {m.label}
                </span>
              );
            })()}
          </div>

          {/* Scheduled date */}
          <div>
            <label className="text-xs text-muted-foreground uppercase font-semibold tracking-wide block mb-1">
              Scheduled Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Technician */}
          <div>
            <label className="text-xs text-muted-foreground uppercase font-semibold tracking-wide block mb-1">
              Technician
            </label>
            <input
              value={techName}
              onChange={(e) => setTechName(e.target.value)}
              placeholder="Technician name"
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={saving || !techName.trim() || !date}
            onClick={() => onSave(techName.trim(), date)}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inspection card ───────────────────────────────────────────────────────────

function InspectionCard({ entry, onClick }: { entry: ScheduleEntry; onClick: () => void }) {
  const m = statusMeta(entry.status, entry.calendarDate);
  const Icon = m.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2 rounded-md border mb-1 last:mb-0 transition-colors hover:opacity-80 cursor-pointer ${m.bg}`}
    >
      <div className={`flex items-center gap-1.5 mb-0.5 ${m.color}`}>
        <Icon className="w-3 h-3 shrink-0" />
        <span className="text-xs font-semibold truncate">{m.label}</span>
      </div>
      <p className="text-xs text-foreground font-medium truncate leading-tight">
        {entry.siteAddress}
      </p>
      {entry.clientName && (
        <p className="text-[10px] text-muted-foreground truncate">{entry.clientName}</p>
      )}
    </button>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function Schedule() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);
  const [filterTech, setFilterTech] = useState<string>('');

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const { data: entries = [], isLoading, error } = useSchedule(toYMD(weekStart), toYMD(weekEnd));
  const { data: members = [] } = useCompanyMembers();
  const reassign = useReassignInspection();

  // Unique technician names from this week's data
  const technicians = useMemo(() => {
    const names = Array.from(new Set(entries.map((e) => e.technicianName))).sort();
    return names;
  }, [entries]);

  const filtered = useMemo(
    () => (filterTech ? entries.filter((e) => e.technicianName === filterTech) : entries),
    [entries, filterTech],
  );

  // Group: technicianName → day-string → entries[]
  const grid = useMemo(() => {
    const map = new Map<string, Map<string, ScheduleEntry[]>>();
    const techs = filterTech ? [filterTech] : technicians;
    for (const tech of techs) {
      const dayMap = new Map<string, ScheduleEntry[]>();
      for (const day of days) {
        dayMap.set(toYMD(day), []);
      }
      map.set(tech, dayMap);
    }
    for (const entry of filtered) {
      const tech = entry.technicianName;
      if (!map.has(tech)) {
        const dayMap = new Map<string, ScheduleEntry[]>();
        for (const day of days) dayMap.set(toYMD(day), []);
        map.set(tech, dayMap);
      }
      const dayKey = entry.calendarDate;
      const cell = map.get(tech)!.get(dayKey);
      if (cell) cell.push(entry);
    }
    return map;
  }, [filtered, technicians, filterTech, days]);

  const techList = filterTech ? [filterTech] : Array.from(grid.keys());

  function handleSave(technicianName: string, scheduledDate: string) {
    if (!selected) return;
    reassign.mutate(
      {
        id: selected.id,
        payload: {
          technicianName,
          scheduledDate: scheduledDate ? `${scheduledDate}T00:00:00.000Z` : null,
        },
      },
      { onSuccess: () => setSelected(null) },
    );
  }

  const today = toYMD(new Date());

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* ── Page header ── */}
      <div className="px-6 py-4 border-b border-border bg-card flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Scheduling Calendar</h1>
            <p className="text-xs text-muted-foreground">
              {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Technician filter */}
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-muted-foreground" />
            <select
              value={filterTech}
              onChange={(e) => setFilterTech(e.target.value)}
              className="bg-muted border border-border rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">All technicians</option>
              {technicians.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Week navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekStart((w) => subWeeks(w, 1))}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
              className="px-2 py-1 text-xs rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => setWeekStart((w) => addWeeks(w, 1))}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Status legend ── */}
      <div className="px-6 py-2 border-b border-border bg-card/50 flex items-center gap-4 overflow-x-auto">
        {Object.values(STATUS_META).map((m) => {
          const Icon = m.icon;
          return (
            <span key={m.label} className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${m.color}`}>
              <Icon className="w-3 h-3" /> {m.label}
            </span>
          );
        })}
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-48 text-destructive gap-2">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">Failed to load schedule</span>
          </div>
        )}

        {!isLoading && !error && (
          <div className="min-w-[900px]">
            {/* Day headers */}
            <div className="grid border-b border-border bg-muted/30 sticky top-0 z-10"
              style={{ gridTemplateColumns: '160px repeat(7, 1fr)' }}
            >
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-r border-border">
                Technician
              </div>
              {days.map((day) => {
                const isToday = toYMD(day) === today;
                return (
                  <div
                    key={toYMD(day)}
                    className={`px-2 py-2 text-center border-r border-border last:border-r-0 ${
                      isToday ? 'bg-primary/10' : ''
                    }`}
                  >
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                      {format(day, 'EEE')}
                    </p>
                    <p className={`text-sm font-bold mt-0.5 ${isToday ? 'text-primary' : 'text-foreground'}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Rows */}
            {techList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                <Calendar className="w-8 h-8 opacity-40" />
                <p className="text-sm">No inspections this week</p>
              </div>
            ) : (
              techList.map((tech, rowIdx) => (
                <div
                  key={tech}
                  className={`grid border-b border-border ${rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/10'}`}
                  style={{ gridTemplateColumns: '160px repeat(7, 1fr)' }}
                >
                  {/* Tech name cell */}
                  <div className="px-3 py-3 border-r border-border flex items-start">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {tech.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-medium text-foreground leading-tight line-clamp-2">{tech}</span>
                    </div>
                  </div>

                  {/* Day cells */}
                  {days.map((day) => {
                    const dayKey = toYMD(day);
                    const cellEntries = grid.get(tech)?.get(dayKey) ?? [];
                    const isToday = dayKey === today;
                    return (
                      <div
                        key={dayKey}
                        className={`px-2 py-2 border-r border-border last:border-r-0 min-h-[80px] ${
                          isToday ? 'bg-primary/5' : ''
                        }`}
                      >
                        {cellEntries.map((entry) => (
                          <InspectionCard
                            key={entry.id}
                            entry={entry}
                            onClick={() => setSelected(entry)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Reassign modal ── */}
      {selected && (
        <ReassignModal
          entry={selected}
          members={members}
          onClose={() => setSelected(null)}
          onSave={handleSave}
          saving={reassign.isPending}
        />
      )}
    </div>
  );
}
