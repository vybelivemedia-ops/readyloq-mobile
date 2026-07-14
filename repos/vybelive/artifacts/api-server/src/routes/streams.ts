import { Router, type Response } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, streamsTable, usersTable, clipsTable, streamMarkersTable } from "@workspace/db";
import { CreateStreamBody, UpdateStreamBody, CreateStreamMarkerBody, EndStreamBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import {
  getRecordingUploadUrl,
  getExpectedRecordingObjectPath,
  validateRecordingObject,
  getRecordingPlaybackUrl,
  deleteRecordingAsset,
  deleteRecordingThumbnail,
  deleteClipAssets,
  RecordingValidationError,
  StorageNotConfiguredError,
} from "../services/storageService";
import { buildRecordingSummary } from "../services/recordingSummary";
import { generateRecordingThumbnail } from "../services/recordingThumbnail";
import { checkRecordingUrlRateLimit } from "../lib/uploadRateLimit";
import * as agoraCloudRecording from "../services/agoraCloudRecording";

const router = Router();

type StreamRow = typeof streamsTable.$inferSelect;

// GET /api/streams
router.get("/streams", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
  const status = req.query["status"] as string | undefined;

  const where = status
    ? and(
        eq(streamsTable.userId, req.auth!.userId),
        eq(streamsTable.status, status as "scheduled" | "live" | "ended")
      )
    : eq(streamsTable.userId, req.auth!.userId);

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(streamsTable)
      .where(where)
      .orderBy(desc(streamsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(streamsTable)
      .where(where),
  ]);

  res.json({ items, total: Number(total) });
});

// POST /api/streams
router.post("/streams", requireAuth, async (req, res) => {
  const parsed = CreateStreamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const streamKey = randomUUID().replace(/-/g, "");
  const [stream] = await db
    .insert(streamsTable)
    .values({
      id: randomUUID(),
      userId: req.auth!.userId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      deviceType: (parsed.data.deviceType ?? "phone") as "phone" | "gopro" | "meta_glasses" | "external_rtmp",
      platforms: parsed.data.platforms ?? [],
      streamKey,
      rtmpIngestUrl: `rtmp://ingest.vybelive.io/live/${streamKey}`,
    })
    .returning();

  res.status(201).json(stream);
});

// GET /api/streams/active — must be before /:streamId
router.get("/streams/active", requireAuth, async (req, res) => {
  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(
      and(
        eq(streamsTable.userId, req.auth!.userId),
        eq(streamsTable.status, "live")
      )
    )
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "No active stream" });
    return;
  }
  res.json(stream);
});

// GET /api/streams/recordings — archive list of ended streams (must be before /:streamId)
router.get("/streams/recordings", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);

  const where = and(
    eq(streamsTable.userId, req.auth!.userId),
    eq(streamsTable.status, "ended")
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(streamsTable)
      .where(where)
      .orderBy(desc(streamsTable.endedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(streamsTable).where(where),
  ]);

  const items = rows.map(buildRecordingSummary);

  res.json({ items, total: Number(total) });
});

// GET /api/streams/:streamId
router.get("/streams/:streamId", requireAuth, async (req, res) => {
  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(
      and(
        eq(streamsTable.id, String(req.params.streamId)),
        eq(streamsTable.userId, req.auth!.userId)
      )
    )
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }
  res.json(stream);
});

// PATCH /api/streams/:streamId
router.patch("/streams/:streamId", requireAuth, async (req, res) => {
  const parsed = UpdateStreamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(streamsTable)
    .set(parsed.data)
    .where(
      and(
        eq(streamsTable.id, String(req.params.streamId)),
        eq(streamsTable.userId, req.auth!.userId)
      )
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }
  res.json(updated);
});

// DELETE /api/streams/:streamId
// Deletes the stream along with its recording file and all clips generated
// from it (DB rows + media). Storage cleanup is best-effort: a storage failure
// is logged but does not block the deletion so the creator can always remove it.
router.delete("/streams/:streamId", requireAuth, async (req, res) => {
  const streamId = String(req.params.streamId);

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  // Capture associated clip ids up front so storage cleanup can run after the
  // DB rows are gone.
  const clips = await db
    .select({ id: clipsTable.id })
    .from(clipsTable)
    .where(eq(clipsTable.streamId, streamId));

  // Delete DB rows atomically: either both the clip rows and the stream row are
  // removed, or neither is — so a mid-sequence failure never leaves orphaned
  // clip rows or a half-deleted archive entry.
  await db.transaction(async (tx) => {
    if (clips.length > 0) {
      await tx.delete(clipsTable).where(eq(clipsTable.streamId, streamId));
    }
    await tx.delete(streamsTable).where(eq(streamsTable.id, streamId));
  });

  // Storage cleanup is best-effort: the DB rows are already gone, so a failed
  // object delete only leaves an orphaned file (logged for later cleanup) and
  // must not fail the request.
  for (const clip of clips) {
    try {
      await deleteClipAssets(streamId, clip.id);
    } catch (err) {
      if (!(err instanceof StorageNotConfiguredError)) {
        req.log.warn({ err, streamId, clipId: clip.id }, "Failed to delete clip assets during stream deletion");
      }
    }
  }

  if (stream.recordingUrl) {
    try {
      await deleteRecordingAsset(stream.recordingUrl);
    } catch (err) {
      if (!(err instanceof StorageNotConfiguredError)) {
        req.log.warn({ err, streamId }, "Failed to delete recording asset during stream deletion");
      }
    }
  }

  // Remove the poster thumbnail too (best-effort; shares the object key with upload).
  try {
    await deleteRecordingThumbnail(streamId);
  } catch (err) {
    if (!(err instanceof StorageNotConfiguredError)) {
      req.log.warn({ err, streamId }, "Failed to delete recording thumbnail during stream deletion");
    }
  }

  res.status(204).send();
});

// POST /api/streams/:streamId/agora-token
router.post("/streams/:streamId/agora-token", requireAuth, async (req, res) => {
  const streamId = String(req.params.streamId);
  const role = req.body?.role === "audience" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

  const [stream] = await db
    .select({ id: streamsTable.id })
    .from(streamsTable)
    .where(
      and(
        eq(streamsTable.id, streamId),
        eq(streamsTable.userId, req.auth!.userId)
      )
    )
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    res.status(503).json({ error: "Agora not configured" });
    return;
  }

  const channelName = streamId;
  const uid = Math.floor(Math.random() * 100000) + 1;
  const expireSeconds = 3600;
  const privilegeExpireTs = Math.floor(Date.now() / 1000) + expireSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    role,
    privilegeExpireTs,
    privilegeExpireTs
  );

  const expiresAt = new Date((privilegeExpireTs) * 1000).toISOString();

  // Persist the creator's publishing UID so the Media Push converter can
  // forward exactly this host's stream (rawOptions.rtcStreamUid). Only the
  // PUBLISHER (the creator) owns the source stream; audience tokens must not
  // overwrite it.
  if (role === RtcRole.PUBLISHER) {
    await db
      .update(streamsTable)
      .set({ agoraPublishUid: uid })
      .where(eq(streamsTable.id, streamId));
  }

  req.log.info(
    {
      channelName,
      uid,
      role,
      // First 8 chars of the App ID returned to the client — must match
      // the AGORA_APP_ID used by the Media Push REST API.
      appIdPrefix: appId.slice(0, 8) + "...",
    },
    "Agora token generated — appId sent to mobile client"
  );

  res.json({ appId, token, channelName, uid, expiresAt });
});

// POST /api/streams/:streamId/start
router.post("/streams/:streamId/start", requireAuth, async (req, res) => {
  const streamId = String(req.params["streamId"]);

  const [existing] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  const updates: Partial<typeof streamsTable.$inferInsert> = {
    status: "live",
    startedAt: new Date(),
  };

  // Attempt Agora Cloud Recording only when explicitly opted in via
  // AGORA_CLOUD_RECORDING_ENABLED=true. Having AGORA_CUSTOMER_ID/SECRET set
  // for Media Push must NOT auto-enable recording — they are separate products.
  // Failures are caught below; the stream proceeds to "live" regardless.
  if (agoraCloudRecording.isConfigured()) {
    try {
      const recordingUid = "0";
      const resourceId = await agoraCloudRecording.acquireResourceId(streamId, recordingUid);

      const appId = process.env["AGORA_APP_ID"]!;
      const appCertificate = process.env["AGORA_APP_CERTIFICATE"] ?? "";
      const expiry = Math.floor(Date.now() / 1000) + 7200;
      const token = appCertificate
        ? RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, streamId, 0, RtcRole.SUBSCRIBER, expiry, expiry)
        : "";

      const { sid } = await agoraCloudRecording.startRecording(streamId, recordingUid, resourceId, token);
      updates.cloudRecordingResourceId = resourceId;
      updates.cloudRecordingSid = sid;
      req.log.info({ streamId, resourceId, sid }, "Agora Cloud Recording started");
    } catch (err) {
      req.log.warn({ err, streamId }, "Agora Cloud Recording start failed — stream will proceed without recording");
    }
  }

  const [stream] = await db
    .update(streamsTable)
    .set(updates)
    .where(eq(streamsTable.id, streamId))
    .returning();

  const [{ liveCount }] = await db
    .select({ liveCount: count() })
    .from(streamsTable)
    .where(eq(streamsTable.userId, req.auth!.userId));
  await db
    .update(usersTable)
    .set({ totalStreams: Number(liveCount) })
    .where(eq(usersTable.id, req.auth!.userId));

  res.json(stream);
});

// POST /api/streams/:streamId/end
router.post("/streams/:streamId/end", requireAuth, async (req, res) => {
  const now = new Date();
  const streamId = String(req.params["streamId"]);

  const [existing] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  const durationSeconds = existing.startedAt
    ? Math.floor((now.getTime() - existing.startedAt.getTime()) / 1000)
    : 0;

  const parsedStats = EndStreamBody.safeParse(req.body ?? {});
  if (!parsedStats.success) {
    res.status(400).json({ error: "Invalid viewer statistics", details: parsedStats.error.issues });
    return;
  }
  const { peakViewers, avgViewers, totalViews } = parsedStats.data;

  const endUpdates: Partial<typeof streamsTable.$inferInsert> = {
    status: "ended",
    endedAt: now,
    durationSeconds,
  };

  // Persist real viewer statistics captured from the live Agora session.
  if (peakViewers !== undefined) endUpdates.peakViewers = Math.round(peakViewers);
  if (avgViewers !== undefined) endUpdates.avgViewers = avgViewers;
  if (totalViews !== undefined) endUpdates.totalViews = Math.round(totalViews);

  // Stop Agora Cloud Recording if it was started with this stream
  if (
    agoraCloudRecording.isConfigured() &&
    existing.cloudRecordingResourceId &&
    existing.cloudRecordingSid
  ) {
    try {
      const files = await agoraCloudRecording.stopRecording(
        streamId,
        "0",
        existing.cloudRecordingResourceId,
        existing.cloudRecordingSid
      );
      if (files.length > 0) {
        const agoraFile = files[0]!;
        // Prefer object path in Replit App Storage (when AGORA_RECORDING_FILE_PREFIX set).
        // Fall back to full HTTPS URL (when AGORA_RECORDING_EXTERNAL_BASE_URL set).
        // If neither is configured, the recording cannot be reached — mark it failed.
        const objectPath = agoraCloudRecording.buildRecordingObjectPath(agoraFile);
        const externalUrl = agoraCloudRecording.buildRecordingExternalUrl(agoraFile);
        const recordingUrl = objectPath ?? externalUrl;
        if (recordingUrl) {
          endUpdates.recordingUrl = recordingUrl;
          endUpdates.recordingError = null;
          req.log.info({ streamId, recordingUrl, agoraFile }, "Agora Cloud Recording stopped, recordingUrl set");
        } else {
          endUpdates.recordingError =
            "Recording captured but could not be archived (storage not configured). Contact support.";
          req.log.warn(
            { streamId, agoraFile },
            "Agora Cloud Recording stopped but AGORA_RECORDING_FILE_PREFIX and " +
            "AGORA_RECORDING_EXTERNAL_BASE_URL are both unset — recordingUrl not set. " +
            "Set one of those env vars to enable clip generation from Agora recordings."
          );
        }
      } else {
        endUpdates.recordingError = "No recording file was produced for this stream.";
        req.log.warn({ streamId }, "Agora Cloud Recording stopped but returned no file names");
      }
    } catch (err) {
      endUpdates.recordingError = "Recording failed to finalize. The stream ended but no recording was saved.";
      req.log.warn({ err, streamId }, "Agora Cloud Recording stop failed — recordingUrl not set");
    }
  }

  const [stream] = await db
    .update(streamsTable)
    .set(endUpdates)
    .where(eq(streamsTable.id, streamId))
    .returning();

  res.json(stream);

  // Best-effort poster thumbnail (fire-and-forget; never blocks the End response).
  if (endUpdates.recordingUrl) {
    void generateRecordingThumbnail(streamId, endUpdates.recordingUrl).catch(() => {});
  }
});

// POST /api/streams/:streamId/recording/upload-url
// Returns a presigned PUT URL for the mobile app to upload the locally recorded video.
// Call this endpoint before uploading; the URL is valid for 30 minutes.
// After upload completes, call /recording/finalize to register the recording.
router.post("/streams/:streamId/recording/upload-url", requireAuth, async (req, res) => {
  const streamId = String(req.params["streamId"]);

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
  if (stream.status !== "ended") {
    res.status(422).json({
      error: "Recording can only be uploaded after the stream has ended.",
      blocker: "STREAM_NOT_ENDED",
    });
    return;
  }

  if (!checkRecordingUrlRateLimit(req.auth!.userId)) {
    res.status(429).json({ error: "Recording upload URL request rate limit exceeded. Please try again later." });
    return;
  }

  try {
    const { uploadUrl, objectPath } = await getRecordingUploadUrl(req.auth!.userId, streamId);
    res.json({
      uploadUrl,
      objectPath,
      expiresInSeconds: 1800,
      instructions: "PUT your video/mp4 file to uploadUrl. Then call POST /recording/finalize with the objectPath.",
    });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      res.status(503).json({
        error: err.message,
        blocker: "STORAGE_NOT_CONFIGURED",
      });
    } else {
      req.log.error({ err, streamId }, "Failed to generate recording upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  }
});

// POST /api/streams/:streamId/recording/finalize
// Called by the mobile app after successfully uploading the recording to GCS.
// Registers the recordingUrl so clips can be generated from it.
// The objectPath must exactly match the server-issued path from /recording/upload-url.
router.post("/streams/:streamId/recording/finalize", requireAuth, async (req, res) => {
  const streamId = String(req.params["streamId"]);
  const { objectPath } = req.body as { objectPath?: string };

  if (!objectPath || typeof objectPath !== "string") {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }

  // Validate that the supplied path matches the server-issued path for this
  // user + stream. Reject anything else to prevent SSRF and cross-user object binding.
  const expectedPath = getExpectedRecordingObjectPath(req.auth!.userId, streamId);
  if (objectPath !== expectedPath) {
    req.log.warn({ streamId, objectPath, expectedPath }, "Recording finalize rejected: objectPath does not match server-issued path");
    res.status(403).json({ error: "Invalid objectPath: must use the path returned by /recording/upload-url" });
    return;
  }

  // Inspect the GCS object metadata BEFORE writing recordingUrl to the DB.
  // Rejects uploads that are empty, oversized, or have a disallowed content-type.
  try {
    await validateRecordingObject(req.auth!.userId, streamId);
  } catch (err) {
    if (err instanceof RecordingValidationError) {
      req.log.warn({ err, streamId, objectPath }, "Recording finalize rejected: invalid object");
      res.status(422).json({ error: err.message, blocker: "INVALID_RECORDING" });
      return;
    }
    if (err instanceof StorageNotConfiguredError) {
      res.status(503).json({ error: (err as Error).message, blocker: "STORAGE_NOT_CONFIGURED" });
      return;
    }
    req.log.error({ err, streamId }, "Failed to validate recording object metadata");
    res.status(500).json({ error: "Failed to validate recording" });
    return;
  }

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

  const [updated] = await db
    .update(streamsTable)
    .set({ recordingUrl: objectPath })
    .where(eq(streamsTable.id, streamId))
    .returning();

  req.log.info({ streamId, objectPath }, "Stream recording finalized");
  res.json({
    streamId,
    recordingUrl: updated!.recordingUrl,
    message: "Recording registered. Use POST /api/streams/:streamId/clips/generate to extract clips.",
  });

  // Best-effort poster thumbnail (fire-and-forget; never blocks finalize).
  void generateRecordingThumbnail(streamId, objectPath).catch(() => {});
});

// GET /api/streams/:streamId/recording/play-url
// Returns a short-lived signed playback URL for the stream's recording.
// External (non-app-storage) recordings are returned as-is.
router.get("/streams/:streamId/recording/play-url", requireAuth, async (req, res) => {
  const streamId = String(req.params["streamId"]);

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

  if (!stream.recordingUrl) {
    res.status(409).json({
      error: "Recording is not available for this stream yet.",
      blocker: "RECORDING_NOT_AVAILABLE",
    });
    return;
  }

  try {
    const expiresInSeconds = 3600;
    const url = await getRecordingPlaybackUrl(stream.recordingUrl, expiresInSeconds);
    res.json({ url, expiresInSeconds });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      res.status(503).json({ error: err.message, blocker: "STORAGE_NOT_CONFIGURED" });
      return;
    }
    req.log.error({ err, streamId }, "Failed to generate recording playback URL");
    res.status(500).json({ error: "Failed to generate playback URL" });
  }
});

// ─── Timeline markers (voice / gesture / manual) ──────────────────────────────

// Ensure the stream exists and belongs to the caller. Returns the stream row or
// null (after sending a 404) so callers can early-return.
async function loadOwnedStream(
  streamId: string,
  userId: string,
  res: Response,
): Promise<StreamRow | null> {
  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, userId)))
    .limit(1);
  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return null;
  }
  return stream;
}

// GET /api/streams/:streamId/markers — list markers for a stream (newest first)
router.get("/streams/:streamId/markers", requireAuth, async (req, res) => {
  const streamId = String(req.params["streamId"]);
  const stream = await loadOwnedStream(streamId, req.auth!.userId, res);
  if (!stream) return;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(streamMarkersTable)
      .where(eq(streamMarkersTable.streamId, streamId))
      .orderBy(desc(streamMarkersTable.streamSecond)),
    db
      .select({ total: count() })
      .from(streamMarkersTable)
      .where(eq(streamMarkersTable.streamId, streamId)),
  ]);

  const items = rows.map((m) => ({
    id: m.id,
    streamId: m.streamId,
    source: m.source,
    triggerValue: m.triggerValue,
    label: m.label,
    streamSecond: m.streamSecond,
    contextWindowSeconds: m.contextWindowSeconds,
    score: m.score,
    createdAt: m.createdAt.toISOString(),
  }));

  res.json({ items, total: Number(total) });
});

// POST /api/streams/:streamId/markers — drop a marker on a live/ended stream
router.post("/streams/:streamId/markers", requireAuth, async (req, res) => {
  const parsed = CreateStreamMarkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const streamId = String(req.params["streamId"]);
  const stream = await loadOwnedStream(streamId, req.auth!.userId, res);
  if (!stream) return;

  const [marker] = await db
    .insert(streamMarkersTable)
    .values({
      id: randomUUID(),
      streamId,
      userId: req.auth!.userId,
      source: parsed.data.source,
      triggerValue: parsed.data.triggerValue ?? null,
      label: parsed.data.label ?? null,
      streamSecond: parsed.data.streamSecond,
      contextWindowSeconds: parsed.data.contextWindowSeconds ?? 30,
      score: parsed.data.score ?? null,
    })
    .returning();

  res.status(201).json({
    id: marker!.id,
    streamId: marker!.streamId,
    source: marker!.source,
    triggerValue: marker!.triggerValue,
    label: marker!.label,
    streamSecond: marker!.streamSecond,
    contextWindowSeconds: marker!.contextWindowSeconds,
    score: marker!.score,
    createdAt: marker!.createdAt.toISOString(),
  });
});

export default router;
