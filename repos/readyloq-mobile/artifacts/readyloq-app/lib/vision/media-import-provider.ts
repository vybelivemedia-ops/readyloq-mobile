/**
 * VisionProvider adapter for importing existing footage from the device
 * library — the Tier 1 path for GoPro, smart-glasses, drone, and borescope
 * evidence: shoot on the specialty device, let it sync to the camera roll
 * (Quik / Meta View / vendor app), then pull the shots into the inspection.
 *
 * Multi-select is enabled so a technician can ingest a whole crawlspace pass
 * in one gesture. Cancelling resolves to an empty array (not an error).
 */

import * as ImagePicker from "expo-image-picker";

import type { EvidenceItem, VisionProvider } from "./types";

const MAX_IMPORT_BATCH = 12;

export function createMediaImportProvider(): VisionProvider {
  return {
    id: "media-import",
    source: "media_import",
    label: "Import from device",
    capabilities: {
      mode: "request_response",
      transport: "on_device_library",
      hasLivePreview: false,
      producesVideo: false,
      requiresPairing: false,
    },
    capture: async (): Promise<EvidenceItem[]> => {
      // On iOS 14+/Android photo-picker this shows a scoped picker with no
      // permission prompt; older platforms may still ask.
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(
          "Photo library access is needed to import evidence. You can enable it in Settings.",
        );
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMPORT_BATCH,
        quality: 1,
        exif: true,
      });
      if (result.canceled) return [];
      const importedAt = new Date().toISOString();
      return result.assets.map((asset): EvidenceItem => {
        // EXIF DateTimeOriginal preserves when the footage was actually shot
        // on the external device (vs. when it was imported).
        const exif = asset.exif ?? undefined;
        const shotAt =
          typeof exif?.DateTimeOriginal === "string" ? exif.DateTimeOriginal : undefined;
        return {
          uri: asset.uri,
          source: "media_import",
          capturedAt: importedAt,
          width: asset.width || undefined,
          height: asset.height || undefined,
          fileSize: asset.fileSize ?? undefined,
          metadata: {
            providerId: "media-import",
            originalFilename: asset.fileName ?? undefined,
            shotAt,
            deviceMake: typeof exif?.Make === "string" ? exif.Make : undefined,
            deviceModel: typeof exif?.Model === "string" ? exif.Model : undefined,
          },
        };
      });
    },
  };
}
