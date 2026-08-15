/**
 * Data hooks for the property-manager client portal view.
 * Calls the read-only /api/client/* endpoints that are scoped to the
 * caller's siteAddresses via clientPortalAccessTable.
 */
import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BuildingSummary {
  siteAddress: string;
  totalInspections: number;
  completedInspections: number;
  lastVisitedAt: string | null;
  lastInspectionId: number | null;
  pestTypes: string[];
}

export interface ClientReport {
  id: number;
  inspectionId: number;
  title: string;
  status: string;
  severity: string | null;
  technicianName: string;
  inspectionDate: string | null;
  pdfUrl: string | null;
  exclusionOpportunities: string[];
  createdAt: string;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json();
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useClientBuildings() {
  return useQuery<BuildingSummary[]>({
    queryKey: ['client', 'buildings'],
    queryFn: () => apiFetch('/client/buildings'),
    retry: false,
    staleTime: 60_000,
  });
}

export function useClientReports(address: string) {
  return useQuery<ClientReport[]>({
    queryKey: ['client', 'buildings', address, 'reports'],
    queryFn: () =>
      apiFetch(`/client/buildings/${encodeURIComponent(address)}/reports`),
    enabled: !!address,
    staleTime: 60_000,
  });
}
