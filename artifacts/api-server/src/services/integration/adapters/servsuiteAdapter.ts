/**
 * ServSuite REST adapter.
 *
 * ServSuite uses a modern REST/JSON API. Inspection payloads are posted to
 * the /workorders endpoint with the structured EnterpriseSyncPayload shape.
 *
 * Auth: Bearer token in Authorization header.
 * Endpoint: SERVSUITE_API_BASE_URL env var, default https://api.servsuite.com/v1
 */

import type { EnterpriseSyncPayload } from "../../../types/enterprise-payload";
import { ssrfSafeFetch } from "../../../lib/ssrf-safe-fetch";

const SERVSUITE_DEFAULT_BASE = "https://api.servsuite.com/v1";

export interface ServSuiteConfig {
  apiKey: string;
  apiBaseUrl?: string | null;
}

export async function sendServSuiteREST(
  payload: EnterpriseSyncPayload,
  config: ServSuiteConfig,
): Promise<void> {
  const base = (config.apiBaseUrl ?? SERVSUITE_DEFAULT_BASE).replace(/\/$/, "");

  const res = await ssrfSafeFetch(`${base}/workorders`, {
    method: "POST",
    redirect: "error", // never follow redirects — a redirect could point to a private host
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`ServSuite REST failed (${res.status}): ${body}`);
  }
}

/**
 * Probe ServSuite credentials — returns true when the API responds with 200/401.
 * A 401 means we reached the server but auth failed (misconfigured key).
 * A network error or 5xx means we could not confirm the key is wrong yet.
 */
export async function probeServSuite(
  apiKey: string,
  apiBaseUrl?: string | null,
): Promise<{ ok: boolean; reason?: "auth_failed" | "network_error"; message?: string }> {
  const base = (apiBaseUrl ?? SERVSUITE_DEFAULT_BASE).replace(/\/$/, "");
  try {
    const res = await ssrfSafeFetch(`${base}/ping`, {
      redirect: "error", // never follow redirects — a redirect could point to a private host
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth_failed", message: "ServSuite rejected the API key." };
    }
    return { ok: false, reason: "network_error", message: `Unexpected status ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      message: err instanceof Error ? err.message : "Network error reaching ServSuite.",
    };
  }
}
