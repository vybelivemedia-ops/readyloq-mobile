/**
 * @platform/meta-wearables
 *
 * Wearable device provider stubs — smart glasses, BLE cameras, USB cameras,
 * WiFi cameras. Implements DeviceProvider as its device foundation.
 *
 * CANONICAL SOURCE:
 *   repos/readyloq-mobile/artifacts/readyloq-app/lib/vision/provider-registry.ts
 *     FUTURE_PROVIDER_DEFINITIONS — stubs for smart-glasses (async_push/BLE),
 *     usb-camera, wifi-camera, wearable-camera
 *
 * CURRENT STATUS:
 *   All providers in this package are STUBS — they appear in the ReadyLoq
 *   provider registry as "future" availability. None are connected to real
 *   hardware SDKs yet. The stubs exist to validate the provider interface and
 *   to let the UI list upcoming supported devices.
 *
 *   VYBE LIVE has no wearables code at all — it uses Agora for streaming
 *   which runs on the device camera. Meta wearables could eventually be used
 *   by VYBE creators to stream from a first-person perspective.
 *
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   WearableProvider now extends DeviceProvider directly, gaining the full
 *   device lifecycle: connect/disconnect, getStatus, checkHealth, getPermissions,
 *   on/emit, initialize/teardown. The hand-rolled connect/disconnect/isConnected
 *   fields are superseded by DeviceProvider's contract; isConnected is kept as
 *   a convenience getter. WearableRegistry extends DeviceDiscovery, mapping
 *   discover() to scan() semantics.
 *
 * INTEGRATION ROADMAP (from ReadyLoq roadmap comments):
 *   Phase Next:
 *     - Meta Ray-Ban smart glasses → react-native-ble-plx BLE notify stream
 *     - USB camera trigger (USB-OTG) → react-native-usb adapter
 *     - WiFi IP camera → WebSocket / RTSP bridge
 *   Phase Future:
 *     - Generic wearable camera (heart-rate + video, e.g. Polar Verity)
 *
 * DEPENDENCY GRAPH:
 *   meta-wearables → device-core → provider-registry → core
 *   meta-wearables → camera-core → shared-types
 */

import type { CaptureCapabilities, CaptureSource } from "@platform/shared-types";
import type { DeviceProvider, DeviceDiscovery } from "@platform/device-core";
import type { ProviderAvailability } from "@platform/camera-core";

// ─── Re-export device-core types consumed by wearable integrators ─────────────
export type {
  DeviceProvider,
  DeviceCapabilities,
  DeviceCategory,
  DeviceTransport,
  DeviceIdentity,
  DeviceStatus,
  DeviceConnectionState,
  DevicePermissions,
  DeviceEvent,
  DeviceEventKind,
  DeviceDiscovery,
} from "@platform/device-core";

// ─── Wearable provider base ───────────────────────────────────────────────────

/**
 * Extended metadata present on all wearable providers.
 */
export interface WearableProviderMeta {
  /** Human-readable hardware model name, e.g. "Meta Ray-Ban (2nd gen)". */
  hardwareModel: string;
  /** BLE / USB / WiFi identifier. */
  connectionAddress?: string;
  /** Firmware version, if discoverable. */
  firmwareVersion?: string;
  /** Battery level 0–100, if the hardware exposes it. */
  batteryLevel?: number;
}

/**
 * Wearable device provider.
 *
 * Extends DeviceProvider directly — the wearable IS a device and
 * DeviceProvider's connect/disconnect replaces the old hand-rolled versions.
 *
 * categories: ["wearable", "camera"] for smart glasses; ["wearable"] for
 * health-band wearables without a camera.
 *
 * isConnected is a convenience getter derived from:
 *   getStatus().connection.state === "connected"
 * It is retained for backward compat with existing callers.
 */
export interface WearableProvider extends DeviceProvider {
  readonly meta: WearableProviderMeta;
  /**
   * Convenience accessor — true when connection.state === "connected".
   * Prefer getStatus() for full connection detail.
   */
  readonly isConnected: boolean;
  /** Camera-specific capture capabilities, if the wearable has a camera. */
  readonly captureCapabilities?: CaptureCapabilities;
  /** Capture source identifier for camera-bearing wearables. */
  readonly source?: CaptureSource;
}

// ─── Wearable registry ────────────────────────────────────────────────────────

/**
 * Registry for wearable devices.
 *
 * Extends DeviceDiscovery — WearableRegistry.discover() maps semantically to
 * DeviceDiscovery.scan() over BLE/USB/WiFi transports. The discover() method
 * is preserved as the domain-specific entry point; implementations delegate
 * to scan() internally.
 */
export interface WearableRegistry extends DeviceDiscovery {
  /**
   * Scan for nearby wearable devices (BLE scan, USB enumeration, mDNS).
   * Returns discovered devices that have NOT yet been registered.
   * Internally delegates to DeviceDiscovery.scan() over supported transports.
   */
  discover(timeoutMs?: number): Promise<WearableProvider[]>;
  register(provider: WearableProvider): void;
  unregister(providerId: string): void;
  listRegistered(): WearableProvider[];
}

// ─── Smart Glasses (Meta Ray-Ban) — async_push / BLE ────────────────────────

/**
 * STUB — not yet connected to real hardware.
 *
 * Target SDK: react-native-ble-plx
 * Transport:  BLE notify characteristic → JPEG frame chunks reassembled on RN
 * Mode:       async_push — glasses trigger a photo on hardware button press;
 *             the phone receives the frame via BLE notification.
 *
 * Canonical: future-source-providers.ts "smart-glasses" entry
 *
 * DeviceCapabilities: categories: ["wearable", "camera"], transports: ["ble"]
 */
export const SMART_GLASSES_CAPABILITIES: CaptureCapabilities = {
  mode: "async_push",
  transport: "ble",
  hasLivePreview: false,
  producesVideo: true,
  requiresPairing: true,
};

export const SMART_GLASSES_SOURCE: CaptureSource = "smart_glasses";

// Concrete class to be implemented during extraction:
// export class SmartGlassesProvider implements WearableProvider { … }

// ─── USB Camera — session_stream ─────────────────────────────────────────────

/**
 * STUB — not yet connected to real hardware.
 *
 * Target SDK: react-native-usb (USB-OTG on Android)
 * Transport:  USB bulk transfer
 * Mode:       session_stream (MJPEG live feed; grab stills on demand)
 *
 * Canonical: future-source-providers.ts "usb-camera" entry
 *
 * DeviceCapabilities: categories: ["camera"], transports: ["usb"]
 */
export const USB_CAMERA_CAPABILITIES: CaptureCapabilities = {
  mode: "session_stream",
  transport: "usb",
  hasLivePreview: true,
  producesVideo: true,
  requiresPairing: false,
};

export const USB_CAMERA_SOURCE: CaptureSource = "usb_camera";

// ─── WiFi IP Camera — session_stream ─────────────────────────────────────────

/**
 * STUB — not yet connected to real hardware.
 *
 * Target SDK: WebSocket / RTSP bridge or vendor SDK
 * Transport:  WiFi (local network)
 * Mode:       session_stream (MJPEG or H.264 over WebSocket)
 *
 * Canonical: future-source-providers.ts "wifi-camera" entry (source: "wifi_stream")
 *
 * DeviceCapabilities: categories: ["camera"], transports: ["wifi"]
 */
export const WIFI_CAMERA_CAPABILITIES: CaptureCapabilities = {
  mode: "session_stream",
  transport: "wifi",
  hasLivePreview: true,
  producesVideo: true,
  requiresPairing: false,
};

export const WIFI_CAMERA_SOURCE: CaptureSource = "wifi_stream";

// ─── Wearable Camera (generic health-band camera) ────────────────────────────

/**
 * STUB — Phase Future.
 *
 * Target: Polar Verity / Garmin VIRB or similar device.
 * Transport: BLE (primary — async_push; frames push in as recorded).
 *
 * Canonical: future-source-providers.ts "wearable-camera" entry
 *
 * DeviceCapabilities: categories: ["wearable", "camera"], transports: ["ble"]
 */
export const WEARABLE_CAMERA_CAPABILITIES: CaptureCapabilities = {
  mode: "async_push",
  transport: "ble",
  hasLivePreview: false,
  producesVideo: true,
  requiresPairing: true,
};

export const WEARABLE_CAMERA_SOURCE: CaptureSource = "wearable_camera";

// ─── Future provider definitions map ────────────────────────────────────────

/**
 * Registry of all planned wearable providers with their availability status.
 * Mirrors FUTURE_PROVIDER_DEFINITIONS from readyloq-mobile — the UI uses this
 * to render "Coming soon" entries in the device picker.
 *
 * `availability` here is a display label ("future") — distinct from the runtime
 * `ProviderAvailability` object ({ available: false, reason: string }) used in
 * the camera provider's probe() call.
 */
export const FUTURE_WEARABLE_PROVIDERS: Array<{
  id: string;
  label: string;
  source: CaptureSource;
  capabilities: CaptureCapabilities;
  /** Runtime probe result — always unavailable for future stubs. */
  availability: ProviderAvailability;
  estimatedRelease?: string;
}> = [
  {
    id: "smart-glasses",
    label: "Smart Glasses (Meta Ray-Ban)",
    source: "smart_glasses",
    capabilities: SMART_GLASSES_CAPABILITIES,
    availability: { available: false, reason: "Hardware support is planned — no driver yet." },
    estimatedRelease: "Q3 2025",
  },
  {
    id: "usb-camera",
    label: "USB Camera",
    source: "usb_camera",
    capabilities: USB_CAMERA_CAPABILITIES,
    availability: { available: false, reason: "Hardware support is planned — no driver yet." },
    estimatedRelease: "Q4 2025",
  },
  {
    id: "wifi-camera",
    label: "WiFi IP Camera",
    source: "wifi_stream",
    capabilities: WIFI_CAMERA_CAPABILITIES,
    availability: { available: false, reason: "Hardware support is planned — no driver yet." },
    estimatedRelease: "Q4 2025",
  },
  {
    id: "wearable-camera",
    label: "Wearable Camera",
    source: "wearable_camera",
    capabilities: WEARABLE_CAMERA_CAPABILITIES,
    availability: { available: false, reason: "Hardware support is planned — no driver yet." },
    estimatedRelease: "2026",
  },
];
