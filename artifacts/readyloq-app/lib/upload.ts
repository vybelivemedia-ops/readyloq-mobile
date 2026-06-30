import * as FileSystem from "expo-file-system/legacy";

import { ApiError, requestUploadUrl } from "./api";

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
  let size: number | undefined;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === "number") size = info.size;
  } catch {
    // size is optional; continue without it
  }

  const { uploadURL, objectPath } = await requestUploadUrl(token, {
    name: filename,
    size,
    contentType,
  });

  const result = await FileSystem.uploadAsync(uploadURL, uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(`Evidence upload failed (${result.status}).`, result.status);
  }

  return `/api/storage${objectPath}`;
}
