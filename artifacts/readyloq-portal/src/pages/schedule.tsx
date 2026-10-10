import { useState, useMemo, useRef } from 'react';
import {
  format, startOfWeek, endOfWeek, addWeeks, subWeeks,
  eachDayOfInterval, isSameDay, parseISO, isValid, isWithinInterval,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, CalendarDays, Users, AlertCircle,
  CheckCircle2, Clock, MapPin, X, RefreshCw, Calendar, Plus, GripVertical,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  useSchedule, useReassignInspection, useCreateInspection,
  type ScheduleEntry,
} from '@/hooks/use-schedule';
import { useCompanyMembers } from '@/hooks/use-team';
import { useAuth } from '@/hooks/use-auth';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';

// ─── helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending:       { label: 'Scheduled',   color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',   icon: Clock },
  'in-progress': { label: 'In Progress', color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', icon: RefreshCw },
  completed:     { label: 'Completed',   color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30',  icon: CheckCircle2 },
  overdue:       { label: 'Overdue',     color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30',      icon: AlertCircle },
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
  technicians,
  onClose,
  onSave,
  saving,
}: {
  entry: ScheduleEntry;
  technicians: string[];
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
            {entry.unitNumber && (
              <p className="text-xs text-teal-700 mt-0.5">Unit / Apt {entry.unitNumber}</p>
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
            {technicians.length > 1 ? (
              <select
                value={techName}
                onChange={(e) => setTechName(e.target.value)}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {technicians.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : (
              <input
                value={techName}
                onChange={(e) => setTechName(e.target.value)}
                placeholder="Technician name"
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            )}
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

// ─── New inspection slide-over ─────────────────────────────────────────────────

interface BookForm {
  siteAddress: string;
  clientName: string;
  technicianName: string;
  scheduledDate: string;
  unitNumber: string;
}

function NewInspectionSheet({
  open,
  onClose,
  onSuccess,
  technicians,
  technicianIdMap,
  initialDate,
  initialTech,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: (scheduledDate: string) => void;
  technicians: string[];
  technicianIdMap: Map<string, string | null>;
  initialDate?: string;
  initialTech?: string;
}) {
  const create = useCreateInspection();
  const [form, setForm] = useState<BookForm>({
    siteAddress: '',
    clientName: '',
    technicianName: initialTech ?? technicians[0] ?? '',
    scheduledDate: initialDate ?? toYMD(new Date()),
    unitNumber: '',
  });
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof BookForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  function handleClose() {
    setForm({
      siteAddress: '',
      clientName: '',
      technicianName: technicians[0] ?? '',
      scheduledDate: toYMD(new Date()),
      unitNumber: '',
    });
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.siteAddress.trim()) { setError('Site address is required'); return; }
    if (!form.technicianName.trim()) { setError('Technician name is required'); return; }
    if (!form.scheduledDate) { setError('Scheduled date is required'); return; }

    try {
      const resolvedId = technicianIdMap.get(form.technicianName.trim());
      await create.mutateAsync({
        siteAddress: form.siteAddress.trim(),
        clientName: form.clientName.trim() || undefined,
        technicianName: form.technicianName.trim(),
        // Include the Clerk ID when we can resolve it from the map, so the
        // inspection row carries a stable identity from creation.
        ...(typeof resolvedId === 'string' ? { technicianId: resolvedId } : {}),
        scheduledDate: form.scheduledDate ? `${form.scheduledDate}T00:00:00.000Z` : undefined,
        unitNumber: form.unitNumber.trim() || undefined,
      });
      const bookedDate = form.scheduledDate;
      handleClose();
      onSuccess?.(bookedDate);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create inspection');
    }
  }

  const inputCls =
    'w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-5 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 text-primary rounded-md">
              <CalendarDays className="w-4 h-4" />
            </div>
            Book New Inspection
          </SheetTitle>
          <SheetDescription>
            Schedule a new inspection and assign it to a technician.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5 flex-1">

            {/* Site address */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Site Address <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={form.siteAddress}
                  onChange={(e) => set('siteAddress', e.target.value)}
                  placeholder="123 Main St, City, State"
                  required
                  className={`${inputCls} pl-8`}
                />
              </div>
            </div>

            {/* Client name */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Client / Property Name
              </label>
              <input
                type="text"
                value={form.clientName}
                onChange={(e) => set('clientName', e.target.value)}
                placeholder="Acme Corp (optional)"
                className={inputCls}
              />
            </div>

            {/* Unit / Apt # — multi-family properties */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Unit / Apt #
              </label>
              <input
                type="text"
                value={form.unitNumber}
                onChange={(e) => set('unitNumber', e.target.value)}
                placeholder="e.g. 4B, 12, 301 (optional)"
                className={inputCls}
              />
            </div>

            {/* Technician */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Technician <span className="text-destructive">*</span>
              </label>
              {technicians.length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={
                      technicians.includes(form.technicianName)
                        ? form.technicianName
                        : '__custom__'
                    }
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        set('technicianName', e.target.value);
                      }
                    }}
                    className={inputCls}
                  >
                    {technicians.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="__custom__">Other (type below)…</option>
                  </select>
                  {!technicians.includes(form.technicianName) && (
                    <input
                      type="text"
                      value={form.technicianName}
                      onChange={(e) => set('technicianName', e.target.value)}
                      placeholder="Enter technician name"
                      required
                      autoFocus
                      className={inputCls}
                    />
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={form.technicianName}
                  onChange={(e) => set('technicianName', e.target.value)}
                  placeholder="Technician name"
                  required
                  className={inputCls}
                />
              )}
            </div>

            {/* Scheduled date */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                Scheduled Date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={form.scheduledDate}
                onChange={(e) => set('scheduledDate', e.target.value)}
                required
                className={inputCls}
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              {create.isPending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Booking…
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Book Inspection
                </>
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Inspection card ───────────────────────────────────────────────────────────

function InspectionCard({
  entry,
  onClick,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  entry: ScheduleEntry;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const m = statusMeta(entry.status, entry.calendarDate);
  const Icon = m.icon;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`w-full text-left p-2 rounded-md border mb-1 last:mb-0 transition-all cursor-grab active:cursor-grabbing select-none ${m.bg} ${
        isDragging ? 'opacity-40 scale-95' : 'hover:opacity-80'
      }`}
    >
      <div className={`flex items-center gap-1.5 mb-0.5 ${m.color}`}>
        <GripVertical className="w-3 h-3 shrink-0 opacity-40" />
        <Icon className="w-3 h-3 shrink-0" />
        <span className="text-xs font-semibold truncate">{m.label}</span>
      </div>
      <p className="text-xs text-foreground font-medium truncate leading-tight">
        {entry.siteAddress}
      </p>
      {entry.clientName && (
        <p className="text-[10px] text-muted-foreground truncate">{entry.clientName}</p>
      )}
      {entry.unitNumber && (
        <p className="text-[10px] text-teal-700 font-medium truncate">Unit / Apt {entry.unitNumber}</p>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function Schedule() {
  const { me } = useAuth();
  const isManager = me?.effectiveRole === 'manager' || me?.effectiveRole === 'owner';

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);
  const [filterTech, setFilterTech] = useState<string>('');
  const [bookOpen, setBookOpen] = useState(false);
  const [bookPreset, setBookPreset] = useState<{ date: string; tech: string } | null>(null);

  // Drag-and-drop state
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const dragOverRef = useRef<string | null>(null); // sync ref to avoid stale closure in drop handler

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const { data: entries = [], isLoading, error } = useSchedule(toYMD(weekStart), toYMD(weekEnd));
  const { data: members = [] } = useCompanyMembers();
  const reassign = useReassignInspection();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Unique technician names from this week's data
  const technicians = useMemo(() => {
    const names = Array.from(new Set(entries.map((e) => e.technicianName))).sort();
    return names;
  }, [entries]);

  // Map technician display-name → Clerk user ID (from the schedule entries that
  // already carry the ID for mobile-app-created records). Used to send the stable
  // identity alongside the name on create/reassign so the server can persist and
  // notify the right person even when no prior inspection history exists.
  const technicianIdMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const e of entries) {
      // First occurrence wins: keeps the most-recent semantics stable across
      // re-renders without needing a secondary sort.
      if (!map.has(e.technicianName)) {
        map.set(e.technicianName, e.technicianId);
      }
    }
    return map;
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

  function handleOpenBook(date?: string, tech?: string) {
    setBookPreset(date || tech ? { date: date ?? toYMD(new Date()), tech: tech ?? '' } : null);
    setBookOpen(true);
  }

  function handleBookSuccess(scheduledDate: string) {
    if (!scheduledDate) return;
    const parsed = parseISO(scheduledDate);
    if (!isValid(parsed)) return;

    const inCurrentWeek = isWithinInterval(parsed, { start: weekStart, end: weekEnd });

    if (!inCurrentWeek) {
      const targetWeekStart = startOfWeek(parsed, { weekStartsOn: 1 });
      setWeekStart(targetWeekStart);
      toast({
        title: 'Inspection booked',
        description: `Scheduled for ${format(parsed, 'EEEE, MMM d')} — calendar has jumped to that week.`,
      });
    } else {
      toast({
        title: 'Inspection booked',
        description: `Scheduled for ${format(parsed, 'EEEE, MMM d')}.`,
      });
    }
  }

  function handleSave(technicianName: string, scheduledDate: string) {
    if (!selected) return;
    // Resolve the Clerk ID from the map so the server can notify the right person
    // and keep technicianId in sync with the displayed name.
    const resolvedId = technicianIdMap.get(technicianName);
    reassign.mutate(
      {
        id: selected.id,
        payload: {
          technicianName,
          // Only include the ID when we have a concrete string — avoid sending
          // null (which would clear a previously known ID on the server).
          ...(typeof resolvedId === 'string' ? { technicianId: resolvedId } : {}),
          scheduledDate: scheduledDate ? `${scheduledDate}T00:00:00.000Z` : null,
        },
      },
      { onSuccess: () => setSelected(null) },
    );
  }

  // ── Drag-and-drop handlers ────────────────────────────────────────────────

  function handleCardDragStart(e: React.DragEvent, entry: ScheduleEntry) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(entry.id));
    setDraggingId(entry.id);
  }

  function handleDayDragOver(e: React.DragEvent, dayKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverRef.current !== dayKey) {
      dragOverRef.current = dayKey;
      setDragOverDay(dayKey);
    }
  }

  function handleDayDragLeave(e: React.DragEvent) {
    // Only clear when leaving the cell entirely (not moving into a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      dragOverRef.current = null;
      setDragOverDay(null);
    }
  }

  function handleDayDrop(e: React.DragEvent, dayKey: string) {
    e.preventDefault();
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    setDraggingId(null);
    setDragOverDay(null);
    dragOverRef.current = null;

    if (!id || isNaN(id)) return;
    const entry = entries.find((en) => en.id === id);
    if (!entry || entry.calendarDate === dayKey) return;

    // Optimistic update: move card to new day in cache
    const queryKey = ['schedule', toYMD(weekStart), toYMD(weekEnd)];
    const previous = qc.getQueryData<ScheduleEntry[]>(queryKey);
    qc.setQueryData<ScheduleEntry[]>(queryKey, (old) =>
      old?.map((en) =>
        en.id === id
          ? { ...en, calendarDate: dayKey, scheduledDate: `${dayKey}T00:00:00.000Z` }
          : en,
      ),
    );

    reassign.mutate(
      { id, payload: { scheduledDate: `${dayKey}T00:00:00.000Z` } },
      {
        onError: () => {
          // Revert optimistic update on failure
          if (previous) qc.setQueryData(queryKey, previous);
          toast({
            title: "Couldn't reschedule — please try again",
            variant: 'destructive',
          });
        },
      },
    );
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverDay(null);
    dragOverRef.current = null;
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
              <span className="ml-2 text-muted-foreground/60">· auto-refreshes every 30s</span>
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Book inspection button — managers/owners only */}
          {isManager && (
            <button
              onClick={() => handleOpenBook()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Book Inspection
            </button>
          )}

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
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
                <Calendar className="w-8 h-8 opacity-40" />
                <p className="text-sm">No inspections this week</p>
                {isManager && (
                  <button
                    onClick={() => handleOpenBook()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Book First Inspection
                  </button>
                )}
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
                    const isDropTarget = dragOverDay === dayKey && draggingId !== null;
                    const isEmpty = cellEntries.length === 0;
                    return (
                      <div
                        key={dayKey}
                        onClick={() => {
                          if (isManager && isEmpty && draggingId === null) handleOpenBook(dayKey, tech);
                        }}
                        onDragOver={(e) => handleDayDragOver(e, dayKey)}
                        onDragLeave={handleDayDragLeave}
                        onDrop={(e) => handleDayDrop(e, dayKey)}
                        className={`px-2 py-2 border-r border-border last:border-r-0 min-h-[80px] transition-colors ${
                          isToday ? 'bg-primary/5' : ''
                        } ${isManager && isEmpty && draggingId === null ? 'cursor-pointer hover:bg-primary/5 group' : ''} ${
                          isDropTarget
                            ? 'ring-2 ring-inset ring-primary/60 bg-primary/10'
                            : ''
                        }`}
                      >
                        {isManager && isEmpty && draggingId === null && (
                          <div className="hidden group-hover:flex items-center justify-center h-full min-h-[64px] opacity-40">
                            <Plus className="w-4 h-4 text-primary" />
                          </div>
                        )}
                        {isEmpty && isDropTarget && (
                          <div className="flex items-center justify-center h-full min-h-[64px] opacity-60">
                            <Plus className="w-5 h-5 text-primary" />
                          </div>
                        )}
                        {cellEntries.map((entry) => (
                          <InspectionCard
                            key={entry.id}
                            entry={entry}
                            onClick={() => { if (draggingId === null) setSelected(entry); }}
                            onDragStart={(e) => handleCardDragStart(e, entry)}
                            onDragEnd={handleDragEnd}
                            isDragging={draggingId === entry.id}
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
          technicians={technicians}
          onClose={() => setSelected(null)}
          onSave={handleSave}
          saving={reassign.isPending}
        />
      )}

      {/* ── New inspection sheet ── */}
      <NewInspectionSheet
        key={bookPreset ? `${bookPreset.date}:${bookPreset.tech}` : 'default'}
        open={bookOpen}
        onClose={() => { setBookOpen(false); setBookPreset(null); }}
        onSuccess={handleBookSuccess}
        technicians={technicians}
        technicianIdMap={technicianIdMap}
        initialDate={bookPreset?.date}
        initialTech={bookPreset?.tech}
      />
    </div>
  );
}
