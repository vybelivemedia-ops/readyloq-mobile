/**
 * DevicePlugin — registers all ReadyLoq hardware providers with the
 * DeviceRegistry on platform startup.
 *
 * Implements the PlatformPlugin contract from @platform/platform-intelligence
 * (satisfied structurally — no import needed to avoid a circular dep edge).
 *
 * On initialize() it:
 *   1. Creates the built-in camera providers (NativeCamera, MediaImport) and
 *      mock measurement device providers (moisture meter, laser distance meter).
 *   2. Adapts camera CaptureCapabilities → DeviceCapabilities so they satisfy
 *      the DeviceProvider interface required by DeviceRegistry.
 *   3. Registers each provider with the internal DeviceRegistry.
 *
 * Consumers that need device access call `devicePlugin.registry` to query
 * registered devices, subscribe to health events, or get the primary device
 * for a category.
 *
 * WifiCamera is registered lazily via `registerWifiCamera()` after the user
 * has configured a baseUrl, because the registry entry is built from the
 * current _config snapshot at creation time.
 *
 * Measurement devices are registered at startup as mock providers. In
 * production, real BLE providers will be registered the same way — the
 * registry and UI layer are already wired and require no further changes.
 */

import type { RefObject } from "react";
import type { CameraView } from "expo-camera";

import type { DeviceProvider, DeviceCapabilities, DeviceRegistry } from "@platform/device-core";
import { createDeviceRegistry } from "@platform/device-core";

import type { CaptureCapabilities } from "@platform/camera-core";
import type { CaptureTransport } from "@platform/shared-types";
import type { MeasurementDeviceProvider } from "@platform/measurement-core";

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
import {
  createMockMoistureMeterProvider,
  createMockLaserDistanceMeterProvider,
} from "../measurement";

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
    "device.sensor",
    "sensor.moisture",
    "sensor.distance",
  ];

  /** The central registry — query this for health, events, and provider lookup. */
  readonly registry: DeviceRegistry = createDeviceRegistry();

  /**
   * Live references to measurement providers, retained so callers can
   * call provider.read() after retrieving them via getMeasurementDevice().
   * The registry stores DeviceProvider; this map gives back the richer type.
   */
  private readonly _measurementProviders = new Map<string, MeasurementDeviceProvider>();

  constructor(
    private readonly cameraRef: RefObject<CameraView | null>,
  ) {}

  async initialize(_context?: unknown): Promise<void> {
    // ── Camera providers ───────────────────────────────────────────────────
    const native = createNativeCameraProvider(this.cameraRef);
    const mediaImport = createMediaImportProvider();

    await native.initialize();
    await mediaImport.initialize();

    this.registry.register(toCameraDeviceProvider(native));
    this.registry.register(toCameraDeviceProvider(mediaImport));

    // ── Measurement providers ──────────────────────────────────────────────
    const moistureMeter = createMockMoistureMeterProvider();
    const laserMeter = createMockLaserDistanceMeterProvider();

    await moistureMeter.initialize();
    await laserMeter.initialize();

    this.registry.register(moistureMeter as unknown as DeviceProvider);
    this.registry.register(laserMeter as unknown as DeviceProvider);

    this._measurementProviders.set(moistureMeter.id, moistureMeter);
    this._measurementProviders.set(laserMeter.id, laserMeter);
  }

  async teardown(): Promise<void> {
    const providers = this.registry.list();
    await Promise.all(providers.map((p) => p.teardown?.()));
    this._measurementProviders.clear();
  }

  /**
   * Retrieve a registered MeasurementDeviceProvider by its id so callers
   * can invoke provider.read() and provider.subscribe().
   *
   * Returns undefined if the id is not a known measurement device.
   */
  getMeasurementDevice(id: string): MeasurementDeviceProvider | undefined {
    return this._measurementProviders.get(id);
  }

  /**
   * All registered MeasurementDeviceProvider instances, in registration order.
   * Safe to call before initialize() — returns an empty array.
   */
  getMeasurementDevices(): MeasurementDeviceProvider[] {
    return Array.from(this._measurementProviders.values());
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
