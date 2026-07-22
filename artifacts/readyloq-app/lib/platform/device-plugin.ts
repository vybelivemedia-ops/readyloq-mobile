/**
 * DevicePlugin — registers all ReadyLoq camera providers with the DeviceRegistry
 * on platform startup.
 *
 * Implements the PlatformPlugin contract from @platform/platform-intelligence
 * (satisfied structurally — no import needed to avoid a circular dep edge).
 *
 * On initialize() it:
 *   1. Creates the three built-in camera providers (NativeCamera, MediaImport,
 *      WifiCamera if configured) with full DeviceProvider lifecycle.
 *   2. Adapts their CaptureCapabilities → DeviceCapabilities so they satisfy
 *      the DeviceProvider interface required by DeviceRegistry.
 *   3. Registers each adapted provider with the internal DeviceRegistry.
 *
 * Consumers that need device access call `devicePlugin.registry` to query
 * registered devices, subscribe to health events, or get the primary camera.
 *
 * WifiCamera is registered lazily via `registerWifiCamera()` after the user
 * has configured a baseUrl, because the registry entry is built from the
 * current _config snapshot at creation time.
 */

import type { RefObject } from "react";
import type { CameraView } from "expo-camera";

import type { DeviceProvider, DeviceCapabilities, DeviceRegistry } from "@platform/device-core";
import { createDeviceRegistry } from "@platform/device-core";

import type { CaptureCapabilities } from "@platform/camera-core";
import type { CaptureTransport } from "@platform/shared-types";

import {
  createNativeCameraProvider,
  type NativeCameraProvider,
} from "../vision/native-camera-provider";
import {
  createMediaImportProvider,
  type MediaImportProvider,
} from "../vision/media-import-provider";
import {
  createWifiCameraProvider,
  configureWifiCamera,
  type WifiCameraProvider,
} from "../vision/wifi-camera-provider";

// ─── Transport mapping ────────────────────────────────────────────────────────

const TRANSPORT_MAP: Record<CaptureTransport, DeviceCapabilities["transports"][number]> = {
  on_device: "internal",
  on_device_library: "internal",
  wifi: "wifi",
  usb: "usb",
  ble: "ble",
  cloud: "wifi",
};

// ─── Adapter: CaptureDeviceProvider → DeviceProvider ─────────────────────────

/**
 * Wraps a fully-lifecycle-capable camera provider so it satisfies the
 * DeviceProvider interface expected by the DeviceRegistry.
 *
 * The key difference: DeviceProvider.capabilities is DeviceCapabilities while
 * camera providers carry CaptureCapabilities. We derive DeviceCapabilities
 * from the CaptureCapabilities and fix the categories to ["camera"].
 */
function toCameraDeviceProvider(
  provider: NativeCameraProvider | MediaImportProvider | WifiCameraProvider,
): DeviceProvider {
  const cap = provider.capabilities as CaptureCapabilities;
  const deviceCapabilities: DeviceCapabilities = {
    categories: ["camera"],
    transports: [TRANSPORT_MAP[cap.transport] ?? "internal"],
    hasLivePreview: cap.hasLivePreview,
    producesMedia: true,
    requiresPairing: cap.requiresPairing,
    supportsStreaming: cap.mode !== "request_response",
    supportsOffline:
      cap.transport === "on_device" || cap.transport === "on_device_library",
    tokens: ["capture.photo"],
  };

  return {
    id: provider.id,
    name: provider.name,
    priority: provider.priority,
    identity: provider.identity,
    capabilities: deviceCapabilities,
    connect: provider.connect.bind(provider),
    disconnect: provider.disconnect.bind(provider),
    getStatus: provider.getStatus.bind(provider),
    checkHealth: provider.checkHealth.bind(provider),
    getPermissions: provider.getPermissions.bind(provider),
    on: provider.on.bind(provider),
    emit: provider.emit.bind(provider),
    initialize: provider.initialize.bind(provider),
    teardown: provider.teardown.bind(provider),
  };
}

// ─── DevicePlugin ─────────────────────────────────────────────────────────────

/**
 * Satisfies the PlatformPlugin shape from @platform/platform-intelligence.
 * id, name, capabilities, initialize(), teardown() — all required members
 * are present; TypeScript structural typing makes this usable as PlatformPlugin
 * without importing the interface (which would create a new dep edge).
 */
export class DevicePlugin {
  readonly id = "device";
  readonly name = "Device Registry";
  readonly capabilities = [
    "capture.photo",
    "capture.media_import",
    "device.camera",
  ];

  /** The central registry — query this for health, events, and provider lookup. */
  readonly registry: DeviceRegistry = createDeviceRegistry();

  constructor(
    private readonly cameraRef: RefObject<CameraView | null>,
  ) {}

  async initialize(_context?: unknown): Promise<void> {
    const native = createNativeCameraProvider(this.cameraRef);
    const mediaImport = createMediaImportProvider();

    await native.initialize();
    await mediaImport.initialize();

    this.registry.register(toCameraDeviceProvider(native));
    this.registry.register(toCameraDeviceProvider(mediaImport));
  }

  async teardown(): Promise<void> {
    const providers = this.registry.list();
    await Promise.all(providers.map((p) => p.teardown?.()));
  }

  /**
   * Configure and register the Wi-Fi camera provider.
   *
   * Call this after the user has supplied a baseUrl. The provider is
   * re-created from the current config snapshot and (re-)registered under the
   * same id "wifi-camera", replacing any previous entry.
   */
  registerWifiCamera(config: { baseUrl: string; label?: string; capturePath?: string }): void {
    configureWifiCamera(config);
    const wifiCamera = createWifiCameraProvider();
    const deviceProvider = toCameraDeviceProvider(wifiCamera);
    if (this.registry.has("wifi-camera")) {
      this.registry.unregister("wifi-camera");
    }
    this.registry.register(deviceProvider);
  }
}
