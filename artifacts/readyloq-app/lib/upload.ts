import * as FileSystem from "expo-file-system/legacy";

import { API_BASE, ApiError, requestUploadUrl } from "./api";
import { createSanitizedPhotoCopy } from "./privacy/image-sanitizer";

/**
 * Upload a captured photo (local file URI from expo-camera) to permanent
 * object storage and return its canonical path plus owner-bound reservation ID.
 *
 * Mirrors the web app's uploadToStorage(): request a durable reservation, send
 * raw bytes through the authenticated create-only upload endpoint, then return
 * the durable storage path. Throws loudly on any
 * failure — we never let an inspection "complete" with evidence that can't be
 * AI-analyzed or re-loaded later.
 */
export async function uploadPhoto(
  token: string | null,
  inspectionId: number,
  uploadKey: string,
  uri: string,
  filename: string,
  contentType = "image/jpeg",
  checksum?: { algorithm: "md5"; value: string },
): Promise<{ storagePath: string; uploadIntentId: number }> {
  const sanitizedUri = await createSanitizedPhotoCopy(uri);
  try {
    const reservation = await reserveUploadPath(
      token,
      inspectionId,
      uploadKey,
      filename,
      sanitizedUri,
      contentType,
      "image",
      checksum,
    );
    const { uploadURL, storagePath } = reservation;
    if (!reservation.uploadIntentId) throw new Error("Photo upload did not receive an upload intent");
    await doUpload(
      uploadURL,
      sanitizedUri,
      contentType,
      reservation.expectedSize,
      reservation.checksum,
      token,
    );
    return { storagePath, uploadIntentId: reservation.uploadIntentId };
  } finally {
    await FileSystem.deleteAsync(sanitizedUri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Step 1 of a two-step upload: reserve the object path and authenticated
 * server-mediated PUT endpoint.
 *
 * **Persist `storagePath` and `uploadIntentId` before calling `doUpload`.**
 * This durable marker means a crash between this call and
 * `doUpload` (or between `doUpload` and the `storagePath` promotion) can be
 * detected on the next launch: `pendingStoragePath` set + `storagePath` null
 * → the engine probes the object URL and either reuses or re-uploads.
 */
export async function reserveUploadPath(
  token: string | null,
  inspectionId: number,
  clientKey: string,
  filename: string,
  /** Local file URI — required to persist the expected byte length. */
  localUri: string,
  contentType = "image/jpeg",
  mediaType: "photo" | "image" | "video" | "document" | "audio" | "voice" = "image",
  checksum?: { algorithm: "md5"; value: string },
): Promise<{
  uploadURL: string;
  storagePath: string;
  uploadIntentId: number;
  expectedSize: number;
  checksum?: { algorithm: "md5"; value: string };
}> {
  let size: number | undefined;
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists && typeof info.size === "number") size = info.size;
  } catch (error) {
    throw new Error(`Unable to inspect upload file size: ${String(error)}`);
  }
  if (size === undefined || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Unable to reserve upload: expected file size is unavailable");
  }

  const normalizedContentType = contentType.split(";")[0].trim().toLowerCase();
  const { uploadURL, objectPath, uploadIntentId } = await requestUploadUrl(token, {
    name: filename,
    size,
    contentType: normalizedContentType,
    purpose: "inspection-evidence",
    inspectionId,
    mediaType,
    clientKey,
    ...(checksum ? { checksum } : {}),
  });
  if (!uploadIntentId) throw new Error("Upload service did not return a durable reservation");

  return {
    uploadURL: uploadURL.startsWith("http") ? uploadURL : `${API_BASE}${uploadURL}`,
    storagePath: `/api/storage${objectPath}`,
    uploadIntentId,
    expectedSize: size,
    ...(checksum ? { checksum } : {}),
  };
}

/**
 * Step 2 of a two-step upload: PUT local bytes to the authenticated, create-only
 * endpoint returned by `reserveUploadPath`.
 */
export async function doUpload(
  uploadURL: string,
  localUri: string,
  contentType = "image/jpeg",
  expectedSize?: number,
  checksum?: { algorithm: "md5"; value: string },
  token?: string | null,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": contentType.split(";")[0].trim().toLowerCase(),
    "x-goog-if-generation-match": "0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (expectedSize !== undefined) headers["Content-Length"] = String(expectedSize);
  if (checksum) headers["Content-MD5"] = checksum.value;
  const result = await FileSystem.uploadAsync(uploadURL, localUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers,
  });

  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(`Evidence upload failed (${result.status}).`, result.status);
  }
}

/**
 * Check whether an object already exists at the given `/api/storage/...` path
 * without downloading it. Used during crash-recovery: if `pendingStoragePath`
 * is set but `storagePath` is null, the engine calls this before deciding
 * whether to reuse the already-uploaded object or start a fresh upload.
 *
 * Returns `true` if the server responds 2xx, `false` on 404 or any error.
 * On unexpected server errors we conservatively return `false` so the caller
 * re-uploads — duplicating the object in storage is wasteful but safe,
 * whereas skipping a missing object would leave the inspection without
 * evidence.
 */
export async function probeStoragePath(
  storagePath: string,
  token: string | null,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${storagePath}`, {
      method: "HEAD",
      headers,
    });
    return res.ok;
  } catch {
    return false;
  }
}
