import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

export interface TeamInventoryItem {
  productId: number;
  productName: string;
  epaRegistrationNumber: string | null;
  quantityOnHand: number;
  unit: string;
  restockThreshold: number | null;
  updatedAt: string;
  /**
   * Sum of totalProductOz this technician has applied today for this product.
   * ALWAYS fluid ounces — treatment_logs.totalProductOz is recorded in fl oz
   * regardless of `unit` above (which may be gallon, lb, etc.). Never render
   * this value with the `unit` field; label it "fl oz" explicitly.
   */
  appliedToday?: number;
}

export interface TeamInventoryEntry {
  technicianId: string;
  technicianName: string | null;
  role: string;
  inventoryCount: number;
  lastRestockedAt: string | null;
  items: TeamInventoryItem[];
}

export function useTeamInventory() {
  return useQuery<TeamInventoryEntry[]>({
    queryKey: ['team-inventory'],
    queryFn: () => {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      return fetch(apiUrl(`/manager/team-inventory?tzOffsetMinutes=${tzOffsetMinutes}`), {
        credentials: 'include',
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to load team inventory');
        return r.json() as Promise<TeamInventoryEntry[]>;
      });
    },
  });
}

export function useSetTechThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      technicianId,
      productId,
      restockThreshold,
    }: {
      technicianId: string;
      productId: number;
      restockThreshold: number | null;
    }) =>
      fetch(
        apiUrl(`/manager/inventory/${encodeURIComponent(technicianId)}/${productId}`),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restockThreshold }),
        },
      ).then((r) => {
        if (!r.ok) throw new Error('Failed to update threshold');
        return r.json();
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['team-inventory'] });
      void qc.invalidateQueries({ queryKey: ['pending-restocks'] });
    },
  });
}
