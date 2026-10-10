import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClientMe {
  id: number;
  label: string | null;
  email: string | null;
  siteAddresses: string[];
  company: { id: number; name: string; slug: string } | null;
  createdAt: string;
}

export interface BuildingSummary {
  siteAddress: string;
  totalInspections: number;
  completedInspections: number;
  lastVisitedAt: string | null;
  lastInspectionId: number | null;
  pestTypes: string[];
}

export interface ClientInspection {
  id: number;
  status: string;
  technicianName: string;
  pestTypes: string[];
  severity: string | null;
  findingsCount: number;
  mediaCount: number;
  createdAt: string;
  completedAt: string | null;
  signedAt: string | null;
  /** True when the technician signed on behalf of an absent owner/tenant. */
  ownerNotAvailable: boolean;
  /** True when a technician signature is on file (SVG not returned). */
  technicianSigned: boolean;
  /** True when an owner/tenant signature is on file (SVG not returned). */
  ownerSigned: boolean;
}

export interface ClientInspectionMedia {
  id: number;
  mediaType: 'photo' | 'image' | string;
  filename: string | null;
  caption: string | null;
  captureSource: string;
  qualityScore: number | null;
  zoomSubject: string | null;
  capturedAt: string;
  /** Client-scoped URL; the underlying storage path is never exposed. */
  imageUrl: string;
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

export interface ClientReportDetail extends ClientReport {
  findings: unknown[];
  recommendations: unknown[];
  aiNarrative: string | null;
}

export interface PestTrendRow {
  month: string;
  pestType: string;
  count: number;
}

export interface InspectionCountRow {
  month: string;
  inspections: number;
}

export interface BuildingTrends {
  pestTrends: PestTrendRow[];
  inspectionCounts: InspectionCountRow[];
}

// ── API fetcher ───────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

async function apiFetch<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(path), {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? 'API error');
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Only fires when `enabled` is true (i.e. the Clerk session is confirmed).
 * Passing enabled=false prevents the API call from running for unauthenticated
 * visitors, which would cause a hanging 401 and an infinite spinner.
 */
export function useClientMe(enabled = true) {
  return useQuery<ClientMe>({
    queryKey: ['client', 'me'],
    queryFn: () => apiFetch('/client/me'),
    retry: false,
    enabled,
    staleTime: 60_000,
  });
}

export function useClientBuildings() {
  return useQuery<BuildingSummary[]>({
    queryKey: ['client', 'buildings'],
    queryFn: () => apiFetch('/client/buildings'),
  });
}

export function useClientInspections(address: string) {
  return useQuery<ClientInspection[]>({
    queryKey: ['client', 'buildings', address, 'inspections'],
    queryFn: () =>
      apiFetch(`/client/buildings/${encodeURIComponent(address)}/inspections`),
    enabled: !!address,
  });
}

export function useClientInspectionMedia(inspectionId: number | null) {
  return useQuery<ClientInspectionMedia[]>({
    queryKey: ['client', 'inspections', inspectionId, 'media'],
    queryFn: () => apiFetch(`/client/inspections/${inspectionId}/media`),
    enabled: inspectionId != null,
    staleTime: 60_000,
  });
}

export function useClientReports(address: string) {
  return useQuery<ClientReport[]>({
    queryKey: ['client', 'buildings', address, 'reports'],
    queryFn: () =>
      apiFetch(`/client/buildings/${encodeURIComponent(address)}/reports`),
    enabled: !!address,
  });
}

export function useBuildingTrends(address: string) {
  return useQuery<BuildingTrends>({
    queryKey: ['client', 'buildings', address, 'trends'],
    queryFn: () =>
      apiFetch(`/client/buildings/${encodeURIComponent(address)}/trends`),
    enabled: !!address,
  });
}

export function useClientReport(id: number | null) {
  return useQuery<ClientReportDetail>({
    queryKey: ['client', 'reports', id],
    queryFn: () => apiFetch(`/client/reports/${id}`),
    enabled: id != null,
  });
}
