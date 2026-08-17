/**
 * Data hooks for the Enterprise Integrations settings page.
 * All routes live under /api/integrations on the API server.
 * Credentials are write-only: the GET config route never returns api_key.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

export type IntegrationSystemType = 'pestpac' | 'fieldroutes' | 'servsuite';

export interface IntegrationConfig {
  id: number;
  systemType: IntegrationSystemType;
  accountId: string;
  apiBaseUrl: string | null;
  enabled: boolean;
  updatedAt: string;
}

export interface IntegrationConfigResponse {
  configured: boolean;
  integration?: IntegrationConfig;
}

export interface IntegrationConfigInput {
  systemType: IntegrationSystemType;
  accountId: string;
  apiKey: string;
  apiToken?: string;
  apiBaseUrl?: string;
  enabled?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  reason?: 'auth_failed' | 'network_error';
  message?: string;
}

export interface SyncLogEntry {
  id: number;
  inspectionId: number;
  systemType: IntegrationSystemType;
  success: boolean;
  errorMessage: string | null;
  syncedAt: string;
  resultJson: unknown;
  siteAddress: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null) ?? `API error ${res.status}`,
    );
  }
  return body as T;
}

const CONFIG_KEY = ['integrations', 'config'];
const HISTORY_KEY = ['integrations', 'sync-history'];

export function useIntegrationConfig() {
  return useQuery<IntegrationConfigResponse>({
    queryKey: CONFIG_KEY,
    queryFn: () => apiFetch('/integrations/config'),
    retry: false,
  });
}

export function useSaveIntegrationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IntegrationConfigInput) =>
      apiFetch<{ configured: boolean }>('/integrations/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY }),
  });
}

export function useDeleteIntegrationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ configured: boolean }>('/integrations/config', { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY });
      qc.invalidateQueries({ queryKey: HISTORY_KEY });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: () => apiFetch<TestConnectionResult>('/integrations/test', { method: 'POST' }),
  });
}

export function useSyncHistory(inspectionId?: number) {
  return useQuery<{ logs: SyncLogEntry[] }>({
    queryKey: inspectionId != null ? [...HISTORY_KEY, inspectionId] : HISTORY_KEY,
    queryFn: () =>
      apiFetch(
        inspectionId != null
          ? `/integrations/sync-history?inspectionId=${inspectionId}`
          : '/integrations/sync-history',
      ),
    retry: false,
  });
}

export function useSyncInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inspectionId: number) =>
      apiFetch<Record<string, unknown>>('/integrations/sync', {
        method: 'POST',
        body: JSON.stringify({ inspectionId }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

export const SYSTEM_LABELS: Record<IntegrationSystemType, string> = {
  pestpac: 'PestPac',
  fieldroutes: 'FieldRoutes',
  servsuite: 'ServSuite',
};
