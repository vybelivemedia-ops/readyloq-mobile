/**
 * clipProcessor — Real FFmpeg-based AI-highlight pipeline.
 *
 * Flow:
 *  1. Stream the recording from object storage to a local temp file
 *  2. ffprobe: get exact duration and validate the recording
 *  3. Extract honest context signals (per-second audio RMS + scene changes)
 *  4. Load P2 markers + learned (creator + universal) weights
 *  5. Score & select clip windows (markers + signals → confidence + format)
 *  6. For each selected window:
 *     a. FFmpeg: extract with the format's aspect/crop, H.264/AAC MP4
 *     b. FFmpeg: thumbnail JPEG
 *     c. FFmpeg + Whisper: transcribe (if AI configured)
 *     d. GPT-4o-mini: title, hashtags, per-platform captions
 *     e. Upload clip + thumbnail + transcript
 *     f. Insert clip row (confidence, reason, format, review gate = pending)
 *     g. Record a "generated" learning outcome
 *  7. Mark job completed or failed
 *
 * Honesty: selection is driven only by measurable signals (creator markers,
 * audio energy, scene changes) and the creator's own past behavior. No clip
 * publishes without explicit creator approval (reviewStatus starts "pending").
 *
 * Hard blockers (no mock fallback):
 *  - streamsTable.recordingUrl is null → recording must be uploaded first
 *  - DEFAULT_OBJECT_STORAGE_BUCKET_ID not set → provision Replit App Storage
 *  - ffmpeg/ffprobe not in PATH → install ffmpeg system package
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { db, clipsTable, clipJobsTable, usersTable, streamMarkersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  uploadClipFile,
  uploadThumbnail,
  uploadTranscript,
  downloadToFile,
} from "./storageService";
import {
  generateClipMetadata,
  transcribeAudio,
  isAIConfigured,
} from "./aiGeneration";
import { extractSignalTimeline } from "./signalExtraction";
import {
  selectClips,
  type AspectRatio,
  type SelectedClip,
  type ScoringMarker,
} from "./clipScoring";
import {
  computeCreatorWeights,
  computeUniversalWeights,
  recordOutcome,
} from "./clipLearning";

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

const MAX_CLIPS = 3;
const FALLBACK_CLIP_DURATION_SEC = 30;
const MIN_RECORDING_SEC = 60;

export class ClipProcessingError extends Error {
  constructor(
    message: string,
    public readonly blocker?: string
  ) {
    super(message);
    this.name = "ClipProcessingError";
    Object.setPrototypeOf(this, ClipProcessingError.prototype);
  }
}

/** Get the exact duration of a video file using ffprobe. */
async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const dur = parseFloat(stdout.trim());
  if (!isFinite(dur) || dur <= 0) {
    throw new ClipProcessingError(
      `ffprobe returned invalid duration "${stdout.trim()}" — recording may be corrupt or not a valid video file.`
    );
  }
  return dur;
}

/**
 * Build the FFmpeg video filter chain for a target aspect ratio.
 *  - vertical   → 720×1280, center-crop to 9:16
 *  - horizontal → 1280×720, fit to 16:9 (letterbox, no crop)
 *  - square     → 720×720, center-crop to 1:1
 */
function videoFilterFor(aspect: AspectRatio): string {
  switch (aspect) {
    case "horizontal":
      return [
        "scale=1280:720:force_original_aspect_ratio=decrease",
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "setsar=1",
      ].join(",");
    case "square":
      return [
        "crop='min(iw,ih)':'min(iw,ih)'",
        "scale=720:720",
        "setsar=1",
      ].join(",");
    case "vertical":
    default:
      return [
        "crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0",
        "scale=720:1280:force_original_aspect_ratio=decrease",
        "pad=720:1280:(ow-iw)/2:(oh-ih)/2",
        "setsar=1",
      ].join(",");
  }
}

/**
 * Extract a clip segment using FFmpeg with the given aspect ratio.
 * Output: H.264 main profile, AAC 128k, faststart MP4.
 */
async function extractClip(
  inputPath: string,
  startSec: number,
  durationSec: number,
  outputPath: string,
  aspect: AspectRatio
): Promise<void> {
  await execFileAsync(FFMPEG_BIN, [
    "-ss", String(startSec),
    "-i", inputPath,
    "-t", String(durationSec),
    "-vf", videoFilterFor(aspect),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-profile:v", "main",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "faststart",
    "-y",
    outputPath,
  ]);
}

/** Extract a JPEG thumbnail frame partway into the clip. */
async function extractThumbnail(clipPath: string, outputPath: string, atSec: number): Promise<void> {
  await execFileAsync(FFMPEG_BIN, [
    "-i", clipPath,
    "-ss", String(Math.max(0, atSec)),
    "-vframes", "1",
    "-q:v", "2",
    "-y",
    outputPath,
  ]);
}

/**
 * Extract the audio track as an MP3 for Whisper transcription.
 * Uses VBR quality 3 (~128kbps average) — sufficient for speech recognition.
 */
async function extractAudio(clipPath: string, outputPath: string): Promise<void> {
  await execFileAsync(FFMPEG_BIN, [
    "-i", clipPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-q:a", "3",
    "-y",
    outputPath,
  ]);
}

async function updateJobProgress(
  jobId: string,
  progress: number,
  statusMessage?: string
): Promise<void> {
  await db
    .update(clipJobsTable)
    .set({
      progress,
      status: "running",
      startedAt: progress === 0 ? new Date() : undefined,
      ...(statusMessage ? { errorMessage: null } : {}),
    })
    .where(eq(clipJobsTable.id, jobId));
}

async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await db
    .update(clipJobsTable)
    .set({ status: "failed", errorMessage, completedAt: new Date() })
    .where(eq(clipJobsTable.id, jobId));
}

async function completeJob(jobId: string, resultData: object): Promise<void> {
  await db
    .update(clipJobsTable)
    .set({
      status: "completed",
      progress: 100,
      resultData: JSON.stringify(resultData),
      completedAt: new Date(),
    })
    .where(eq(clipJobsTable.id, jobId));
}

export interface ProcessClipsInput {
  jobId: string;
  streamId: string;
  userId: string;
  streamTitle: string;
  streamDescription: string | null;
  recordingObjectPath: string;
  maxClips?: number;
}

/**
 * Main entry point. Runs the full AI-highlight pipeline for a stream recording.
 * Designed to run async (fire-and-forget from a route) — FFmpeg takes real wall time.
 * Updates clipJobsTable.progress throughout for mobile polling.
 */
export async function processClips(input: ProcessClipsInput): Promise<void> {
  const {
    jobId,
    streamId,
    userId,
    streamTitle,
    streamDescription,
    recordingObjectPath,
    maxClips = MAX_CLIPS,
  } = input;

  const tmpDir = mkdtempSync(join(tmpdir(), "vybe-clips-"));

  try {
    await updateJobProgress(jobId, 0);

    // ── Step 1: Stream recording to local temp file ──────────────────────────
    const inputPath = join(tmpDir, "recording.mp4");
    await downloadToFile(recordingObjectPath, inputPath);
    await updateJobProgress(jobId, 8);

    // ── Step 2: Probe duration ───────────────────────────────────────────────
    const totalDuration = await getVideoDuration(inputPath);
    if (totalDuration < MIN_RECORDING_SEC) {
      throw new ClipProcessingError(
        `Recording is too short (${Math.round(totalDuration)}s) — minimum is ${MIN_RECORDING_SEC}s for clip generation.`,
        "RECORDING_TOO_SHORT"
      );
    }

    // ── Step 3: Extract honest context signals (audio energy + scene cuts) ───
    const timeline = await extractSignalTimeline(inputPath);
    await updateJobProgress(jobId, 20);

    // ── Step 4: Load markers + learned weights ───────────────────────────────
    const markerRows = await db
      .select()
      .from(streamMarkersTable)
      .where(eq(streamMarkersTable.streamId, streamId));
    const markers: ScoringMarker[] = markerRows.map((m) => ({
      source: m.source,
      streamSecond: m.streamSecond,
      contextWindowSeconds: m.contextWindowSeconds,
      score: m.score,
    }));

    const [creatorWeights, universalWeights] = await Promise.all([
      computeCreatorWeights(userId),
      computeUniversalWeights(),
    ]);

    // ── Step 5: Score & select clip windows ──────────────────────────────────
    const selected: SelectedClip[] = selectClips({
      markers,
      timeline,
      totalDuration,
      maxClips,
      fallbackDurationSec: FALLBACK_CLIP_DURATION_SEC,
      creatorWeights,
      universalWeights,
    });

    if (selected.length === 0) {
      throw new ClipProcessingError(
        `Recording (${Math.round(totalDuration)}s) is too short to extract any clips.`,
        "RECORDING_TOO_SHORT"
      );
    }

    const createdClipIds: string[] = [];
    const progressPerClip = Math.floor(75 / selected.length);
    const aiEnabled = isAIConfigured();

    // ── Step 6: Process each selected clip ───────────────────────────────────
    for (let i = 0; i < selected.length; i++) {
      const sel = selected[i]!;
      const clipId = randomUUID();
      const clipPath = join(tmpDir, `clip_${i}.mp4`);
      const thumbPath = join(tmpDir, `thumb_${i}.jpg`);
      const audioPath = join(tmpDir, `audio_${i}.mp3`);

      // 6a. FFmpeg: extract clip with the format's aspect/crop
      await extractClip(inputPath, sel.startSec, sel.durationSec, clipPath, sel.aspectRatio);

      // 6b. FFmpeg: thumbnail partway into the clip
      await extractThumbnail(clipPath, thumbPath, Math.min(3, Math.floor(sel.durationSec / 2)));

      // 6c. FFmpeg + Whisper: transcribe (non-fatal on failure)
      let transcript: string | null = null;
      if (aiEnabled) {
        try {
          await extractAudio(clipPath, audioPath);
          transcript = await transcribeAudio(audioPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void db
            .update(clipJobsTable)
            .set({ errorMessage: `Transcription warning for clip ${i + 1}: ${msg}` })
            .where(eq(clipJobsTable.id, jobId));
        }
      }

      // 6d. GPT-4o-mini: title, hashtags, per-platform captions
      let aiTitle: string | null = null;
      let aiHashtags: string[] = [];
      let aiCaptionTiktok: string | null = null;
      let aiCaptionYoutube: string | null = null;
      let aiCaptionInstagram: string | null = null;
      let aiCaptionFacebook: string | null = null;

      if (aiEnabled) {
        try {
          const meta = await generateClipMetadata(
            streamTitle,
            streamDescription,
            sel.durationSec,
            i + 1,
            transcript
          );
          aiTitle = meta.title;
          aiHashtags = meta.hashtags;
          aiCaptionTiktok = meta.captionTiktok;
          aiCaptionYoutube = meta.captionYoutube;
          aiCaptionInstagram = meta.captionInstagram;
          aiCaptionFacebook = meta.captionFacebook;
        } catch {
          // AI metadata failure is non-fatal — clip created without AI fields
        }
      }

      // 6e. Upload clip + thumbnail (+ transcript best-effort)
      const [videoUrl, thumbnailUrl] = await Promise.all([
        uploadClipFile(clipPath, streamId, clipId),
        uploadThumbnail(thumbPath, streamId, clipId),
      ]);
      if (transcript) {
        uploadTranscript(transcript, streamId, clipId).catch(() => {});
      }

      // 6f. Insert clip row — review gate starts "pending"
      await db.insert(clipsTable).values({
        id: clipId,
        userId,
        streamId,
        title: aiTitle ?? `${streamTitle} — ${capitalize(sel.format)} ${i + 1}`,
        description: streamDescription ?? null,
        videoUrl,
        thumbnailUrl,
        durationSeconds: sel.durationSec,
        status: "ready",
        aiGenerated: true,
        aspectRatio: sel.aspectRatio,
        clipFormat: sel.format,
        confidence: sel.confidence,
        confidenceReason: sel.confidenceReason,
        intentScore: sel.intentScore,
        signalScore: sel.signalScore,
        cropMode: sel.cropMode,
        reviewStatus: "pending",
        startTimeMs: sel.startSec * 1000,
        endTimeMs: (sel.startSec + sel.durationSec) * 1000,
        processingJobId: jobId,
        aiTitle,
        aiHashtags,
        aiCaptionTiktok,
        aiCaptionYoutube,
        aiCaptionInstagram,
        aiCaptionFacebook,
      });

      // 6g. Record the "generated" learning outcome (best-effort)
      await recordOutcome({
        userId,
        clipId,
        streamId,
        format: sel.format,
        source: sel.source,
        signals: sel.signals,
        confidence: sel.confidence,
        outcome: "generated",
      }).catch(() => {});

      createdClipIds.push(clipId);
      await updateJobProgress(jobId, 20 + (i + 1) * progressPerClip);
    }

    // ── Step 7: Update user aggregate clip count ─────────────────────────────
    const [{ clipCount }] = await db
      .select({ clipCount: count() })
      .from(clipsTable)
      .where(eq(clipsTable.userId, userId));
    await db
      .update(usersTable)
      .set({ totalClips: Number(clipCount) })
      .where(eq(usersTable.id, userId));

    await completeJob(jobId, {
      clipIds: createdClipIds,
      totalClips: createdClipIds.length,
      transcriptGenerated: aiEnabled,
      markerCount: markers.length,
      audioSamples: timeline.audio.length,
      sceneChanges: timeline.sceneChanges.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(jobId, message);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup failure is non-fatal
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Trim re-cut (creator review action) ───────────────────────────────────────

export interface TrimClipInput {
  jobId: string;
  userId: string;
  clipId: string;
  streamId: string;
  recordingObjectPath: string;
  startSec: number;
  durationSec: number;
  aspect: AspectRatio;
}

/**
 * Re-cut an existing clip to a new window from the source recording.
 * Re-uploads media (same storage key → overwrites), updates timing/duration,
 * and resets the review gate to "pending" so the new cut must be re-approved.
 */
export async function trimClip(input: TrimClipInput): Promise<void> {
  const { jobId, clipId, streamId, recordingObjectPath, startSec, durationSec, aspect } = input;
  const tmpDir = mkdtempSync(join(tmpdir(), "vybe-trim-"));

  try {
    await updateJobProgress(jobId, 0);
    const inputPath = join(tmpDir, "recording.mp4");
    await downloadToFile(recordingObjectPath, inputPath);
    await updateJobProgress(jobId, 40);

    const totalDuration = await getVideoDuration(inputPath);
    const safeStart = Math.max(0, Math.min(startSec, Math.floor(totalDuration) - 1));
    const safeDur = Math.max(1, Math.min(durationSec, Math.floor(totalDuration) - safeStart));

    const clipPath = join(tmpDir, "clip.mp4");
    const thumbPath = join(tmpDir, "thumb.jpg");
    await extractClip(inputPath, safeStart, safeDur, clipPath, aspect);
    await extractThumbnail(clipPath, thumbPath, Math.min(3, Math.floor(safeDur / 2)));
    await updateJobProgress(jobId, 75);

    const [videoUrl, thumbnailUrl] = await Promise.all([
      uploadClipFile(clipPath, streamId, clipId),
      uploadThumbnail(thumbPath, streamId, clipId),
    ]);

    await db
      .update(clipsTable)
      .set({
        videoUrl,
        thumbnailUrl,
        durationSeconds: safeDur,
        startTimeMs: safeStart * 1000,
        endTimeMs: (safeStart + safeDur) * 1000,
        status: "ready",
        reviewStatus: "pending",
        approvedAt: null,
      })
      .where(eq(clipsTable.id, clipId));

    await completeJob(jobId, { clipId, startSec: safeStart, durationSec: safeDur });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(jobId, message);
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup failure is non-fatal
    }
  }
}
