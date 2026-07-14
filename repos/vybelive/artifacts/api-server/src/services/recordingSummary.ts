/**
 * recordingSummary — pure projection + status derivation for the recording
 * archive surface.
 *
 * Kept side-effect free (no db, no storage, no express) so the privacy and
 * status rules can be unit-tested directly. Both the archive list route and the
 * recording-thumbnail service consume these helpers so the derived status, the
 * public projection, and the thumbnail object key never drift.
 */

import type { streamsTable } from "@workspace/db";

export type StreamRow = typeof streamsTable.$inferSelect;

export type RecordingStatus = "archived" | "pending" | "unavailable" | "failed";

/**
 * Derive a creator-facing recording status from stored stream fields:
 *  - archived:    a usable recordingUrl is set → playable
 *  - failed:      finalization failed terminally (recordingError set, no url)
 *  - pending:     no recordingUrl yet but a cloud recording session exists
 *  - unavailable: no recording was captured for this stream
 */
export function deriveRecordingStatus(
  s: Pick<
    StreamRow,
    "recordingUrl" | "recordingError" | "cloudRecordingResourceId" | "cloudRecordingSid"
  >,
): RecordingStatus {
  if (s.recordingUrl) return "archived";
  if (s.recordingError) return "failed";
  if (s.cloudRecordingResourceId && s.cloudRecordingSid) return "pending";
  return "unavailable";
}

/**
 * Public archive projection. Deliberately excludes sensitive operational
 * fields (stream keys, RTMP ingest URLs, raw private recording object paths,
 * Agora session identifiers) so the list endpoint can never leak them.
 */
export interface RecordingSummaryDTO {
  streamId: string;
  title: string;
  description: string | null;
  status: RecordingStatus;
  recordingError: string | null;
  durationSeconds: number;
  hasRecording: boolean;
  clipsCount: number;
  thumbnailUrl: string | null;
  endedAt: string | null;
  createdAt: string;
}

export function buildRecordingSummary(s: StreamRow): RecordingSummaryDTO {
  const status = deriveRecordingStatus(s);
  return {
    streamId: s.id,
    title: s.title,
    description: s.description,
    status,
    // The error message is only meaningful (and only surfaced) when the
    // recording actually failed — never leak stale errors on other states.
    recordingError: status === "failed" ? s.recordingError : null,
    durationSeconds: s.durationSeconds ?? 0,
    hasRecording: status === "archived",
    clipsCount: s.clipsCount,
    thumbnailUrl: s.thumbnailUrl,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Object key for a recording's poster thumbnail. Used by BOTH the upload and
 * the delete paths so deleting a recording never orphans its thumbnail.
 */
export function recordingThumbnailObjectPath(streamId: string): string {
  return `recordings/${streamId}/thumb.jpg`;
}
