/**
 * Thin fetch helpers for the few backend endpoints that are NOT part of the
 * generated `@/lib/api-client` client (auth bootstrap + object
 * storage upload URLs). All inspection / analysis / report data goes through
 * the generated React Query hooks instead — see those imports in the screens.
 *
 * The base URL points at the same backend the web app uses. The Clerk bearer
 * token is passed in explicitly by callers (from `useAuth().getToken()`),
 * because there is no browser cookie jar on native.
 */

export const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Network request failed. Check your connection.", 0);
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      code = body?.code;
      message = body?.error || body?.message || message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Auth bootstrap (raw endpoints, not in the generated client) ──────────────

export interface CurrentCompany {
  id: number;
  name: string;
  betaAccess?: boolean;
}

export interface CurrentUser {
  id: number | string;
  clerkUserId: string;
  /** Actual DB role — unchanged by impersonation. */
  role: string;
  /** Active role after applying roleOverride (use this for UI gates). */
  effectiveRole: string;
  /** Non-null while the super admin is impersonating a role. */
  roleOverride: string | null;
  isSuperAdmin: boolean;
  companyId: number | null;
  betaAccess: boolean;
  company?: CurrentCompany | null;
}

export interface AdminUser {
  id: number;
  clerkUserId: string;
  role: string;
  roleOverride: string | null;
  isSuperAdmin: boolean;
  betaAccess: boolean;
  companyId: number | null;
  companyName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export function fetchCurrentUser(token: string | null, init?: RequestInit) {
  return request<CurrentUser>("/api/auth/me", token, init);
}

export function createCompany(token: string | null, name: string) {
  return request<CurrentCompany>("/api/auth/company", token, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function acceptInvite(token: string | null, inviteToken: string) {
  return request<{ success?: boolean }>("/api/auth/accept-invite", token, {
    method: "POST",
    body: JSON.stringify({ token: inviteToken }),
  });
}

// ─── Super-admin helpers ──────────────────────────────────────────────────────

export function bootstrapSuperAdmin(token: string | null, bootstrapToken: string) {
  return request<{ success: boolean; message: string; isSuperAdmin: boolean }>(
    "/api/admin/bootstrap",
    token,
    { method: "POST", body: JSON.stringify({ token: bootstrapToken }) },
  );
}

export function fetchAdminUsers(token: string | null) {
  return request<AdminUser[]>("/api/admin/users", token);
}

export function patchAdminUser(
  token: string | null,
  userId: number,
  updates: { role?: string; isSuperAdmin?: boolean; betaAccess?: boolean },
) {
  return request<AdminUser>(`/api/admin/users/${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function setRoleOverride(token: string | null, role: string | null) {
  return request<{ success: boolean; roleOverride: string | null }>(
    "/api/auth/me/role-override",
    token,
    { method: "POST", body: JSON.stringify({ role }) },
  );
}

export interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
}

export function requestUploadUrl(
  token: string | null,
  args: { name: string; size?: number; contentType?: string },
) {
  return request<UploadUrlResponse>("/api/storage/uploads/request-url", token, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

// ─── Inspection state transitions (not in generated client) ──────────────────

export interface ReopenInspectionResult {
  id: number;
  status: string;
  completedAt: string | null;
  alreadyOpen: boolean;
}

export function reopenInspection(token: string | null, id: number) {
  return request<ReopenInspectionResult>(`/api/inspections/${id}/reopen`, token, {
    method: "POST",
  });
}

// ─── Field-service platform integrations ─────────────────────────────────────

export type FieldIntegrationSystem = "pestpac" | "fieldroutes";

export interface FieldIntegrationConfig {
  id: number;
  systemType: FieldIntegrationSystem;
  accountId: string;
  apiBaseUrl: string | null;
  enabled: boolean;
  updatedAt: string;
}

export type IntegrationConfigResponse =
  | { configured: false }
  | { configured: true; integration: FieldIntegrationConfig };

export interface IntegrationSyncResult {
  success: boolean;
  externalSystem: FieldIntegrationSystem;
  postedNotes: boolean;
  attachmentsPosted: number;
  error?: string;
}

export function fetchIntegrationConfig(token: string | null) {
  return request<IntegrationConfigResponse>("/api/integrations/config", token);
}

export function triggerIntegrationSync(token: string | null, inspectionId: number) {
  return request<IntegrationSyncResult>("/api/integrations/sync", token, {
    method: "POST",
    body: JSON.stringify({ inspectionId }),
  });
}

export interface SaveIntegrationConfigArgs {
  systemType: FieldIntegrationSystem;
  accountId: string;
  apiKey: string;
  apiBaseUrl?: string;
  enabled?: boolean;
}

export function saveIntegrationConfig(
  token: string | null,
  args: SaveIntegrationConfigArgs,
) {
  return request<{ configured: true; systemType: string; accountId: string }>(
    "/api/integrations/config",
    token,
    { method: "PUT", body: JSON.stringify(args) },
  );
}

export function deleteIntegrationConfig(token: string | null) {
  return request<{ configured: false }>("/api/integrations/config", token, {
    method: "DELETE",
  });
}

// ─── Property memory ─────────────────────────────────────────────────────────

export interface HistoricalFinding {
  category: string;
  description: string;
  frequency: number;
  severity?: "low" | "medium" | "high";
}

export interface PropertyMemoryData {
  id: number;
  companyId: number;
  addressKey: string;
  siteAddress: string;
  lastInspectionId: number | null;
  lastVisitedAt: string | null;
  historicalPests: string[];
  historicalFindings: HistoricalFinding[];
  createdAt: string;
  updatedAt: string;
}

export type PropertyMemoryResponse =
  | { found: false }
  | { found: true; data: PropertyMemoryData };

export function fetchPropertyMemory(token: string | null, siteAddress: string) {
  return request<PropertyMemoryResponse>(
    `/api/properties/memory?siteAddress=${encodeURIComponent(siteAddress)}`,
    token,
  );
}

// ─── Bulk dataset ingestion ───────────────────────────────────────────────────

export interface BulkIngestMetadata {
  category: string;
  subcategory?: string;
  possiblePest?: string;
  possibleConduciveCondition?: string;
  possibleEntryPoint?: string;
  severity?: "low" | "moderate" | "high" | "critical";
  locationType?: string;
  notes?: string;
}

export interface BulkIngestResult {
  created: number;
  failed: number;
  recordIds: number[];
}

export function bulkIngestDataset(
  token: string | null,
  images: Array<{ objectPath: string; filename?: string }>,
  metadata: BulkIngestMetadata,
) {
  return request<BulkIngestResult>("/api/intelligence-dataset/bulk-ingest", token, {
    method: "POST",
    body: JSON.stringify({ images, metadata }),
  });
}
