import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '../config';

export interface RestockEventEntry {
  /** Numeric id for a confirmed receipt row, or "order-<id>" for a placed
   *  order that hasn't been received yet (source === 'supplier_api'). */
  id: number | string;
  productId: number;
  productName: string;
  quantityReceived: number;
  unit: string;
  source: string;
  supplierOrderRef: string | null;
  notes: string | null;
  receivedAt: string;
}

export interface CarriedEntry {
  productId: number;
  productName: string;
  targetPest: string;
  notes?: string;
}

export interface AppliedEntry {
  inspectionId: number;
  siteAddress: string;
  productId: number;
  productName: string;
  targetPest: string;
  siteClassification: string;
  totalProductOz: number | null;
  areaSqft: number | null;
  appliedAt: string;
}

export interface TechActivityDay {
  date: string;
  ordered: RestockEventEntry[];
  carried: CarriedEntry[];
  applied: AppliedEntry[];
}

export interface TechActivityData {
  technicianId: string;
  technicianName: string | null;
  days: TechActivityDay[];
}

export function useTechActivity(
  userId: string | null,
  startDate?: string,
  endDate?: string,
) {
  return useQuery<TechActivityData>({
    queryKey: ['tech-activity', userId, startDate, endDate],
    enabled: !!userId,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (startDate) qs.set('startDate', startDate);
      if (endDate) qs.set('endDate', endDate);
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await fetch(
        apiUrl(`/manager/tech-activity/${encodeURIComponent(userId!)}${q}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`Failed to load tech activity: ${res.status}`);
      return res.json();
    },
  });
}

// ─── Live supplier order status ────────────────────────────────────────────

export type RestockOrderStatus =
  | { status: 'pending' }
  | { status: 'processing' }
  | { status: 'shipped'; trackingNumber?: string }
  | { status: 'delivered'; deliveredAt: string }
  | { status: 'cancelled'; reason?: string };

export type RestockOrderStatusResponse = RestockOrderStatus & {
  orderRef: string;
  supplierName: string;
  placedAt: string;
};

/**
 * Fetches the live fulfilment status for a placed supplier order
 * (GET /manager/restock-orders/:orderRef). Used to show a status badge next
 * to supplier_api restock events in the Tech Activity timeline.
 */
export function useRestockOrderStatus(orderRef: string | null) {
  return useQuery<RestockOrderStatusResponse>({
    queryKey: ['restock-order-status', orderRef],
    enabled: !!orderRef,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/manager/restock-orders/${encodeURIComponent(orderRef!)}`),
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`Failed to load order status: ${res.status}`);
      return res.json();
    },
  });
}
