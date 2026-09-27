export type ApiPathResolver = (path: string) => string;

const ABSOLUTE_URL = /^(?:https?:|data:|blob:|file:)/i;

/**
 * Turns API-relative evidence paths into URLs that stay inside the configured
 * portal API proxy. Public or device-local URLs are already directly usable.
 */
export function resolveMediaUrl(value: string, resolveApiPath: ApiPathResolver): string {
  if (!value || ABSOLUTE_URL.test(value)) return value;
  if (value.startsWith("/api/storage/")) return resolveApiPath(value.slice("/api".length));
  if (value.startsWith("/objects/")) return resolveApiPath(`/storage${value}`);
  return value;
}