import * as ImagePicker from "expo-image-picker";
import { requestUploadUrl } from "@workspace/api-client-react";

export type PickedMedia = {
  uri: string;
  kind: "image" | "video";
  name: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

function guessContentType(uri: string, kind: "image" | "video", mimeType?: string): string {
  if (mimeType) return mimeType;
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "video") {
    if (ext === "mov") return "video/quicktime";
    return "video/mp4";
  }
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

/** Opens the OS media library and returns the picked asset, or null if cancelled. */
export async function pickMedia(): Promise<PickedMedia | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Media library permission is required to attach photos or videos.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    quality: 0.8,
    videoMaxDuration: 120,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  const kind: "image" | "video" = asset.type === "video" ? "video" : "image";
  const contentType = guessContentType(asset.uri, kind, asset.mimeType ?? undefined);
  const name = asset.fileName ?? `upload.${contentType.split("/")[1] ?? "bin"}`;

  return {
    uri: asset.uri,
    kind,
    name,
    contentType,
    size: asset.fileSize ?? 0,
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(asset.duration != null ? { durationSeconds: Math.round(asset.duration / 1000) } : {}),
  };
}

/**
 * Requests a signed upload URL from the API, PUTs the local file to it, and
 * returns the server-issued private object path (`/objects/<id>`).
 */
export async function uploadPickedMedia(media: PickedMedia): Promise<string> {
  const fileResp = await fetch(media.uri);
  const blob = await fileResp.blob();
  const size = media.size > 0 ? media.size : blob.size;

  const { uploadURL, objectPath } = await requestUploadUrl({
    name: media.name,
    size,
    contentType: media.contentType,
  });

  const put = await fetch(uploadURL, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": media.contentType },
  });

  if (!put.ok) {
    throw new Error(`Upload failed (${put.status})`);
  }

  return objectPath;
}
