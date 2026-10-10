import { resolveMediaUrl } from "./lib/media-url";

/**
 * API URL helper for the ReadyLoq Company Portal.
 *
 * In production, set VITE_API_URL to the deployed API origin (e.g. "https://api.example.com").
 * Without VITE_API_URL, production keeps the bare /api prefix which the Replit deployment
 * proxy routes to the API service.
 *
 * In Replit dev mode the bare /api path is routed by the Replit dev-proxy to the mobile-app
 * artifact (registered at /api), not the API server.  To work around this we prefix with
 * BASE_URL (e.g. "/readyloq-portal/") so the request stays within this artifact's path and
 * is caught by the Vite dev-server's own reverse-proxy rule before the Replit router sees it.
 * This behaviour is gated on import.meta.env.DEV so it never affects production builds.
 */
const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

// Priority:
//   1. VITE_API_URL  — explicit override for any environment (origin only, no trailing slash)
//   2. DEV fallback  — BASE_URL prefix so Vite's proxy intercepts the request in dev
//   3. bare ""       — production default: /api/... is handled by the deployment proxy
const API_ORIGIN: string = import.meta.env.VITE_API_URL
  ? stripTrailingSlash(import.meta.env.VITE_API_URL)
  : import.meta.env.DEV
    ? stripTrailingSlash(import.meta.env.BASE_URL ?? "")
    : "";

/** Base URL for generated API-client requests. */
export const apiClientBaseUrl = API_ORIGIN || null;

export function apiUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}/api${clean}`;
}

/** Resolve uploaded evidence paths through the configured API/proxy origin. */
export function mediaUrl(path: string): string {
  return resolveMediaUrl(path, apiUrl);
}
