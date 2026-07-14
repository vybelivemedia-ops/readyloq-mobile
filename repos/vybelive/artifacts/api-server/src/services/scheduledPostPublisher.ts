/**
 * scheduledPostPublisher — closes the loop on the Social Command Center's
 * scheduling queue: it picks up due `social_scheduled_posts` rows and actually
 * publishes them to the target platform using the founder's OAuth token.
 *
 * HARD RULE (mirrors socialInsights): never fake a publish. A row only moves to
 * `published` after a real platform API call returns an id. Platforms without a
 * real publish path, or missing required inputs (e.g. Instagram needs media),
 * move the row to `failed` with an honest `errorMessage`.
 *
 * Real publish paths:
 *   • YouTube   — Data API v3 resumable video upload (requires a video mediaUrl)
 *   • Facebook  — Graph API Page feed/photo post
 *   • Instagram — Graph API media container publish (requires image/video mediaUrl)
 *
 * The worker runs in-process (a short interval, like Agent Zero) and is also
 * exposed as a standalone job entry point for a production Scheduled Deployment.
 */

import { createReadStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { db, socialScheduledPostsTable, type SocialScheduledPostRow } from "@workspace/db";
import { and, asc, eq, isNotNull, lte, or } from "drizzle-orm";

import { logger } from "../lib/logger.js";
import { getFounderToken, PLATFORM_CAPABILITIES, type SocialPlatformId } from "./socialInsights.js";
import { downloadToFile } from "./storageService.js";

// ── Worker tuning ────────────────────────────────────────────────────────────

const TICK_MS = 30_000; // scan for due posts every 30s in-process
const MAX_PER_TICK = 5; // cap per tick — publishes (esp. YouTube uploads) are slow

// Bounded auto-retry for transient publish failures (network blip, 5xx, 429).
// After MAX_RETRIES transient failures a post stays `failed` so it can't loop
// forever. Backoff grows exponentially from RETRY_BACKOFF_MS.
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 60_000; // 1m, then 2m, then 4m

let workerTimer: NodeJS.Timeout | null = null;
let lastTickAt: Date | null = null;
let tickInFlight = false;

export function getScheduledPostsWorkerHealth(): {
  healthy: boolean;
  lastTickAt: string | null;
} {
  const healthy = lastTickAt !== null && Date.now() - lastTickAt.getTime() < TICK_MS * 4;
  return { healthy, lastTickAt: lastTickAt?.toISOString() ?? null };
}

export function startScheduledPostsWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void tick();
  }, TICK_MS);
  workerTimer.unref();
  logger.info({ tickMs: TICK_MS, maxPerTick: MAX_PER_TICK }, "Scheduled posts worker started");
  void tick();
}

async function tick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  lastTickAt = new Date();
  try {
    await runDueScheduledPosts();
  } catch (err) {
    logger.warn({ err }, "Scheduled posts tick failed");
  } finally {
    tickInFlight = false;
  }
}

// ── Publishing errors ────────────────────────────────────────────────────────

export class ScheduledPublishError extends Error {
  /** Whether the failure is worth retrying (network/5xx/429) vs permanent. */
  readonly transient: boolean;
  constructor(message: string, opts?: { transient?: boolean }) {
    super(message);
    this.name = "ScheduledPublishError";
    this.transient = opts?.transient ?? false;
  }
}

/**
 * Classify a publish failure. Explicit business-rule failures (not connected,
 * missing media, unsupported platform, 4xx client errors) are permanent. HTTP
 * 429/5xx are marked transient at the throw site. Anything that is NOT a
 * ScheduledPublishError (a raw network throw from fetch, an unexpected error)
 * is treated as transient — those are the recoverable infra blips.
 */
export function isTransientFailure(err: unknown): boolean {
  if (err instanceof ScheduledPublishError) return err.transient;
  return true;
}

// ── Due-post processing ──────────────────────────────────────────────────────

/**
 * Scan for due scheduled posts and publish each one. A row is due when it is in
 * the `scheduled` state (already approved, or approval was never required) and
 * its `scheduledAt` is in the past. Each row is claimed with a conditional
 * UPDATE (scheduled → publishing) so overlapping workers can't double-publish.
 *
 * Returns a summary count of what happened.
 */
/**
 * Data-access surface the run loop depends on. The production implementation is
 * DB-backed (`dbStore`); tests inject an in-memory fake that mirrors the same
 * semantics so the orchestration (due filtering, CAS claim, retry vs fail) can
 * be verified deterministically and offline.
 */
export interface ScheduledPostStore {
  selectDue(now: Date, limit: number): Promise<SocialScheduledPostRow[]>;
  /** CAS claim: flip `scheduled` → `publishing`; returns false if lost the race. */
  claim(id: string): Promise<boolean>;
  markPublished(id: string, externalPostId: string, now: Date): Promise<void>;
  markFailed(id: string, errorMessage: string, retryCount: number, now: Date): Promise<void>;
  requeue(
    id: string,
    nextScheduledAt: Date,
    retryCount: number,
    errorMessage: string,
    now: Date,
  ): Promise<void>;
}

export interface RunDueDeps {
  store?: ScheduledPostStore;
  publish?: (row: SocialScheduledPostRow) => Promise<PublishOutcome>;
  now?: () => Date;
}

/** Production, DB-backed store — mirrors the original inline queries verbatim. */
const dbStore: ScheduledPostStore = {
  async selectDue(now, limit) {
    return db
      .select()
      .from(socialScheduledPostsTable)
      .where(
        and(
          eq(socialScheduledPostsTable.status, "scheduled"),
          lte(socialScheduledPostsTable.scheduledAt, now),
          // Belt-and-suspenders: a row is only `scheduled` after approval, but we
          // still refuse to publish an approval-required row that wasn't approved.
          or(
            eq(socialScheduledPostsTable.requiresApproval, false),
            isNotNull(socialScheduledPostsTable.approvedAt),
          ),
        ),
      )
      .orderBy(asc(socialScheduledPostsTable.scheduledAt))
      .limit(limit);
  },
  async claim(id) {
    const [locked] = await db
      .update(socialScheduledPostsTable)
      .set({ status: "publishing", errorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(socialScheduledPostsTable.id, id),
          eq(socialScheduledPostsTable.status, "scheduled"),
        ),
      )
      .returning({ id: socialScheduledPostsTable.id });
    return Boolean(locked);
  },
  async markPublished(id, externalPostId, now) {
    await db
      .update(socialScheduledPostsTable)
      .set({ status: "published", publishedAt: now, externalPostId, errorMessage: null, updatedAt: now })
      .where(eq(socialScheduledPostsTable.id, id));
  },
  async markFailed(id, errorMessage, retryCount, now) {
    await db
      .update(socialScheduledPostsTable)
      .set({ status: "failed", errorMessage: errorMessage.slice(0, 2000), retryCount, updatedAt: now })
      .where(eq(socialScheduledPostsTable.id, id));
  },
  async requeue(id, nextScheduledAt, retryCount, errorMessage, now) {
    await db
      .update(socialScheduledPostsTable)
      .set({
        status: "scheduled",
        scheduledAt: nextScheduledAt,
        retryCount,
        errorMessage: errorMessage.slice(0, 2000),
        updatedAt: now,
      })
      .where(eq(socialScheduledPostsTable.id, id));
  },
};

export async function runDueScheduledPosts(deps: RunDueDeps = {}): Promise<{
  claimed: number;
  published: number;
  failed: number;
  retried: number;
}> {
  const store = deps.store ?? dbStore;
  const publish = deps.publish ?? publishScheduledPost;
  const nowFn = deps.now ?? (() => new Date());

  const due = await store.selectDue(nowFn(), MAX_PER_TICK);

  let claimed = 0;
  let published = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due) {
    // Claim via CAS: only the worker that flips scheduled → publishing proceeds.
    const locked = await store.claim(row.id);
    if (!locked) continue; // another worker got it first
    claimed += 1;

    try {
      const result = await publish(row);
      await store.markPublished(row.id, result.externalPostId, nowFn());
      published += 1;
      logger.info(
        { postId: row.id, platform: row.platform, externalPostId: result.externalPostId },
        "Scheduled post published",
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const priorRetries = row.retryCount ?? 0;

      if (isTransientFailure(err) && priorRetries < MAX_RETRIES) {
        // Transient failure with retries left: requeue with exponential backoff.
        const nextRetry = priorRetries + 1;
        const delayMs = RETRY_BACKOFF_MS * 2 ** (nextRetry - 1);
        const nextScheduledAt = new Date(nowFn().getTime() + delayMs);
        await store.requeue(row.id, nextScheduledAt, nextRetry, reason, nowFn());
        retried += 1;
        logger.warn(
          { err, postId: row.id, platform: row.platform, attempt: nextRetry, nextScheduledAt },
          "Scheduled post publish failed transiently; requeued for retry",
        );
      } else {
        // Permanent failure, or transient but out of retries: stay failed.
        await store.markFailed(row.id, reason, priorRetries, nowFn());
        failed += 1;
        logger.warn({ err, postId: row.id, platform: row.platform }, "Scheduled post publish failed");
      }
    }
  }

  return { claimed, published, failed, retried };
}

// ── Publish dispatch ─────────────────────────────────────────────────────────

interface PublishOutcome {
  externalPostId: string;
}

async function publishScheduledPost(row: SocialScheduledPostRow): Promise<PublishOutcome> {
  const platform = row.platform as SocialPlatformId;
  const cap = PLATFORM_CAPABILITIES[platform];
  if (!cap) {
    throw new ScheduledPublishError(`Unknown platform "${row.platform}".`);
  }
  if (!cap.publishSupported) {
    throw new ScheduledPublishError(`${cap.label} does not support publishing yet.`);
  }

  const token = await getFounderToken(row.userId, platform);
  if (!("accessToken" in token)) {
    // Unavailable descriptor — surface its honest message.
    throw new ScheduledPublishError(token.message);
  }

  if (platform === "youtube") return publishYouTube(token.accessToken, row);
  if (platform === "facebook") return publishFacebook(token.accessToken, row);
  if (platform === "instagram") return publishInstagram(token.accessToken, row);

  throw new ScheduledPublishError(`Publishing to ${cap.label} is not implemented.`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compose the caption/description from the post's content + hashtags. */
function composeCaption(row: SocialScheduledPostRow): string {
  const tags = (row.hashtags ?? [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");
  return [row.content?.trim(), tags].filter((s) => s && s.length > 0).join("\n\n");
}

function isHttpUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function looksLikeVideo(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url);
}

async function graphFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    const transient = res.status === 429 || res.status >= 500;
    throw new ScheduledPublishError(`Graph API ${res.status}: ${text.slice(0, 300)}`, { transient });
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ── Facebook (Page feed / photo post) ────────────────────────────────────────

async function publishFacebook(
  userAccessToken: string,
  row: SocialScheduledPostRow,
): Promise<PublishOutcome> {
  const pages = (await graphFetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userAccessToken)}`,
  )) as { data?: Array<{ id: string; name?: string; access_token: string }> };

  const page = pages.data?.[0];
  if (!page) {
    throw new ScheduledPublishError(
      "No manageable Facebook Page found — the connected account needs Page publish permissions.",
    );
  }

  const message = composeCaption(row);

  if (isHttpUrl(row.mediaUrl) && !looksLikeVideo(row.mediaUrl)) {
    // Photo post
    const body = new URLSearchParams({
      url: row.mediaUrl,
      caption: message,
      access_token: page.access_token,
    });
    const photo = (await graphFetch(`https://graph.facebook.com/v21.0/${page.id}/photos`, {
      method: "POST",
      body,
    })) as { id?: string; post_id?: string };
    const id = photo.post_id ?? photo.id;
    if (!id) throw new ScheduledPublishError("Facebook photo post returned no id.");
    return { externalPostId: id };
  }

  // Text (feed) post — the graph feed endpoint doesn't accept a raw video URL,
  // so video mediaUrls fall through to a text post referencing the caption.
  const body = new URLSearchParams({ message, access_token: page.access_token });
  const post = (await graphFetch(`https://graph.facebook.com/v21.0/${page.id}/feed`, {
    method: "POST",
    body,
  })) as { id?: string };
  if (!post.id) throw new ScheduledPublishError("Facebook feed post returned no id.");
  return { externalPostId: post.id };
}

// ── Instagram (media container publish) ──────────────────────────────────────

async function publishInstagram(
  userAccessToken: string,
  row: SocialScheduledPostRow,
): Promise<PublishOutcome> {
  if (!isHttpUrl(row.mediaUrl)) {
    throw new ScheduledPublishError(
      "Instagram publishing requires a publicly accessible image or video URL (mediaUrl).",
    );
  }

  const pages = (await graphFetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account&access_token=${encodeURIComponent(userAccessToken)}`,
  )) as { data?: Array<{ instagram_business_account?: { id?: string } }> };
  const igId = pages.data?.find((p) => p.instagram_business_account?.id)?.instagram_business_account
    ?.id;
  if (!igId) {
    throw new ScheduledPublishError(
      "No Instagram Professional account is linked to a connected Facebook Page.",
    );
  }

  const caption = composeCaption(row).slice(0, 2200);
  const isVideo = looksLikeVideo(row.mediaUrl);

  const containerBody = new URLSearchParams({ caption, access_token: userAccessToken });
  if (isVideo) {
    containerBody.set("media_type", "REELS");
    containerBody.set("video_url", row.mediaUrl);
  } else {
    containerBody.set("image_url", row.mediaUrl);
  }

  const container = (await graphFetch(`https://graph.facebook.com/v21.0/${igId}/media`, {
    method: "POST",
    body: containerBody,
  })) as { id?: string };
  if (!container.id) throw new ScheduledPublishError("Instagram media container returned no id.");

  // Video containers need processing time before they can be published.
  if (isVideo) {
    const maxAttempts = 12; // up to ~2 minutes
    let statusCode = "";
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const statusData = (await graphFetch(
        `https://graph.facebook.com/v21.0/${container.id}?fields=status_code&access_token=${encodeURIComponent(userAccessToken)}`,
      )) as { status_code?: string };
      statusCode = statusData.status_code ?? "";
      if (statusCode === "FINISHED") break;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new ScheduledPublishError(`Instagram media container ${statusCode}.`);
      }
    }
    if (statusCode !== "FINISHED") {
      throw new ScheduledPublishError(
        `Instagram media container did not finish processing in time (status: ${statusCode || "unknown"}).`,
      );
    }
  }

  const published = (await graphFetch(`https://graph.facebook.com/v21.0/${igId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: container.id, access_token: userAccessToken }),
  })) as { id?: string };
  if (!published.id) throw new ScheduledPublishError("Instagram media_publish returned no id.");
  return { externalPostId: published.id };
}

// ── YouTube (resumable video upload) ─────────────────────────────────────────

async function publishYouTube(
  accessToken: string,
  row: SocialScheduledPostRow,
): Promise<PublishOutcome> {
  if (!row.mediaUrl) {
    throw new ScheduledPublishError("YouTube publishing requires a video (mediaUrl).");
  }

  // Stream the video to a temp file first (never buffer full videos in memory).
  const tmpPath = path.join(os.tmpdir(), `sched-yt-${randomUUID()}.mp4`);
  try {
    await downloadToFile(row.mediaUrl, tmpPath);
    const { size } = await stat(tmpPath);
    if (size <= 0) {
      throw new ScheduledPublishError("Downloaded video for YouTube upload was empty.");
    }

    const title = (row.title?.trim() || row.content?.trim() || "VYBE LIVE").slice(0, 100);
    const metadata = {
      snippet: {
        title,
        description: composeCaption(row).slice(0, 5000),
        tags: (row.hashtags ?? []).map((h) => h.replace(/^#/, "")).slice(0, 15),
        categoryId: "22",
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    };

    // Step 1: initiate a resumable upload session.
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/*",
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!initRes.ok) {
      const body = await initRes.text().catch(() => "");
      throw new ScheduledPublishError(
        `YouTube upload initiation failed (${initRes.status}): ${body.slice(0, 300)}`,
        { transient: initRes.status === 429 || initRes.status >= 500 },
      );
    }
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) {
      throw new ScheduledPublishError("YouTube did not return a resumable upload URL.");
    }

    // Step 2: stream the file bytes to the upload URL.
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/*", "Content-Length": String(size) },
      body: createReadStream(tmpPath) as unknown as RequestInit["body"],
      // Node's fetch requires duplex when the body is a stream.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => "");
      throw new ScheduledPublishError(
        `YouTube video upload failed (${uploadRes.status}): ${body.slice(0, 300)}`,
        { transient: uploadRes.status === 429 || uploadRes.status >= 500 },
      );
    }
    const uploaded = (await uploadRes.json()) as { id?: string };
    if (!uploaded.id) throw new ScheduledPublishError("YouTube upload returned no video id.");
    return { externalPostId: uploaded.id };
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined);
  }
}
