// Cross-app + API configuration for the ReadyLoq marketing site.
//
// In development, the marketing site and the API are served behind the same
// Replit proxy, so same-origin relative URLs work out of the box. In production
// the marketing site is hosted at ReadyLoq.com while the app + API live at
// app.readyloq.com — set these build-time env vars to point the marketing site
// at the app:
//
//   VITE_APP_URL  - origin of the ReadyLoq app (e.g. https://app.readyloq.com).
//                   Empty = same origin (dev default; app is mounted at "/").
//   VITE_API_URL  - origin of the API (e.g. https://app.readyloq.com).
//                   Empty = same origin (dev default; API is proxied at /api).

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

const APP_ORIGIN = stripTrailingSlash(import.meta.env.VITE_APP_URL ?? "");
const API_ORIGIN = stripTrailingSlash(import.meta.env.VITE_API_URL ?? "");

// URL of the ReadyLoq application (sign in / launch the app). Falls back to "/"
// so links resolve to the app mounted at the proxy root during development.
// In dev (no VITE_APP_URL set) the Expo web build is proxied at /app/
export const APP_URL = APP_ORIGIN || "/app/";

// Build a full API endpoint URL. Always targets the "/api" base path so callers
// pass resource paths like "/leads" without worrying about the base.
export function apiUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}/api${clean}`;
}

// Resolve a static asset that lives in /public against the site's base path.
// import.meta.env.BASE_URL is "/site/" in dev and the configured base in prod,
// so a bare "/hero-bg.png" (which escapes the base path) becomes correct.
export function asset(file: string): string {
  const clean = file.replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${clean}`;
}
