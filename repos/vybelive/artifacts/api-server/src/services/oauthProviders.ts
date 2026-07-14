/**
 * OAuth 2.0 provider configurations and helpers.
 * Platforms: YouTube · Facebook · Instagram · Twitch · Kick
 *
 * All credentials come from env vars. Server boots without them and returns
 * 503 when a provider is not configured.
 *
 * Kick is the only provider that requires OAuth 2.1 PKCE (code_challenge on the
 * authorization request + code_verifier on the token exchange). The PKCE
 * parameters on buildAuthorizationUrl / exchangeCodeForTokens are optional and
 * only emitted for Kick; the other providers ignore them.
 */

export type OAuthPlatform = "youtube" | "facebook" | "instagram" | "twitch" | "kick";

/** Providers that require OAuth 2.1 PKCE (S256). */
export function requiresPkce(platform: OAuthPlatform): boolean {
  return platform === "kick";
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
  raw: Record<string, unknown>;
}

export interface PlatformProfile {
  platformUserId: string;
  accountName: string;
  profileImageUrl: string | null;
}

export interface RtmpCredentials {
  rtmpUrl: string;
  streamKey: string;
  broadcastId?: string;
  streamId?: string;
}

/**
 * A selectable Facebook Live destination. `profile` streams to the connected
 * user's personal timeline; `page` streams to a managed Facebook Page.
 *
 * `accessToken` (the page access token) is server-internal only — it must be
 * encrypted at rest and NEVER serialized to the client.
 */
export interface FacebookTargetOption {
  type: "profile" | "page";
  id: string;
  name: string;
  accessToken?: string;
}

/**
 * The resolved Facebook destination passed at push time. For a page, both
 * `targetId` and `pageAccessToken` (decrypted) are required; for a profile they
 * are null and the user access token is used against `me/live_videos`.
 */
export interface FacebookStreamTarget {
  targetType: "profile" | "page";
  targetId: string | null;
  pageAccessToken: string | null;
}

export interface RtmpFetchOptions {
  facebookTarget?: FacebookStreamTarget | null;
}

// ─── Provider configs ─────────────────────────────────────────────────────────

export function getProviderConfig(platform: OAuthPlatform): OAuthConfig {
  switch (platform) {
    case "youtube":
      return {
        clientId: process.env["GOOGLE_CLIENT_ID"] ?? "",
        clientSecret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: [
          "https://www.googleapis.com/auth/youtube",
          "https://www.googleapis.com/auth/youtube.upload",
          // Required to post comment replies from the Unified Inbox (comments.insert).
          "https://www.googleapis.com/auth/youtube.force-ssl",
          "openid", "email", "profile",
        ],
        scopeSeparator: " ",
      };
    case "facebook":
      return {
        clientId: process.env["META_APP_ID"] ?? "",
        clientSecret: process.env["META_APP_SECRET"] ?? "",
        authUrl: "https://www.facebook.com/v20.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v20.0/oauth/access_token",
        // pages_read_engagement powers reading Page post comments (the inbox);
        // pages_manage_engagement is required to POST comment replies as the Page.
        scopes: [
          "pages_show_list",
          "pages_read_engagement",
          "pages_manage_engagement",
          "publish_video",
          "public_profile",
        ],
        scopeSeparator: ",",
      };
    case "instagram":
      return {
        clientId: process.env["META_APP_ID"] ?? "",
        clientSecret: process.env["META_APP_SECRET"] ?? "",
        authUrl: "https://www.facebook.com/v20.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v20.0/oauth/access_token",
        // instagram_basic + instagram_content_publish power clip publishing;
        // the page + publish_video scopes are required to create an Instagram
        // Live broadcast (live_videos) on the linked professional account;
        // instagram_manage_comments powers the unified inbox (read media
        // comments) and posting comment replies.
        // instagram_manage_messages (+ pages_manage_metadata, required to read a
        // Page's conversations edge) power reading story replies, which arrive as
        // Instagram Direct messages on the linked Page's conversations edge.
        // NOTE (Meta app review): instagram_manage_messages and
        // pages_manage_metadata are advanced permissions — they only return live
        // data after the Meta app passes App Review with a messaging use case and
        // the account grants them on consent. Until then the story-replies fetch
        // degrades honestly to "unavailable".
        scopes: [
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_comments",
          "instagram_manage_messages",
          "pages_show_list",
          "pages_read_engagement",
          "pages_manage_metadata",
          "publish_video",
          "public_profile",
        ],
        scopeSeparator: ",",
      };
    case "twitch":
      return {
        clientId: process.env["TWITCH_CLIENT_ID"] ?? "",
        clientSecret: process.env["TWITCH_CLIENT_SECRET"] ?? "",
        authUrl: "https://id.twitch.tv/oauth2/authorize",
        tokenUrl: "https://id.twitch.tv/oauth2/token",
        scopes: ["channel:read:stream_key", "channel:manage:broadcast", "user:read:email"],
        scopeSeparator: " ",
      };
    case "kick":
      return {
        clientId: process.env["KICK_CLIENT_ID"] ?? "",
        clientSecret: process.env["KICK_CLIENT_SECRET"] ?? "",
        // Kick runs a dedicated OAuth 2.1 server (id.kick.com) separate from its
        // REST API host (api.kick.com). streamkey:read is required to fetch the
        // channel stream key for auto-provisioning; channel:read backs the
        // profile/channel lookup.
        authUrl: "https://id.kick.com/oauth/authorize",
        tokenUrl: "https://id.kick.com/oauth/token",
        scopes: ["user:read", "channel:read", "streamkey:read"],
        scopeSeparator: " ",
      };
  }
}

export function isProviderConfigured(platform: OAuthPlatform): boolean {
  const cfg = getProviderConfig(platform);
  return cfg.clientId.length > 0 && cfg.clientSecret.length > 0;
}

// ─── Authorization URL ────────────────────────────────────────────────────────

export function buildAuthorizationUrl(
  platform: OAuthPlatform,
  redirectUri: string,
  state: string,
  codeChallenge?: string,
): string {
  const cfg = getProviderConfig(platform);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(cfg.scopeSeparator),
    state,
  });
  if (platform === "youtube") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  // OAuth 2.1 PKCE (Kick): attach the S256 code challenge so the token exchange
  // can prove possession of the matching code_verifier.
  if (requiresPkce(platform) && codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return `${cfg.authUrl}?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(
  platform: OAuthPlatform,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(platform);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  // OAuth 2.1 PKCE (Kick): send the verifier the challenge was derived from.
  if (requiresPkce(platform) && codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed [${platform}]: ${res.status} — ${text}`);
  }
  return parseTokenResponse(await res.json() as Record<string, unknown>);
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshAccessToken(
  platform: OAuthPlatform,
  currentRefreshToken: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(platform);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: currentRefreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed [${platform}]: ${res.status} — ${text}`);
  }
  const parsed = parseTokenResponse(await res.json() as Record<string, unknown>);
  if (!parsed.refreshToken) parsed.refreshToken = currentRefreshToken;
  return parsed;
}

function parseTokenResponse(data: Record<string, unknown>): TokenResponse {
  return {
    accessToken: String(data["access_token"] ?? ""),
    refreshToken: data["refresh_token"] ? String(data["refresh_token"]) : null,
    expiresIn: data["expires_in"] != null ? Number(data["expires_in"]) : null,
    scopes: data["scope"] ? String(data["scope"]).split(/[ ,]+/).filter(Boolean) : [],
    raw: data,
  };
}

// ─── Platform profile fetch ───────────────────────────────────────────────────

export async function fetchPlatformProfile(
  platform: OAuthPlatform,
  accessToken: string,
): Promise<PlatformProfile> {
  switch (platform) {
    case "youtube": {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`YouTube profile fetch failed: ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      return {
        platformUserId: String(d["id"] ?? ""),
        accountName: String(d["name"] ?? d["email"] ?? "YouTube Account"),
        profileImageUrl: d["picture"] ? String(d["picture"]) : null,
      };
    }
    case "facebook":
    case "instagram": {
      const res = await fetch(
        "https://graph.facebook.com/me?fields=id,name,picture.type(large)",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`Meta profile fetch failed: ${res.status}`);
      const d = await res.json() as Record<string, unknown>;
      const pic = (d["picture"] as Record<string, unknown> | undefined)?.["data"] as Record<string, unknown> | undefined;
      return {
        platformUserId: String(d["id"] ?? ""),
        accountName: String(d["name"] ?? "Facebook Account"),
        profileImageUrl: pic?.["url"] ? String(pic["url"]) : null,
      };
    }
    case "twitch": {
      const cfg = getProviderConfig("twitch");
      const res = await fetch("https://api.twitch.tv/helix/users", {
        headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": cfg.clientId },
      });
      if (!res.ok) throw new Error(`Twitch profile fetch failed: ${res.status}`);
      const d = await res.json() as { data?: Record<string, unknown>[] };
      const user = d.data?.[0] ?? {};
      return {
        platformUserId: String(user["id"] ?? ""),
        accountName: String(user["display_name"] ?? user["login"] ?? "Twitch Account"),
        profileImageUrl: user["profile_image_url"] ? String(user["profile_image_url"]) : null,
      };
    }
    case "kick": {
      // GET /public/v1/users with a user access token returns the authenticated
      // user. Kick wraps results in { data: [...], message } and field names use
      // snake_case (user_id, name, profile_picture).
      const res = await fetch("https://api.kick.com/public/v1/users", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Kick profile fetch failed: ${res.status} — ${await res.text()}`);
      const d = await res.json() as { data?: Record<string, unknown>[] };
      const user = d.data?.[0] ?? {};
      return {
        platformUserId: String(user["user_id"] ?? user["id"] ?? ""),
        accountName: String(user["name"] ?? user["username"] ?? user["slug"] ?? "Kick Account"),
        profileImageUrl: user["profile_picture"] ? String(user["profile_picture"]) : null,
      };
    }
  }
}

// ─── RTMP credential fetchers ─────────────────────────────────────────────────

export async function fetchYouTubeRtmpCredentials(
  accessToken: string,
  streamTitle: string,
): Promise<RtmpCredentials> {
  const streamRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,status",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: { title: streamTitle },
        cdn: { frameRate: "30fps", ingestionType: "rtmp", resolution: "1080p" },
      }),
    },
  );
  if (!streamRes.ok) {
    throw new Error(`YouTube liveStream create failed: ${streamRes.status} — ${await streamRes.text()}`);
  }
  const sd = await streamRes.json() as Record<string, unknown>;
  const streamId = String(sd["id"] ?? "");
  const ingestion = (sd["cdn"] as Record<string, unknown> | undefined)?.["ingestionInfo"] as Record<string, unknown> | undefined;
  const rtmpUrl = String(ingestion?.["ingestionAddress"] ?? "rtmp://a.rtmp.youtube.com/live2");
  const streamKey = String(ingestion?.["streamName"] ?? "");

  const broadcastRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        snippet: { title: streamTitle, scheduledStartTime: new Date().toISOString() },
        // selfDeclaredMadeForKids:false marks the broadcast "Not made for kids"
        // up front. A fresh broadcast is created every stream, so without this
        // YouTube leaves the COPPA declaration unset and prompts the creator on
        // every new livestream. Setting it here suppresses that prompt.
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
        contentDetails: {
          enableAutoStart: true, enableAutoStop: true, enableDvr: true,
          recordFromStart: true, startWithSlate: false,
          monitorStream: { enableMonitorStream: false },
        },
      }),
    },
  );
  if (!broadcastRes.ok) {
    throw new Error(`YouTube liveBroadcast create failed: ${broadcastRes.status} — ${await broadcastRes.text()}`);
  }
  const bd = await broadcastRes.json() as Record<string, unknown>;
  const broadcastId = String(bd["id"] ?? "");
  if (broadcastId) {
    const bindRes = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&streamId=${streamId}&part=id,contentDetails`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!bindRes.ok) {
      throw new Error(`YouTube liveBroadcast bind failed: ${bindRes.status} — ${await bindRes.text()}`);
    }
  }
  return { rtmpUrl, streamKey, broadcastId, streamId };
}

/**
 * List the Facebook Live destinations available to a connected user: their
 * personal profile plus every Page they manage (requires the `pages_show_list`
 * scope). Page entries carry their own page access token, which is required to
 * create a live video on the Page. The caller is responsible for encrypting any
 * page token before persistence and for never returning it to the client.
 */
export async function fetchFacebookTargets(
  userAccessToken: string,
): Promise<FacebookTargetOption[]> {
  const profileRes = await fetch(
    "https://graph.facebook.com/v20.0/me?fields=id,name",
    { headers: { Authorization: `Bearer ${userAccessToken}` } },
  );
  if (!profileRes.ok) {
    throw new Error(`Facebook profile fetch failed: ${profileRes.status} — ${await profileRes.text()}`);
  }
  const profile = await profileRes.json() as Record<string, unknown>;
  const targets: FacebookTargetOption[] = [
    {
      type: "profile",
      id: String(profile["id"] ?? "me"),
      name: String(profile["name"] ?? "Personal Timeline"),
    },
  ];

  // Pages the user manages. A missing/forbidden response (e.g. the user granted
  // no page scopes) degrades gracefully to "profile only" rather than failing.
  const pagesRes = await fetch(
    "https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100",
    { headers: { Authorization: `Bearer ${userAccessToken}` } },
  );
  if (pagesRes.ok) {
    const pd = await pagesRes.json() as { data?: Record<string, unknown>[] };
    for (const p of pd.data ?? []) {
      const id = String(p["id"] ?? "");
      if (!id) continue;
      targets.push({
        type: "page",
        id,
        name: String(p["name"] ?? "Facebook Page"),
        accessToken: p["access_token"] ? String(p["access_token"]) : undefined,
      });
    }
  }

  return targets;
}

export async function fetchFacebookRtmpCredentials(
  accessToken: string,
  streamTitle: string,
  target?: FacebookStreamTarget | null,
): Promise<RtmpCredentials> {
  // Page target: create the live video on the Page using its page access token.
  // Otherwise stream to the connected user's personal timeline via me/live_videos.
  const usePage =
    target?.targetType === "page" && Boolean(target.targetId) && Boolean(target.pageAccessToken);
  const graphNode = usePage ? String(target!.targetId) : "me";
  const token = usePage ? String(target!.pageAccessToken) : accessToken;

  const res = await fetch(`https://graph.facebook.com/v20.0/${graphNode}/live_videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: streamTitle, description: "",
      privacy: { value: "EVERYONE" }, status: "LIVE_NOW",
    }),
  });
  if (!res.ok) {
    throw new Error(`Facebook live_video create failed: ${res.status} — ${await res.text()}`);
  }
  const d = await res.json() as Record<string, unknown>;
  const secureUrl = String(d["secure_stream_url"] ?? d["stream_url"] ?? "");
  const lastSlash = secureUrl.lastIndexOf("/");
  return {
    rtmpUrl: secureUrl.substring(0, lastSlash),
    streamKey: secureUrl.substring(lastSlash + 1),
    broadcastId: String(d["id"] ?? ""),
  };
}

/**
 * The Instagram Professional account linked to a connected Meta login. This is
 * the implicit Instagram Live "destination" — there is no separate picker like
 * Facebook Pages; the linked account IS where the stream goes live.
 */
export interface InstagramAccountInfo {
  igUserId: string;
  username: string | null;
}

/**
 * Resolve the Instagram Professional (Business/Creator) account linked to the
 * connected Meta login, or `null` when no account is linked.
 *
 * A `null` result is the Instagram analogue of a Facebook Page that has
 * disappeared from the user's managed-pages list: the link was removed, admin
 * access was lost, or the `instagram_*` scopes were revoked — the same condition
 * that makes Instagram Live impossible at push time. A non-OK Graph response
 * throws instead, so callers can distinguish a transient/auth failure (do not
 * raise a false "reconnect" alarm) from a link that is definitively gone.
 */
export async function fetchInstagramAccount(
  accessToken: string,
): Promise<InstagramAccountInfo | null> {
  const meRes = await fetch(
    "https://graph.facebook.com/v20.0/me?fields=instagram_business_account{id,username}",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!meRes.ok) {
    throw new Error(`Instagram account lookup failed: ${meRes.status} — ${await meRes.text()}`);
  }
  const me = (await meRes.json()) as {
    instagram_business_account?: { id?: string; username?: string };
  };
  const igUserId = me.instagram_business_account?.id;
  if (!igUserId) return null;
  return { igUserId, username: me.instagram_business_account?.username ?? null };
}

/**
 * Create an Instagram Live broadcast and return its RTMP ingest credentials.
 *
 * Instagram Live for third-party encoders is only available to Instagram
 * Professional (Business/Creator) accounts linked to a Facebook Page. We resolve
 * the linked IG account from the connected Meta user token (the same lookup the
 * clip-publishing flow uses), then create a live video on the IG user node.
 *
 * Meta returns a combined `secure_stream_url` that embeds the stream key as its
 * final path segment — mirroring the Facebook Live response shape — so the URL
 * is split into base RTMP URL + stream key for Agora Media Push.
 */
export async function fetchInstagramRtmpCredentials(
  accessToken: string,
  streamTitle: string,
): Promise<RtmpCredentials> {
  const account = await fetchInstagramAccount(accessToken);
  if (!account) {
    throw new Error(
      "No Instagram Professional account is linked to this Meta login. " +
        "Convert your Instagram account to Business/Creator and link it to a Facebook Page, then reconnect.",
    );
  }
  const igUserId = account.igUserId;

  const res = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/live_videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: streamTitle, status: "LIVE_NOW" }),
  });
  if (!res.ok) {
    throw new Error(`Instagram live_video create failed: ${res.status} — ${await res.text()}`);
  }
  const d = (await res.json()) as Record<string, unknown>;
  const secureUrl = String(d["secure_stream_url"] ?? d["stream_url"] ?? "");
  if (!secureUrl) {
    throw new Error(
      "Instagram did not return an RTMP ingest URL — Live API access may not be enabled for this account",
    );
  }
  const lastSlash = secureUrl.lastIndexOf("/");
  return {
    rtmpUrl: secureUrl.substring(0, lastSlash),
    streamKey: secureUrl.substring(lastSlash + 1),
    broadcastId: String(d["id"] ?? ""),
  };
}

export async function fetchTwitchRtmpCredentials(accessToken: string): Promise<RtmpCredentials> {
  const cfg = getProviderConfig("twitch");
  const res = await fetch("https://api.twitch.tv/helix/streams/key", {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": cfg.clientId },
  });
  if (!res.ok) {
    throw new Error(`Twitch stream key fetch failed: ${res.status} — ${await res.text()}`);
  }
  const d = await res.json() as { data?: Record<string, unknown>[] };
  return {
    rtmpUrl: "rtmp://live.twitch.tv/app",
    streamKey: String(d.data?.[0]?.["stream_key"] ?? ""),
  };
}

/** Sentinel error so callers can distinguish "Kick can't auto-provision — fall
 *  back to manual RTMP" from a generic/transient failure. */
export class KickAutoProvisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KickAutoProvisionUnavailableError";
  }
}

/**
 * Auto-provision Kick RTMP credentials.
 *
 * Kick uses an always-on channel model (like Twitch): there is no per-stream
 * broadcast object to create. GET /public/v1/channels/stream-key returns the
 * channel stream key (scope streamkey:read). Kick assigns a regional ingest
 * endpoint per account of the shape
 * `rtmps://<prefix>.global-contribute.live-video.net:443/app`, which the API may
 * return alongside the key.
 *
 * If the API does not return a usable ingest URL (e.g. the field is absent for
 * this account, or the endpoint is unavailable for the granted scopes), this
 * throws KickAutoProvisionUnavailableError so the caller can fall back to the
 * manual custom_rtmp destination model rather than failing the whole stream.
 */
export async function fetchKickRtmpCredentials(accessToken: string): Promise<RtmpCredentials> {
  const res = await fetch("https://api.kick.com/public/v1/channels/stream-key", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    // 401/403 → scope/token issue; 404 → endpoint not available for this account.
    // Either way auto-provisioning is not possible; surface as the fallback signal.
    throw new KickAutoProvisionUnavailableError(
      `Kick stream key fetch failed (${res.status}). Add your Kick RTMP URL and stream key manually under Custom RTMP.`,
    );
  }
  const body = await res.json() as { data?: Record<string, unknown> } & Record<string, unknown>;
  const data = (body.data ?? body) as Record<string, unknown>;

  const streamKey = String(data["stream_key"] ?? data["streamKey"] ?? data["key"] ?? "");
  const rtmpUrl = String(
    data["rtmp_url"] ?? data["rtmpUrl"] ?? data["stream_url"] ?? data["streamUrl"] ?? data["ingest_url"] ?? data["ingest_endpoint"] ?? "",
  );

  if (!streamKey || !rtmpUrl) {
    throw new KickAutoProvisionUnavailableError(
      "Kick did not return a usable RTMP ingest URL and stream key. " +
        "Copy the Stream URL and Stream Key from your Kick dashboard and add them manually under Custom RTMP.",
    );
  }

  return { rtmpUrl, streamKey };
}

export async function fetchRtmpCredentials(
  platform: OAuthPlatform,
  accessToken: string,
  streamTitle: string,
  options?: RtmpFetchOptions,
): Promise<RtmpCredentials | null> {
  switch (platform) {
    case "youtube":   return fetchYouTubeRtmpCredentials(accessToken, streamTitle);
    case "facebook":  return fetchFacebookRtmpCredentials(accessToken, streamTitle, options?.facebookTarget ?? null);
    case "twitch":    return fetchTwitchRtmpCredentials(accessToken);
    case "instagram": return fetchInstagramRtmpCredentials(accessToken, streamTitle);
    case "kick":      return fetchKickRtmpCredentials(accessToken);
  }
}
