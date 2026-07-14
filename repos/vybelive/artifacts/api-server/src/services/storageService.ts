/**
 * storageService — server-side GCS upload/download helpers for recordings and clips.
 *
 * Architecture:
 *  - Recordings: mobile uploads directly to GCS via presigned PUT URL (signed by Replit sidecar)
 *  - Clips: server uploads directly after FFmpeg processing using sidecar-authenticated GCS client
 *  - Clips stored publicly readable so mobile plays directly from GCS URL
 *  - Recordings are private; server streams them to a temp file for FFmpeg processing
 *
 * Presigned URL signing uses the Replit sidecar endpoint (not file.getSignedUrl()) because
 * the sidecar external_account credentials do not have IAM signBlob permission.
 */

import { objectStorageClient } from "../lib/objectStorage";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { recordingThumbnailObjectPath } from "./recordingSummary";

const SIDECAR = "http://127.0.0.1:1106";
const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Object storage is not configured — DEFAULT_OBJECT_STORAGE_BUCKET_ID is missing. " +
        "Provision a Replit App Storage bucket to enable recording uploads and clip generation."
    );
    this.name = "StorageNotConfiguredError";
    Object.setPrototypeOf(this, StorageNotConfiguredError.prototype);
  }
}

function requireBucketId(): string {
  if (!BUCKET_ID) throw new StorageNotConfiguredError();
  return BUCKET_ID;
}

function requireBucket() {
  return objectStorageClient.bucket(requireBucketId());
}

/** Full public GCS URL for an object path in this bucket */
export function gcsUrl(objectPath: string): string {
  return `https://storage.googleapis.com/${BUCKET_ID}/${objectPath}`;
}

/**
 * Generate a presigned URL via the Replit sidecar.
 * Works for both PUT (upload) and GET (download).
 * Falls back to direct GCS URL on sidecar error so callers get a real error message.
 */
async function sidecarSignedUrl(
  objectPath: string,
  method: "GET" | "PUT",
  ttlSec: number
): Promise<string> {
  const bucketId = requireBucketId();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketId,
      object_name: objectPath,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Replit sidecar failed to sign ${method} URL for ${objectPath}: ${res.status} ${body}`
    );
  }
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

/**
 * Return the canonical GCS object path for a stream recording.
 * This is the single source of truth used by both upload-url issuance
 * and finalize validation — the finalize endpoint rejects any objectPath
 * that does not exactly match this value.
 */
export function getExpectedRecordingObjectPath(userId: string, streamId: string): string {
  return `recordings/${userId}/${streamId}/source.mp4`;
}

/**
 * Generate a presigned PUT URL for direct mobile→GCS recording upload.
 * Valid for 30 minutes. The returned objectPath should be stored in streamsTable.recordingUrl
 * after the upload completes (via the /recording/finalize endpoint).
 *
 * Uses the Replit sidecar signing endpoint — does NOT require a service account key.
 */
export async function getRecordingUploadUrl(
  userId: string,
  streamId: string
): Promise<{ uploadUrl: string; objectPath: string }> {
  const objectPath = getExpectedRecordingObjectPath(userId, streamId);
  const uploadUrl = await sidecarSignedUrl(objectPath, "PUT", 30 * 60);
  return { uploadUrl, objectPath };
}

/**
 * Stream a recording directly to a local file without loading into memory.
 *
 * Accepts two formats:
 *  - GCS object path (e.g. "recordings/userId/streamId/source.mp4") — downloaded via sidecar GCS client
 *  - HTTPS URL (e.g. "https://storage.googleapis.com/…") — downloaded via fetch() stream
 *
 * Uses streaming in both cases to avoid OOM on large recording files.
 */
export async function downloadToFile(objectPathOrUrl: string, destPath: string): Promise<void> {
  const writeStream = createWriteStream(destPath);

  if (objectPathOrUrl.startsWith("https://") || objectPathOrUrl.startsWith("http://")) {
    // HTTPS URL path — used when Agora writes to an external bucket
    const res = await fetch(objectPathOrUrl, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      throw new Error(
        `Failed to download recording from ${objectPathOrUrl}: HTTP ${res.status} ${res.statusText}`
      );
    }
    if (!res.body) throw new Error("Response body is null");
    const { Readable } = await import("stream");
    const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeStream, writeStream);
  } else {
    // GCS object path — downloaded via sidecar-authenticated GCS client
    const bucket = requireBucket();
    const readStream = bucket.file(objectPathOrUrl).createReadStream();
    await pipeline(readStream, writeStream);
  }
}

/**
 * Upload a locally generated clip file to GCS as publicly readable.
 * Returns the full public GCS URL.
 */
export async function uploadClipFile(
  localPath: string,
  streamId: string,
  clipId: string
): Promise<string> {
  const bucket = requireBucket();
  const objectPath = `clips/${streamId}/${clipId}/video.mp4`;
  const file = bucket.file(objectPath);
  await file.save(createReadStream(localPath), {
    contentType: "video/mp4",
    resumable: false,
    public: true,
    metadata: { contentType: "video/mp4", cacheControl: "public, max-age=31536000" },
  });
  return gcsUrl(objectPath);
}

/**
 * Upload a locally generated thumbnail to GCS as publicly readable.
 * Returns the full public GCS URL.
 */
export async function uploadThumbnail(
  localPath: string,
  streamId: string,
  clipId: string
): Promise<string> {
  const bucket = requireBucket();
  const objectPath = `clips/${streamId}/${clipId}/thumb.jpg`;
  const file = bucket.file(objectPath);
  await file.save(createReadStream(localPath), {
    contentType: "image/jpeg",
    resumable: false,
    public: true,
    metadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" },
  });
  return gcsUrl(objectPath);
}

/**
 * Upload a recording's poster thumbnail to GCS as publicly readable.
 * Uses the shared object key so the delete path removes the same object.
 * Returns the full public GCS URL.
 */
export async function uploadRecordingThumbnail(
  localPath: string,
  streamId: string
): Promise<string> {
  const bucket = requireBucket();
  const objectPath = recordingThumbnailObjectPath(streamId);
  const file = bucket.file(objectPath);
  await file.save(createReadStream(localPath), {
    contentType: "image/jpeg",
    resumable: false,
    public: true,
    metadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" },
  });
  return gcsUrl(objectPath);
}

/**
 * Delete a recording's poster thumbnail from GCS (on stream deletion).
 * Missing objects are ignored.
 */
export async function deleteRecordingThumbnail(streamId: string): Promise<void> {
  const bucket = requireBucket();
  await bucket.file(recordingThumbnailObjectPath(streamId)).delete({ ignoreNotFound: true });
}

/**
 * Upload a transcript text file alongside a clip.
 * Returns the full public GCS URL.
 */
export async function uploadTranscript(
  transcript: string,
  streamId: string,
  clipId: string
): Promise<string> {
  const bucket = requireBucket();
  const objectPath = `clips/${streamId}/${clipId}/transcript.txt`;
  const file = bucket.file(objectPath);
  await file.save(Buffer.from(transcript, "utf-8"), {
    contentType: "text/plain",
    resumable: false,
    public: true,
    metadata: { contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=31536000" },
  });
  return gcsUrl(objectPath);
}

/**
 * Delete clip assets from GCS (on clip deletion).
 * Silently ignores missing files. Throws if any deletion fails with an error
 * other than "not found", so callers can log and handle storage failures.
 */
export async function deleteClipAssets(streamId: string, clipId: string): Promise<void> {
  const bucket = requireBucket();
  const paths = [
    `clips/${streamId}/${clipId}/video.mp4`,
    `clips/${streamId}/${clipId}/thumb.jpg`,
    `clips/${streamId}/${clipId}/transcript.txt`,
  ];

  const results = await Promise.allSettled(
    paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }))
  );

  const failures = results
    .map((r, i) => ({ result: r, path: paths[i]! }))
    .filter(({ result }) => result.status === "rejected") as Array<{
    result: PromiseRejectedResult;
    path: string;
  }>;

  if (failures.length > 0) {
    const details = failures
      .map(({ path, result }) => `${path}: ${String(result.reason)}`)
      .join("; ");
    throw new Error(`Failed to delete ${failures.length} clip asset(s) from storage: ${details}`);
  }
}

/**
 * Resolve a playable URL for a stored recording.
 *  - External HTTPS recordings (Agora external storage) are returned as-is.
 *  - App-storage object paths are signed into a short-lived GET URL via the sidecar.
 */
export async function getRecordingPlaybackUrl(
  recordingUrl: string,
  ttlSec = 3600
): Promise<string> {
  if (recordingUrl.startsWith("http://") || recordingUrl.startsWith("https://")) {
    return recordingUrl;
  }
  return sidecarSignedUrl(recordingUrl, "GET", ttlSec);
}

/**
 * Delete a recording object from app storage (on stream deletion).
 * External HTTPS recordings are not ours to delete, so they are skipped.
 * Missing objects are ignored.
 */
export async function deleteRecordingAsset(recordingUrl: string): Promise<void> {
  if (recordingUrl.startsWith("http://") || recordingUrl.startsWith("https://")) {
    return;
  }
  const bucket = requireBucket();
  await bucket.file(recordingUrl).delete({ ignoreNotFound: true });
}

const RECORDING_MAX_SIZE_BYTES = 2_000_000_000; // 2 GB
const RECORDING_ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
];

export class RecordingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingValidationError";
    Object.setPrototypeOf(this, RecordingValidationError.prototype);
  }
}

/**
 * Inspect the GCS object metadata for a recording after the client claims to
 * have uploaded it.  Rejects the recording if the object does not exist, is
 * empty, exceeds the size cap, or has a disallowed content-type.
 *
 * Must be called from the /recording/finalize route BEFORE registering
 * recordingUrl in the DB so we never persist a reference to an invalid upload.
 */
export async function validateRecordingObject(
  userId: string,
  streamId: string
): Promise<{ sizeBytes: number; contentType: string }> {
  const objectPath = getExpectedRecordingObjectPath(userId, streamId);
  const bucket = requireBucket();
  const file = bucket.file(objectPath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new RecordingValidationError(
      "Recording object not found in storage — the upload may have failed or not yet completed"
    );
  }

  const [metadata] = await file.getMetadata();
  const sizeBytes = Number(metadata["size"] ?? 0);
  const contentType = String(metadata["contentType"] ?? "");

  if (sizeBytes <= 0) {
    throw new RecordingValidationError("Uploaded object is empty");
  }
  if (sizeBytes > RECORDING_MAX_SIZE_BYTES) {
    throw new RecordingValidationError(
      `Uploaded object (${sizeBytes} bytes) exceeds the 2 GB size limit`
    );
  }
  const contentTypeBase = contentType.split(";")[0]!.trim();
  if (!RECORDING_ALLOWED_CONTENT_TYPES.includes(contentTypeBase)) {
    throw new RecordingValidationError(
      `Uploaded object has disallowed content-type '${contentType}'; ` +
        `expected one of: ${RECORDING_ALLOWED_CONTENT_TYPES.join(", ")}`
    );
  }

  return { sizeBytes, contentType };
}
