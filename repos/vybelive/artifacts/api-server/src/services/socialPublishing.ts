/**
 * socialPublishing — Publish clips to social platforms via OAuth.
 *
 * Supported platforms:
 *   youtube_shorts — YouTube Data API v3 (resumable upload, set Shorts)
 *   facebook       — Facebook Graph API (video upload + publish)
 *   instagram      — Instagram Content Publishing API (Reels)
 *
 * All functions require a valid OAuth connection in oauthConnectionsTable
 * for the requesting user. If the connection is missing, expired, or the
 * access token cannot be decrypted, PublishingError is thrown immediately.
 *
 * No mock publishing. If the platform API returns an error, it propagates
 * to the caller and is stored in contentPostsTable.failureReason.
 */

import { db, oauthConnectionsTable, contentPostsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptToken } from "../lib/crypto";
import { randomUUID } from "crypto";

export class PublishingError extends Error {
  constructor(
    message: string,
    public readonly platform: string,
    public readonly blocker?: string
  ) {
    super(message);
    this.name = "PublishingError";
    Object.setPrototypeOf(this, PublishingError.prototype);
  }
}

interface OAuthToken {
  accessToken: string;
  platform: string;
  accountName: string | null;
}

/** Retrieve and decrypt the access token for the user's OAuth connection. */
async function getAccessToken(userId: string, platform: string): Promise<OAuthToken> {
  const [conn] = await db
    .select()
    .from(oauthConnectionsTable)
    .where(
      and(
        eq(oauthConnectionsTable.userId, userId),
        eq(oauthConnectionsTable.platform, platform as "youtube" | "facebook" | "instagram" | "twitch"),
        eq(oauthConnectionsTable.status, "connected")
      )
    )
    .limit(1);

  if (!conn) {
    throw new PublishingError(
      `No active ${platform} connection found. Connect your account in Settings → Connected Accounts.`,
      platform,
      "NO_OAUTH_CONNECTION"
    );
  }

  if (!conn.encryptedAccessToken) {
    throw new PublishingError(
      `${platform} connection exists but access token is missing. Reconnect in Settings → Connected Accounts.`,
      platform,
      "MISSING_TOKEN"
    );
  }

  if (conn.tokenExpiresAt && conn.tokenExpiresAt < new Date()) {
    throw new PublishingError(
      `${platform} access token has expired. Reconnect in Settings → Connected Accounts to refresh.`,
      platform,
      "TOKEN_EXPIRED"
    );
  }

  const accessToken = decryptToken(conn.encryptedAccessToken);

  return { accessToken, platform, accountName: conn.accountName };
}

async function graphFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${url} → ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── YouTube Shorts ────────────────────────────────────────────────────────────

/**
 * Publish a clip as a YouTube Short using the YouTube Data API v3.
 *
 * Flow:
 *  1. Initiate a resumable upload session
 *  2. Fetch the video bytes from GCS (the clip's public videoUrl)
 *  3. Stream upload to YouTube
 *  4. Set video to unlisted with #shorts in the title to qualify as a Short
 *
 * Returns the YouTube video ID.
 */
async function publishToYouTubeShorts(
  videoUrl: string,
  title: string,
  caption: string,
  userId: string
): Promise<{ postId: string; postUrl: string }> {
  const { accessToken } = await getAccessToken(userId, "youtube");

  // Step 1: Get video bytes (clip must be a publicly accessible URL)
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    throw new PublishingError(
      `Cannot fetch clip video for YouTube upload — ${videoRes.status}. Ensure the clip has a video URL.`,
      "youtube",
      "NO_VIDEO_URL"
    );
  }
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const contentLength = videoBuffer.byteLength;

  // Step 2: Initiate resumable upload session
  const ytTitle = title.includes("#shorts") ? title : `${title.slice(0, 90)} #shorts`;
  const metadata = {
    snippet: {
      title: ytTitle.slice(0, 100),
      description: caption,
      tags: ["shorts", "vybelive", "pov", "livestream"],
      categoryId: "22",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(contentLength),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new PublishingError(`YouTube upload initiation failed: ${err}`, "youtube");
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new PublishingError("YouTube did not return an upload URL.", "youtube");
  }

  // Step 3: Upload video bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(contentLength),
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new PublishingError(`YouTube video upload failed: ${err}`, "youtube");
  }

  const uploadData = (await uploadRes.json()) as { id: string };
  const videoId = uploadData.id;

  return {
    postId: videoId,
    postUrl: `https://www.youtube.com/shorts/${videoId}`,
  };
}

// ─── Facebook Reels ────────────────────────────────────────────────────────────

/**
 * Publish a clip as a Facebook Reel.
 * Requires pages_manage_posts + publish_video permissions.
 *
 * Flow:
 *  1. Get the user's managed pages
 *  2. Initiate video upload to the page
 *  3. Start transfer with source URL
 *  4. Publish when upload is complete
 */
async function publishToFacebook(
  videoUrl: string,
  title: string,
  caption: string,
  userId: string
): Promise<{ postId: string; postUrl: string }> {
  const { accessToken } = await getAccessToken(userId, "facebook");

  // Step 1: Get managed pages (use first page with publish access)
  const pagesData = (await graphFetch(
    "https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token",
    accessToken
  )) as { data: Array<{ id: string; name: string; access_token: string }> };

  const page = pagesData.data?.[0];
  if (!page) {
    throw new PublishingError(
      "No Facebook Pages found. Create a Facebook Page and grant publish permissions.",
      "facebook",
      "NO_PAGE"
    );
  }

  const pageToken = page.access_token;
  const pageId = page.id;

  // Step 2: Initiate Reels upload
  const initData = (await graphFetch(
    `https://graph.facebook.com/v19.0/${pageId}/video_reels`,
    pageToken,
    {
      method: "POST",
      body: JSON.stringify({ upload_phase: "start" }),
    }
  )) as { video_id: string; upload_url: string };

  const videoId = initData.video_id;
  const uploadUrl = initData.upload_url;

  // Step 3: Upload video via URL (Facebook fetches from our GCS URL)
  await graphFetch(uploadUrl, pageToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: videoUrl }),
  });

  // Step 4: Publish
  const publishData = (await graphFetch(
    `https://graph.facebook.com/v19.0/${pageId}/video_reels`,
    pageToken,
    {
      method: "POST",
      body: JSON.stringify({
        upload_phase: "finish",
        video_id: videoId,
        description: `${caption}\n\n#reels #vybelive #pov`,
        title: title.slice(0, 255),
        published: true,
      }),
    }
  )) as { success: boolean };

  if (!publishData.success) {
    throw new PublishingError("Facebook Reel publish returned success=false.", "facebook");
  }

  return {
    postId: videoId,
    postUrl: `https://www.facebook.com/reel/${videoId}`,
  };
}

// ─── Instagram Reels ───────────────────────────────────────────────────────────

/**
 * Publish a clip as an Instagram Reel via the Instagram Content Publishing API.
 * Requires instagram_basic + instagram_content_publish permissions.
 *
 * Flow:
 *  1. Create a media container with the video URL
 *  2. Poll container status until FINISHED
 *  3. Publish the container
 */
async function publishToInstagram(
  videoUrl: string,
  caption: string,
  userId: string
): Promise<{ postId: string; postUrl: string }> {
  const { accessToken, accountName } = await getAccessToken(userId, "instagram");

  // Step 1: Get Instagram Business Account ID
  const meData = (await graphFetch(
    "https://graph.facebook.com/v19.0/me?fields=instagram_business_account",
    accessToken
  )) as { instagram_business_account?: { id: string } };

  const igAccountId = meData.instagram_business_account?.id;
  if (!igAccountId) {
    throw new PublishingError(
      "No Instagram Business Account linked to this Facebook account. " +
        "Connect an Instagram Professional account in Facebook Business Manager.",
      "instagram",
      "NO_IG_BUSINESS_ACCOUNT"
    );
  }

  // Step 2: Create media container
  const containerData = (await graphFetch(
    `https://graph.facebook.com/v19.0/${igAccountId}/media`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption: caption.slice(0, 2200),
        share_to_feed: true,
      }),
    }
  )) as { id: string };

  const containerId = containerData.id;

  // Step 3: Poll until container is FINISHED (max 2 minutes for V1)
  const maxAttempts = 12;
  let status = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 10000));
    const statusData = (await graphFetch(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code`,
      accessToken
    )) as { status_code: string };
    status = statusData.status_code;
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new PublishingError(`Instagram media container ${status}: ${containerId}`, "instagram");
    }
  }

  if (status !== "FINISHED") {
    throw new PublishingError(
      `Instagram media container did not finish processing after 2 minutes (status: ${status}). Try again later.`,
      "instagram"
    );
  }

  // Step 4: Publish
  const publishData = (await graphFetch(
    `https://graph.facebook.com/v19.0/${igAccountId}/media_publish`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ creation_id: containerId }),
    }
  )) as { id: string };

  const postId = publishData.id;

  return {
    postId,
    postUrl: `https://www.instagram.com/p/${postId}/`,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type SupportedPublishPlatform = "youtube_shorts" | "facebook" | "instagram";

export interface PublishResult {
  platform: SupportedPublishPlatform;
  status: "published" | "failed";
  postId?: string;
  postUrl?: string;
  failureReason?: string;
  contentPostId: string;
}

/**
 * Publish a clip to one or more platforms.
 * Creates a contentPostsTable record for each platform attempt.
 * Returns results for all platforms — never throws even on partial failure.
 */
export async function publishClip(
  clipId: string,
  userId: string,
  platforms: SupportedPublishPlatform[],
  videoUrl: string,
  title: string,
  captionOverrides?: Partial<Record<SupportedPublishPlatform, string>>
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];

  for (const platform of platforms) {
    const contentPostId = randomUUID();
    const caption = captionOverrides?.[platform] ?? title;

    // Create pending record
    await db.insert(contentPostsTable).values({
      id: contentPostId,
      clipId,
      userId,
      platform,
      status: "publishing",
      caption,
    });

    try {
      let result: { postId: string; postUrl: string };

      if (platform === "youtube_shorts") {
        result = await publishToYouTubeShorts(videoUrl, title, caption, userId);
      } else if (platform === "facebook") {
        result = await publishToFacebook(videoUrl, title, caption, userId);
      } else if (platform === "instagram") {
        result = await publishToInstagram(videoUrl, caption, userId);
      } else {
        throw new PublishingError(`Platform "${platform}" is not supported for publishing.`, platform, "UNSUPPORTED");
      }

      await db
        .update(contentPostsTable)
        .set({
          status: "published",
          externalPostId: result.postId,
          externalPostUrl: result.postUrl,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(contentPostsTable.id, contentPostId));

      results.push({
        platform,
        status: "published",
        postId: result.postId,
        postUrl: result.postUrl,
        contentPostId,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .update(contentPostsTable)
        .set({
          status: "failed",
          failureReason: reason,
          retryCount: 1,
          updatedAt: new Date(),
        })
        .where(eq(contentPostsTable.id, contentPostId));

      results.push({ platform, status: "failed", failureReason: reason, contentPostId });
    }
  }

  return results;
}
