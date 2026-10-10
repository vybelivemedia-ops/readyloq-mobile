/**
 * Hooks for the Warehouse tier, the immutable transaction ledger, and
 * replenishment-target configuration.
 *
 *  useWarehouseInventory()      — company warehouse balances per product
 *  useReceiveWarehouseStock()   — record a supplier receipt into the warehouse
 *  useTransferToTruck()         — atomic warehouse → technician-truck transfer
 *  useInventoryTransactions()   — audit history, filterable by tech/product
 *  useReplenishmentTargets()    — company default + tech/product overrides
 *  useSetCompanyReplenishmentTarget()
 *  useSetTechnicianReplenishmentTarget() / useClearTechnicianReplenishmentTarget()
 *  useSetProductReplenishmentTarget() / useClearProductReplenishmentTarget()
 *  useTeamStockHealth()          — Truck Stock Health projection, team-wide
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

// ── Product catalogue (for the warehouse-receive & product-override pickers) ──

export interface Product {
  id: number;
  name: string;
  epaRegistrationNumber: string | null;
}

export function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/products'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load products');
      const rows: Array<{ id: number; name: string; epaRegistrationNumber: string | null }> = await res.json();
      return rows.map((r) => ({ id: r.id, name: r.name, epaRegistrationNumber: r.epaRegistrationNumber }));
    },
    staleTime: 5 * 60_000,
  });
}

// ── Warehouse balances ─────────────────────────────────────────────────────

export interface WarehouseItem {
  productId: number;
  productName: string;
  epaRegistrationNumber: string | null;
  quantityOnHand: number;
  unit: string;
  updatedAt: string;
}

const WAREHOUSE_KEY = ['warehouse-inventory'] as const;

export function useWarehouseInventory() {
  return useQuery<WarehouseItem[]>({
    queryKey: WAREHOUSE_KEY,
    queryFn: async () => {
      const res = await fetch(apiUrl('/manager/warehouse'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load warehouse inventory');
      return res.json();
    },
  });
}

export function useReceiveWarehouseStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { productId: number; quantity: number; unit: string; notes?: string }) => {
      const res = await fetch(apiUrl('/manager/warehouse/receive'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to receive warehouse stock');
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WAREHOUSE_KEY });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });
}

// ── Truck Stock Health (proactive, trending — independent of today's schedule) ──
//
// Projected "days of coverage remaining" per product (on-hand ÷ recent
// average daily consumption), compared to the configured replenishment
// target window. Distinct from Today's Route Readiness (see
// use-schedule.ts's useTeamRouteReadiness), which only looks at today's
// stops, and from the existing reactive restockThreshold alert (unchanged).

export type StockHealthStatus = 'trending-short' | 'healthy' | 'no-target-configured' | 'insufficient-data';

export interface StockHealthItem {
  productId: number;
  productName: string;
  unit: string;
  quantityOnHand: number;
  projectedDaysCoverage: number | null;
  targetDaysOfSupply: number | null;
  targetScope: 'combined' | 'technician' | 'product' | 'company' | 'none';
  status: StockHealthStatus;
}

export interface TechnicianStockHealth {
  technicianId: string;
  lookbackDays: number;
  items: StockHealthItem[];
}

export function useTeamStockHealth() {
  return useQuery<TechnicianStockHealth[]>({
    queryKey: ['team-stock-health'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/manager/team-stock-health'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load team stock health');
      return res.json();
    },
  });
}

export function useTransferToTruck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      technicianId: string;
      productId: number;
      quantity: number;
      notes?: string;
    }) => {
      const res = await fetch(apiUrl('/manager/warehouse/transfer'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to transfer stock');
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WAREHOUSE_KEY });
      void qc.invalidateQueries({ queryKey: ['team-inventory'] });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });
}

// ── Transaction ledger (audit history) ─────────────────────────────────────

export interface InventoryTransaction {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  unit: string;
  movementType: string;
  source: string;
  destination: string;
  technicianId: string | null;
  actingUserId: string;
  referenceId: number | null;
  notes: string | null;
  createdAt: string;
}

export function useInventoryTransactions(filters: { technicianId?: string; productId?: number } = {}) {
  const { technicianId, productId } = filters;
  return useQuery<InventoryTransaction[]>({
    queryKey: ['inventory-transactions', technicianId ?? null, productId ?? null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (technicianId) params.set('technicianId', technicianId);
      if (productId) params.set('productId', String(productId));
      const qs = params.toString();
      const res = await fetch(apiUrl(`/manager/inventory-transactions${qs ? `?${qs}` : ''}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load transaction history');
      return res.json();
    },
  });
}

// ── Replenishment targets ──────────────────────────────────────────────────

export interface ReplenishmentTargetRow {
  id: number;
  technicianId: string | null;
  productId: number | null;
  daysOfSupply: number | null;
  distanceAdjustmentFactor: number | null;
  /** Supplier replenishment lead time (days) — only ever set on company-default/product-scoped rows. */
  leadTimeDays: number | null;
  updatedAt: string;
}

export interface ReplenishmentTargets {
  companyDefault: { daysOfSupply: number | null; leadTimeDays: number | null; updatedAt: string | null };
  technicianOverrides: ReplenishmentTargetRow[];
  productOverrides: (ReplenishmentTargetRow & { productName: string })[];
  combinedOverrides: (ReplenishmentTargetRow & { productName: string })[];
}

const TARGETS_KEY = ['replenishment-targets'] as const;

export function useReplenishmentTargets() {
  return useQuery<ReplenishmentTargets>({
    queryKey: TARGETS_KEY,
    queryFn: async () => {
      const res = await fetch(apiUrl('/manager/replenishment-targets'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load replenishment targets');
      return res.json();
    },
  });
}

export function useSetCompanyReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { daysOfSupply?: number | null; leadTimeDays?: number | null }) => {
      const res = await fetch(apiUrl('/manager/replenishment-targets/company'), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to save company target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}

export function useSetTechnicianReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      technicianId: string;
      daysOfSupply?: number | null;
      distanceAdjustmentFactor?: number | null;
    }) => {
      const { technicianId, ...body } = input;
      const res = await fetch(
        apiUrl(`/manager/replenishment-targets/technician/${encodeURIComponent(technicianId)}`),
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error('Failed to save technician target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}

export function useClearTechnicianReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (technicianId: string) => {
      const res = await fetch(
        apiUrl(`/manager/replenishment-targets/technician/${encodeURIComponent(technicianId)}`),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to clear technician target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}

export function useSetProductReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      productId: number;
      daysOfSupply?: number | null;
      leadTimeDays?: number | null;
    }) => {
      const { productId, ...body } = input;
      const res = await fetch(apiUrl(`/manager/replenishment-targets/product/${productId}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to save product target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}

export function useClearProductReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId: number) => {
      const res = await fetch(apiUrl(`/manager/replenishment-targets/product/${productId}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to clear product target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}

// Most-specific override: one technician's days-of-supply for one product.
export function useSetCombinedReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { technicianId: string; productId: number; daysOfSupply: number | null }) => {
      const res = await fetch(
        apiUrl(
          `/manager/replenishment-targets/technician/${encodeURIComponent(input.technicianId)}/product/${input.productId}`,
        ),
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ daysOfSupply: input.daysOfSupply }),
        },
      );
      if (!res.ok) throw new Error('Failed to save combined target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}

export function useClearCombinedReplenishmentTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { technicianId: string; productId: number }) => {
      const res = await fetch(
        apiUrl(
          `/manager/replenishment-targets/technician/${encodeURIComponent(input.technicianId)}/product/${input.productId}`,
        ),
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to clear combined target');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: TARGETS_KEY }),
  });
}
