import { useCompanyMembers } from '@/hooks/use-team';
import { useGetScorecardSummary } from '@workspace/api-client-react';
import {
  Loader2, ShieldAlert, Award, AlertTriangle, Activity, FlaskConical,
  PackageSearch, CheckCircle2, X, ChevronDown, ChevronRight, Pencil, Check,
  MapPin, TrendingDown, Sparkles, ArrowRightCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { useLocation } from 'wouter';
import { useState } from 'react';
import { usePendingRestocks, useUpdateRestockRequest } from '@/hooks/use-pending-restocks';
import {
  usePredictiveRestocks, useDismissPredictiveRestock, useConvertPredictiveRestock,
} from '@/hooks/use-predictive-restocks';
import { useTeamInventory, useSetTechThreshold } from '@/hooks/use-team-inventory';
import { useTeamRouteReadiness } from '@/hooks/use-schedule';
import { useTeamStockHealth } from '@/hooks/use-warehouse';
import { useToast } from '@/hooks/use-toast';
import { WarehousePanel } from '@/components/warehouse-panel';

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Team() {
  const { data: members, isLoading: isLoadingMembers } = useCompanyMembers();
  const { data: summary, isLoading: isLoadingSummary } = useGetScorecardSummary();
  const { data: pendingRestocks } = usePendingRestocks();
  const { mutate: updateRestock } = useUpdateRestockRequest();
  const { data: predictiveRestocks } = usePredictiveRestocks();
  const { mutate: dismissPredictive } = useDismissPredictiveRestock();
  const { mutate: convertPredictive, isPending: isConvertingPredictive } = useConvertPredictiveRestock();
  const { toast } = useToast();
  const { data: teamInventory, isLoading: isLoadingInventory } = useTeamInventory();
  const { mutate: setThreshold, isPending: isSavingThreshold } = useSetTechThreshold();
  const { data: routeReadiness, isLoading: isLoadingReadiness } = useTeamRouteReadiness(todayDateString());
  const { data: stockHealth, isLoading: isLoadingStockHealth } = useTeamStockHealth();
  const [, setLocation] = useLocation();
  const [expandedReadinessTechs, setExpandedReadinessTechs] = useState<Set<string>>(new Set());
  const [expandedHealthTechs, setExpandedHealthTechs] = useState<Set<string>>(new Set());

  const toggleReadinessTech = (id: string) => {
    setExpandedReadinessTechs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleHealthTech = (id: string) => {
    setExpandedHealthTechs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Which tech sections are expanded in the Team Inventory card
  const [expandedTechs, setExpandedTechs] = useState<Set<string>>(new Set());
  // Which threshold is currently being edited: { technicianId, productId, value }
  const [editing, setEditing] = useState<{ technicianId: string; productId: number; value: string } | null>(null);

  const isLoading = isLoadingMembers || isLoadingSummary;

  const toggleTech = (id: string) => {
    setExpandedTechs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startEdit = (technicianId: string, productId: number, current: number | null) => {
    setEditing({ technicianId, productId, value: current != null ? String(current) : '' });
  };

  const cancelEdit = () => setEditing(null);

  const approveRestock = (id: number) => {
    updateRestock(
      { id, status: 'approved' },
      {
        onSuccess: (data) => {
          toast({
            title: data.supplierOrderRef ? 'Order placed' : 'Approved',
            description: data.supplierOrderRef
              ? `Order ${data.supplierOrderRef} placed with the supplier.`
              : 'Restock alert approved.',
          });
        },
        onError: (err) => {
          toast({
            title: 'Approval failed',
            description: err.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const convertPredictiveRecommendation = (id: number) => {
    convertPredictive(id, {
      onSuccess: () => toast({ title: 'Converted', description: 'Recommendation moved to Restock Alerts for approval.' }),
      onError: (err) => toast({ title: 'Conversion failed', description: err.message, variant: 'destructive' }),
    });
  };

  const saveEdit = () => {
    if (!editing) return;
    const raw = editing.value.trim();
    const threshold = raw === '' ? null : parseFloat(raw);
    if (raw !== '' && (Number.isNaN(threshold!) || threshold! < 0)) return;
    setThreshold({ technicianId: editing.technicianId, productId: editing.productId, restockThreshold: threshold! });
    setEditing(null);
  };

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const highRiskCount = summary ? (summary.riskDistribution?.['high'] ?? 0) : 0;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Team Performance</h1>
        <p className="text-muted-foreground mt-1">Manage field operators and monitor quality scores.</p>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Quality Score</p>
                <p className="text-2xl font-bold mt-1">{summary.avgQuality.toFixed(1)}%</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-500/10 text-yellow-500 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Risk Inspections</p>
                <p className="text-2xl font-bold mt-1">{highRiskCount}</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Evaluated</p>
                <p className="text-2xl font-bold mt-1">{summary.totalScorecards}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {summary && summary.technicians.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30">
            <h2 className="font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-muted-foreground" />
              Technician Quality Breakdown
            </h2>
          </div>
          <div className="divide-y divide-border">
            {summary.technicians.map((tech, i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-sm">{tech.technicianName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tech.inspections} inspections &middot; {tech.missedOpportunities} missed
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, tech.avgQuality)}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold w-12 text-right">{tech.avgQuality.toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Today's Route Readiness (proactive, TODAY-scoped) ───────────────
          Distinct from Truck Stock Health below (a longer-range trending
          signal) and from the reactive Restock Alerts, which only fire once
          on-hand stock has already crossed a configured threshold. */}
      {(isLoadingReadiness || (routeReadiness && routeReadiness.length > 0)) && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold flex-1">Today's Route Readiness</h2>
            {isLoadingReadiness && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground border-b border-border bg-muted/10">
            Compares each technician's stops scheduled today against their truck's on-hand stock for products on today's rig.
          </p>
          <div className="divide-y divide-border">
            {routeReadiness?.map((tech) => {
              const shortProducts = tech.products.filter((p) => p.status === 'short');
              const isExpanded = expandedReadinessTechs.has(tech.technicianId);
              return (
                <div key={tech.technicianId}>
                  <button
                    type="button"
                    onClick={() => tech.overallStatus === 'short' && toggleReadinessTech(tech.technicianId)}
                    className={`w-full flex items-center gap-3 px-6 py-4 text-left transition-colors ${tech.overallStatus === 'short' ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'}`}
                  >
                    {tech.overallStatus === 'short'
                      ? (isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />)
                      : <span className="w-4 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{tech.technicianId.substring(0, 14)}…</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {tech.stopCount} stop{tech.stopCount !== 1 ? 's' : ''} today
                      </span>
                    </div>
                    {tech.overallStatus === 'short' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">
                        Short on {shortProducts.length}
                      </span>
                    )}
                    {tech.overallStatus === 'ready' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                        Ready
                      </span>
                    )}
                    {tech.overallStatus === 'not-set-up' && (
                      <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                        Rig not set up
                      </span>
                    )}
                  </button>
                  {isExpanded && shortProducts.length > 0 && (
                    <div className="border-t border-border divide-y divide-border bg-red-500/5">
                      {shortProducts.map((p) => (
                        <div key={p.productId} className="px-10 py-3 text-sm flex items-center justify-between gap-4">
                          <span className="font-medium">{p.productName}</span>
                          <span className="text-xs text-red-600 dark:text-red-400">
                            {p.quantityOnHand.toFixed(1)} {p.unit} on hand · ~{p.expectedUsageToday?.toFixed(1)} {p.unit} expected today
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Restock Alerts ────────────────────────────────────────────────── */}
      {pendingRestocks && pendingRestocks.length > 0 && (
        <div className="bg-card border border-amber-500/30 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-amber-500/5 flex items-center gap-3">
            <PackageSearch className="w-4 h-4 text-amber-500 shrink-0" />
            <h2 className="font-semibold flex-1">Restock Alerts</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">
              {pendingRestocks.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {pendingRestocks.map((req) => (
              <div key={req.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{req.productName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tech {req.technicianId.substring(0, 12)}…
                    &nbsp;·&nbsp;
                    <span className="text-amber-600 font-medium">{req.quantityOnHand.toFixed(1)} on hand</span>
                    &nbsp;·&nbsp; threshold {req.restockThreshold.toFixed(1)}
                    &nbsp;·&nbsp; need <span className="font-medium">{req.shortfall.toFixed(1)} more</span>
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => updateRestock({ id: req.id, status: 'dismissed' })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Dismiss
                  </button>
                  <button
                    onClick={() => approveRestock(req.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Predictive Restock Recommendations (FAIE, forward-looking) ──────
          Distinct from the reactive Restock Alerts above: adaptively
          recomputed server-side from a recency-weighted consumption trend,
          upcoming scheduled-route demand, and configured supplier lead time,
          so a recommendation can fire before today's static threshold would
          ever trip. Acting on one converts it into a normal restock alert —
          it never bypasses manager approval. */}
      {predictiveRestocks && predictiveRestocks.length > 0 && (
        <div className="bg-card border border-violet-500/30 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-violet-500/5 flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
            <h2 className="font-semibold flex-1">Predictive Restock Recommendations</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-violet-500 text-white text-xs font-bold">
              {predictiveRestocks.length}
            </span>
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground border-b border-border bg-muted/10">
            Forecasted from recent consumption trend, upcoming scheduled stops, and supplier lead time — surfaced
            before a truck actually runs short, not after.
          </p>
          <div className="divide-y divide-border">
            {predictiveRestocks.map((rec) => (
              <div key={rec.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{rec.productName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tech {rec.technicianId.substring(0, 12)}…
                    &nbsp;·&nbsp;
                    <span className="text-violet-600 dark:text-violet-400 font-medium">
                      {rec.quantityOnHand.toFixed(1)} {rec.unit} on hand
                    </span>
                    {rec.recommendedOrderQuantity != null && (
                      <>
                        &nbsp;·&nbsp; recommend <span className="font-medium">+{rec.recommendedOrderQuantity.toFixed(1)} {rec.unit}</span>
                      </>
                    )}
                    {rec.scheduledStopCount > 0 && (
                      <>&nbsp;·&nbsp; {rec.scheduledStopCount} upcoming stop{rec.scheduledStopCount !== 1 ? 's' : ''}</>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    By {format(new Date(rec.recommendedByAt), 'MMM d, yyyy')}
                    {rec.projectedBreachAt && (
                      <> · projected to run short {format(new Date(rec.projectedBreachAt), 'MMM d')}</>
                    )}
                    {rec.leadTimeDays != null && <> · {rec.leadTimeDays}d supplier lead time</>}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => dismissPredictive(rec.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Dismiss
                  </button>
                  <button
                    onClick={() => convertPredictiveRecommendation(rec.id)}
                    disabled={isConvertingPredictive}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-600/90 transition-colors disabled:opacity-50"
                  >
                    <ArrowRightCircle className="w-3 h-3" />
                    Send to Restock Alerts
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Team Inventory & Restock Thresholds ───────────────────────────── */}
      {(isLoadingInventory || (teamInventory && teamInventory.length > 0)) && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold flex-1">Team Inventory &amp; Restock Thresholds</h2>
            {isLoadingInventory && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground border-b border-border bg-muted/10">
            Set the minimum on-hand level for each product. When a technician's stock drops below their threshold, it will appear above as a Restock Alert.
          </p>

          {teamInventory?.map((tech) => (
            <div key={tech.technicianId} className="border-b border-border last:border-b-0">
              {/* Tech header row — click to expand/collapse */}
              <button
                type="button"
                onClick={() => toggleTech(tech.technicianId)}
                className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors text-left"
              >
                {expandedTechs.has(tech.technicianId)
                  ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">
                    {tech.technicianId.substring(0, 14)}…
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {tech.inventoryCount} product{tech.inventoryCount !== 1 ? 's' : ''}
                    {tech.lastRestockedAt
                      ? ` · last restocked ${format(new Date(tech.lastRestockedAt), 'MMM d')}`
                      : ''}
                  </span>
                </div>
              </button>

              {/* Expandable product rows */}
              {expandedTechs.has(tech.technicianId) && (
                <div className="border-t border-border divide-y divide-border">
                  {tech.items.length === 0 ? (
                    <p className="px-10 py-4 text-sm text-muted-foreground">No products in inventory.</p>
                  ) : (
                    tech.items.map((item) => {
                      const isEditing =
                        editing?.technicianId === tech.technicianId && editing?.productId === item.productId;
                      return (
                        <div
                          key={item.productId}
                          className="flex items-center gap-4 px-10 py-3 flex-wrap"
                        >
                          {/* Product name + on-hand */}
                          <div className="flex-1 min-w-48">
                            <p className="text-sm font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.quantityOnHand % 1 === 0
                                ? item.quantityOnHand.toFixed(0)
                                : item.quantityOnHand.toFixed(1)}{' '}
                              {item.unit} on hand
                              {item.appliedToday != null && item.appliedToday > 0 ? (
                                <>
                                  {' '}
                                  ·{' '}
                                  <span className="text-foreground/80">
                                    {/* appliedToday is summed from treatment_logs.totalProductOz,
                                        which is always recorded in fluid ounces regardless of the
                                        unit this tech's on-hand balance is tracked in (e.g. gallon) —
                                        label it "fl oz" explicitly, never item.unit, or a gallon-
                                        tracked product would misleadingly read "3 gallon applied". */}
                                    {item.appliedToday % 1 === 0
                                      ? item.appliedToday.toFixed(0)
                                      : item.appliedToday.toFixed(1)}{' '}
                                    fl oz applied today
                                  </span>
                                </>
                              ) : null}
                            </p>
                          </div>

                          {/* Threshold display / edit */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">Alert below:</span>
                            {isEditing ? (
                              <>
                                <input
                                  type="number"
                                  min="0"
                                  value={editing.value}
                                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                  placeholder="e.g. 32"
                                  className="w-24 px-2 py-1 text-sm border border-primary rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                  autoFocus
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                />
                                <span className="text-xs text-muted-foreground">{item.unit}</span>
                                <button
                                  type="button"
                                  onClick={saveEdit}
                                  disabled={isSavingThreshold}
                                  className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                  title="Save"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  className="p-1.5 rounded-md border border-border hover:bg-muted"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </>
                            ) : (
                              <>
                                {item.restockThreshold != null ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
                                    {item.restockThreshold % 1 === 0
                                      ? item.restockThreshold.toFixed(0)
                                      : item.restockThreshold.toFixed(1)}{' '}
                                    {item.unit}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                                    Not set
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => startEdit(tech.technicianId, item.productId, item.restockThreshold)}
                                  className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  title="Edit threshold"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Truck Stock Health (proactive, trending — independent of today) ──
          Projected days of coverage remaining vs. the configured
          replenishment target window. Distinct from Today's Route Readiness
          above (today-only) and the reactive restockThreshold alert. */}
      {(isLoadingStockHealth || (stockHealth && stockHealth.some((t) => t.items.length > 0))) && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold flex-1">Truck Stock Health</h2>
            {isLoadingStockHealth && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground border-b border-border bg-muted/10">
            Projected days of coverage remaining (on-hand ÷ recent average daily use) against each product's configured replenishment window.
          </p>
          {stockHealth?.filter((t) => t.items.length > 0).map((tech) => {
            const trendingShort = tech.items.filter((i) => i.status === 'trending-short');
            const isExpanded = expandedHealthTechs.has(tech.technicianId);
            return (
              <div key={tech.technicianId} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleHealthTech(tech.technicianId)}
                  className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{tech.technicianId.substring(0, 14)}…</span>
                    <span className="text-xs text-muted-foreground ml-2">{tech.items.length} product{tech.items.length !== 1 ? 's' : ''}</span>
                  </div>
                  {trendingShort.length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">
                      {trendingShort.length} trending short
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <div className="border-t border-border divide-y divide-border">
                    {tech.items.map((item) => (
                      <div key={item.productId} className="flex items-center gap-4 px-10 py-3 flex-wrap">
                        <div className="flex-1 min-w-48">
                          <p className="text-sm font-medium">{item.productName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.quantityOnHand % 1 === 0 ? item.quantityOnHand.toFixed(0) : item.quantityOnHand.toFixed(1)} {item.unit} on hand
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {item.status === 'trending-short' && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
                              ~{item.projectedDaysCoverage?.toFixed(0)}d left · target {item.targetDaysOfSupply?.toFixed(0)}d
                            </span>
                          )}
                          {item.status === 'healthy' && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                              ~{item.projectedDaysCoverage?.toFixed(0)}d left · target {item.targetDaysOfSupply?.toFixed(0)}d
                            </span>
                          )}
                          {item.status === 'no-target-configured' && (
                            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                              No target set
                            </span>
                          )}
                          {item.status === 'insufficient-data' && (
                            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                              Not enough usage history
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Warehouse tier, replenishment targets & transaction history ────── */}
      {members && <WarehousePanel members={members} />}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h2 className="font-semibold">Team Roster</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Member ID</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Joined</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members?.map((member) => (
                <tr
                  key={member.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setLocation(`/team/${member.clerkUserId}/activity`)}
                >
                  <td className="px-6 py-4 font-medium text-foreground">
                    #{member.id}
                    <span className="text-xs text-muted-foreground ml-2 font-normal">
                      ({member.clerkUserId.substring(0, 12)}...)
                    </span>
                  </td>
                  <td className="px-6 py-4 capitalize">
                    <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-xs font-medium">
                      {member.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {format(new Date(member.createdAt), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4">
                    {(member.role === 'technician' || member.role === 'manager') && (
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/team/${member.clerkUserId}/activity`);
                        }}
                      >
                        <FlaskConical className="w-3 h-3" />
                        Activity
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!members?.length && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">
                    No team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
