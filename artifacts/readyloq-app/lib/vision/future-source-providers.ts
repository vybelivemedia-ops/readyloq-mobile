/**
 * Reserved capture sources for future hardware tiers.
 *
 * These are metadata-only definitions: they declare the interaction model and
 * transport so the registry (and any source picker) knows what SHAPE each device
 * is, but they carry no driver yet. `probe()` reports them unavailable and
 * `create()` throws — so the app never attempts to use hardware that isn't wired.
 *
 * To add real support later: implement the matching provider
 * (`SessionCaptureProvider` for USB/Wi-Fi, `PushCaptureProvider` for glasses/
 * wearables) behind a dev-client native module, then replace this definition's
 * `probe` (real availability check) and `create` (return the live provider).
 * No change is needed anywhere downstream of `EvidenceItem`.
 */

import type { CaptureProviderDefinition } from "./provider-registry";
import {
  configureWifiCamera,
  probeWifiCamera,
  createWifiCameraProvider,
  getWifiCameraConfig,
} from "./wifi-camera-provider";

const COMING_SOON =
  "Hardware support is planned — this build has no driver for it yet.";

function notImplemented(sourceName: string): never {
  throw new Error(`${sourceName} capture is not available in this build yet.`);
}

export const FUTURE_PROVIDER_DEFINITIONS: CaptureProviderDefinition[] = [
  {
    id: "smart-glasses",
    source: "smart_glasses",
    name: "Meta Ray-Ban glasses",
    description: "Hands-free capture; frames arrive over the companion app / BLE.",
    capabilities: {
      mode: "async_push",
      transport: "ble",
      hasLivePreview: false,
      producesVideo: true,
      requiresPairing: true,
    },
    previewKind: "none",
    probe: async () => ({ available: false, reason: COMING_SOON }),
    create: () => notImplemented("Smart glasses"),
  },
  {
    id: "usb-camera",
    source: "usb_camera",
    name: "USB scope",
    description: "UVC borescope / endoscope over USB-OTG. Live feed, grab stills on demand.",
    capabilities: {
      mode: "session_stream",
      transport: "usb",
      hasLivePreview: true,
      producesVideo: true,
      requiresPairing: false,
    },
    previewKind: "stream_url",
    probe: async () => ({ available: false, reason: COMING_SOON }),
    create: () => notImplemented("USB camera"),
  },
  {
    id: "wifi-camera",
    source: "wifi_stream",
    name: "Wi-Fi camera",
    description: "Action / drone camera (GoPro, IP cam) over Wi-Fi. Tap to configure and capture stills.",
    capabilities: {
      mode: "request_response",
      transport: "wifi",
      hasLivePreview: false,
      producesVideo: false,
      requiresPairing: false,
    },
    previewKind: "none",
    probe: async (_ctx) => {
      const cfg = getWifiCameraConfig();
      if (!cfg) return { available: false, reason: "No Wi-Fi camera configured. Tap to set up." };
      return probeWifiCamera();
    },
    create: () => {
      const cfg = getWifiCameraConfig();
      if (!cfg) throw new Error("Configure a Wi-Fi camera URL before capturing.");
      return createWifiCameraProvider() as ReturnType<typeof createWifiCameraProvider>;
    },
  },
  {
    id: "wearable-camera",
    source: "wearable_camera",
    name: "Wearable camera",
    description: "Body-cam / other wearables; frames push in as they're recorded.",
    capabilities: {
      mode: "async_push",
      transport: "ble",
      hasLivePreview: false,
      producesVideo: true,
      requiresPairing: true,
    },
    previewKind: "none",
    probe: async () => ({ available: false, reason: COMING_SOON }),
    create: () => notImplemented("Wearable camera"),
  },
];
