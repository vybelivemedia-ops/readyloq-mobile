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
  /** Whether push notifications are enabled for this user. */
  pushNotificationsEnabled: boolean;
  /** True when a valid Expo push token is stored server-side for this user. */
  hasPushToken: boolean;
  /**
   * ISO timestamp of the last Expo push delivery failure for this user,
   * or null when no failure is recorded. Set server-side when a push ticket
   * returns an error; cleared when the owner dismisses the banner or
   * re-registers their push token.
   */
  pushLastFailedAt: string | null;
  /**
   * True when the owner has opted out of the daily briefing email.
   * Always true for property_manager (they have no staff row).
   */
  briefingEmailOptOut: boolean;
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

export type IntegrationProbeFailureReason = "auth_failed" | "network_error";

export interface IntegrationProbeResult {
  ok: boolean;
  reason?: IntegrationProbeFailureReason;
  message?: string;
}

/**
 * Fires a lightweight auth probe against the stored credentials.
 * The api_key is read from the server DB — no credential is sent from the app.
 */
export function testIntegrationCredentials(token: string | null) {
  return request<IntegrationProbeResult>("/api/integrations/test", token, {
    method: "POST",
  });
}

export interface SyncHistoryEntry {
  id: number;
  inspectionId: number;
  systemType: FieldIntegrationSystem;
  success: boolean;
  errorMessage: string | null;
  syncedAt: string;
  siteAddress: string | null;
}

export interface SyncHistoryResponse {
  logs: SyncHistoryEntry[];
}

export function fetchSyncHistory(
  token: string | null,
  inspectionId?: number,
) {
  const qs = inspectionId !== undefined ? `?inspectionId=${inspectionId}` : "";
  return request<SyncHistoryResponse>(`/api/integrations/sync-history${qs}`, token);
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

// ─── Company Playbooks & Learning Engine ─────────────────────────────────────

export interface PlaybookRequiredStep {
  id: string;
  label: string;
}

export interface ChemicalRestriction {
  name: string;
  reason?: string;
}

export interface CompanyPlaybook {
  id: number;
  companyId: number;
  title: string;
  targetPests: string[];
  requiredSteps: PlaybookRequiredStep[];
  chemicalRestrictions: ChemicalRestriction[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceViolation {
  playbookId: number;
  playbookTitle: string;
  type: "missing_step" | "restricted_chemical";
  missingStep?: string;
  restrictedChemical?: string;
  severity: "WARNING" | "ERROR";
  message: string;
}

export interface ComplianceResult {
  compliant: boolean;
  violations: ComplianceViolation[];
}

export type NewPlaybookInput = {
  title: string;
  targetPests: string[];
  requiredSteps: PlaybookRequiredStep[];
  chemicalRestrictions: ChemicalRestriction[];
  notes?: string;
  isActive?: boolean;
};

export function fetchActivePlaybooks(token: string | null) {
  return request<{ success: true; playbooks: CompanyPlaybook[] }>(
    "/api/playbooks/active",
    token,
  );
}

export function fetchAllPlaybooks(token: string | null) {
  return request<{ success: true; playbooks: CompanyPlaybook[] }>(
    "/api/playbooks",
    token,
  );
}

export function fetchPlaybookCompliance(
  token: string | null,
  inspectionId: number,
) {
  return request<{ success: true } & ComplianceResult>(
    `/api/playbooks/compliance?inspectionId=${inspectionId}`,
    token,
  );
}

export function createPlaybook(token: string | null, input: NewPlaybookInput) {
  return request<{ success: true; playbook: CompanyPlaybook }>(
    "/api/playbooks",
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updatePlaybook(
  token: string | null,
  id: number,
  input: Partial<NewPlaybookInput>,
) {
  return request<{ success: true; playbook: CompanyPlaybook }>(
    `/api/playbooks/${id}`,
    token,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function deletePlaybook(token: string | null, id: number) {
  return request<{ success: true }>(`/api/playbooks/${id}`, token, {
    method: "DELETE",
  });
}

// ─── Executive Intelligence Dashboard ────────────────────────────────────────

export interface ExecutiveTechnician {
  name: string;
  avgQuality: number;
  inspectionCount: number;
}

export interface ExecutiveMetrics {
  pipelineValue: number;
  openOpportunities: number;
  wonOpportunities: number;
  totalScorecards: number;
  avgQualityScore: number;
  riskDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  topTechnicians: ExecutiveTechnician[];
  inspectionsThisMonth: number;
  inspectionsLastMonth: number;
}

export function fetchExecutiveMetrics(token: string | null) {
  return request<{ success: true; metrics: ExecutiveMetrics }>(
    "/api/executive/intelligence",
    token,
  );
}

export type ExecutiveRiskLevel = "critical" | "high" | "medium" | "low";

export interface ExecutiveRiskInspection {
  inspectionId: number;
  siteAddress: string;
  technicianName: string;
  qualityScore: number;
  riskLevel: ExecutiveRiskLevel;
  riskScore: number;
  scoredAt: string;
}

export interface ExecutiveQualityWeek {
  weekStart: string;
  label: string;
  avgQuality: number;
}

export function fetchExecutiveQualityTrend(token: string | null) {
  return request<{ success: true; weeks: ExecutiveQualityWeek[] }>(
    "/api/executive/quality-trend",
    token,
  );
}

export interface ExecutiveInspectionFilters {
  technicianName?: string;

  since?: string; // ISO date string, e.g. "2026-07-01"

  offset?: number; // pagination offset (default 0, page size 100)
}

export interface ExecutiveInspectionsResponse {
  success: true;
  riskLevel: ExecutiveRiskLevel;
  filters: { technicianName: string | null; since: string | null };
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
  total: number;
  hasMore: boolean;
  inspections: ExecutiveRiskInspection[];
}

export function fetchExecutiveInspections(
  token: string | null,
  riskLevel: ExecutiveRiskLevel,
  filters?: ExecutiveInspectionFilters,
) {
  const params = new URLSearchParams({ riskLevel });
  if (filters?.technicianName) params.set("technicianName", filters.technicianName);
  if (filters?.since) params.set("since", filters.since);
  if (filters?.offset != null && filters.offset > 0)
    params.set("offset", String(filters.offset));
  return request<ExecutiveInspectionsResponse>(
    `/api/executive/inspections?${params.toString()}`,
    token,
  );
}

// ─── Monthly velocity drill-down ─────────────────────────────────────────────

export type VelocityMonth = "current" | "last";

export interface VelocityInspection {
  inspectionId: number;
  siteAddress: string;
  technicianName: string;
  completedAt: string;
}

export interface VelocityDetailResponse {
  success: true;
  month: VelocityMonth;
  label: string;
  count: number;
  /** Distinct technician names for the month (always unfiltered). */
  technicians: string[];
  inspections: VelocityInspection[];
}

export function fetchVelocityDetail(
  token: string | null,
  month: VelocityMonth,
  technicianName?: string,
) {
  const params = new URLSearchParams({ month });
  if (technicianName) params.set("technicianName", technicianName);
  return request<VelocityDetailResponse>(
    `/api/executive/velocity-detail?${params.toString()}`,
    token,
  );
}

// ─── Weekly quality drill-down ────────────────────────────────────────────────

export interface WeeklyQualityInspection {
  inspectionId: number;
  siteAddress: string;
  technicianName: string;
  qualityScore: number;
  riskLevel: string;
  scoredAt: string;
}

export interface WeeklyQualityInspectionsResponse {
  success: true;
  weekStart: string;
  count: number;
  inspections: WeeklyQualityInspection[];
}

export function fetchWeeklyQualityInspections(
  token: string | null,
  weekStart: string,
) {
  return request<WeeklyQualityInspectionsResponse>(
    `/api/executive/quality-trend/inspections?weekStart=${encodeURIComponent(weekStart)}`,
    token,
  );
}

/** Register (or refresh) the device Expo push token for this user. */
export function registerPushToken(token: string | null, pushToken: string) {
  return request<{ success: boolean }>("/api/auth/me/push-token", token, {
    method: "POST",
    body: JSON.stringify({ token: pushToken }),
  });
}

// ─── Executive daily briefing ─────────────────────────────────────────────────

export interface DailyBriefing {
  date: string;
  summary: string;
  inspectionsCount: number;
  criticalRiskCount: number;
  newOpportunities: number;
  pipelineAdded: number;
  recommendation: string;
}

export function fetchDailyBriefing(token: string | null) {
  // Pass the device's IANA timezone so the server anchors day boundaries to the
  // owner's local calendar rather than UTC.  Without this, a UTC-5 owner would
  // miss inspections completed after 7 pm because they fall in the next UTC day.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return request<{ success: true; briefing: DailyBriefing }>(
    `/api/executive/briefing/yesterday?tz=${encodeURIComponent(tz)}`,
    token,
  );
}

export function fetchExecutiveEmailPreview(token: string | null) {
  return request<{ success: true; html: string; subject: string }>(
    "/api/executive/intelligence/email-preview",
    token,
  );
}

export function fetchExecutiveTextPreview(token: string | null) {
  return request<{ success: true; text: string; subject: string }>(
    "/api/executive/intelligence/email-preview?format=text",
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

/** Remove the stored push token (opt-out path). */
export function removePushToken(token: string | null) {
  return request<{ success: boolean }>("/api/auth/me/push-token", token, {
    method: "DELETE",
  });
}

/** Dismiss the push-failure banner by clearing the server-side failure flag. */
export function dismissPushFailure(token: string | null) {
  return request<{ success: boolean }>("/api/auth/me/push-failure", token, {
    method: "DELETE",
  });
}

/** Toggle push notification preference on the server. */
export function setPushNotificationsEnabled(token: string | null, enabled: boolean) {
  return request<{ success: boolean; pushNotificationsEnabled: boolean }>(
    "/api/auth/me/push-notifications",
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    },
  );
}

/** Toggle the daily briefing email opt-out preference on the server. */
export function setBriefingEmailOptOut(token: string | null, optOut: boolean) {
  return request<{ success: boolean; briefingEmailOptOut: boolean }>(
    "/api/auth/me/briefing-email",
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ optOut }),
    },
  );
}
