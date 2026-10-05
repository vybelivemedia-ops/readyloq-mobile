/**
 * VisionProvider adapter for importing existing footage from the device
 * library — the Tier 1 path for GoPro, smart-glasses, drone, and borescope
 * evidence: shoot on the specialty device, let it sync to the camera roll
 * (Quik / Meta View / vendor app), then pull the shots into the inspection.
 *
 * Multi-select is enabled so a technician can ingest a whole crawlspace pass
 * in one gesture. Cancelling resolves to an empty array (not an error).
 *
 * DEVICE-CORE LIFECYCLE (Phase 29):
 *   All optional CaptureDeviceProvider lifecycle methods are now implemented so
 *   this provider can be registered in the DeviceRegistry and participate in
 *   health monitoring and event streaming.
 */

import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";

import type { HealthCheckResult } from "@platform/provider-registry";
import type {
  DeviceStatus,
  DevicePermissions,
  DeviceEvent,
  DeviceEventKind,
  DeviceEventListener,
  DeviceIdentity,
} from "@platform/device-core";
import type { EvidenceItem, RequestCaptureProvider } from "./types";

// ─── Minimal event emitter ───────────────────────────────────────────────────

function makeDeviceEmitter() {
  const listeners = new Map<DeviceEventKind, Set<DeviceEventListener>>();
  return {
    on(kind: DeviceEventKind, listener: DeviceEventListener): () => void {
      if (!listeners.has(kind)) listeners.set(kind, new Set());
      listeners.get(kind)!.add(listener);
      return () => listeners.get(kind)?.delete(listener);
    },
    emit(event: DeviceEvent): void {
      listeners.get(event.kind)?.forEach((l) => l(event));
    },
  };
}

// ─── Extended provider type ──────────────────────────────────────────────────

export type MediaImportProvider = RequestCaptureProvider & {
  readonly name: string;
  readonly priority: number;
  readonly identity: DeviceIdentity;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<DeviceStatus>;
  checkHealth(): Promise<HealthCheckResult>;
  getPermissions(): DevicePermissions;
  on(kind: DeviceEventKind, listener: DeviceEventListener): () => void;
  emit(event: DeviceEvent): void;
  initialize(): Promise<void>;
  teardown(): Promise<void>;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_IMPORT_BATCH = 12;

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createMediaImportProvider(): MediaImportProvider {
  const emitter = makeDeviceEmitter();

  return {
    id: "media-import",
    source: "media_import",
    label: "Import from device",
    name: "Import from device",
    priority: 50,
    identity: {
      manufacturer: "Device",
      model: "Media Library",
    },
    capabilities: {
      mode: "request_response",
      transport: "on_device_library",
      hasLivePreview: false,
      producesVideo: false,
      requiresPairing: false,
    },

    async initialize(): Promise<void> {
      // Media library access needs no OS-level setup beyond permission prompts
    },

    async teardown(): Promise<void> {
      // Nothing to release for the media library
    },

    async connect(): Promise<void> {
      // The device library is always reachable (internal)
    },

    async disconnect(): Promise<void> {
      // No-op: the media library has no connection to close
    },

    async getStatus(): Promise<DeviceStatus> {
      const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      const now = new Date().toISOString();
      return {
        operational: permission.granted ? "idle" : "unavailable",
        connection: {
          state: "connected",
          transport: "internal",
          connectedAt: now,
        },
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const start = Date.now();
      const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      return {
        status: permission.granted ? "healthy" : "degraded",
        message: permission.granted
          ? "Photo library access granted"
          : "Photo library permission not yet granted",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    },

    getPermissions(): DevicePermissions {
      return {
        granted: false, // sync snapshot — use checkHealth() for the async truth
        required: [
          "NSPhotoLibraryUsageDescription",
          "android.permission.READ_EXTERNAL_STORAGE",
          "android.permission.READ_MEDIA_IMAGES",
        ],
        async request(): Promise<boolean> {
          const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
          return result.granted;
        },
      };
    },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),

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
          id: Crypto.randomUUID(),
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
            // Retain the non-location EXIF calibration fields needed for
            // measurement after the JPEG's embedded metadata is removed.
            FocalLenIn35mmFilm:
              typeof exif?.FocalLenIn35mmFilm === "number" ? exif.FocalLenIn35mmFilm : undefined,
            PixelXDimension:
              typeof exif?.PixelXDimension === "number" ? exif.PixelXDimension : undefined,
            PixelYDimension:
              typeof exif?.PixelYDimension === "number" ? exif.PixelYDimension : undefined,
          },
        };
      });
    },
  };
}
