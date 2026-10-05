/**
 * VisionProvider adapter for the in-app phone camera (expo-camera).
 *
 * The CameraView itself stays owned by the capture screen (it is a UI
 * element); this provider wraps the *capture action* so the screen's photo
 * pipeline is provider-agnostic. The returned URI lives in the camera cache —
 * callers must persist it immediately (the OS can purge cache at any time).
 *
 * DEVICE-CORE LIFECYCLE (Phase 29):
 *   All optional CaptureDeviceProvider lifecycle methods are now implemented so
 *   this provider can be registered in the DeviceRegistry and participate in
 *   health monitoring and event streaming. Actual capture still relies on the
 *   injected cameraRef (set by the mounted CameraView).
 */

import * as Crypto from "expo-crypto";
import { Camera } from "expo-camera";
import type { CameraView } from "expo-camera";
import type { RefObject } from "react";

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

// ─── Minimal event emitter used by all camera providers ─────────────────────

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

// ─── Extended provider type (all optional lifecycle members are required) ────

export type NativeCameraProvider = RequestCaptureProvider & {
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

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createNativeCameraProvider(
  cameraRef: RefObject<CameraView | null>,
): NativeCameraProvider {
  const emitter = makeDeviceEmitter();

  return {
    id: "native-camera",
    source: "phone_camera",
    label: "Phone camera",
    name: "Phone camera",
    priority: 100,
    identity: {
      manufacturer: "Phone",
      model: "Native Camera",
    },
    capabilities: {
      mode: "request_response",
      transport: "on_device",
      hasLivePreview: true,
      producesVideo: false,
      requiresPairing: false,
    },

    async initialize(): Promise<void> {
      // Internal camera needs no OS-level setup
    },

    async teardown(): Promise<void> {
      // Nothing to release for the internal camera
    },

    async connect(): Promise<void> {
      // Internal camera is always connected to the host
    },

    async disconnect(): Promise<void> {
      // No-op: disconnecting an internal camera is meaningless
    },

    async getStatus(): Promise<DeviceStatus> {
      const permission = await Camera.getCameraPermissionsAsync();
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
      const permission = await Camera.getCameraPermissionsAsync();
      return {
        status: permission.granted ? "healthy" : "degraded",
        message: permission.granted
          ? "Camera permission granted"
          : "Camera permission not yet granted",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    },

    getPermissions(): DevicePermissions {
      return {
        granted: false, // sync snapshot — use checkHealth() for the async truth
        required: [
          "NSCameraUsageDescription",
          "android.permission.CAMERA",
        ],
        async request(): Promise<boolean> {
          const result = await Camera.requestCameraPermissionsAsync();
          return result.granted;
        },
      };
    },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),

    capture: async (): Promise<EvidenceItem[]> => {
      const camera = cameraRef.current;
      if (!camera) throw new Error("Camera is not ready");
      // skipProcessing: true — return the camera hardware's own JPEG directly,
      // bypassing the software post-capture compression pass that causes 3–8 s
      // of shutter lag on full-resolution sensors.  The hardware encoder
      // produces equivalent quality at native speed (~150–300 ms).  The quality
      // parameter has no effect when skipProcessing is true so it is omitted.
      const pic = await camera.takePictureAsync({ skipProcessing: true, exif: true });
      if (!pic?.uri) return [];
      return [
        {
          id: Crypto.randomUUID(),
          uri: pic.uri,
          source: "phone_camera",
          capturedAt: new Date().toISOString(),
          width: pic.width,
          height: pic.height,
          metadata: {
            providerId: "native-camera",
            // Preserve focal/pixel calibration when the source JPEG's EXIF is
            // stripped at intake. Never copy the full EXIF object (it can
            // include GPS coordinates).
            FocalLenIn35mmFilm:
              typeof pic.exif?.FocalLenIn35mmFilm === "number"
                ? pic.exif.FocalLenIn35mmFilm
                : undefined,
            PixelXDimension:
              typeof pic.exif?.PixelXDimension === "number"
                ? pic.exif.PixelXDimension
                : undefined,
            PixelYDimension:
              typeof pic.exif?.PixelYDimension === "number"
                ? pic.exif.PixelYDimension
                : undefined,
          },
        },
      ];
    },
  };
}
