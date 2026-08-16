import * as FileSystem from "expo-file-system/legacy";

import { API_BASE, ApiError, requestUploadUrl } from "./api";

/**
 * Upload a captured photo (local file URI from expo-camera) to permanent
 * object storage and return its canonical `/api/storage/...` path.
 *
 * Mirrors the web app's uploadToStorage(): request a signed PUT URL, upload
 * the raw bytes, then return the durable storage path. Throws loudly on any
 * failure — we never let an inspection "complete" with evidence that can't be
 * AI-analyzed or re-loaded later.
 */
export async function uploadPhoto(
  token: string | null,
  uri: string,
  filename: string,
  contentType = "image/jpeg",
): Promise<string> {
  const { uploadURL, storagePath } = await reserveUploadPath(token, filename, uri, contentType);
  await doUpload(uploadURL, uri, contentType);
  return storagePath;
}

/**
 * Step 1 of a two-step upload: request a presigned PUT URL and the
 * canonical `/api/storage/...` path for the object.
 *
 * **Persist `storagePath` as `photo.pendingStoragePath` before calling
 * `doUpload`.** This durable marker means a crash between this call and
 * `doUpload` (or between `doUpload` and the `storagePath` promotion) can be
 * detected on the next launch: `pendingStoragePath` set + `storagePath` null
 * → the engine probes the object URL and either reuses or re-uploads.
 */
export async function reserveUploadPath(
  token: string | null,
  filename: string,
  /** Local file URI — used only to read file size (optional, informational). */
  localUri?: string,
  contentType = "image/jpeg",
): Promise<{ uploadURL: string; storagePath: string }> {
  let size: number | undefined;
  if (localUri) {
    try {
      const info = await FileSystem.getInfoAsync(localUri);
      if (info.exists && typeof info.size === "number") size = info.size;
    } catch {
      // size is optional; continue without it
    }
  }

  const { uploadURL, objectPath } = await requestUploadUrl(token, {
    name: filename,
    size,
    contentType,
  });

  return { uploadURL, storagePath: `/api/storage${objectPath}` };
}

/**
 * Step 2 of a two-step upload: PUT the local file bytes to the presigned URL
 * returned by `reserveUploadPath`. Throws `ApiError` on any non-2xx response.
 */
export async function doUpload(
  uploadURL: string,
  localUri: string,
  contentType = "image/jpeg",
): Promise<void> {
  const result = await FileSystem.uploadAsync(uploadURL, localUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
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
