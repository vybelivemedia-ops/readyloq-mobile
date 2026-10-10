import { logger } from "./logger";

/**
 * Native (Expo) OAuth redirect URLs that must be on the Clerk instance's
 * authorized redirect allowlist. Dev instances allow any redirect URL, but
 * production instances reject unlisted ones with "Redirect url mismatch"
 * (code: resource_missmatch), which breaks Google sign-in in the standalone
 * mobile app. There is no dashboard access for Replit-managed Clerk, so the
 * server registers them itself at startup using its own secret key.
 */
const NATIVE_REDIRECT_URLS = [
  "readyloq-app://sso-callback",   // standard two-slash form (Linking.createURL without leading slash)
  "readyloq-app:///sso-callback",  // three-slash form (empty host) — some Expo/platform combos produce this
];

const CLERK_API_BASE = "https://api.clerk.com/v1";

interface ClerkRedirectUrl {
  id: string;
  url: string;
}

/**
 * Idempotently ensures every native redirect URL is registered with the
 * Clerk instance backing CLERK_SECRET_KEY. Never throws — a failure here
 * must not take down the API server; it only means native Google sign-in
 * stays broken until the next boot.
 */
export async function ensureClerkNativeRedirectUrls(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.warn("clerk redirect allowlist: CLERK_SECRET_KEY not set, skipping");
    return;
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };

  try {
    const listRes = await fetch(`${CLERK_API_BASE}/redirect_urls?limit=100`, {
      headers,
    });
    if (!listRes.ok) {
      logger.warn(
        { status: listRes.status },
        "clerk redirect allowlist: failed to list redirect URLs",
      );
      return;
    }

    const body = (await listRes.json()) as
      | ClerkRedirectUrl[]
      | { data?: ClerkRedirectUrl[] };
    const existing = Array.isArray(body) ? body : (body.data ?? []);
    const existingUrls = new Set(existing.map((r) => r.url));

    for (const url of NATIVE_REDIRECT_URLS) {
      if (existingUrls.has(url)) {
        logger.info({ url }, "clerk redirect allowlist: already registered");
        continue;
      }

      const createRes = await fetch(`${CLERK_API_BASE}/redirect_urls`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      });

      if (createRes.ok) {
        logger.info({ url }, "clerk redirect allowlist: registered");
      } else {
        const errText = await createRes.text().catch(() => "");
        logger.warn(
          { url, status: createRes.status, error: errText.slice(0, 500) },
          "clerk redirect allowlist: failed to register",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "clerk redirect allowlist: unexpected error");
  }
}
