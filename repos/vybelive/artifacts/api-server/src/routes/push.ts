/**
 * Agora Cloud Push routes — real multistreaming via Agora Media Push.
 *
 * POST /streams/:streamId/push/start    — start push to all connected OAuth platforms
 * POST /streams/:streamId/push/stop     — stop all push tasks for a stream
 * GET  /streams/:streamId/push/status   — per-destination health (for stream health monitor)
 * GET  /streams/:streamId/preflight     — pre-live validation checklist
 */

import { Router, type Request, type Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { streamsTable, oauthConnectionsTable, streamDestinationsTable, platformsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { decryptToken, encryptToken, isEncryptionConfigured } from "../lib/crypto";
import {
  type OAuthPlatform,
  type RtmpFetchOptions,
  fetchRtmpCredentials,
  refreshAccessToken,
  fetchFacebookTargets,
} from "../services/oauthProviders";
import type { OAuthConnection } from "@workspace/db";
import {
  startPushTask,
  stopPushTask,
  getPushTaskStatus,
  isAgoraPushConfigured,
} from "../services/agoraPush";
import {
  type PreflightCheck,
  summarizeConnections,
  evaluatePlatformConnectedCheck,
  evaluateTokenValidityCheck,
  buildManualDestinationChecks,
  classifyPushDestinationError,
} from "../services/destinationValidation";

const router = Router();

const OAUTH_PUSH_PLATFORMS: OAuthPlatform[] = ["youtube", "facebook", "twitch", "instagram", "kick"];

function generateId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Build per-platform options for fetchRtmpCredentials. For Facebook, resolves
 * the selected Live destination: a "page" target decrypts the stored page
 * access token so the live video is created on the Page; anything else (null /
 * "profile") falls back to the user's personal timeline.
 */
function buildFetchOptions(conn: OAuthConnection): RtmpFetchOptions | undefined {
  if (conn.platform === "facebook" && conn.targetType === "page") {
    // A Page destination was chosen but its stored page token is gone (admin
    // access lost / token revoked). Do NOT silently fall back to the personal
    // timeline — fail loudly so the destination is recorded as failed and the
    // creator is prompted to re-select a destination in Settings → Platforms.
    if (!conn.targetId || !conn.encryptedTargetToken) {
      throw new Error(
        "Your selected Facebook Page is no longer available. Re-select a destination in Settings → Platforms.",
      );
    }
    return {
      facebookTarget: {
        targetType: "page",
        targetId: conn.targetId,
        pageAccessToken: decryptToken(conn.encryptedTargetToken),
      },
    };
  }
  return undefined;
}

/**
 * Per-stream rate limit for /push/start.
 * Tracks how many start attempts have been made for a given streamId within
 * the current time window (PUSH_RATE_WINDOW_MS).  Resets when the window
 * expires.  Limits each stream to PUSH_RATE_LIMIT calls per window,
 * regardless of how many platforms are connected.
 */
const PUSH_RATE_LIMIT = 3;
const PUSH_RATE_WINDOW_MS = 60_000; // 1-minute sliding window
const pushRateCounters = new Map<string, { count: number; windowStart: number }>();

/** Returns true if the streamId has exceeded the rate limit; records the call if not. */
function checkPushRateLimit(streamId: string): boolean {
  const now = Date.now();
  const entry = pushRateCounters.get(streamId);
  if (!entry || now - entry.windowStart > PUSH_RATE_WINDOW_MS) {
    pushRateCounters.set(streamId, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= PUSH_RATE_LIMIT) return true;
  entry.count += 1;
  return false;
}

/** Sweep stale counters once per minute. */
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pushRateCounters) {
    if (now - entry.windowStart > PUSH_RATE_WINDOW_MS) pushRateCounters.delete(id);
  }
}, 60_000);

// ─── Start push ───────────────────────────────────────────────────────────────

router.post("/streams/:streamId/push/start", requireAuth, async (req: Request, res: Response) => {
  const streamId = String(req.params["streamId"]);
  const userId = req.auth!.userId;

  // Verify stream ownership
  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, userId)))
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }
  if (stream.status !== "live") {
    res.status(400).json({ error: "Stream must be live before starting push" });
    return;
  }

  if (stream.agoraPublishUid == null) {
    res.status(400).json({
      error:
        "Creator has not joined the Agora channel yet (publisher UID missing). Re-launch the stream before starting push.",
    });
    return;
  }
  const creatorUid: number = stream.agoraPublishUid;

  if (!isAgoraPushConfigured()) {
    res.status(503).json({
      error: "Agora Cloud Push is not configured. Add AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET to Replit Secrets.",
      configured: false,
    });
    return;
  }

  // Rate limit: cap repeated /push/start calls for the same stream to
  // PUSH_RATE_LIMIT per PUSH_RATE_WINDOW_MS.  Each call creates paid Agora
  // converter tasks and may provision upstream platform broadcast resources,
  // so unguarded repetition multiplies external cost even with idempotency
  // guards in place (e.g. after a stop that resets destination statuses).
  if (checkPushRateLimit(streamId)) {
    res.status(429).json({ error: "Too many push start requests for this stream. Please wait before retrying." });
    return;
  }

  // Fetch all active OAuth connections for this user
  const connections = await db
    .select()
    .from(oauthConnectionsTable)
    .where(and(
      eq(oauthConnectionsTable.userId, userId),
      eq(oauthConnectionsTable.status, "connected"),
    ));

  const pushConnections = connections.filter(
    (c) => OAUTH_PUSH_PLATFORMS.includes(c.platform as OAuthPlatform)
  );

  if (pushConnections.length === 0) {
    res.status(400).json({ error: "No connected platforms available for push" });
    return;
  }

  const results: Array<{ platform: string; status: string; error?: string; taskId?: string }> = [];

  for (const conn of pushConnections) {
    try {
      // Idempotency guard: check for an already-running destination BEFORE
      // calling fetchRtmpCredentials.  fetchRtmpCredentials makes upstream
      // API calls (YouTube/Facebook broadcast provisioning) that themselves
      // cost quota and money, so we must not invoke them for platforms that
      // already have an active Agora task.
      const existingDest = await db
        .select({ id: streamDestinationsTable.id, status: streamDestinationsTable.status, agoraPushTaskId: streamDestinationsTable.agoraPushTaskId })
        .from(streamDestinationsTable)
        .where(and(
          eq(streamDestinationsTable.streamId, streamId),
          eq(streamDestinationsTable.platform, conn.platform),
        ))
        .limit(1);

      if (
        existingDest.length > 0 &&
        existingDest[0]!.agoraPushTaskId &&
        (existingDest[0]!.status === "connecting" || existingDest[0]!.status === "live")
      ) {
        results.push({ platform: conn.platform, status: "already_running", taskId: existingDest[0]!.agoraPushTaskId });
        continue;
      }

      if (!conn.encryptedAccessToken) throw new Error("No access token");

      let accessToken = decryptToken(conn.encryptedAccessToken);

      // Proactively refresh if token is expired or expires within 5 minutes.
      // Same pattern as /push/reconnect — avoids YouTube 401s during push/start.
      const tokenExpiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null;
      if (tokenExpiresAt && tokenExpiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
        if (conn.encryptedRefreshToken) {
          try {
            const rawRefresh = decryptToken(conn.encryptedRefreshToken);
            const refreshed = await refreshAccessToken(conn.platform as OAuthPlatform, rawRefresh);
            accessToken = refreshed.accessToken;
            const now = new Date();
            await db
              .update(oauthConnectionsTable)
              .set({
                encryptedAccessToken: encryptToken(refreshed.accessToken),
                encryptedRefreshToken: refreshed.refreshToken
                  ? encryptToken(refreshed.refreshToken)
                  : conn.encryptedRefreshToken,
                tokenExpiresAt: refreshed.expiresIn
                  ? new Date(Date.now() + refreshed.expiresIn * 1000)
                  : null,
                status: "connected",
                errorMessage: null,
                updatedAt: now,
              })
              .where(eq(oauthConnectionsTable.id, conn.id));
            req.log.info({ platform: conn.platform, streamId }, "OAuth token refreshed before push start");
          } catch (refreshErr) {
            req.log.warn({ err: refreshErr, platform: conn.platform }, "OAuth token refresh failed before push start — proceeding with stored token");
          }
        }
      }

      const rtmpCreds = await fetchRtmpCredentials(
        conn.platform as OAuthPlatform,
        accessToken,
        stream.title,
        buildFetchOptions(conn),
      );

      if (!rtmpCreds) {
        results.push({ platform: conn.platform, status: "skipped", error: "No RTMP API available" });
        continue;
      }

      const taskId = await startPushTask(
        streamId,
        {
          platform: conn.platform,
          rtmpUrl: rtmpCreds.rtmpUrl,
          streamKey: rtmpCreds.streamKey,
        },
        creatorUid,
      );

      const now = new Date();
      if (existingDest.length > 0) {
        await db
          .update(streamDestinationsTable)
          .set({
            oauthConnectionId: conn.id,
            rtmpUrl: rtmpCreds.rtmpUrl,
            streamKey: rtmpCreds.streamKey,
            status: "connecting",
            agoraPushTaskId: taskId,
            reconnectAttempts: 0,
            errorMessage: null,
            lastHeartbeatAt: now,
            updatedAt: now,
          })
          .where(eq(streamDestinationsTable.id, existingDest[0]!.id));
      } else {
        await db.insert(streamDestinationsTable).values({
          id: generateId(),
          streamId,
          platform: conn.platform,
          oauthConnectionId: conn.id,
          rtmpUrl: rtmpCreds.rtmpUrl,
          streamKey: rtmpCreds.streamKey,
          status: "connecting",
          agoraPushTaskId: taskId,
          bitrateKbps: 0,
          viewerCount: 0,
          reconnectAttempts: 0,
          lastHeartbeatAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Store broadcast ID for YouTube/Facebook end-of-stream cleanup
      if (rtmpCreds.broadcastId) {
        await db
          .update(oauthConnectionsTable)
          .set({ platformBroadcastId: rtmpCreds.broadcastId, platformStreamId: rtmpCreds.streamId, updatedAt: now })
          .where(eq(oauthConnectionsTable.id, conn.id));
      }

      req.log.info(
        {
          platform: conn.platform,
          taskId,
          // Stream keys are sensitive creator credentials and must never be
          // logged in any form (not even a prefix). Log only non-secret
          // identifiers. hasStreamKey lets us distinguish "empty key" cases
          // (e.g. YouTube returned no streamName) without exposing the value.
          hasStreamKey: Boolean(rtmpCreds.streamKey),
          broadcastId: rtmpCreds.broadcastId ?? "(none)",
          channelName: streamId,
        },
        "Agora Media Push task started — RTMP credentials accepted by Agora",
      );

      results.push({ platform: conn.platform, status: "started", taskId });
    } catch (err) {
      // Kick (and any future PKCE auto-provision provider) can legitimately be
      // unable to mint RTMP creds for an account; that's not a generic failure
      // but a signal to add the destination manually under Custom RTMP. Surface
      // it as a distinct result status so the client can guide the user, while
      // still persisting a "failed" DB row (the enum has no fallback state) and
      // continuing with the other destinations.
      const { status, manualFallback, message: errorMessage } = classifyPushDestinationError(err);
      req.log.warn(
        { err, platform: conn.platform, streamId, manualFallback },
        manualFallback ? "Push start skipped — manual RTMP fallback required" : "Push start failed",
      );
      results.push({ platform: conn.platform, status, error: errorMessage });

      // Record the failure
      await db
        .insert(streamDestinationsTable)
        .values({
          id: generateId(),
          streamId,
          platform: conn.platform,
          oauthConnectionId: conn.id,
          status: "failed",
          bitrateKbps: 0,
          viewerCount: 0,
          reconnectAttempts: 0,
          errorMessage,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    }
  }

  const anyStarted = results.some((r) => r.status === "started");
  req.log.info(
    {
      streamId,
      started: results.filter((r) => r.status === "started").map((r) => r.platform),
      alreadyRunning: results.filter((r) => r.status === "already_running").map((r) => r.platform),
      failed: results.filter((r) => r.status === "failed").map((r) => ({ platform: r.platform, error: r.error })),
      skipped: results.filter((r) => r.status === "skipped").map((r) => r.platform),
    },
    anyStarted ? "Push start complete — at least one platform started" : "Push start complete — no platforms started",
  );
  res.status(anyStarted ? 200 : 502).json({ streamId, destinations: results });
});

// ─── Stop push ────────────────────────────────────────────────────────────────

router.post("/streams/:streamId/push/stop", requireAuth, async (req: Request, res: Response) => {
  const streamId = String(req.params["streamId"]);
  const userId = req.auth!.userId;

  const [stream] = await db
    .select({ id: streamsTable.id })
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, userId)))
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  const destinations = await db
    .select()
    .from(streamDestinationsTable)
    .where(eq(streamDestinationsTable.streamId, streamId));

  const results: Array<{ platform: string; status: string }> = [];

  for (const dest of destinations) {
    if (dest.agoraPushTaskId) {
      try {
        await stopPushTask(dest.agoraPushTaskId);
        await db
          .update(streamDestinationsTable)
          .set({ status: "offline", updatedAt: new Date() })
          .where(eq(streamDestinationsTable.id, dest.id));
        results.push({ platform: dest.platform, status: "stopped" });
      } catch (err) {
        req.log.error({ err, platform: dest.platform }, "Push stop failed");
        results.push({ platform: dest.platform, status: "error" });
      }
    } else {
      results.push({ platform: dest.platform, status: "no_task" });
    }
  }

  res.json({ streamId, destinations: results });
});

// ─── Reconnect failed push destinations ──────────────────────────────────────
// Stops the old Agora task, refreshes tokens if needed, and starts a new task.
// Called by the mobile client when it detects consecutive failed poll results.

router.post("/streams/:streamId/push/reconnect", requireAuth, async (req: Request, res: Response) => {
  const streamId = String(req.params["streamId"]);
  const userId = req.auth!.userId;
  const { platforms: targetPlatforms } = (req.body ?? {}) as { platforms?: string[] };

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, userId)))
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }
  if (!isAgoraPushConfigured()) {
    res.status(503).json({ error: "Agora Cloud Push is not configured", configured: false });
    return;
  }

  if (stream.agoraPublishUid == null) {
    res.status(400).json({
      error: "Creator publisher UID missing — re-launch the stream before reconnecting push.",
    });
    return;
  }
  const creatorUid: number = stream.agoraPublishUid;

  // Scope to requested platforms, or default to all failed/reconnecting destinations
  const allDests = await db
    .select()
    .from(streamDestinationsTable)
    .where(eq(streamDestinationsTable.streamId, streamId));

  const destinations =
    targetPlatforms && targetPlatforms.length > 0
      ? allDests.filter((d) => targetPlatforms.includes(d.platform))
      : allDests.filter((d) => d.status === "failed" || d.status === "reconnecting");

  if (destinations.length === 0) {
    res.json({ streamId, message: "No destinations to reconnect", destinations: [] });
    return;
  }

  const results: Array<{ platform: string; status: string; error?: string; taskId?: string }> = [];

  for (const dest of destinations) {
    // Hard cap: 5 reconnect attempts per destination per stream session
    if (dest.reconnectAttempts >= 5) {
      results.push({
        platform: dest.platform,
        status: "max_attempts",
        error: "Maximum reconnect attempts (5) reached — reconnect the OAuth account to reset",
      });
      continue;
    }

    try {
      // Find OAuth connection (may be disconnected or expired)
      const [conn] = await db
        .select()
        .from(oauthConnectionsTable)
        .where(and(
          eq(oauthConnectionsTable.userId, userId),
          eq(oauthConnectionsTable.platform, dest.platform as OAuthPlatform),
        ))
        .limit(1);

      if (!conn?.encryptedAccessToken) {
        results.push({ platform: dest.platform, status: "no_connection", error: "No OAuth connection found" });
        continue;
      }

      let accessToken = decryptToken(conn.encryptedAccessToken);

      // Proactively refresh if token is expired or expires within 5 minutes
      const expiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null;
      if (expiresAt && expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
        if (conn.encryptedRefreshToken) {
          try {
            const rawRefresh = decryptToken(conn.encryptedRefreshToken);
            const refreshed = await refreshAccessToken(conn.platform as OAuthPlatform, rawRefresh);
            accessToken = refreshed.accessToken;
            const now = new Date();
            await db
              .update(oauthConnectionsTable)
              .set({
                encryptedAccessToken: encryptToken(refreshed.accessToken),
                encryptedRefreshToken: refreshed.refreshToken
                  ? encryptToken(refreshed.refreshToken)
                  : conn.encryptedRefreshToken,
                tokenExpiresAt: refreshed.expiresIn
                  ? new Date(Date.now() + refreshed.expiresIn * 1000)
                  : null,
                status: "connected",
                errorMessage: null,
                updatedAt: now,
              })
              .where(eq(oauthConnectionsTable.id, conn.id));
          } catch {
            // Proceed with the existing token — the push attempt will surface any auth errors
          }
        }
      }

      // Stop the old Agora task (404 treated as success — idempotent)
      if (dest.agoraPushTaskId) {
        await stopPushTask(dest.agoraPushTaskId).catch(() => undefined);
      }

      // Fetch fresh RTMP credentials from the platform API
      const rtmpCreds = await fetchRtmpCredentials(
        dest.platform as OAuthPlatform,
        accessToken,
        stream.title,
        buildFetchOptions(conn),
      );
      if (!rtmpCreds) {
        results.push({
          platform: dest.platform,
          status: "skipped",
          error: "No public RTMP API for this platform",
        });
        continue;
      }

      // Start a fresh push task
      const taskId = await startPushTask(
        streamId,
        {
          platform: dest.platform,
          rtmpUrl: rtmpCreds.rtmpUrl,
          streamKey: rtmpCreds.streamKey,
        },
        creatorUid,
      );

      const now = new Date();
      await db
        .update(streamDestinationsTable)
        .set({
          agoraPushTaskId: taskId,
          rtmpUrl: rtmpCreds.rtmpUrl,
          streamKey: rtmpCreds.streamKey,
          status: "connecting",
          reconnectAttempts: dest.reconnectAttempts + 1,
          errorMessage: null,
          lastHeartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(streamDestinationsTable.id, dest.id));

      req.log.info(
        { platform: dest.platform, taskId, attempt: dest.reconnectAttempts + 1, streamId },
        "Push reconnect started",
      );
      results.push({ platform: dest.platform, status: "reconnecting", taskId });
    } catch (err) {
      // Mirror /push/start: a Kick auto-provision failure is a manual-fallback
      // signal, not a generic reconnect failure. Persist "failed" (enum has no
      // fallback state) but surface the distinct status to the client.
      const { status, manualFallback, message: errorMessage } = classifyPushDestinationError(err);
      req.log.warn(
        { err, platform: dest.platform, streamId, manualFallback },
        manualFallback ? "Push reconnect skipped — manual RTMP fallback required" : "Push reconnect failed",
      );
      await db
        .update(streamDestinationsTable)
        .set({
          status: "failed",
          errorMessage,
          reconnectAttempts: dest.reconnectAttempts + 1,
          updatedAt: new Date(),
        })
        .where(eq(streamDestinationsTable.id, dest.id))
        .catch(() => undefined);
      results.push({ platform: dest.platform, status, error: errorMessage });
    }
  }

  res.json({ streamId, destinations: results });
});

// ─── Push status ──────────────────────────────────────────────────────────────

router.get("/streams/:streamId/push/status", requireAuth, async (req: Request, res: Response) => {
  const streamId = String(req.params["streamId"]);
  const userId = req.auth!.userId;

  const [stream] = await db
    .select({ id: streamsTable.id })
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, userId)))
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  const destinations = await db
    .select()
    .from(streamDestinationsTable)
    .where(eq(streamDestinationsTable.streamId, streamId));

  const agoraPushAvailable = isAgoraPushConfigured();

  const statuses = await Promise.all(
    destinations.map(async (dest) => {
      if (!dest.agoraPushTaskId || !agoraPushAvailable) {
        return {
          platform: dest.platform,
          status: dest.status,
          bitrateKbps: dest.bitrateKbps,
          viewerCount: dest.viewerCount,
          reconnectAttempts: dest.reconnectAttempts,
          errorMessage: dest.errorMessage,
          lastHeartbeatAt: dest.lastHeartbeatAt,
        };
      }

      try {
        const live = await getPushTaskStatus(dest.agoraPushTaskId, dest.platform);

        // Persist heartbeat + bitrate update
        await db
          .update(streamDestinationsTable)
          .set({
            status: live.status,
            bitrateKbps: live.bitrateKbps,
            lastHeartbeatAt: new Date(),
            errorMessage: live.errorMessage ?? null,
            updatedAt: new Date(),
          })
          .where(eq(streamDestinationsTable.id, dest.id));

        return {
          platform: dest.platform,
          status: live.status,
          bitrateKbps: live.bitrateKbps,
          viewerCount: dest.viewerCount,
          reconnectAttempts: dest.reconnectAttempts,
          errorMessage: live.errorMessage,
          lastHeartbeatAt: new Date().toISOString(),
        };
      } catch {
        return {
          platform: dest.platform,
          status: dest.status,
          bitrateKbps: dest.bitrateKbps,
          viewerCount: dest.viewerCount,
          reconnectAttempts: dest.reconnectAttempts,
          errorMessage: dest.errorMessage,
          lastHeartbeatAt: dest.lastHeartbeatAt,
        };
      }
    })
  );

  res.json({ streamId, destinations: statuses });
});

// ─── Pre-live preflight validation ───────────────────────────────────────────

router.get("/streams/:streamId/preflight", requireAuth, async (req: Request, res: Response) => {
  const streamId = String(req.params["streamId"]);
  const userId = req.auth!.userId;

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, userId)))
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  // Fetch OAuth connections
  const connections = await db
    .select()
    .from(oauthConnectionsTable)
    .where(eq(oauthConnectionsTable.userId, userId));

  const oauthPlatforms = connections.filter(
    (c) => OAUTH_PUSH_PLATFORMS.includes(c.platform as OAuthPlatform)
  );

  const { connectedCount, expiredCount, refreshNeededCount } = summarizeConnections(oauthPlatforms);

  // Active manual RTMP destinations (TikTok / Custom RTMP) — validated server-side
  // so a missing/malformed URL or key surfaces before going live. Restrict to the
  // manual destination types: OAuth platforms (and any legacy rows) live in the
  // oauth_connections flow and must not drive manual-destination preflight checks.
  const manualDestinations = await db
    .select()
    .from(platformsTable)
    .where(
      and(
        eq(platformsTable.userId, userId),
        inArray(platformsTable.type, ["tiktok", "custom_rtmp"]),
      ),
    );

  // Network reachability: server-side ping to Agora REST API (3s timeout)
  let networkStatus: "pass" | "warn" = "pass";
  let networkDetail = "Server network reachable";
  try {
    const controller = new AbortController();
    const networkTimeout = setTimeout(() => controller.abort(), 3000);
    await fetch("https://api.agora.io", { method: "HEAD", signal: controller.signal });
    clearTimeout(networkTimeout);
  } catch {
    networkStatus = "warn";
    networkDetail = "Cannot reach Agora API — check server network connectivity";
  }

  // Facebook destination availability check.
  // A creator who chose a Facebook Page can lose that destination when admin
  // access is revoked or the stored page token is gone. Surface it here as a
  // warning so they re-select BEFORE going live instead of failing silently at
  // push time. Only Page selections can break — the personal profile is always
  // available. Mirrors the selectedAvailable logic in GET /oauth/facebook/targets.
  const fbConn = oauthPlatforms.find(
    (c) => c.platform === "facebook" && c.status === "connected" && c.targetType === "page",
  );
  let fbDestinationCheck: PreflightCheck | null = null;
  if (fbConn) {
    if (!fbConn.targetId || !fbConn.encryptedTargetToken) {
      // Stored page id/token is gone — definitively broken, no API call needed.
      fbDestinationCheck = {
        id: "facebook_destination",
        label: "Facebook destination",
        status: "warn",
        detail: fbConn.targetName
          ? `"${fbConn.targetName}" is no longer available — re-select a Facebook destination in Settings → Platforms`
          : "Your selected Facebook Page is no longer available — re-select a destination in Settings → Platforms",
      };
    } else if (fbConn.encryptedAccessToken) {
      try {
        const fbAccessToken = decryptToken(fbConn.encryptedAccessToken);
        const targets = await fetchFacebookTargets(fbAccessToken);
        const available = targets.some((t) => t.type === "page" && t.id === fbConn.targetId);
        fbDestinationCheck = available
          ? {
              id: "facebook_destination",
              label: "Facebook destination",
              status: "pass",
              detail: `Live to "${fbConn.targetName ?? "Facebook Page"}"`,
            }
          : {
              id: "facebook_destination",
              label: "Facebook destination",
              status: "warn",
              detail: `"${fbConn.targetName ?? "Your selected Page"}" is no longer available — re-select a Facebook destination in Settings → Platforms`,
            };
      } catch (err) {
        // Can't verify (e.g. Meta API hiccup) — don't raise a false alarm; the
        // loud push-time check still guards a truly-broken destination.
        req.log.warn({ err }, "Preflight: could not verify Facebook destination");
      }
    }
  }

  const checks: PreflightCheck[] = [
    {
      id: "stream_exists",
      label: "Stream ready",
      status: "pass",
      detail: stream.title,
    },
    evaluatePlatformConnectedCheck(connectedCount),
    evaluateTokenValidityCheck(expiredCount, refreshNeededCount),
    {
      id: "agora_push",
      label: "Multistream engine",
      status: isAgoraPushConfigured() ? "pass" : "warn",
      detail: isAgoraPushConfigured()
        ? "Agora Cloud Push configured"
        : "Agora Cloud Push not configured — add AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET",
    },
    {
      id: "encryption",
      label: "Token encryption",
      status: isEncryptionConfigured() ? "pass" : "warn",
      detail: isEncryptionConfigured()
        ? "Encryption key configured"
        : "OAUTH_ENCRYPTION_KEY not set — tokens cannot be stored securely",
    },
    {
      id: "network_reachability",
      label: "Network reachability",
      status: networkStatus,
      detail: networkDetail,
    },
    // Camera and microphone permissions are checked client-side only
    {
      id: "camera",
      label: "Camera access",
      status: "client_check",
      detail: "Verified on device",
    },
    {
      id: "microphone",
      label: "Microphone access",
      status: "client_check",
      detail: "Verified on device",
    },
  ];

  if (fbDestinationCheck) checks.push(fbDestinationCheck);

  // Validate each active manual RTMP destination independently — one broken
  // destination yields its own fail/warn without hiding the others.
  for (const check of buildManualDestinationChecks(manualDestinations)) {
    checks.push(check);
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const overallStatus = hasFail ? "fail" : hasWarn ? "warn" : "pass";

  res.json({
    streamId,
    overallStatus,
    canGoLive: !hasFail,
    checks,
    platformSummary: {
      total: oauthPlatforms.length,
      connected: connectedCount,
      expired: expiredCount,
      refreshNeeded: refreshNeededCount,
    },
  });
});

export default router;
