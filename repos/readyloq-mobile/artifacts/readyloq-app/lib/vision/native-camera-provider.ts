/**
 * VisionProvider adapter for the in-app phone camera (expo-camera).
 *
 * The CameraView itself stays owned by the capture screen (it is a UI
 * element); this provider wraps the *capture action* so the screen's photo
 * pipeline is provider-agnostic. The returned URI lives in the camera cache —
 * callers must persist it immediately (the OS can purge cache at any time).
 */

import type { CameraView } from "expo-camera";
import type { RefObject } from "react";

import type { EvidenceItem, VisionProvider } from "./types";

export function createNativeCameraProvider(
  cameraRef: RefObject<CameraView | null>,
): VisionProvider {
  return {
    id: "native-camera",
    source: "phone_camera",
    label: "Phone camera",
    capabilities: {
      mode: "request_response",
      transport: "on_device",
      hasLivePreview: true,
      producesVideo: false,
      requiresPairing: false,
    },
    capture: async (): Promise<EvidenceItem[]> => {
      const camera = cameraRef.current;
      if (!camera) throw new Error("Camera is not ready");
      const pic = await camera.takePictureAsync({ quality: 0.6 });
      if (!pic?.uri) return [];
      return [
        {
          uri: pic.uri,
          source: "phone_camera",
          capturedAt: new Date().toISOString(),
          width: pic.width,
          height: pic.height,
          metadata: { providerId: "native-camera" },
        },
      ];
    },
  };
}
