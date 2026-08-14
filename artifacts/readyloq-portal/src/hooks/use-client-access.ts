/**
 * Data hooks for the Client Access management page.
 * Uses the same /api/client/invites endpoints defined in client-portal.ts.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

export interface ClientAccessRecord {
  id: number;
  companyId: number;
  clerkUserId: string;
  email: string | null;
  label: string | null;
  siteAddresses: string[];
  createdAt: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json();
}

/** List all property manager access grants for the current company. */
export function useClientInvites() {
  return useQuery<ClientAccessRecord[]>({
    queryKey: ['client', 'invites'],
    queryFn: () => apiFetch('/client/invites'),
    retry: false,
  });
}

/** Grant (or extend) access to a property manager. */
export function useGrantAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      clerkUserId: string;
      email?: string;
      label?: string;
      siteAddresses: string[];
    }) => apiFetch<ClientAccessRecord>('/client/invites', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', 'invites'] }),
  });
}

/** Remove a property manager's access entirely. */
export function useRevokeAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/client/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', 'invites'] }),
  });
}

/** Unique building addresses from the company's inspection history. */
export function useCompanyAddresses() {
  return useQuery<string[]>({
    queryKey: ['properties', 'addresses'],
    queryFn: async () => {
      const data = await apiFetch<Array<{ siteAddress: string }>>('/properties');
      return data.map((p) => p.siteAddress).filter(Boolean).sort();
    },
    retry: false,
    staleTime: 60_000,
  });
}
