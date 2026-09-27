/**
 * Hooks for the FAIE predictive restock recommendations API (Task #918).
 *
 * A fourth, distinct proactive signal from the reactive restock alert
 * (use-pending-restocks.ts), Today's Route Readiness (use-schedule.ts), and
 * Truck Stock Health (use-warehouse.ts): forward-looking, adaptively
 * recomputed server-side from a recency-weighted consumption trend, upcoming
 * scheduled-route demand, and configured supplier lead time. This hook only
 * reads/dismisses/converts — all forecasting math lives on the server.
 *
 *  usePredictiveRestocks()          — fetch open (pending) recommendations
 *  useDismissPredictiveRestock()    — dismiss a recommendation
 *  useConvertPredictiveRestock()    — convert into a normal restock alert
 *                                      (reuses the existing manager-approval
 *                                      → supplier-order pipeline; never
 *                                      places an order directly)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

// NOTE: `status` below is the recommendation's LIFECYCLE status
// (pending/dismissed/converted — has a manager acted on it?), not the
// server's forecast-computation status (predicted-shortfall/healthy/
// insufficient-data/no-target-configured/no-lead-time-configured, computed
// in predictive-restocking.ts). Only rows the server judged
// "predicted-shortfall" are ever persisted/returned here, so the forecast
// status itself never needs to reach the client — don't reintroduce it as a
// second, differently-valued "status" type on this interface.
export interface PredictiveRestockRecommendation {
  id: number;
  technicianId: string;
  productId: number;
  productName: string;
  quantityOnHand: number;
  unit: string;
  projectedDailyRate: number | null;
  leadTimeDays: number | null;
  safetyStockDays: number | null;
  reorderPointQuantity: number | null;
  recommendedOrderQuantity: number | null;
  scheduledStopCount: number;
  projectedBreachAt: string | null;
  recommendedByAt: string;
  status: 'pending' | 'dismissed' | 'converted';
  convertedAlertId: number | null;
  resolvedAt: string | null;
  updatedAt: string;
}

const QUERY_KEY = ['predictive-restocks'] as const;

export function usePredictiveRestocks() {
  return useQuery<PredictiveRestockRecommendation[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(apiUrl('/manager/predictive-restocks'), { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load predictive restock recommendations: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useDismissPredictiveRestock() {
  const queryClient = useQueryClient();
  return useMutation<PredictiveRestockRecommendation, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(apiUrl(`/manager/predictive-restocks/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'dismissed' }),
      });
      if (!res.ok) throw new Error(`Failed to dismiss recommendation: ${res.status}`);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useConvertPredictiveRestock() {
  const queryClient = useQueryClient();
  return useMutation<{ id: number; status: string; alertId: number }, Error, number>({
    mutationFn: async (id) => {
      const res = await fetch(apiUrl(`/manager/predictive-restocks/${id}/convert-to-alert`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to convert recommendation: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['pending-restocks'] });
    },
  });
}
