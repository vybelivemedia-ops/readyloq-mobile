/**
 * API URL helper for the ReadyLoq Company Portal.
 * In dev, the Replit proxy routes /api to the shared API server automatically.
 * In production, set VITE_API_URL to the deployed API origin.
 */
const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");
const API_ORIGIN = stripTrailingSlash(import.meta.env.VITE_API_URL ?? "");

export function apiUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}/api${clean}`;
}
