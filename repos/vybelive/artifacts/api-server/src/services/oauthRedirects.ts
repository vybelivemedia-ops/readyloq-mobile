/**
 * Environment-aware OAuth redirect URI resolver.
 *
 * Priority order:
 *   1. production — REPLIT_DEPLOYMENT=1 + REPLIT_DOMAINS
 *   2. staging    — STAGING_DOMAIN
 *   3. dev        — REPLIT_DEV_DOMAIN (Replit workspace)
 *   4. local      — localhost:PORT
 *
 * Each provider family has its own named getter because OAuth dashboards
 * require URIs to be whitelisted individually. Facebook and Instagram share
 * the same Meta app and therefore the same redirect URI.
 *
 * Call validateOAuthRedirectUris(log) once at server startup to emit
 * structured warnings for unconfigured providers.
 */

import type { Logger } from "pino";

export type OAuthEnvironment = "production" | "staging" | "development" | "local";

// ─── Environment detection ─────────────────────────────────────────────────────

export function detectOAuthEnvironment(): OAuthEnvironment {
  if (process.env["REPLIT_DEPLOYMENT"] === "1" && process.env["REPLIT_DOMAINS"]) {
    return "production";
  }
  if (process.env["STAGING_DOMAIN"]) {
    return "staging";
  }
  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return "development";
  }
  return "local";
}

function getBaseUrl(): string {
  const env = detectOAuthEnvironment();
  switch (env) {
    case "production": {
      const domain = process.env["REPLIT_DOMAINS"]!.split(",")[0]!.trim();
      return `https://${domain}`;
    }
    case "staging":
      return `https://${process.env["STAGING_DOMAIN"]!}`;
    case "development":
      return `https://${process.env["REPLIT_DEV_DOMAIN"]!}`;
    case "local": {
      const port = process.env["PORT"] ?? "8080";
      return `http://localhost:${port}`;
    }
  }
}

function callbackPath(platform: string): string {
  return `/api/oauth/${platform}/callback`;
}

/**
 * Public, environment-aware origin for the deployed app (no trailing slash).
 * Used to build browser-return URLs for web-originated OAuth flows (e.g. the
 * Mission Control web console), which — unlike the mobile app — cannot receive
 * a `mobile://` deep link.
 */
export function getAppBaseUrl(): string {
  return getBaseUrl();
}

// ─── Per-provider getters ──────────────────────────────────────────────────────

/** YouTube redirect URI — register in Google Cloud Console → OAuth 2.0 Client. */
export function getGoogleRedirectUri(): string {
  return `${getBaseUrl()}${callbackPath("youtube")}`;
}

/**
 * Meta redirect URI — register in Meta for Developers → Valid OAuth Redirect URIs.
 * Covers both Facebook and Instagram: they share one Meta app and one callback path.
 */
export function getMetaRedirectUri(): string {
  return `${getBaseUrl()}${callbackPath("facebook")}`;
}

/** Twitch redirect URI — register in dev.twitch.tv → OAuth Redirect URLs. */
export function getTwitchRedirectUri(): string {
  return `${getBaseUrl()}${callbackPath("twitch")}`;
}

/** Kick redirect URI — register in kick.com/settings/developer → Redirect URLs. */
export function getKickRedirectUri(): string {
  return `${getBaseUrl()}${callbackPath("kick")}`;
}

/**
 * Canonical redirect URI for any supported platform.
 * Instagram shares the Meta (Facebook) redirect URI.
 */
export function getRedirectUri(
  platform: "youtube" | "facebook" | "instagram" | "twitch" | "kick",
): string {
  switch (platform) {
    case "youtube":   return getGoogleRedirectUri();
    case "facebook":
    case "instagram": return getMetaRedirectUri();
    case "twitch":    return getTwitchRedirectUri();
    case "kick":      return getKickRedirectUri();
  }
}

// ─── Startup validation ────────────────────────────────────────────────────────

interface ProviderCheck {
  platform: string;
  redirectUri: string;
  configured: boolean;
}

/**
 * Validate all OAuth redirect URIs at server startup.
 *
 * Logs info for each configured provider and warns for each missing one.
 * Never throws — individual providers degrade gracefully to 503 when their
 * credentials are absent.
 */
export function validateOAuthRedirectUris(log: Pick<Logger, "info" | "warn">): void {
  const env = detectOAuthEnvironment();

  const checks: ProviderCheck[] = [
    {
      platform: "youtube",
      redirectUri: getGoogleRedirectUri(),
      configured: Boolean(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]),
    },
    {
      platform: "facebook+instagram",
      redirectUri: getMetaRedirectUri(),
      configured: Boolean(process.env["META_APP_ID"] && process.env["META_APP_SECRET"]),
    },
    {
      platform: "twitch",
      redirectUri: getTwitchRedirectUri(),
      configured: Boolean(process.env["TWITCH_CLIENT_ID"] && process.env["TWITCH_CLIENT_SECRET"]),
    },
    {
      platform: "kick",
      redirectUri: getKickRedirectUri(),
      configured: Boolean(process.env["KICK_CLIENT_ID"] && process.env["KICK_CLIENT_SECRET"]),
    },
  ];

  log.info({ env }, "OAuth redirect URI validation");

  for (const { platform, redirectUri, configured } of checks) {
    if (configured) {
      log.info({ platform, redirectUri, env }, "OAuth provider ready");
    } else {
      log.warn(
        { platform, redirectUri, env },
        `OAuth provider not configured — ${platform} flows will return 503 until credentials are added to Replit Secrets`,
      );
    }
  }
}
