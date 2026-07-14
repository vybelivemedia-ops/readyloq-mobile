/**
 * recordingThumbnail — best-effort poster-frame generation for a stream
 * recording.
 *
 * Extracts a single JPEG frame ~1s into the recording with FFmpeg (input
 * seeking → only the needed byte ranges are read, no full download), uploads it
 * as a public thumbnail, and stores the URL on the stream row.
 *
 * This is a NON-FATAL enhancement: it is invoked fire-and-forget after a
 * recording becomes available and must never throw back to the caller. A
 * failure just leaves the archive card on its placeholder tile.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db, streamsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getRecordingPlaybackUrl,
  uploadRecordingThumbnail,
  StorageNotConfiguredError,
} from "./storageService";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

/**
 * Generate + persist a poster thumbnail for a recording. Best-effort: swallows
 * all errors (logged as warnings) so it is safe to call fire-and-forget.
 */
export async function generateRecordingThumbnail(
  streamId: string,
  recordingUrl: string,
): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "vybe-rec-thumb-"));
  try {
    // Signed GET URL for app-storage objects; external URLs pass through.
    const src = await getRecordingPlaybackUrl(recordingUrl, 900);
    const out = join(tmpDir, "thumb.jpg");

    // -ss before -i => fast input seek (range requests), single frame, 640px wide.
    await execFileAsync(FFMPEG_BIN, [
      "-ss", "1",
      "-i", src,
      "-frames:v", "1",
      "-vf", "scale=640:-2",
      "-q:v", "3",
      "-y",
      out,
    ]);

    const publicUrl = await uploadRecordingThumbnail(out, streamId);
    await db
      .update(streamsTable)
      .set({ thumbnailUrl: publicUrl })
      .where(eq(streamsTable.id, streamId));

    logger.info({ streamId }, "Recording thumbnail generated");
  } catch (err) {
    // Storage not provisioned is an expected no-op in some environments.
    if (err instanceof StorageNotConfiguredError) return;
    logger.warn({ err, streamId }, "Recording thumbnail generation failed (non-fatal)");
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // temp cleanup failure is non-fatal
    }
  }
}
