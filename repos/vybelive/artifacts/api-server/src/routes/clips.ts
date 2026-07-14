import { Router } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  clipsTable,
  clipJobsTable,
  clipOutcomesTable,
  contentPostsTable,
  streamsTable,
  usersTable,
} from "@workspace/db";
import { PublishClipBody, TrimClipBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import {
  processClips,
  trimClip,
} from "../services/clipProcessor";
import type { AspectRatio, MarkerSource, ClipFormat } from "../services/clipScoring";
import {
  computeCreatorWeights,
  computeUniversalWeights,
  recordOutcome,
  type ClipOutcomeKind,
} from "../services/clipLearning";
import {
  publishClip,
  type SupportedPublishPlatform,
} from "../services/socialPublishing";
import {
  generateClipMetadata,
  isAIConfigured,
  AINotConfiguredError,
} from "../services/aiGeneration";
import { StorageNotConfiguredError, deleteClipAssets } from "../services/storageService";
import { logger } from "../lib/logger";

const router = Router();

type ClipRow = typeof clipsTable.$inferSelect;

/**
 * Record a learning outcome for an existing clip. Copies the marker source and
 * context signals from the clip's original "generated" outcome (those aren't
 * stored on the clip row) so approve/reject/publish/delete feed back into the
 * same source/signal/format weights. Best-effort — never breaks the main flow.
 */
async function recordClipOutcome(
  clip: ClipRow,
  outcome: ClipOutcomeKind,
  views = 0
): Promise<void> {
  try {
    const [gen] = await db
      .select({ source: clipOutcomesTable.source, signals: clipOutcomesTable.signals })
      .from(clipOutcomesTable)
      .where(and(eq(clipOutcomesTable.clipId, clip.id), eq(clipOutcomesTable.outcome, "generated")))
      .limit(1);

    await recordOutcome({
      userId: clip.userId,
      clipId: clip.id,
      streamId: clip.streamId,
      format: (clip.clipFormat as ClipFormat) ?? null,
      source: (gen?.source as MarkerSource | null) ?? null,
      signals: gen?.signals ?? [],
      confidence: clip.confidence,
      outcome,
      views,
    });
  } catch (err) {
    // Learning is non-critical: never break the main flow. Log so silent
    // degradation of learning-data completeness is observable.
    logger.warn({ err, clipId: clip.id, outcome }, "Failed to record clip learning outcome");
  }
}

// GET /api/clips
router.get("/clips", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
  const streamId = req.query["streamId"] as string | undefined;
  const status = req.query["status"] as string | undefined;

  const conditions = [eq(clipsTable.userId, req.auth!.userId)];
  if (streamId) conditions.push(eq(clipsTable.streamId, streamId));
  if (status) conditions.push(eq(clipsTable.status, status as "processing" | "ready" | "published" | "failed"));

  const where = and(...conditions);

  const [items, [{ total }]] = await Promise.all([
    db.select().from(clipsTable).where(where).orderBy(desc(clipsTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(clipsTable).where(where),
  ]);

  res.json({ items, total: Number(total) });
});

// GET /api/clips/:clipId
router.get("/clips/:clipId", requireAuth, async (req, res) => {
  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, String(req.params["clipId"])), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }
  res.json(clip);
});

// DELETE /api/clips/:clipId
router.delete("/clips/:clipId", requireAuth, async (req, res) => {
  const clipId = String(req.params["clipId"]);
  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  // Delete storage assets BEFORE the DB row.
  // If storage deletion fails with a real error, return 500 and leave the DB
  // row intact so the clip remains visible and the user can retry.
  // StorageNotConfiguredError means no bucket was provisioned — the clip has
  // no storage assets, so it is safe to proceed with DB deletion only.
  if (clip.streamId) {
    try {
      await deleteClipAssets(clip.streamId, clipId);
    } catch (err: unknown) {
      if (!(err instanceof StorageNotConfiguredError)) {
        req.log.error({ err, clipId, streamId: clip.streamId }, "Failed to delete clip assets from storage; aborting clip deletion");
        res.status(500).json({ error: "Failed to remove clip media from storage. The clip record was not deleted. Please try again." });
        return;
      }
      // Storage not provisioned — no assets to clean up; fall through to DB delete.
    }
  }

  await recordClipOutcome(clip, "deleted");
  await db.delete(clipsTable).where(eq(clipsTable.id, clipId));
  res.status(204).send();
});

// POST /api/streams/:streamId/clips/generate
// Triggers the real FFmpeg clip generation pipeline for a completed stream.
// Requires: stream must be ended AND streamsTable.recordingUrl must be populated.
router.post("/streams/:streamId/clips/generate", requireAuth, async (req, res) => {
  const streamId = String(req.params["streamId"]);

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.id, streamId), eq(streamsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

  if (stream.status !== "ended") {
    res.status(422).json({
      error: "Stream must be ended before clips can be generated.",
      blocker: "STREAM_NOT_ENDED",
    });
    return;
  }

  if (!stream.recordingUrl) {
    res.status(422).json({
      error:
        "No recording available for this stream. " +
        "The mobile app must upload the local recording after the stream ends " +
        "using POST /api/streams/:streamId/recording/upload-url then " +
        "POST /api/streams/:streamId/recording/finalize.",
      blocker: "NO_RECORDING",
    });
    return;
  }

  // Check for a running job to prevent duplicate processing
  const [existingJob] = await db
    .select()
    .from(clipJobsTable)
    .where(
      and(
        eq(clipJobsTable.streamId, streamId),
        eq(clipJobsTable.type, "generate_clips"),
        eq(clipJobsTable.status, "running")
      )
    )
    .limit(1);

  if (existingJob) {
    res.status(409).json({
      error: "Clip generation is already in progress for this stream.",
      jobId: existingJob.id,
      progress: existingJob.progress,
    });
    return;
  }

  // Create the job record
  const jobId = randomUUID();
  const [job] = await db
    .insert(clipJobsTable)
    .values({
      id: jobId,
      userId: req.auth!.userId,
      streamId,
      type: "generate_clips",
      status: "queued",
      progress: 0,
    })
    .returning();

  // Fire the pipeline async — respond immediately with the job ID
  processClips({
    jobId,
    streamId,
    userId: req.auth!.userId,
    streamTitle: stream.title,
    streamDescription: stream.description ?? null,
    recordingObjectPath: stream.recordingUrl,
  }).catch((err: unknown) => {
    req.log.error({ err, jobId }, "Unhandled error in clip processing pipeline");
  });

  res.status(202).json({
    jobId: job!.id,
    status: "queued",
    message: "Clip generation started. Poll GET /api/clips/jobs/:jobId for progress.",
  });
});

// GET /api/clips/jobs/:jobId
// Poll clip generation job status.
router.get("/clips/jobs/:jobId", requireAuth, async (req, res) => {
  const [job] = await db
    .select()
    .from(clipJobsTable)
    .where(
      and(
        eq(clipJobsTable.id, String(req.params["jobId"])),
        eq(clipJobsTable.userId, req.auth!.userId)
      )
    )
    .limit(1);

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const response: Record<string, unknown> = {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  };

  if (job.status === "completed" && job.resultData) {
    response["result"] = JSON.parse(job.resultData) as unknown;
  }

  res.json(response);
});

// POST /api/clips/:clipId/captions
// Generate AI captions for a specific clip.
// Requires: AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY
router.post("/clips/:clipId/captions", requireAuth, async (req, res) => {
  const clipId = String(req.params["clipId"]);

  if (!isAIConfigured()) {
    res.status(503).json({
      error:
        "AI caption generation is not configured. " +
        "AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY must be set. " +
        "Provision the OpenAI integration in Replit (Integrations → OpenAI).",
      blocker: "AI_NOT_CONFIGURED",
    });
    return;
  }

  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);
  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  let stream: { title: string; description: string | null } | undefined;
  if (clip.streamId) {
    const [s] = await db.select().from(streamsTable).where(eq(streamsTable.id, clip.streamId)).limit(1);
    stream = s;
  }

  try {
    const meta = await generateClipMetadata(
      stream?.title ?? clip.title,
      stream?.description ?? clip.description ?? null,
      clip.durationSeconds,
      1
    );

    const [updated] = await db
      .update(clipsTable)
      .set({
        aiTitle: meta.title,
        aiHashtags: meta.hashtags,
        aiCaptionTiktok: meta.captionTiktok,
        aiCaptionYoutube: meta.captionYoutube,
        aiCaptionInstagram: meta.captionInstagram,
        aiCaptionFacebook: meta.captionFacebook,
      })
      .where(eq(clipsTable.id, clipId))
      .returning();

    res.json(updated);
  } catch (err) {
    if (err instanceof AINotConfiguredError) {
      res.status(503).json({ error: err.message, blocker: "AI_NOT_CONFIGURED" });
    } else {
      req.log.error({ err, clipId }, "AI caption generation failed");
      res.status(500).json({ error: "AI generation failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }
});

// PATCH /api/clips/:clipId
// Update caption, title, or AI fields before publishing.
router.patch("/clips/:clipId", requireAuth, async (req, res) => {
  const clipId = String(req.params["clipId"]);

  const allowed = [
    "title", "description", "captionText",
    "aiCaptionTiktok", "aiCaptionYoutube", "aiCaptionInstagram", "aiCaptionFacebook",
    "aiTitle", "aiHashtags",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = (req.body as Record<string, unknown>)[key];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }

  const [updated] = await db
    .update(clipsTable)
    .set(updates)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Clip not found" }); return; }
  res.json(updated);
});

// POST /api/clips/:clipId/publish
// Publish a ready clip to one or more social platforms via OAuth.
router.post("/clips/:clipId/publish", requireAuth, async (req, res) => {
  const parsed = PublishClipBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const clipId = String(req.params["clipId"]);
  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);

  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  if (!clip.videoUrl) {
    res.status(422).json({
      error:
        "This clip has no video file. " +
        "Clips must be generated via POST /api/streams/:streamId/clips/generate before publishing.",
      blocker: "NO_VIDEO_URL",
    });
    return;
  }

  // Review gate: nothing publishes without explicit creator approval.
  if (clip.reviewStatus !== "approved") {
    res.status(422).json({
      error:
        "This clip has not been approved. Review and approve the clip " +
        "(POST /api/clips/:clipId/approve) before publishing.",
      blocker: "NEEDS_APPROVAL",
      reviewStatus: clip.reviewStatus,
    });
    return;
  }

  const supportedPlatforms: SupportedPublishPlatform[] = ["youtube_shorts", "facebook", "instagram"];
  const requestedPlatforms = parsed.data.platforms as string[];
  const validPlatforms = requestedPlatforms.filter((p): p is SupportedPublishPlatform =>
    supportedPlatforms.includes(p as SupportedPublishPlatform)
  );

  if (validPlatforms.length === 0) {
    res.status(422).json({
      error: `No supported publish platforms specified. Supported: ${supportedPlatforms.join(", ")}`,
      blocker: "UNSUPPORTED_PLATFORMS",
    });
    return;
  }

  const title = clip.aiTitle ?? clip.title;
  const captionOverrides: Partial<Record<SupportedPublishPlatform, string>> = {
    youtube_shorts: clip.aiCaptionYoutube ?? parsed.data.caption ?? title,
    facebook: clip.aiCaptionFacebook ?? parsed.data.caption ?? title,
    instagram: clip.aiCaptionInstagram ?? parsed.data.caption ?? title,
  };

  const results = await publishClip(
    clipId,
    req.auth!.userId,
    validPlatforms,
    clip.videoUrl,
    title,
    captionOverrides
  );

  const publishedPlatforms = results
    .filter((r) => r.status === "published")
    .map((r) => r.platform);

  if (publishedPlatforms.length > 0) {
    await db
      .update(clipsTable)
      .set({
        status: "published",
        publishedPlatforms: [...new Set([...clip.publishedPlatforms, ...publishedPlatforms])],
        captionText: parsed.data.caption ?? clip.captionText,
      })
      .where(eq(clipsTable.id, clipId));

    await recordClipOutcome(clip, "published");
  }

  res.json({ results });
});

// POST /api/clips/:clipId/approve
// Creator approves a clip — required before it can be published.
router.post("/clips/:clipId/approve", requireAuth, async (req, res) => {
  const clipId = String(req.params["clipId"]);
  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);
  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  const [updated] = await db
    .update(clipsTable)
    .set({ reviewStatus: "approved", approvedAt: new Date() })
    .where(eq(clipsTable.id, clipId))
    .returning();

  await recordClipOutcome(clip, "approved");
  res.json(updated);
});

// POST /api/clips/:clipId/reject
// Creator rejects a clip — keeps the record but blocks publishing.
router.post("/clips/:clipId/reject", requireAuth, async (req, res) => {
  const clipId = String(req.params["clipId"]);
  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);
  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  const [updated] = await db
    .update(clipsTable)
    .set({ reviewStatus: "rejected", approvedAt: null })
    .where(eq(clipsTable.id, clipId))
    .returning();

  await recordClipOutcome(clip, "rejected");
  res.json(updated);
});

// POST /api/clips/:clipId/trim
// Re-cut a clip to a new window from the source recording (async job).
// Resets the review gate to "pending" so the new cut must be re-approved.
router.post("/clips/:clipId/trim", requireAuth, async (req, res) => {
  const parsed = TrimClipBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const clipId = String(req.params["clipId"]);
  const [clip] = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);
  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  if (!clip.streamId) {
    res.status(422).json({ error: "Clip is not linked to a stream and cannot be re-trimmed.", blocker: "NO_STREAM" });
    return;
  }

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(eq(streamsTable.id, clip.streamId))
    .limit(1);
  if (!stream?.recordingUrl) {
    res.status(422).json({
      error: "The source recording is no longer available, so this clip cannot be re-trimmed.",
      blocker: "NO_RECORDING",
    });
    return;
  }

  const { startTimeMs, endTimeMs } = parsed.data;
  if (endTimeMs <= startTimeMs) {
    res.status(400).json({ error: "endTimeMs must be greater than startTimeMs." });
    return;
  }

  const jobId = randomUUID();
  const [job] = await db
    .insert(clipJobsTable)
    .values({
      id: jobId,
      userId: req.auth!.userId,
      streamId: clip.streamId,
      type: "trim_clip",
      status: "queued",
      progress: 0,
    })
    .returning();

  trimClip({
    jobId,
    userId: req.auth!.userId,
    clipId,
    streamId: clip.streamId,
    recordingObjectPath: stream.recordingUrl,
    startSec: Math.floor(startTimeMs / 1000),
    durationSec: Math.floor((endTimeMs - startTimeMs) / 1000),
    aspect: (clip.aspectRatio as AspectRatio) ?? "vertical",
  }).catch((err: unknown) => {
    req.log.error({ err, jobId, clipId }, "Unhandled error in clip trim pipeline");
  });

  res.status(202).json({
    jobId: job!.id,
    status: "queued",
    message: "Clip re-trim started. Poll GET /api/clips/jobs/:jobId for progress.",
  });
});

// GET /api/clips/learning/profile
// Returns this creator's learned selection weights + anonymized universal weights.
router.get("/clips/learning/profile", requireAuth, async (req, res) => {
  const [creator, universal] = await Promise.all([
    computeCreatorWeights(req.auth!.userId),
    computeUniversalWeights(),
  ]);

  const shape = (w: Awaited<ReturnType<typeof computeCreatorWeights>>) => ({
    sampleCount: w.sampleCount,
    sources: w.sources,
    formats: w.formats,
    signals: w.signals,
  });

  res.json({
    creator: shape(creator),
    universal: shape(universal),
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/clips/:clipId/posts
// List content post records for a clip (publish history per platform).
router.get("/clips/:clipId/posts", requireAuth, async (req, res) => {
  const clipId = String(req.params["clipId"]);

  const [clip] = await db
    .select({ id: clipsTable.id })
    .from(clipsTable)
    .where(and(eq(clipsTable.id, clipId), eq(clipsTable.userId, req.auth!.userId)))
    .limit(1);
  if (!clip) { res.status(404).json({ error: "Clip not found" }); return; }

  const posts = await db
    .select()
    .from(contentPostsTable)
    .where(eq(contentPostsTable.clipId, clipId))
    .orderBy(desc(contentPostsTable.createdAt));

  res.json({ posts });
});

export default router;
