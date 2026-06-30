/**
 * Upload a branding asset (logo / app icon) to object storage and return the
 * app-relative URL that can be stored on a branding profile.
 *
 * Mirrors the inspection-media upload flow: request a presigned URL, PUT the
 * bytes directly, then persist `/api/storage<objectPath>`.
 */
import { reportClientError } from "@/lib/report-client-error";

export async function uploadBrandAsset(blob: Blob, filename: string): Promise<string> {
  const contentType = blob.type || "image/png";

  const urlRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: filename, size: blob.size, contentType }),
  });
  if (!urlRes.ok) {
    reportClientError("upload", `Branding upload URL request failed (${urlRes.status})`, {
      context: { stage: "request-url", contentType },
    });
    throw new Error("Failed to request upload URL");
  }

  const { uploadURL, objectPath } = (await urlRes.json()) as {
    uploadURL: string;
    objectPath: string;
  };

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!putRes.ok) {
    reportClientError("upload", `Branding object PUT failed (${putRes.status})`, {
      context: { stage: "put", contentType },
    });
    throw new Error("Failed to upload file");
  }

  return `/api/storage${objectPath}`;
}
