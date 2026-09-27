import { useState } from 'react';
import {
  Warehouse, ArrowRightLeft, PackagePlus, History, Loader2, Settings2, X, Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import type { CompanyMember } from '@/hooks/use-team';
import {
  useWarehouseInventory,
  useReceiveWarehouseStock,
  useTransferToTruck,
  useInventoryTransactions,
  useReplenishmentTargets,
  useSetCompanyReplenishmentTarget,
  useSetTechnicianReplenishmentTarget,
  useClearTechnicianReplenishmentTarget,
  useSetProductReplenishmentTarget,
  useClearProductReplenishmentTarget,
  useSetCombinedReplenishmentTarget,
  useClearCombinedReplenishmentTarget,
  useProducts,
} from '@/hooks/use-warehouse';

function shortId(id: string) {
  return id.length > 14 ? `${id.substring(0, 14)}…` : id;
}

function movementLabel(type: string) {
  switch (type) {
    case 'warehouse_receipt': return 'Warehouse receipt';
    case 'warehouse_to_truck_transfer': return 'Warehouse → truck transfer';
    case 'truck_receipt': return 'Truck receipt';
    case 'truck_deduction': return 'Applied to property';
    case 'truck_deduction_reversal': return 'Deduction reversed';
    case 'truck_adjustment': return 'Manual adjustment';
    default: return type;
  }
}

// ── Warehouse balances + receive/transfer ──────────────────────────────────

function WarehouseBalances({ technicians }: { technicians: CompanyMember[] }) {
  const { data: warehouse, isLoading } = useWarehouseInventory();
  const { data: products } = useProducts();
  const { toast } = useToast();

  const [showReceive, setShowReceive] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const [receiveProductId, setReceiveProductId] = useState('');
  const [receiveQty, setReceiveQty] = useState('');
  const [receiveUnit, setReceiveUnit] = useState('fl oz');

  const [transferTechId, setTransferTechId] = useState('');
  const [transferProductId, setTransferProductId] = useState('');
  const [transferQty, setTransferQty] = useState('');

  const { mutate: receive, isPending: isReceiving } = useReceiveWarehouseStock();
  const { mutate: transfer, isPending: isTransferring } = useTransferToTruck();

  const submitReceive = () => {
    const productId = parseInt(receiveProductId, 10);
    const quantity = parseFloat(receiveQty);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) return;
    receive(
      { productId, quantity, unit: receiveUnit },
      {
        onSuccess: () => {
          toast({ title: 'Stock received', description: 'Warehouse balance updated.' });
          setShowReceive(false);
          setReceiveProductId('');
          setReceiveQty('');
        },
        onError: (err) => toast({ title: 'Receive failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  const submitTransfer = () => {
    const productId = parseInt(transferProductId, 10);
    const quantity = parseFloat(transferQty);
    if (!transferTechId || !productId || !Number.isFinite(quantity) || quantity <= 0) return;
    transfer(
      { technicianId: transferTechId, productId, quantity },
      {
        onSuccess: () => {
          toast({ title: 'Transfer complete', description: 'Stock moved to the technician truck.' });
          setShowTransfer(false);
          setTransferProductId('');
          setTransferQty('');
        },
        onError: (err) => toast({ title: 'Transfer failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2 flex-wrap">
        <Warehouse className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-semibold flex-1">Warehouse</h2>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <button
          type="button"
          onClick={() => { setShowReceive((v) => !v); setShowTransfer(false); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
        >
          <PackagePlus className="w-3.5 h-3.5" />
          Receive from supplier
        </button>
        <button
          type="button"
          onClick={() => { setShowTransfer((v) => !v); setShowReceive(false); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          Transfer to truck
        </button>
      </div>

      {showReceive && (
        <div className="px-6 py-4 border-b border-border bg-muted/10 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Product</label>
            <select
              value={receiveProductId}
              onChange={(e) => setReceiveProductId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
            >
              <option value="">Select product…</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Quantity</label>
            <input
              type="number" min="0" step="any" value={receiveQty}
              onChange={(e) => setReceiveQty(e.target.value)}
              className="w-28 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Unit</label>
            <input
              type="text" value={receiveUnit} onChange={(e) => setReceiveUnit(e.target.value)}
              className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
            />
          </div>
          <button
            type="button" onClick={submitReceive} disabled={isReceiving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isReceiving ? 'Saving…' : 'Receive'}
          </button>
          <button type="button" onClick={() => setShowReceive(false)} className="p-1.5 rounded-md hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {showTransfer && (
        <div className="px-6 py-4 border-b border-border bg-muted/10 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Technician</label>
            <select
              value={transferTechId} onChange={(e) => setTransferTechId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
            >
              <option value="">Select technician…</option>
              {technicians.map((t) => (
                <option key={t.clerkUserId} value={t.clerkUserId}>{shortId(t.clerkUserId)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Product</label>
            <select
              value={transferProductId} onChange={(e) => setTransferProductId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
            >
              <option value="">Select product…</option>
              {warehouse?.map((w) => <option key={w.productId} value={w.productId}>{w.productName} ({w.quantityOnHand} {w.unit} available)</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Quantity</label>
            <input
              type="number" min="0" step="any" value={transferQty}
              onChange={(e) => setTransferQty(e.target.value)}
              className="w-28 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
            />
          </div>
          <button
            type="button" onClick={submitTransfer} disabled={isTransferring}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isTransferring ? 'Transferring…' : 'Transfer'}
          </button>
          <button type="button" onClick={() => setShowTransfer(false)} className="p-1.5 rounded-md hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}

      <div className="divide-y divide-border">
        {!warehouse?.length && !isLoading && (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No stock in the warehouse yet. Use "Receive from supplier" to add some.
          </p>
        )}
        {warehouse?.map((item) => (
          <div key={item.productId} className="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm font-medium">{item.productName}</p>
            <p className="text-sm">
              <span className="font-semibold">
                {item.quantityOnHand % 1 === 0 ? item.quantityOnHand.toFixed(0) : item.quantityOnHand.toFixed(1)}
              </span>{' '}
              <span className="text-muted-foreground">{item.unit} on hand</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Replenishment targets ──────────────────────────────────────────────────

function ReplenishmentTargetsPanel({ technicians }: { technicians: CompanyMember[] }) {
  const { data, isLoading } = useReplenishmentTargets();
  const { data: products } = useProducts();
  const { toast } = useToast();

  const { mutate: setCompanyTarget, isPending: isSavingCompany } = useSetCompanyReplenishmentTarget();
  const { mutate: setTechTarget } = useSetTechnicianReplenishmentTarget();
  const { mutate: clearTechTarget } = useClearTechnicianReplenishmentTarget();
  const { mutate: setProductTarget } = useSetProductReplenishmentTarget();
  const { mutate: clearProductTarget } = useClearProductReplenishmentTarget();
  const { mutate: setCombinedTarget } = useSetCombinedReplenishmentTarget();
  const { mutate: clearCombinedTarget } = useClearCombinedReplenishmentTarget();

  const [companyDraft, setCompanyDraft] = useState('');
  const [companyLeadTimeDraft, setCompanyLeadTimeDraft] = useState('');
  const [newTechId, setNewTechId] = useState('');
  const [newTechDays, setNewTechDays] = useState('');
  const [newTechFactor, setNewTechFactor] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newProductDays, setNewProductDays] = useState('');
  const [newProductLeadTime, setNewProductLeadTime] = useState('');
  const [newCombinedTechId, setNewCombinedTechId] = useState('');
  const [newCombinedProductId, setNewCombinedProductId] = useState('');
  const [newCombinedDays, setNewCombinedDays] = useState('');

  const onError = (err: Error) => toast({ title: 'Save failed', description: err.message, variant: 'destructive' });

  const saveCompanyDefault = () => {
    // Blank means "leave this field unchanged" (there's no separate clear
    // affordance for the company default), so an untouched field must be
    // omitted from the payload entirely — not sent as an explicit `null`,
    // which would wipe out whatever value is already saved for it.
    const days = companyDraft.trim() === '' ? undefined : parseFloat(companyDraft);
    const leadTimeDays = companyLeadTimeDraft.trim() === '' ? undefined : parseFloat(companyLeadTimeDraft);
    if (days !== undefined && (Number.isNaN(days) || days <= 0)) return;
    if (leadTimeDays !== undefined && (Number.isNaN(leadTimeDays) || leadTimeDays < 0)) return;
    if (days === undefined && leadTimeDays === undefined) return;
    setCompanyTarget(
      { ...(days !== undefined ? { daysOfSupply: days } : {}), ...(leadTimeDays !== undefined ? { leadTimeDays } : {}) },
      {
        onSuccess: () => {
          toast({ title: 'Saved', description: 'Company default replenishment target updated.' });
          setCompanyDraft('');
          setCompanyLeadTimeDraft('');
        },
        onError,
      },
    );
  };

  const addTechOverride = () => {
    if (!newTechId) return;
    const days = newTechDays.trim() === '' ? undefined : parseFloat(newTechDays);
    const factor = newTechFactor.trim() === '' ? undefined : parseFloat(newTechFactor);
    setTechTarget(
      { technicianId: newTechId, daysOfSupply: days ?? null, distanceAdjustmentFactor: factor ?? null },
      {
        onSuccess: () => {
          toast({ title: 'Saved', description: 'Technician replenishment target updated.' });
          setNewTechId(''); setNewTechDays(''); setNewTechFactor('');
        },
        onError,
      },
    );
  };

  const addProductOverride = () => {
    const productId = parseInt(newProductId, 10);
    // Same "blank = leave unchanged" rule as the company default: a manager
    // editing just the lead time for an existing override must not wipe its
    // days-of-supply value (and vice versa), so an untouched field is
    // omitted from the payload rather than sent as an explicit `null`.
    const days = newProductDays.trim() === '' ? undefined : parseFloat(newProductDays);
    const leadTimeDays = newProductLeadTime.trim() === '' ? undefined : parseFloat(newProductLeadTime);
    if (!productId) return;
    if (days !== undefined && Number.isNaN(days)) return;
    if (leadTimeDays !== undefined && Number.isNaN(leadTimeDays)) return;
    if (days === undefined && leadTimeDays === undefined) return;
    setProductTarget(
      {
        productId,
        ...(days !== undefined ? { daysOfSupply: days } : {}),
        ...(leadTimeDays !== undefined ? { leadTimeDays } : {}),
      },
      {
        onSuccess: () => {
          toast({ title: 'Saved', description: 'Product replenishment target updated.' });
          setNewProductId(''); setNewProductDays(''); setNewProductLeadTime('');
        },
        onError,
      },
    );
  };

  const addCombinedOverride = () => {
    const productId = parseInt(newCombinedProductId, 10);
    const days = newCombinedDays.trim() === '' ? null : parseFloat(newCombinedDays);
    if (!newCombinedTechId || !productId) return;
    setCombinedTarget(
      { technicianId: newCombinedTechId, productId, daysOfSupply: days },
      {
        onSuccess: () => {
          toast({ title: 'Saved', description: 'Technician + product replenishment target updated.' });
          setNewCombinedTechId(''); setNewCombinedProductId(''); setNewCombinedDays('');
        },
        onError,
      },
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-semibold flex-1">Replenishment Targets</h2>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="px-6 py-3 text-xs text-muted-foreground border-b border-border bg-muted/10">
        Target days of on-hand supply and supplier replenishment lead time. Both feed Truck Stock Health and the
        Predictive Restock Recommendations below — keep them current so recommendations fire early enough to matter.
      </p>

      {/* Company default */}
      <div className="px-6 py-4 border-b border-border flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium w-40 shrink-0">Company default</span>
        <input
          type="number" min="0" step="any"
          placeholder={data?.companyDefault.daysOfSupply != null ? String(data.companyDefault.daysOfSupply) : 'Not set'}
          value={companyDraft}
          onChange={(e) => setCompanyDraft(e.target.value)}
          className="w-28 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
        />
        <span className="text-xs text-muted-foreground">days of supply</span>
        <input
          type="number" min="0" step="any"
          placeholder={data?.companyDefault.leadTimeDays != null ? String(data.companyDefault.leadTimeDays) : 'Not set'}
          value={companyLeadTimeDraft}
          onChange={(e) => setCompanyLeadTimeDraft(e.target.value)}
          className="w-28 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
        />
        <span className="text-xs text-muted-foreground">days supplier lead time</span>
        <button
          type="button" onClick={saveCompanyDefault} disabled={isSavingCompany}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {/* Technician overrides */}
      <div className="px-6 py-4 border-b border-border">
        <p className="text-sm font-medium mb-3">Technician overrides</p>
        <div className="space-y-2 mb-3">
          {data?.technicianOverrides.map((row) => (
            <div key={row.id} className="flex items-center gap-3 flex-wrap text-sm">
              <span className="w-40 shrink-0 text-muted-foreground">{shortId(row.technicianId ?? '')}</span>
              <span>{row.daysOfSupply != null ? `${row.daysOfSupply} days` : 'inherits default'}</span>
              <span className="text-muted-foreground">
                {row.distanceAdjustmentFactor != null ? `× ${row.distanceAdjustmentFactor} distance factor` : 'no distance adjustment'}
              </span>
              <button
                type="button"
                onClick={() => clearTechTarget(row.technicianId!, { onError })}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                title="Clear override"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!data?.technicianOverrides.length && (
            <p className="text-xs text-muted-foreground">No technician overrides set.</p>
          )}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={newTechId} onChange={(e) => setNewTechId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
          >
            <option value="">Select technician…</option>
            {technicians.map((t) => <option key={t.clerkUserId} value={t.clerkUserId}>{shortId(t.clerkUserId)}</option>)}
          </select>
          <input
            type="number" min="0" step="any" placeholder="days"
            value={newTechDays} onChange={(e) => setNewTechDays(e.target.value)}
            className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
          />
          <input
            type="number" min="0" step="any" placeholder="distance factor"
            value={newTechFactor} onChange={(e) => setNewTechFactor(e.target.value)}
            className="w-32 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
          />
          <button
            type="button" onClick={addTechOverride}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted"
          >
            <Check className="w-3.5 h-3.5 inline mr-1" />
            Set
          </button>
        </div>
      </div>

      {/* Product overrides */}
      <div className="px-6 py-4">
        <p className="text-sm font-medium mb-3">Product overrides</p>
        <div className="space-y-2 mb-3">
          {data?.productOverrides.map((row) => (
            <div key={row.id} className="flex items-center gap-3 flex-wrap text-sm">
              <span className="w-40 shrink-0">{row.productName}</span>
              <span>{row.daysOfSupply != null ? `${row.daysOfSupply} days` : 'inherits default'}</span>
              <span className="text-muted-foreground">
                {row.leadTimeDays != null ? `${row.leadTimeDays}d lead time` : 'inherits company lead time'}
              </span>
              <button
                type="button"
                onClick={() => clearProductTarget(row.productId!, { onError })}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                title="Clear override"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!data?.productOverrides.length && (
            <p className="text-xs text-muted-foreground">No product overrides set.</p>
          )}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={newProductId} onChange={(e) => setNewProductId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
          >
            <option value="">Select product…</option>
            {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            type="number" min="0" step="any" placeholder="days"
            value={newProductDays} onChange={(e) => setNewProductDays(e.target.value)}
            className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
          />
          <input
            type="number" min="0" step="any" placeholder="lead time (days)"
            value={newProductLeadTime} onChange={(e) => setNewProductLeadTime(e.target.value)}
            className="w-32 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
          />
          <button
            type="button" onClick={addProductOverride}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted"
          >
            <Check className="w-3.5 h-3.5 inline mr-1" />
            Set
          </button>
        </div>
      </div>

      {/* Combined technician+product overrides (most specific) */}
      <div className="px-6 py-4 border-t border-border">
        <p className="text-sm font-medium mb-1">Technician + product overrides</p>
        <p className="text-xs text-muted-foreground mb-3">
          Most specific: this technician's target for this one product only, overriding both the technician and
          product overrides above.
        </p>
        <div className="space-y-2 mb-3">
          {data?.combinedOverrides.map((row) => (
            <div key={row.id} className="flex items-center gap-3 flex-wrap text-sm">
              <span className="w-40 shrink-0 text-muted-foreground">{shortId(row.technicianId ?? '')}</span>
              <span className="w-40 shrink-0">{row.productName}</span>
              <span>{row.daysOfSupply != null ? `${row.daysOfSupply} days` : 'inherits default'}</span>
              <button
                type="button"
                onClick={() => clearCombinedTarget({ technicianId: row.technicianId!, productId: row.productId! }, { onError })}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                title="Clear override"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!data?.combinedOverrides.length && (
            <p className="text-xs text-muted-foreground">No technician + product overrides set.</p>
          )}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={newCombinedTechId} onChange={(e) => setNewCombinedTechId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
          >
            <option value="">Select technician…</option>
            {technicians.map((t) => <option key={t.clerkUserId} value={t.clerkUserId}>{shortId(t.clerkUserId)}</option>)}
          </select>
          <select
            value={newCombinedProductId} onChange={(e) => setNewCombinedProductId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background min-w-48"
          >
            <option value="">Select product…</option>
            {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            type="number" min="0" step="any" placeholder="days"
            value={newCombinedDays} onChange={(e) => setNewCombinedDays(e.target.value)}
            className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-background"
          />
          <button
            type="button" onClick={addCombinedOverride}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted"
          >
            <Check className="w-3.5 h-3.5 inline mr-1" />
            Set
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transaction history (audit) ────────────────────────────────────────────

function TransactionHistoryPanel({ technicians }: { technicians: CompanyMember[] }) {
  const [technicianId, setTechnicianId] = useState('');
  const { data, isLoading } = useInventoryTransactions({ technicianId: technicianId || undefined });

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-3 flex-wrap">
        <History className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-semibold flex-1">Transaction History</h2>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <select
          value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background"
        >
          <option value="">All technicians</option>
          {technicians.map((t) => <option key={t.clerkUserId} value={t.clerkUserId}>{shortId(t.clerkUserId)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">When</th>
              <th className="px-6 py-3">Movement</th>
              <th className="px-6 py-3">Product</th>
              <th className="px-6 py-3">Qty</th>
              <th className="px-6 py-3">From → To</th>
              <th className="px-6 py-3">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data?.map((txn) => (
              <tr key={txn.id}>
                <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">
                  {format(new Date(txn.createdAt), 'MMM d, yyyy h:mm a')}
                </td>
                <td className="px-6 py-3">{movementLabel(txn.movementType)}</td>
                <td className="px-6 py-3">{txn.productName}</td>
                <td className="px-6 py-3">{txn.quantity} {txn.unit}</td>
                <td className="px-6 py-3 text-muted-foreground">{txn.source} → {txn.destination}</td>
                <td className="px-6 py-3 text-muted-foreground">{shortId(txn.actingUserId)}</td>
              </tr>
            ))}
            {!data?.length && !isLoading && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  No transactions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Top-level export ────────────────────────────────────────────────────────

export function WarehousePanel({ members }: { members: CompanyMember[] }) {
  const technicians = members.filter((m) => m.role === 'technician');

  return (
    <div className="space-y-8">
      <WarehouseBalances technicians={technicians} />
      <ReplenishmentTargetsPanel technicians={technicians} />
      <TransactionHistoryPanel technicians={technicians} />
    </div>
  );
}
