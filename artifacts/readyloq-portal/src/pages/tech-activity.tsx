import { useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { format, subDays, parseISO } from 'date-fns';
import { Loader2, ChevronLeft, Package, Briefcase, Home } from 'lucide-react';
import {
  useTechActivity,
  useRestockOrderStatus,
  type TechActivityDay,
} from '@/hooks/use-tech-activity';

// ─── Live supplier order status badge ──────────────────────────────────────
//
// Only rendered next to source === "supplier_api" restock events — those are
// live-API supplier orders where the actual delivery hasn't necessarily been
// confirmed yet. Manual and csv_import events are already-confirmed receipts
// and don't need a status check.

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  processing: 'bg-blue-500/10 text-blue-600',
  shipped: 'bg-indigo-500/10 text-indigo-600',
  delivered: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-red-500/10 text-red-600',
};

function OrderStatusBadge({ orderRef }: { orderRef: string }) {
  const { data, isLoading } = useRestockOrderStatus(orderRef);

  if (isLoading) {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
        Checking…
      </span>
    );
  }

  // Fetch failure (e.g. no active connection, adapter error) — don't block
  // the rest of the timeline from rendering.
  if (!data) return null;

  const label =
    data.status === 'shipped'
      ? data.trackingNumber
        ? `Shipped · ${data.trackingNumber}`
        : 'Shipped'
      : data.status === 'delivered'
        ? 'Delivered'
        : data.status.charAt(0).toUpperCase() + data.status.slice(1);

  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
        STATUS_STYLES[data.status] ?? STATUS_STYLES.pending
      }`}
    >
      {label}
    </span>
  );
}

// ─── Day card ────────────────────────────────────────────────────────────────

function DayCard({ day }: { day: TechActivityDay }) {
  const date = parseISO(day.date);
  const hasActivity =
    day.ordered.length > 0 || day.carried.length > 0 || day.applied.length > 0;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">{format(date, 'EEEE, MMMM d')}</span>
          <span className="text-xs text-muted-foreground ml-2">{day.date}</span>
        </div>
        {!hasActivity && (
          <span className="text-xs text-muted-foreground italic">No activity</span>
        )}
      </div>

      <div className="divide-y divide-border">
        {/* 📦 Ordered / Received — a supplier_api entry is a placed order still
            awaiting delivery (shows a live status badge); manual/csv_import
            entries are already-confirmed receipts. */}
        {day.ordered.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-blue-500/10 rounded-lg">
                <Package className="w-3.5 h-3.5 text-blue-500" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-blue-500">
                Restocking ({day.ordered.length})
              </span>
            </div>
            <div className="space-y-2">
              {day.ordered.map((ev) => (
                <div key={ev.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ev.productName}</span>
                    {ev.supplierOrderRef && (
                      <span className="text-xs text-muted-foreground">#{ev.supplierOrderRef}</span>
                    )}
                    {ev.source === 'supplier_api' && ev.supplierOrderRef && (
                      <OrderStatusBadge orderRef={ev.supplierOrderRef} />
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {ev.source === 'supplier_api'
                      ? `Ordered ${ev.quantityReceived} ${ev.unit}`
                      : `+${ev.quantityReceived} ${ev.unit}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 🎒 Carried (morning kit) */}
        {day.carried.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-amber-500/10 rounded-lg">
                <Briefcase className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-500">
                Carried ({day.carried.length})
              </span>
            </div>
            <div className="space-y-2">
              {day.carried.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{c.productName}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-primary font-medium">{c.targetPest}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 🏠 Applied */}
        {day.applied.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-green-500/10 rounded-lg">
                <Home className="w-3.5 h-3.5 text-green-500" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-green-500">
                Applied ({day.applied.length} treatment{day.applied.length !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="space-y-2">
              {day.applied.map((a, i) => (
                <div key={i} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.productName}</span>
                    {a.totalProductOz != null && (
                      <span className="text-xs text-muted-foreground">{a.totalProductOz} oz</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {a.targetPest}
                    {a.areaSqft ? ` · ${a.areaSqft.toLocaleString()} sq ft` : ''}
                    {a.siteAddress ? ` · ${a.siteAddress}` : ''}
                    <span className="ml-2">{format(parseISO(a.appliedAt), 'h:mm a')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasActivity && (
          <div className="px-5 py-6 text-center text-sm text-muted-foreground">
            No chemical activity on this day.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TechActivity() {
  const [, params] = useRoute<{ userId: string }>('/team/:userId/activity');
  const [, setLocation] = useLocation();
  const userId = params?.userId ?? null;

  // Date range — default last 14 days
  const today = new Date();
  const [endDate] = useState(() => format(today, 'yyyy-MM-dd'));
  const [startDate, setStartDate] = useState(() =>
    format(subDays(today, 13), 'yyyy-MM-dd'),
  );

  const { data, isLoading, error } = useTechActivity(userId, startDate, endDate);

  const presets = [
    { label: '7 days', days: 6 },
    { label: '14 days', days: 13 },
    { label: '30 days', days: 29 },
  ];

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-12 text-center text-muted-foreground">
        Failed to load tech activity. Please try again.
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => setLocation('/team')}
          className="mt-1 p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Tech Activity</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data.technicianName ?? `Tech ${(userId ?? '').substring(0, 8)}…`}
            {' · '}
            Chemical timeline: ordered → carried → applied
          </p>
        </div>
      </div>

      {/* Date range picker */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Show last:</span>
        {presets.map((p) => {
          const from = format(subDays(today, p.days), 'yyyy-MM-dd');
          const active = startDate === from;
          return (
            <button
              key={p.label}
              onClick={() => setStartDate(from)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p.label}
            </button>
          );
        })}

        <div className="flex items-center gap-2 ml-auto">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={endDate}
            disabled
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-muted text-muted-foreground"
          />
        </div>
      </div>

      {/* Summary badges */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-500">
            {data.days.reduce((s, d) => s + d.ordered.length, 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1 font-medium">Orders</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">
            {data.days.reduce((s, d) => s + d.carried.length, 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1 font-medium">Products Carried</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-500">
            {data.days.reduce((s, d) => s + d.applied.length, 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1 font-medium">Treatments Applied</p>
        </div>
      </div>

      {/* Day-by-day timeline */}
      {data.days.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          No chemical activity in this date range.
        </div>
      ) : (
        <div className="space-y-4">
          {data.days.map((day) => (
            <DayCard key={day.date} day={day} />
          ))}
        </div>
      )}
    </div>
  );
}
