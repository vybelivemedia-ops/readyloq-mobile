/**
 * Hooks for the manager pending-restock-requests API.
 *
 *  usePendingRestocks()       — fetch all open restock alerts for this company
 *  useUpdateRestockRequest()  — dismiss or approve a single alert
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

export interface PendingRestockRequest {
  id: number;
  technicianId: string;
  productId: number;
  productName: string;
  quantityOnHand: number;
  restockThreshold: number;
  shortfall: number;
  status: 'pending' | 'approved' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRestockResponse extends PendingRestockRequest {
  resolvedAt: string | null;
  /**
   * Supplier order reference (e.g. "VSR-20240101-ABCD1234") when approving the
   * alert triggered an automatic supplier order. Null when the company has no
   * active supplier connection, or when the request was a dismissal.
   */
  supplierOrderRef: string | null;
}

const QUERY_KEY = ['pending-restocks'] as const;

export function usePendingRestocks() {
  return useQuery<PendingRestockRequest[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(apiUrl('/manager/pending-restocks'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to load restock alerts: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,   // alerts are refreshed when a tech logs a treatment
    refetchOnWindowFocus: true,
  });
}

export function useUpdateRestockRequest() {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateRestockResponse,
    Error,
    { id: number; status: 'approved' | 'dismissed' }
  >({
    mutationFn: async ({ id, status }) => {
      const res = await fetch(apiUrl(`/manager/pending-restocks/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Failed to update restock alert: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
