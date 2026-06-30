/**
 * Thin fetch helpers for the few backend endpoints that are NOT part of the
 * generated `@workspace/api-client-react` client (auth bootstrap + object
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
  role: string;
  companyId: number | null;
  betaAccess: boolean;
  company?: CurrentCompany | null;
}

export function fetchCurrentUser(token: string | null) {
  return request<CurrentUser>("/api/auth/me", token);
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
