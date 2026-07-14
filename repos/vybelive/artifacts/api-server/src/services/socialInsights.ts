/**
 * socialInsights — real social-platform data for the Mission Control Social
 * Command Center.
 *
 * HARD RULE: this module never fabricates metrics. It returns real data pulled
 * from a platform's API using the founder's stored OAuth token, OR an explicit
 * "unavailable" descriptor explaining why (not connected, creds not configured,
 * platform not integrated, or a live API error). Callers render honest connect /
 * unavailable states from those descriptors.
 *
 * Currently implemented with real API calls:
 *   • YouTube  — Data API v3 (channel stats, recent uploads, comment threads,
 *                comment replies)
 *   • Facebook — Graph API Page fan_count (best-effort, requires page scope),
 *                Page post comments inbox + comment replies (requires
 *                pages_read_engagement + pages_manage_engagement)
 *   • Instagram— Graph API IG business account followers/media (best-effort),
 *                media comments inbox + comment replies (requires
 *                instagram_manage_comments)
 *
 * Twitch / Kick have OAuth support in the app but their app credentials are not
 * configured in this environment, so they resolve to a "not_configured" state.
 * X / LinkedIn / Threads / Discord / Reddit / TikTok are not integrated at all
 * and resolve to a "not_integrated" state.
 */

import { db, oauthConnectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptToken, encryptToken } from "../lib/crypto.js";
import {
  refreshAccessToken,
  isProviderConfigured,
  type OAuthPlatform,
} from "./oauthProviders.js";
import { logger } from "../lib/logger.js";

// ─── Platform capability registry ────────────────────────────────────────────

export type SocialPlatformId =
  | "youtube"
  | "facebook"
  | "instagram"
  | "twitch"
  | "kick"
  | "x"
  | "linkedin"
  | "threads"
  | "discord"
  | "reddit"
  | "tiktok";

export interface PlatformCapability {
  id: SocialPlatformId;
  label: string;
  /** The app has an OAuth connect flow for this platform. */
  oauthSupported: boolean;
  /** The app can publish content to this platform. */
  publishSupported: boolean;
  /** This module can pull real analytics/metrics for this platform. */
  analyticsSupported: boolean;
  /** This module can pull an inbox (comments/mentions) for this platform. */
  inboxSupported: boolean;
  /** This module can post replies to inbox comments for this platform. */
  replySupported: boolean;
}

/** Static capability map — describes what the platform integration can do. */
export const PLATFORM_CAPABILITIES: Record<SocialPlatformId, PlatformCapability> = {
  youtube:   { id: "youtube",   label: "YouTube",   oauthSupported: true,  publishSupported: true,  analyticsSupported: true,  inboxSupported: true,  replySupported: true  },
  facebook:  { id: "facebook",  label: "Facebook",  oauthSupported: true,  publishSupported: true,  analyticsSupported: true,  inboxSupported: true,  replySupported: true  },
  instagram: { id: "instagram", label: "Instagram", oauthSupported: true,  publishSupported: true,  analyticsSupported: true,  inboxSupported: true,  replySupported: true  },
  twitch:    { id: "twitch",    label: "Twitch",    oauthSupported: true,  publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  kick:      { id: "kick",      label: "Kick",      oauthSupported: true,  publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  x:         { id: "x",         label: "X",         oauthSupported: false, publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  linkedin:  { id: "linkedin",  label: "LinkedIn",  oauthSupported: false, publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  threads:   { id: "threads",   label: "Threads",   oauthSupported: false, publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  discord:   { id: "discord",   label: "Discord",   oauthSupported: false, publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  reddit:    { id: "reddit",    label: "Reddit",    oauthSupported: false, publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
  tiktok:    { id: "tiktok",    label: "TikTok",    oauthSupported: false, publishSupported: false, analyticsSupported: false, inboxSupported: false, replySupported: false },
};

export const ALL_PLATFORMS = Object.keys(PLATFORM_CAPABILITIES) as SocialPlatformId[];

/** Why real data is unavailable for a platform — drives honest UI states. */
export type UnavailableReason =
  | "not_integrated"   // no OAuth flow exists for this platform at all
  | "not_configured"   // OAuth flow exists but app credentials are missing
  | "not_connected"    // configured but the founder has not connected an account
  | "reauth_needed"    // connection exists but token is expired / refresh failed
  | "unsupported"      // connected but this data type isn't fetchable for it
  | "api_error";       // live API call failed

export interface Unavailable {
  available: false;
  reason: UnavailableReason;
  message: string;
}

function unavailable(reason: UnavailableReason, message: string): Unavailable {
  return { available: false, reason, message };
}

const OAUTH_PLATFORMS: SocialPlatformId[] = ["youtube", "facebook", "instagram", "twitch", "kick"];

function isOAuthPlatform(id: SocialPlatformId): id is OAuthPlatform {
  return OAUTH_PLATFORMS.includes(id);
}

/**
 * True when the platform has an OAuth flow AND its app credentials are present
 * in this environment. Used by the overview endpoint to distinguish
 * "not configured" from "not connected".
 */
export function isSocialProviderConfigured(id: SocialPlatformId): boolean {
  if (!isOAuthPlatform(id)) return false;
  return isProviderConfigured(id);
}

// ─── Token resolution (founder-scoped, auto-refresh) ─────────────────────────

export interface ResolvedToken {
  accessToken: string;
  connection: {
    id: string;
    accountName: string | null;
    platformUserId: string | null;
    profileImageUrl: string | null;
    status: string;
  };
}

/**
 * Return a usable (decrypted, non-expired) access token for the founder on a
 * platform, auto-refreshing if needed. Returns an Unavailable descriptor when
 * the platform isn't integrated/configured, isn't connected, or reauth failed.
 */
export async function getFounderToken(
  founderUserId: string,
  platform: SocialPlatformId,
): Promise<ResolvedToken | Unavailable> {
  const cap = PLATFORM_CAPABILITIES[platform];
  if (!cap.oauthSupported || !isOAuthPlatform(platform)) {
    return unavailable("not_integrated", `${cap.label} is not integrated yet.`);
  }
  if (!isProviderConfigured(platform)) {
    return unavailable(
      "not_configured",
      `${cap.label} OAuth credentials are not configured in this environment.`,
    );
  }

  const [conn] = await db
    .select()
    .from(oauthConnectionsTable)
    .where(
      and(
        eq(oauthConnectionsTable.userId, founderUserId),
        eq(oauthConnectionsTable.platform, platform),
      ),
    )
    .limit(1);

  if (!conn || conn.status === "disconnected" || !conn.encryptedAccessToken) {
    return unavailable("not_connected", `${cap.label} is not connected.`);
  }

  const meta = {
    id: conn.id,
    accountName: conn.accountName,
    platformUserId: conn.platformUserId,
    profileImageUrl: conn.profileImageUrl,
    status: conn.status,
  };

  const expired =
    conn.status === "expired" ||
    conn.status === "refresh_needed" ||
    (conn.tokenExpiresAt && new Date(conn.tokenExpiresAt) < new Date());

  if (!expired) {
    return { accessToken: decryptToken(conn.encryptedAccessToken), connection: meta };
  }

  if (!conn.encryptedRefreshToken) {
    return unavailable("reauth_needed", `${cap.label} session expired — reconnect required.`);
  }

  try {
    const refreshToken = decryptToken(conn.encryptedRefreshToken);
    const tokens = await refreshAccessToken(platform, refreshToken);
    await db
      .update(oauthConnectionsTable)
      .set({
        encryptedAccessToken: encryptToken(tokens.accessToken),
        encryptedRefreshToken: tokens.refreshToken
          ? encryptToken(tokens.refreshToken)
          : conn.encryptedRefreshToken,
        tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        status: "connected",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(oauthConnectionsTable.id, conn.id));
    return { accessToken: tokens.accessToken, connection: { ...meta, status: "connected" } };
  } catch (err) {
    logger.warn({ err, platform }, "socialInsights: token refresh failed");
    await db
      .update(oauthConnectionsTable)
      .set({ status: "refresh_needed", updatedAt: new Date() })
      .where(eq(oauthConnectionsTable.id, conn.id))
      .catch(() => undefined);
    return unavailable("reauth_needed", `${cap.label} session expired — reconnect required.`);
  }
}

// ─── Shared shapes ───────────────────────────────────────────────────────────

export interface AudienceStats {
  followers: number | null;
  totalViews: number | null;
  contentCount: number | null;
}

export interface RecentPost {
  id: string;
  platform: SocialPlatformId;
  title: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface PlatformSnapshot {
  platform: SocialPlatformId;
  label: string;
  account: { name: string | null; avatarUrl: string | null } | null;
  stats: AudienceStats | null;
  recent: RecentPost[];
  unavailable: Unavailable | null;
}

export interface InboxItem {
  id: string;
  platform: SocialPlatformId;
  kind: "comment" | "mention" | "story_reply";
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  createdAt: string | null;
  likeCount: number | null;
  contextTitle: string | null;
  contextUrl: string | null;
  /** True when this inbox item's platform supports posting a reply from here. */
  replySupported: boolean;
  /**
   * Human-readable name of the account/asset that owns this item and that a
   * reply would be posted as — e.g. the Facebook Page name. Lets the UI group
   * and label items when a founder manages several Pages. Null when there is no
   * distinct owning asset (e.g. a single-identity platform).
   */
  ownerLabel?: string | null;
}

/**
 * A per-feature availability descriptor for a platform inbox. A single platform
 * can expose several engagement surfaces (e.g. Instagram: media comments,
 * @-mentions, story replies) that each have their own permission/availability.
 * Each sub-source is reported honestly so the UI can show exactly what is (and
 * is not) covered instead of a single all-or-nothing platform state.
 */
export interface InboxSubSource {
  key: string;
  label: string;
  available: boolean;
  message: string | null;
}

/** Result of fetching a platform inbox that has multiple engagement surfaces. */
export interface InboxFetchResult {
  items: InboxItem[];
  sources: InboxSubSource[];
}

// ─── YouTube (real, Data API v3) ─────────────────────────────────────────────

const YT_BASE = "https://www.googleapis.com/youtube/v3";

async function ytFetch<T>(path: string, params: Record<string, string>, accessToken: string): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${YT_BASE}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface YtChannelResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string } } };
    statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

interface YtPlaylistItemsResponse {
  items?: Array<{
    contentDetails?: { videoId?: string };
    snippet?: {
      title?: string;
      publishedAt?: string;
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
    };
  }>;
}

interface YtVideosResponse {
  items?: Array<{
    id: string;
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }>;
}

interface YtCommentThreadsResponse {
  items?: Array<{
    id: string;
    snippet?: {
      videoId?: string;
      topLevelComment?: {
        snippet?: {
          authorDisplayName?: string;
          authorProfileImageUrl?: string;
          textDisplay?: string;
          publishedAt?: string;
          likeCount?: number;
        };
      };
    };
  }>;
}

function toNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fetch the founder's YouTube channel snapshot (real subs/views/videos + recent uploads). */
export async function getYouTubeSnapshot(accessToken: string): Promise<PlatformSnapshot> {
  const chan = await ytFetch<YtChannelResponse>(
    "channels",
    { part: "snippet,statistics,contentDetails", mine: "true" },
    accessToken,
  );
  const channel = chan.items?.[0];
  if (!channel) {
    return {
      platform: "youtube",
      label: "YouTube",
      account: null,
      stats: null,
      recent: [],
      unavailable: unavailable("api_error", "No YouTube channel found on the connected account."),
    };
  }

  const stats: AudienceStats = {
    followers: toNum(channel.statistics?.subscriberCount),
    totalViews: toNum(channel.statistics?.viewCount),
    contentCount: toNum(channel.statistics?.videoCount),
  };

  const recent: RecentPost[] = [];
  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (uploadsId) {
    const playlist = await ytFetch<YtPlaylistItemsResponse>(
      "playlistItems",
      { part: "snippet,contentDetails", playlistId: uploadsId, maxResults: "10" },
      accessToken,
    );
    const videoIds = (playlist.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((v): v is string => Boolean(v));

    const statsById = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
    if (videoIds.length > 0) {
      const vids = await ytFetch<YtVideosResponse>(
        "videos",
        { part: "statistics", id: videoIds.join(",") },
        accessToken,
      );
      for (const v of vids.items ?? []) {
        statsById.set(v.id, {
          views: toNum(v.statistics?.viewCount),
          likes: toNum(v.statistics?.likeCount),
          comments: toNum(v.statistics?.commentCount),
        });
      }
    }

    for (const item of playlist.items ?? []) {
      const vid = item.contentDetails?.videoId;
      if (!vid) continue;
      const s = statsById.get(vid);
      recent.push({
        id: vid,
        platform: "youtube",
        title: item.snippet?.title ?? "(untitled)",
        publishedAt: item.snippet?.publishedAt ?? null,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
        url: `https://www.youtube.com/watch?v=${vid}`,
        views: s?.views ?? null,
        likes: s?.likes ?? null,
        comments: s?.comments ?? null,
      });
    }
  }

  return {
    platform: "youtube",
    label: "YouTube",
    account: {
      name: channel.snippet?.title ?? null,
      avatarUrl: channel.snippet?.thumbnails?.medium?.url ?? channel.snippet?.thumbnails?.default?.url ?? null,
    },
    stats,
    recent,
    unavailable: null,
  };
}

/** Fetch recent comment threads across the founder's YouTube channel (real inbox). */
export async function getYouTubeInbox(accessToken: string, max = 25): Promise<InboxItem[]> {
  // First resolve the channel id (commentThreads requires allThreadsRelatedToChannelId).
  const chan = await ytFetch<YtChannelResponse>("channels", { part: "id", mine: "true" }, accessToken);
  const channelId = chan.items?.[0]?.id;
  if (!channelId) return [];

  const threads = await ytFetch<YtCommentThreadsResponse>(
    "commentThreads",
    {
      part: "snippet",
      allThreadsRelatedToChannelId: channelId,
      maxResults: String(Math.min(max, 50)),
      order: "time",
    },
    accessToken,
  );

  const items: InboxItem[] = [];
  for (const t of threads.items ?? []) {
    const c = t.snippet?.topLevelComment?.snippet;
    if (!c) continue;
    const videoId = t.snippet?.videoId;
    items.push({
      id: t.id,
      platform: "youtube",
      kind: "comment",
      authorName: c.authorDisplayName ?? "Unknown",
      authorAvatarUrl: c.authorProfileImageUrl ?? null,
      text: c.textDisplay ?? "",
      createdAt: c.publishedAt ?? null,
      likeCount: typeof c.likeCount === "number" ? c.likeCount : null,
      contextTitle: null,
      contextUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      replySupported: PLATFORM_CAPABILITIES.youtube.replySupported,
    });
  }
  return items;
}

export interface InboxReplyResult {
  replyId: string | null;
  text: string | null;
  publishedAt: string | null;
}

/**
 * Post a reply to a YouTube comment thread (real, Data API v3 comments.insert).
 * `parentId` is the top-level comment / thread id (the inbox item id). Requires
 * the connected account to have granted a comment-write scope
 * (youtube.force-ssl); otherwise the API returns 403 and we surface it honestly.
 */
export async function replyToYouTubeComment(
  accessToken: string,
  parentId: string,
  text: string,
): Promise<InboxReplyResult> {
  const res = await fetch(`${YT_BASE}/comments?part=snippet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API comments.insert ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    id?: string;
    snippet?: { textDisplay?: string; textOriginal?: string; publishedAt?: string };
  };
  return {
    replyId: json.id ?? null,
    text: json.snippet?.textDisplay ?? json.snippet?.textOriginal ?? text,
    publishedAt: json.snippet?.publishedAt ?? null,
  };
}

// ─── Meta: Facebook / Instagram (best-effort, honest degradation) ────────────

/** Facebook Page fan_count via Graph API. Best-effort; requires page scopes. */
export async function getFacebookSnapshot(accessToken: string): Promise<PlatformSnapshot> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=name,fan_count,followers_count,picture&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Graph ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      data?: Array<{ name?: string; fan_count?: number; followers_count?: number; picture?: { data?: { url?: string } } }>;
    };
    const page = json.data?.[0];
    if (!page) {
      return {
        platform: "facebook",
        label: "Facebook",
        account: null,
        stats: null,
        recent: [],
        unavailable: unavailable("unsupported", "No manageable Facebook Page found on this account."),
      };
    }
    return {
      platform: "facebook",
      label: "Facebook",
      account: { name: page.name ?? null, avatarUrl: page.picture?.data?.url ?? null },
      stats: {
        followers: page.followers_count ?? page.fan_count ?? null,
        totalViews: null,
        contentCount: null,
      },
      recent: [],
      unavailable: null,
    };
  } catch (err) {
    logger.warn({ err }, "socialInsights: facebook snapshot failed");
    return {
      platform: "facebook",
      label: "Facebook",
      account: null,
      stats: null,
      recent: [],
      unavailable: unavailable("api_error", "Facebook Page insights are unavailable — the connected account may lack Page permissions."),
    };
  }
}

/** Instagram business account followers/media via Graph API. Best-effort. */
export async function getInstagramSnapshot(accessToken: string): Promise<PlatformSnapshot> {
  try {
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!pagesRes.ok) throw new Error(`Graph accounts ${pagesRes.status}`);
    const pages = (await pagesRes.json()) as {
      data?: Array<{ instagram_business_account?: { id?: string } }>;
    };
    const igId = pages.data?.find((p) => p.instagram_business_account?.id)?.instagram_business_account?.id;
    if (!igId) {
      return {
        platform: "instagram",
        label: "Instagram",
        account: null,
        stats: null,
        recent: [],
        unavailable: unavailable("unsupported", "No Instagram Professional account is linked to a connected Facebook Page."),
      };
    }
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${igId}?fields=username,profile_picture_url,followers_count,media_count&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!igRes.ok) throw new Error(`Graph ig ${igRes.status}`);
    const ig = (await igRes.json()) as {
      username?: string;
      profile_picture_url?: string;
      followers_count?: number;
      media_count?: number;
    };
    return {
      platform: "instagram",
      label: "Instagram",
      account: { name: ig.username ?? null, avatarUrl: ig.profile_picture_url ?? null },
      stats: {
        followers: ig.followers_count ?? null,
        totalViews: null,
        contentCount: ig.media_count ?? null,
      },
      recent: [],
      unavailable: null,
    };
  } catch (err) {
    logger.warn({ err }, "socialInsights: instagram snapshot failed");
    return {
      platform: "instagram",
      label: "Instagram",
      account: null,
      stats: null,
      recent: [],
      unavailable: unavailable("api_error", "Instagram insights are unavailable — the connected account may lack the required permissions."),
    };
  }
}

// ─── Meta Graph helpers (inbox + reply) ──────────────────────────────────────

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/**
 * Facebook inbox item ids are page-scoped: replying to a Page comment must be
 * done with that Page's access token, but a bare comment id doesn't tell us
 * which Page owns it. We therefore encode `${pageId}::${commentId}` into the
 * inbox item id so the reply handler can resolve the correct page token. Both
 * ids are numeric strings, so "::" never collides with their contents.
 */
const FB_ID_DELIM = "::";

async function graphGet<T>(
  node: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: accessToken }).toString();
  const res = await fetch(`${GRAPH_BASE}/${node}?${qs}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph GET ${node} ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function graphPost<T>(
  node: string,
  params: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/${node}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph POST ${node} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface FbPagesResponse {
  data?: Array<{ id?: string; name?: string; access_token?: string }>;
}

interface FbFeedResponse {
  data?: Array<{
    id?: string;
    message?: string;
    permalink_url?: string;
    comments?: {
      data?: Array<{
        id?: string;
        message?: string;
        created_time?: string;
        like_count?: number;
        from?: { name?: string; picture?: { data?: { url?: string } } };
      }>;
    };
  }>;
}

/**
 * Real Facebook inbox: recent comments on the connected account's managed Page
 * posts. Requires `pages_read_engagement` (+ `pages_show_list`). Each item id is
 * page-scoped (`${pageId}::${commentId}`) so replies can resolve the page token.
 * Reading a page's own post comments uses the page access token.
 */
export async function getFacebookInbox(
  userAccessToken: string,
  maxPerPage = 25,
): Promise<InboxFetchResult> {
  const pages = await graphGet<FbPagesResponse>(
    "me/accounts",
    { fields: "id,name,access_token", limit: "50" },
    userAccessToken,
  );
  const items: InboxItem[] = [];
  const sources: InboxSubSource[] = [];

  const pageList = pages.data ?? [];
  if (pageList.length === 0) {
    sources.push({
      key: "facebook",
      label: "Facebook",
      available: false,
      message: "No manageable Facebook Pages found. Reconnect Facebook to grant Page access.",
    });
    return { items, sources };
  }

  // Each managed Page degrades independently and honestly: a Page whose access
  // token is missing (revoked/insufficient permission) surfaces a reconnect
  // sub-source instead of silently disappearing, and one Page failing to load
  // never blanks out the others.
  for (const page of pageList) {
    const pageId = page.id;
    const pageToken = page.access_token;
    const pageName = page.name ?? "Facebook Page";
    if (!pageId) continue;
    const key = `facebook:${pageId}`;
    const label = `Facebook · ${pageName}`;
    if (!pageToken) {
      sources.push({
        key,
        label,
        available: false,
        message: `This Page's access token is missing — reconnect Facebook to grant reply access for "${pageName}".`,
      });
      continue;
    }
    try {
      const feed = await graphGet<FbFeedResponse>(
        `${pageId}/feed`,
        {
          fields: `message,permalink_url,comments.limit(${maxPerPage}){id,message,created_time,like_count,from{name,picture}}`,
          limit: "10",
        },
        pageToken,
      );
      for (const post of feed.data ?? []) {
        for (const c of post.comments?.data ?? []) {
          if (!c.id) continue;
          items.push({
            id: `${pageId}${FB_ID_DELIM}${c.id}`,
            platform: "facebook",
            kind: "comment",
            authorName: c.from?.name ?? "Facebook user",
            authorAvatarUrl: c.from?.picture?.data?.url ?? null,
            text: c.message ?? "",
            createdAt: c.created_time ?? null,
            likeCount: typeof c.like_count === "number" ? c.like_count : null,
            contextTitle: post.message ? post.message.slice(0, 80) : null,
            contextUrl: post.permalink_url ?? null,
            replySupported: PLATFORM_CAPABILITIES.facebook.replySupported,
            ownerLabel: pageName,
          });
        }
      }
      sources.push({ key, label, available: true, message: null });
    } catch (err) {
      logger.warn({ err, pageId }, "socialInsights: facebook page feed fetch failed");
      sources.push({
        key,
        label,
        available: false,
        message: `Failed to load comments for "${pageName}". Reconnect Facebook if this persists.`,
      });
    }
  }
  return { items, sources };
}

/**
 * Post a reply to a Facebook Page comment (Graph API: publish to the comment's
 * `comments` edge). `itemId` is the page-scoped id minted by getFacebookInbox
 * (`${pageId}::${commentId}`); we resolve the owning Page's access token and post
 * as the Page. Requires `pages_manage_engagement`; otherwise Graph returns an
 * error we surface honestly (never a fake "sent").
 */
export async function replyToFacebookComment(
  userAccessToken: string,
  itemId: string,
  text: string,
): Promise<InboxReplyResult> {
  const delimIdx = itemId.indexOf(FB_ID_DELIM);
  const pageId = delimIdx >= 0 ? itemId.slice(0, delimIdx) : "";
  const commentId = delimIdx >= 0 ? itemId.slice(delimIdx + FB_ID_DELIM.length) : itemId;
  if (!pageId || !commentId) {
    throw new Error("Facebook reply requires a page-scoped comment id.");
  }
  const pages = await graphGet<FbPagesResponse>(
    "me/accounts",
    { fields: "id,access_token", limit: "50" },
    userAccessToken,
  );
  const pageToken = pages.data?.find((p) => p.id === pageId)?.access_token;
  if (!pageToken) {
    throw new Error("No manageable Facebook Page token found for this comment.");
  }
  const json = await graphPost<{ id?: string }>(
    `${commentId}/comments`,
    { message: text },
    pageToken,
  );
  return { replyId: json.id ?? null, text, publishedAt: null };
}

interface IgAccountsResponse {
  data?: Array<{ id?: string; access_token?: string; instagram_business_account?: { id?: string } }>;
}

interface IgConversationsResponse {
  data?: Array<{
    id?: string;
    messages?: {
      data?: Array<{
        id?: string;
        created_time?: string;
        from?: { id?: string; username?: string };
        message?: string;
        // Present only when the message is a reply to (a mention of) a story.
        story?: { id?: string; link?: string; mention?: unknown } | null;
      }>;
    };
  }>;
}

interface IgMediaResponse {
  data?: Array<{
    id?: string;
    caption?: string;
    permalink?: string;
    comments?: {
      data?: Array<{
        id?: string;
        text?: string;
        username?: string;
        timestamp?: string;
        like_count?: number;
      }>;
    };
  }>;
}

interface IgTagsResponse {
  data?: Array<{
    id?: string;
    caption?: string;
    permalink?: string;
    username?: string;
    timestamp?: string;
    like_count?: number;
    media_type?: string;
  }>;
}

/**
 * Build an honest, non-fabricated failure message for an Instagram sub-source.
 * Meta returns a permissions error (commonly OAuthException code 10 / 200) when
 * the token lacks a scope; we surface that possibility plainly rather than a
 * generic error so the operator knows a re-consent may be required.
 */
function igSubSourceMessage(err: unknown, feature: string, scope: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const looksLikePermission = /permission|OAuthException|\b(10|200)\b|scope/i.test(raw);
  return looksLikePermission
    ? `Instagram ${feature} unavailable — the connected account may be missing the "${scope}" permission. Reconnect Instagram to grant it.`
    : `Instagram ${feature} could not be loaded from the Graph API right now.`;
}

/**
 * Real Instagram inbox across multiple engagement surfaces:
 *   • Comments  — comments on the linked IG Professional account's own media
 *     (requires `instagram_manage_comments`).
 *   • @-Mentions — media where other users tagged/@mentioned this account, read
 *     from the account's Tags edge (`/{ig-user-id}/tags`, requires
 *     `instagram_manage_comments`). NOTE: the `mentioned_media` /
 *     `mentioned_comment` fields are NOT list edges — they only resolve when you
 *     already hold a specific id delivered by a `mentions` webhook, so they
 *     cannot be enumerated on demand. The Tags edge is the listable, real source
 *     of "where the audience @mentioned/tagged you", so we surface that.
 *   • Story replies — arrive as Instagram Direct messages, read from the linked
 *     Page's `conversations` edge (`platform=instagram`, requires
 *     `instagram_manage_messages` + a Page access token). Only inbound messages
 *     carrying a `story` reference (a reply to one of our stories) are surfaced.
 *     The permission is an advanced Meta permission gated behind App Review, so
 *     until it is granted this sub-source degrades honestly to "unavailable"
 *     (never a placeholder).
 *
 * Each surface degrades independently and honestly: a permission gap on one
 * (e.g. mentions) does not blank out the others, and every gap is reported via
 * an InboxSubSource so the UI shows exactly what is and isn't covered.
 */
export async function getInstagramInbox(
  userAccessToken: string,
  maxPerMedia = 25,
): Promise<InboxFetchResult> {
  const pages = await graphGet<IgAccountsResponse>(
    "me/accounts",
    { fields: "id,access_token,instagram_business_account", limit: "50" },
    userAccessToken,
  );
  const page = pages.data?.find((p) => p.instagram_business_account?.id);
  const igId = page?.instagram_business_account?.id;
  // The IG messaging (conversations) edge is queried on the linked Page and
  // requires that Page's access token, unlike comments/tags which use the user
  // token. Fall back to the user token if the Page token wasn't returned.
  const pageId = page?.id ?? null;
  const pageToken = page?.access_token ?? userAccessToken;
  if (!igId) {
    return {
      items: [],
      sources: [
        {
          key: "instagram",
          label: "Instagram",
          available: false,
          message: "No Instagram Professional account is linked to a connected Facebook Page.",
        },
      ],
    };
  }

  const items: InboxItem[] = [];
  const sources: InboxSubSource[] = [];

  // 1) Comments on the account's own media.
  try {
    const media = await graphGet<IgMediaResponse>(
      `${igId}/media`,
      {
        fields: `id,caption,permalink,comments.limit(${maxPerMedia}){id,text,username,timestamp,like_count}`,
        limit: "10",
      },
      userAccessToken,
    );
    for (const m of media.data ?? []) {
      for (const c of m.comments?.data ?? []) {
        if (!c.id) continue;
        items.push({
          id: c.id,
          platform: "instagram",
          kind: "comment",
          authorName: c.username ?? "Instagram user",
          authorAvatarUrl: null,
          text: c.text ?? "",
          createdAt: c.timestamp ?? null,
          likeCount: typeof c.like_count === "number" ? c.like_count : null,
          contextTitle: m.caption ? m.caption.slice(0, 80) : null,
          contextUrl: m.permalink ?? null,
          replySupported: PLATFORM_CAPABILITIES.instagram.replySupported,
        });
      }
    }
    sources.push({ key: "instagram:comments", label: "Instagram · Comments", available: true, message: null });
  } catch (err) {
    logger.warn({ err }, "socialInsights: instagram comments fetch failed");
    sources.push({
      key: "instagram:comments",
      label: "Instagram · Comments",
      available: false,
      message: igSubSourceMessage(err, "comments", "instagram_manage_comments"),
    });
  }

  // 2) @-Mentions via the Tags edge (media where others tagged/@mentioned us).
  try {
    const tags = await graphGet<IgTagsResponse>(
      `${igId}/tags`,
      {
        fields: "id,caption,permalink,username,timestamp,like_count,media_type",
        limit: String(Math.min(maxPerMedia, 50)),
      },
      userAccessToken,
    );
    for (const t of tags.data ?? []) {
      if (!t.id) continue;
      items.push({
        id: `ig-mention:${t.id}`,
        platform: "instagram",
        kind: "mention",
        authorName: t.username ? `@${t.username}` : "Instagram user",
        authorAvatarUrl: null,
        text: t.caption ?? "",
        createdAt: t.timestamp ?? null,
        likeCount: typeof t.like_count === "number" ? t.like_count : null,
        contextTitle: "Tagged / @mentioned your account",
        contextUrl: t.permalink ?? null,
        // A mention lives on another creator's media — you can't reply to it via
        // your own comment-reply flow, so replies are not offered from here.
        replySupported: false,
      });
    }
    sources.push({ key: "instagram:mentions", label: "Instagram · @-Mentions", available: true, message: null });
  } catch (err) {
    logger.warn({ err }, "socialInsights: instagram mentions fetch failed");
    sources.push({
      key: "instagram:mentions",
      label: "Instagram · @-Mentions",
      available: false,
      message: igSubSourceMessage(err, "@-mentions", "instagram_manage_comments"),
    });
  }

  // 3) Story replies — inbound Instagram Direct messages that reply to one of
  //    our stories, read from the linked Page's conversations edge. A single
  //    call expands each conversation's recent messages (avoids an N+1), and we
  //    keep only inbound messages that carry a `story` reference.
  try {
    const convos = await graphGet<IgConversationsResponse>(
      `${pageId ?? igId}/conversations`,
      {
        platform: "instagram",
        fields: `messages.limit(${Math.min(maxPerMedia, 50)}){id,created_time,from{id,username},message,story}`,
        limit: "20",
      },
      pageToken,
    );
    for (const convo of convos.data ?? []) {
      for (const msg of convo.messages?.data ?? []) {
        // Only messages that reference a story are story replies…
        if (!msg.id || !msg.story) continue;
        // …and only inbound ones (skip our own outgoing DMs).
        if (msg.from?.id && (msg.from.id === igId || msg.from.id === pageId)) continue;
        items.push({
          id: `ig-story-reply:${msg.id}`,
          platform: "instagram",
          kind: "story_reply",
          authorName: msg.from?.username ? `@${msg.from.username}` : "Instagram user",
          authorAvatarUrl: null,
          text: msg.message ?? "",
          createdAt: msg.created_time ?? null,
          likeCount: null,
          contextTitle: "Replied to your story",
          contextUrl: msg.story?.link ?? null,
          // A story reply is a Direct message; replying would need the Messenger
          // send API (not the comment-reply flow), so we don't offer it here.
          replySupported: false,
        });
      }
    }
    sources.push({ key: "instagram:story_replies", label: "Instagram · Story replies", available: true, message: null });
  } catch (err) {
    logger.warn({ err }, "socialInsights: instagram story replies fetch failed");
    sources.push({
      key: "instagram:story_replies",
      label: "Instagram · Story replies",
      available: false,
      message: igSubSourceMessage(err, "story replies", "instagram_manage_messages / pages_manage_metadata"),
    });
  }

  return { items, sources };
}

/**
 * Post a reply to an Instagram comment (Graph API: publish to the comment's
 * `replies` edge). Uses the connected Meta user token — matching the existing
 * IG snapshot/publish flows. Requires `instagram_manage_comments`; otherwise
 * Graph returns an error we surface honestly.
 */
export async function replyToInstagramComment(
  userAccessToken: string,
  commentId: string,
  text: string,
): Promise<InboxReplyResult> {
  const json = await graphPost<{ id?: string }>(
    `${commentId}/replies`,
    { message: text },
    userAccessToken,
  );
  return { replyId: json.id ?? null, text, publishedAt: null };
}

/**
 * Build a full snapshot for a platform for the founder, resolving the token and
 * dispatching to the right real fetcher. Returns an Unavailable-only snapshot
 * for platforms without live data.
 */
export async function getPlatformSnapshot(
  founderUserId: string,
  platform: SocialPlatformId,
): Promise<PlatformSnapshot> {
  const cap = PLATFORM_CAPABILITIES[platform];
  const empty = (u: Unavailable): PlatformSnapshot => ({
    platform,
    label: cap.label,
    account: null,
    stats: null,
    recent: [],
    unavailable: u,
  });

  if (!cap.analyticsSupported) {
    if (!cap.oauthSupported) return empty(unavailable("not_integrated", `${cap.label} is not integrated yet.`));
    if (!isProviderConfigured(platform as OAuthPlatform)) {
      return empty(unavailable("not_configured", `${cap.label} OAuth credentials are not configured in this environment.`));
    }
    return empty(unavailable("unsupported", `Analytics for ${cap.label} are not available yet.`));
  }

  const tok = await getFounderToken(founderUserId, platform);
  if ("available" in tok) return empty(tok);

  try {
    let snap: PlatformSnapshot;
    if (platform === "youtube") snap = await getYouTubeSnapshot(tok.accessToken);
    else if (platform === "facebook") snap = await getFacebookSnapshot(tok.accessToken);
    else if (platform === "instagram") snap = await getInstagramSnapshot(tok.accessToken);
    else return empty(unavailable("unsupported", `Analytics for ${cap.label} are not available yet.`));

    if (snap.account === null && tok.connection.accountName) {
      snap.account = { name: tok.connection.accountName, avatarUrl: tok.connection.profileImageUrl };
    }
    return snap;
  } catch (err) {
    logger.warn({ err, platform }, "socialInsights: snapshot fetch failed");
    return empty(unavailable("api_error", `Failed to load live ${cap.label} data.`));
  }
}
