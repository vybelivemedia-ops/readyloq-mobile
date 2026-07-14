import { useEffect } from "react";
import { Alert } from "react-native";

import { APP_VERSION } from "@/constants/version";

/** Semver-style comparison — returns positive if b > a (b is newer). */
function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const r = parse(remote);
  const l = parse(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const diff = (r[i] ?? 0) - (l[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

/**
 * Runs once at app startup. Fetches GET /api/system/version from the backend
 * and shows an alert if the backend reports a newer version than the local build.
 * Network errors and timeouts are silently swallowed — this check is advisory only.
 */
export function useVersionCheck(): void {
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const domain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "getvybe.live";
      const url = `https://${domain}/api/system/version`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { version?: string };
        if (data.version && isNewer(data.version, APP_VERSION) && !cancelled) {
          Alert.alert(
            "Update Available",
            "A newer version of VYBE LIVE is available. Please update for the latest features.",
          );
        }
      } catch {
        // Network error or abort — non-fatal, silently ignore
      } finally {
        clearTimeout(timer);
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, []);
}
