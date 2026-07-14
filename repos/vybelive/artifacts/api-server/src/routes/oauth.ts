/**
 * OAuth 2.0 platform connection routes.
 *
 * GET  /oauth/connections              — list all OAuth connections for the user
 * GET  /oauth/:platform/init           — return the authorization URL (app opens in browser)
 * GET  /oauth/:platform/callback       — handle OAuth callback (browser redirect)
 * DELETE /oauth/:platform              — disconnect a platform
 * POST /oauth/:platform/refresh        — manually trigger token refresh
 *
 * The OAuth callback uses a signed state token (HMAC-SHA256 with SESSION_SECRET)
 * to associate the browser-based OAuth flow with the authenticated mobile user.
 * After the callback the server redirects to the "mobile://" deep link so the
 * app knows the connection succeeded or failed.
 */

import { Router, type Request, type Response } from "express";
import { createHmac, createHash, randomBytes } from "crypto";
import { eq, and, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { oauthConnectionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { encryptToken, decryptToken, isEncryptionConfigured } from "../lib/crypto";
import {
  type OAuthPlatform,
  requiresPkce,
  getProviderConfig,
  isProviderConfigured,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchPlatformProfile,
  fetchFacebookTargets,
  fetchInstagramAccount,
} from "../services/oauthProviders";
import { logger } from "../lib/logger";
import { getRedirectUri, getAppBaseUrl } from "../services/oauthRedirects";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OAUTH_PLATFORMS: OAuthPlatform[] = ["youtube", "facebook", "instagram", "twitch", "kick"];

function isValidPlatform(p: string): p is OAuthPlatform {
  return OAUTH_PLATFORMS.includes(p as OAuthPlatform);
}

/**
 * Server-side one-time nonce store.
 * Maps nonce → expiry timestamp (ms). Entries are removed on first use or
 * lazily on the next cleanup pass, whichever comes first.
 */
const pendingNonces = new Map<string, number>();
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes, matches state expiry

/**
 * Server-side PKCE verifier store (OAuth 2.1, Kick).
 * Maps the state nonce → { code_verifier, expiry }. The verifier is generated
 * at /init, the derived S256 challenge is sent to the authorization endpoint,
 * and the verifier is looked up (and consumed) at /callback to complete the
 * token exchange. Keyed by nonce so it shares the one-time lifecycle of state.
 */
const pendingVerifiers = new Map<string, { verifier: string; expiry: number }>();

/** Generate a high-entropy PKCE code_verifier (RFC 7636, 43–128 chars). */
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derive the S256 code_challenge from a verifier. */
function computeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Look up and consume the PKCE verifier for a state nonce, if any. */
function consumeVerifier(nonce: string): string | undefined {
  const entry = pendingVerifiers.get(nonce);
  if (!entry) return undefined;
  pendingVerifiers.delete(nonce);
  if (Date.now() > entry.expiry) return undefined;
  return entry.verifier;
}

/**
 * Server-side pending OAuth confirmations.
 * After the browser-based OAuth callback succeeds we do NOT write the
 * connection to the database immediately.  Instead we store the retrieved
 * tokens here under a random confirmToken and include that token in the
 * deep-link redirect.  The mobile app — which holds the authenticated
 * session — must then call POST /oauth/:platform/confirm with its bearer
 * token and the confirmToken.  The server checks that req.auth.userId
 * matches the userId embedded in the pending record before committing the
 * connection, preventing a confused-deputy attack where an attacker's
 * authorization URL is completed by a victim in their browser.
 */
interface PendingConfirmation {
  userId: string;
  platform: string;
  profile: { platformUserId: string; accountName: string; profileImageUrl: string | null };
  encryptedAccess: string;
  encryptedRefresh: string | null;
  expiresAt: Date | null;
  scopes: string[] | null;
  expiry: number; // ms timestamp
}
const pendingConfirmations = new Map<string, PendingConfirmation>();
const CONFIRM_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete confirmation

/** Periodically sweep expired nonces and confirmations. */
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiry] of pendingNonces) {
    if (now > expiry) pendingNonces.delete(nonce);
  }
  for (const [token, record] of pendingConfirmations) {
    if (now > record.expiry) pendingConfirmations.delete(token);
  }
  for (const [nonce, entry] of pendingVerifiers) {
    if (now > entry.expiry) pendingVerifiers.delete(nonce);
  }
}, 60_000);

/** Sign an OAuth state token and register its nonce for one-time use.
 *  `origin` marks where the flow was initiated ("mc" for the Mission Control
 *  web console, undefined/absent for the mobile app) so the callback can pick
 *  the correct browser-return channel. It is part of the signed payload, so it
 *  cannot be forged by a client. */
function signState(userId: string, platform: string, codeVerifier?: string, origin?: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = Buffer.from(JSON.stringify({
    userId, platform, nonce, ts: Date.now(), ...(origin ? { origin } : {}),
  })).toString("base64url");
  const secret = process.env["SESSION_SECRET"] ?? "";
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  // Register nonce before returning so it is always in the store when the
  // authorization URL is opened.
  const expiry = Date.now() + NONCE_TTL_MS;
  pendingNonces.set(nonce, expiry);
  // For PKCE flows, bind the verifier to the same nonce so it is consumed
  // atomically with state at /callback.
  if (codeVerifier) pendingVerifiers.set(nonce, { verifier: codeVerifier, expiry });
  return `${payload}.${sig}`;
}

interface StatePayload { userId: string; platform: string; nonce: string; ts: number; origin?: string }

/**
 * Decode the (unverified) origin field from a state token for redirect routing
 * ONLY. This is used on the error path (e.g. the user denied consent, before
 * the code/state can be validated) to decide whether to bounce the browser back
 * to the mobile deep link or the Mission Control web console. The value is
 * never trusted for authorization — commit decisions use verifyState().
 */
function peekStateOrigin(state: string | undefined): string | undefined {
  if (!state) return undefined;
  try {
    const [payload] = state.split(".");
    if (!payload) return undefined;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { origin?: unknown };
    return typeof data.origin === "string" ? data.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify and parse a state token.
 * Checks signature, expiry, and that the nonce has not already been used.
 * Throws on any failure; consumes the nonce on success.
 */
function verifyState(state: string): StatePayload {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) throw new Error("Malformed state");
  const secret = process.env["SESSION_SECRET"] ?? "";
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (sig !== expected) throw new Error("Invalid state signature");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StatePayload;
  if (Date.now() - data.ts > NONCE_TTL_MS) throw new Error("State expired");
  // One-time use: the nonce must be present (registered at /init) and is
  // removed atomically to prevent replay.
  if (!pendingNonces.has(data.nonce)) throw new Error("State already used or not issued by this server");
  pendingNonces.delete(data.nonce);
  return data;
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Commit (insert or update) an OAuth connection for a user.
 * Shared by the mobile two-phase confirm route and the Mission Control web
 * callback flow so both write connections identically.
 */
async function commitOAuthConnection(record: {
  userId: string;
  platform: OAuthPlatform;
  profile: { platformUserId: string; accountName: string; profileImageUrl: string | null };
  encryptedAccess: string;
  encryptedRefresh: string | null;
  expiresAt: Date | null;
  scopes: string[] | null;
}): Promise<void> {
  const { userId, platform, profile, encryptedAccess, encryptedRefresh, expiresAt, scopes } = record;
  const existing = await db
    .select({ id: oauthConnectionsTable.id })
    .from(oauthConnectionsTable)
    .where(and(
      eq(oauthConnectionsTable.userId, userId),
      eq(oauthConnectionsTable.platform, platform),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(oauthConnectionsTable)
      .set({
        platformUserId: profile.platformUserId,
        accountName: profile.accountName,
        profileImageUrl: profile.profileImageUrl,
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh ?? undefined,
        tokenExpiresAt: expiresAt ?? undefined,
        scopes: scopes ?? undefined,
        status: "connected",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(oauthConnectionsTable.id, existing[0]!.id));
  } else {
    await db.insert(oauthConnectionsTable).values({
      id: generateId(),
      userId,
      platform,
      platformUserId: profile.platformUserId,
      accountName: profile.accountName,
      profileImageUrl: profile.profileImageUrl,
      encryptedAccessToken: encryptedAccess,
      encryptedRefreshToken: encryptedRefresh ?? undefined,
      tokenExpiresAt: expiresAt ?? undefined,
      scopes: scopes ?? undefined,
      status: "connected",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/**
 * Build a platform authorization URL for a web-initiated (Mission Control)
 * OAuth flow. The state is stamped with origin="mc" so the callback returns the
 * browser to the MC web console and commits the connection directly (there is
 * no mobile bearer token / deep link in the web flow). The founder userId is
 * resolved by the caller and baked into the signed, one-time state.
 *
 * Returns a discriminated result rather than throwing so the caller can map
 * failures to an appropriate redirect/response.
 */
export function buildOAuthInitUrl(
  userId: string,
  platform: string,
):
  | { ok: true; url: string }
  | { ok: false; status: number; error: string } {
  if (!isValidPlatform(platform)) {
    return { ok: false, status: 400, error: `Unknown platform: ${platform}` };
  }
  if (!isProviderConfigured(platform)) {
    return {
      ok: false,
      status: 503,
      error: `${platform} OAuth is not configured. Add the required credentials to Replit Secrets.`,
    };
  }
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "OAUTH_ENCRYPTION_KEY is not configured. Cannot securely store tokens.",
    };
  }

  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;
  if (requiresPkce(platform)) {
    codeVerifier = generateCodeVerifier();
    codeChallenge = computeCodeChallenge(codeVerifier);
  }

  const state = signState(userId, platform, codeVerifier, "mc");
  const redirectUri = getRedirectUri(platform);
  const url = buildAuthorizationUrl(platform, redirectUri, state, codeChallenge);
  return { ok: true, url };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** List all OAuth connections for the authenticated user.
 *  Expired tokens are automatically refreshed using the stored refresh token.
 *  If refresh fails the connection is marked refresh_needed so the app can
 *  prompt the user to reconnect.
 */
router.get("/oauth/connections", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  try {
    const rows = await db
      .select({
        id: oauthConnectionsTable.id,
        platform: oauthConnectionsTable.platform,
        platformUserId: oauthConnectionsTable.platformUserId,
        accountName: oauthConnectionsTable.accountName,
        profileImageUrl: oauthConnectionsTable.profileImageUrl,
        status: oauthConnectionsTable.status,
        scopes: oauthConnectionsTable.scopes,
        errorMessage: oauthConnectionsTable.errorMessage,
        tokenExpiresAt: oauthConnectionsTable.tokenExpiresAt,
        targetType: oauthConnectionsTable.targetType,
        targetId: oauthConnectionsTable.targetId,
        targetName: oauthConnectionsTable.targetName,
        encryptedRefreshToken: oauthConnectionsTable.encryptedRefreshToken,
        createdAt: oauthConnectionsTable.createdAt,
        updatedAt: oauthConnectionsTable.updatedAt,
      })
      .from(oauthConnectionsTable)
      .where(
        and(
          eq(oauthConnectionsTable.userId, userId),
          or(
            eq(oauthConnectionsTable.status, "connected"),
            eq(oauthConnectionsTable.status, "expired"),
            eq(oauthConnectionsTable.status, "refresh_needed"),
          ),
        )
      );

    const connections = await Promise.all(rows.map(async (row) => {
      const needsRefresh =
        row.status === "expired" ||
        row.status === "refresh_needed" ||
        (row.tokenExpiresAt && new Date(row.tokenExpiresAt) < new Date());

      if (needsRefresh && row.encryptedRefreshToken) {
        try {
          const refreshToken = decryptToken(row.encryptedRefreshToken);
          const tokens = await refreshAccessToken(row.platform, refreshToken);
          await db
            .update(oauthConnectionsTable)
            .set({
              encryptedAccessToken: encryptToken(tokens.accessToken),
              encryptedRefreshToken: tokens.refreshToken
                ? encryptToken(tokens.refreshToken)
                : row.encryptedRefreshToken,
              tokenExpiresAt: tokens.expiresIn
                ? new Date(Date.now() + tokens.expiresIn * 1000)
                : null,
              status: "connected",
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(oauthConnectionsTable.id, row.id));
          row.status = "connected";
          row.errorMessage = null;
          req.log.info({ platform: row.platform }, "OAuth token auto-refreshed");
        } catch (err) {
          req.log.warn({ err, platform: row.platform }, "OAuth auto-refresh failed — reauth needed");
          await db
            .update(oauthConnectionsTable)
            .set({ status: "refresh_needed", updatedAt: new Date() })
            .where(eq(oauthConnectionsTable.id, row.id))
            .catch(() => undefined);
          row.status = "refresh_needed";
        }
      }

      const { encryptedRefreshToken: _r, ...safe } = row;
      return safe;
    }));

    res.json(connections);
  } catch (err) {
    req.log.error({ err }, "Failed to list OAuth connections");
    res.status(500).json({ error: "Failed to list connections" });
  }
});

/** Return the OAuth authorization URL for a platform. */
router.get("/oauth/:platform/init", requireAuth, (req: Request, res: Response) => {
  const platform = String(req.params["platform"]);
  if (!isValidPlatform(platform)) {
    res.status(400).json({ error: `Unknown platform: ${platform}` });
    return;
  }
  if (!isProviderConfigured(platform)) {
    res.status(503).json({
      error: `${platform} OAuth is not configured. Add the required credentials to Replit Secrets.`,
    });
    return;
  }
  if (!isEncryptionConfigured()) {
    res.status(503).json({
      error: "OAUTH_ENCRYPTION_KEY is not configured. Cannot securely store tokens.",
    });
    return;
  }

  const userId = req.auth!.userId;

  // OAuth 2.1 PKCE (Kick): mint a verifier, derive the S256 challenge, and bind
  // the verifier to the state nonce so it can be replayed at /callback.
  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;
  if (requiresPkce(platform)) {
    codeVerifier = generateCodeVerifier();
    codeChallenge = computeCodeChallenge(codeVerifier);
  }

  const state = signState(userId, platform, codeVerifier);
  const redirectUri = getRedirectUri(platform);
  const authUrl = buildAuthorizationUrl(platform, redirectUri, state, codeChallenge);

  res.json({ url: authUrl, redirectUri });
});

/** Handle the OAuth callback from the platform. Browser redirect — no auth header. */
router.get("/oauth/:platform/callback", async (req: Request, res: Response) => {
  const platform = String(req.params["platform"]);
  const { code, state, error: oauthError } = req.query as Record<string, string>;

  const mobileReturnBase = "mobile://oauth-complete";
  const mcSocialBase = `${getAppBaseUrl()}/mission-control/social`;
  // Unverified origin, used ONLY to choose the browser-return destination on
  // both success and error paths. Trust decisions use the verified origin below.
  const isMcOrigin = peekStateOrigin(state) === "mc";

  /** Redirect the browser back with a failure, to the correct surface. */
  const fail = (reason: string): void => {
    const msg = encodeURIComponent(reason);
    if (isMcOrigin) {
      res.redirect(`${mcSocialBase}?connect_error=${msg}&platform=${platform}`);
    } else {
      res.redirect(`${mobileReturnBase}?success=false&platform=${platform}&error=${msg}`);
    }
  };

  if (oauthError || !code || !state) {
    fail(oauthError ?? "Authorization denied");
    return;
  }

  if (!isValidPlatform(platform)) {
    fail("unknown_platform");
    return;
  }

  let userId: string;
  let stateNonce: string;
  let trustedMcOrigin: boolean;
  try {
    const stateData = verifyState(state);
    // Ensure the state was issued for the same platform as this callback URL.
    // Prevents a valid signed state for one provider being replayed against
    // a different provider's callback path.
    if (stateData.platform !== platform) throw new Error("State platform mismatch");
    userId = stateData.userId;
    stateNonce = stateData.nonce;
    trustedMcOrigin = stateData.origin === "mc";
  } catch (err) {
    logger.warn({ err }, "OAuth callback: invalid state");
    fail("invalid_state");
    return;
  }

  try {
    const redirectUri = getRedirectUri(platform);
    // PKCE flows replay the verifier bound to this state nonce; undefined for
    // non-PKCE providers.
    const codeVerifier = consumeVerifier(stateNonce);
    const tokens = await exchangeCodeForTokens(platform, code, redirectUri, codeVerifier);
    const profile = await fetchPlatformProfile(platform, tokens.accessToken);

    const encryptedAccess = encryptToken(tokens.accessToken);
    const encryptedRefresh = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
    const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null;

    // Mission Control (web console) flow. There is no mobile bearer token or
    // deep link in the browser, and the whole MC surface is unauthenticated and
    // founder-scoped by convention (network-level access is the compensating
    // control). The signed, one-time state already binds this flow to the
    // founder userId resolved server-side at /init, so we commit directly here
    // instead of the mobile two-phase confirm, then return the browser to the
    // MC Social console.
    if (trustedMcOrigin) {
      await commitOAuthConnection({
        userId,
        platform,
        profile,
        encryptedAccess,
        encryptedRefresh,
        expiresAt,
        scopes: tokens.scopes ?? null,
      });
      logger.info({ userId, platform }, "OAuth (Mission Control) connection committed");
      const accountName = encodeURIComponent(profile.accountName);
      res.redirect(`${mcSocialBase}?connected=${platform}&account=${accountName}`);
      return;
    }

    // Two-phase confirmation: do NOT write to DB yet.
    // Store the retrieved tokens in memory under a random confirmToken and
    // return it to the mobile app via the deep link.  The mobile app must
    // call POST /oauth/:platform/confirm with its bearer token before the
    // connection is committed.  This binds the stored tokens to the
    // *authenticated* VYBE user who owns the mobile session, not merely to
    // whoever completed the browser-based consent flow.
    const confirmToken = randomBytes(32).toString("hex");
    pendingConfirmations.set(confirmToken, {
      userId,
      platform,
      profile,
      encryptedAccess,
      encryptedRefresh,
      expiresAt,
      scopes: tokens.scopes ?? null,
      expiry: Date.now() + CONFIRM_TTL_MS,
    });

    const accountName = encodeURIComponent(profile.accountName);
    res.redirect(
      `${mobileReturnBase}?success=true&platform=${platform}&accountName=${accountName}&confirmToken=${confirmToken}`,
    );
  } catch (err) {
    logger.error({ err, userId, platform }, "OAuth callback: token exchange failed");
    // Route the failure back to the surface that started the flow (MC web or
    // the mobile deep link) so the error is actually surfaced to the user.
    fail((err as Error).message ?? "Connection failed");
  }
});

/**
 * Confirm an OAuth connection — authenticated endpoint.
 *
 * The mobile app calls this after receiving a confirmToken in the deep-link
 * redirect from the OAuth callback.  The server checks that the requesting
 * authenticated user (req.auth.userId) matches the userId stored with the
 * confirmToken, then commits the connection to the database.
 *
 * This two-phase design closes the confused-deputy attack: even if a victim
 * completes an attacker's authorization URL in their browser, the confirmToken
 * is delivered to the victim's device via the deep link, and the victim's
 * mobile app would call this endpoint with the victim's bearer token — causing
 * a userId mismatch that the server rejects.
 */
router.post("/oauth/:platform/confirm", requireAuth, async (req: Request, res: Response) => {
  const platform = String(req.params["platform"]);
  if (!isValidPlatform(platform)) {
    res.status(400).json({ error: `Unknown platform: ${platform}` });
    return;
  }

  const { confirmToken } = (req.body ?? {}) as { confirmToken?: string };
  if (!confirmToken) {
    res.status(400).json({ error: "confirmToken is required" });
    return;
  }

  const pending = pendingConfirmations.get(confirmToken);
  if (!pending) {
    res.status(400).json({ error: "Invalid or expired confirmToken" });
    return;
  }
  if (Date.now() > pending.expiry) {
    pendingConfirmations.delete(confirmToken);
    res.status(400).json({ error: "confirmToken has expired — please reconnect" });
    return;
  }

  const userId = req.auth!.userId;

  // Binding check: the authenticated user must be the same one who initiated
  // the OAuth flow.  Rejects any attempt by a different user to claim a
  // confirmToken they intercepted or received via social engineering.
  if (pending.userId !== userId) {
    req.log.warn({ pending_userId: pending.userId, req_userId: userId, platform }, "OAuth confirm: userId mismatch");
    res.status(403).json({ error: "This authorization was not initiated by your account" });
    return;
  }

  if (pending.platform !== platform) {
    res.status(400).json({ error: "Platform mismatch" });
    return;
  }

  // Consume the pending record before any async work to prevent double-commit.
  pendingConfirmations.delete(confirmToken);

  try {
    await commitOAuthConnection({
      userId,
      platform: platform as OAuthPlatform,
      profile: pending.profile,
      encryptedAccess: pending.encryptedAccess,
      encryptedRefresh: pending.encryptedRefresh,
      expiresAt: pending.expiresAt,
      scopes: pending.scopes,
    });

    res.json({ success: true, platform, accountName: pending.profile.accountName });
  } catch (err) {
    req.log.error({ err, userId, platform }, "OAuth confirm: DB write failed");
    res.status(500).json({ error: "Failed to save connection" });
  }
});

/**
 * List the Facebook Live destinations (personal profile + managed Pages) the
 * connected user can stream to, plus the currently selected target.
 *
 * Page access tokens are NEVER returned — only id/type/name. The selection
 * endpoint re-fetches server-side to obtain and encrypt the page token.
 */
router.get("/oauth/facebook/targets", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  try {
    const [conn] = await db
      .select()
      .from(oauthConnectionsTable)
      .where(and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, "facebook"),
      ))
      .limit(1);

    if (!conn || conn.status === "disconnected" || !conn.encryptedAccessToken) {
      res.status(404).json({ error: "Facebook is not connected" });
      return;
    }

    const accessToken = decryptToken(conn.encryptedAccessToken);
    const targets = await fetchFacebookTargets(accessToken);

    const selectedTargetType = conn.targetType ?? "profile";
    // Whether the currently-stored selection still exists in the live list.
    // The personal profile is always available; a Page selection is only valid
    // while that Page is still returned by Meta (i.e. the user retains admin
    // access and the page token has not been revoked). When a previously-chosen
    // Page disappears, selectedAvailable is false so the client can prompt a
    // re-selection instead of silently streaming to the wrong destination.
    const selectedAvailable =
      selectedTargetType === "page"
        ? targets.some((t) => t.type === "page" && t.id === conn.targetId)
        : true;

    res.json({
      selected: {
        targetType: selectedTargetType,
        targetId: conn.targetId,
        targetName: conn.targetName,
      },
      selectedAvailable,
      // Strip page access tokens — they must never reach the client.
      targets: targets.map((t) => ({ type: t.type, id: t.id, name: t.name })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list Facebook targets");
    res.status(502).json({ error: "Failed to load Facebook destinations — try reconnecting Facebook" });
  }
});

/**
 * Report whether the Instagram Live destination for the connected user is still
 * available.
 *
 * Instagram Live depends on an Instagram Professional account linked to a
 * Facebook Page; that link can break the same way a Facebook Page selection can
 * (admin access lost / permissions revoked). Unlike Facebook there is no
 * destination picker — the linked account IS the destination — so the client
 * surfaces a reconnect prompt rather than a re-selection when `available` is
 * false. A transient/auth failure returns 502 so the client leaves prior state
 * untouched instead of raising a false alarm.
 *
 * No tokens are returned — only availability and the linked account's username.
 */
router.get("/oauth/instagram/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  try {
    const [conn] = await db
      .select()
      .from(oauthConnectionsTable)
      .where(and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, "instagram"),
      ))
      .limit(1);

    if (!conn || conn.status === "disconnected" || !conn.encryptedAccessToken) {
      res.status(404).json({ error: "Instagram is not connected" });
      return;
    }

    const accessToken = decryptToken(conn.encryptedAccessToken);
    const account = await fetchInstagramAccount(accessToken);

    res.json({
      available: account !== null,
      accountName: account?.username ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to check Instagram destination");
    res.status(502).json({ error: "Failed to verify Instagram destination — try reconnecting Instagram" });
  }
});

/**
 * Select the Facebook Live destination for the connected user.
 *
 * The chosen target is validated against the live list fetched from Meta (so a
 * client cannot select a Page it does not manage), and the page access token is
 * obtained and encrypted server-side rather than trusting any client-supplied
 * credential.
 */
router.post("/oauth/facebook/target", requireAuth, async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const { targetType, targetId } = (req.body ?? {}) as { targetType?: string; targetId?: string };

  if (targetType !== "profile" && targetType !== "page") {
    res.status(400).json({ error: "targetType must be 'profile' or 'page'" });
    return;
  }
  if (targetType === "page" && !targetId) {
    res.status(400).json({ error: "targetId is required when targetType is 'page'" });
    return;
  }

  try {
    const [conn] = await db
      .select()
      .from(oauthConnectionsTable)
      .where(and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, "facebook"),
      ))
      .limit(1);

    if (!conn || conn.status === "disconnected" || !conn.encryptedAccessToken) {
      res.status(404).json({ error: "Facebook is not connected" });
      return;
    }

    const accessToken = decryptToken(conn.encryptedAccessToken);
    const targets = await fetchFacebookTargets(accessToken);

    const selected =
      targetType === "profile"
        ? targets.find((t) => t.type === "profile")
        : targets.find((t) => t.type === "page" && t.id === String(targetId));

    if (!selected) {
      res.status(400).json({ error: "Selected destination was not found among your Facebook accounts" });
      return;
    }

    const isPage = selected.type === "page";
    if (isPage && !selected.accessToken) {
      res.status(400).json({
        error: "Could not obtain a Page access token. Re-connect Facebook and grant Pages permissions.",
      });
      return;
    }

    await db
      .update(oauthConnectionsTable)
      .set({
        targetType: selected.type,
        targetId: isPage ? selected.id : null,
        targetName: selected.name,
        encryptedTargetToken: isPage && selected.accessToken ? encryptToken(selected.accessToken) : null,
        updatedAt: new Date(),
      })
      .where(eq(oauthConnectionsTable.id, conn.id));

    res.json({
      success: true,
      targetType: selected.type,
      targetId: isPage ? selected.id : null,
      targetName: selected.name,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to set Facebook target");
    res.status(502).json({ error: "Failed to set Facebook destination — try reconnecting Facebook" });
  }
});

/** Disconnect a platform — marks as disconnected, clears tokens. */
router.delete("/oauth/:platform", requireAuth, async (req: Request, res: Response) => {
  const platform = String(req.params["platform"]);
  if (!isValidPlatform(platform)) {
    res.status(400).json({ error: `Unknown platform: ${platform}` });
    return;
  }

  const userId = req.auth!.userId;
  try {
    await db
      .update(oauthConnectionsTable)
      .set({
        status: "disconnected",
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, platform as OAuthPlatform),
      ));

    res.json({ success: true, platform });
  } catch (err) {
    req.log.error({ err }, "Failed to disconnect platform");
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

/** Manually trigger a token refresh for a platform. */
router.post("/oauth/:platform/refresh", requireAuth, async (req: Request, res: Response) => {
  const platform = String(req.params["platform"]);
  if (!isValidPlatform(platform)) {
    res.status(400).json({ error: `Unknown platform: ${platform}` });
    return;
  }

  const userId = req.auth!.userId;
  try {
    const [conn] = await db
      .select()
      .from(oauthConnectionsTable)
      .where(and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, platform as OAuthPlatform),
      ))
      .limit(1);

    if (!conn) {
      res.status(404).json({ error: "No connection found for this platform" });
      return;
    }
    if (!conn.encryptedRefreshToken) {
      res.status(400).json({ error: "No refresh token available — please reconnect" });
      return;
    }

    const refreshToken = decryptToken(conn.encryptedRefreshToken);
    const tokens = await refreshAccessToken(platform, refreshToken);

    await db
      .update(oauthConnectionsTable)
      .set({
        encryptedAccessToken: encryptToken(tokens.accessToken),
        encryptedRefreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : conn.encryptedRefreshToken,
        tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        status: "connected",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(oauthConnectionsTable.id, conn.id));

    res.json({ success: true, platform, expiresIn: tokens.expiresIn });
  } catch (err) {
    req.log.error({ err }, "Token refresh failed");

    // Mark the connection as requiring reauth
    await db
      .update(oauthConnectionsTable)
      .set({
        status: "refresh_needed",
        errorMessage: (err as Error).message,
        updatedAt: new Date(),
      })
      .where(and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, platform as OAuthPlatform),
      ))
      .catch(() => undefined);

    res.status(502).json({ error: "Token refresh failed — please reconnect" });
  }
});

export default router;
