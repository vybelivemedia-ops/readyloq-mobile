/**
 * DevicePlugin — registers all ReadyLoq hardware providers with the
 * DeviceRegistry on platform startup.
 *
 * Implements the PlatformPlugin contract from @platform/platform-intelligence
 * (satisfied structurally — no import needed to avoid a circular dep edge).
 *
 * On initialize() it:
 *   1. Creates built-in camera providers (NativeCamera, MediaImport).
 *   2. Creates the 5 real BLE sensor providers (moisture, laser, temperature,
 *      CO₂, acoustic) — they start in disconnected state and connect on demand
 *      via the Connections tab or DeviceScannerModal.
 *   3. Adapts camera CaptureCapabilities → DeviceCapabilities.
 *   4. Registers each provider with the internal DeviceRegistry.
 *
 * BLE sensor providers expose setPairedDevice(id, name) in addition to the
 * standard MeasurementDeviceProvider interface. Retrieve the full-typed
 * provider via getBleSensorProvider(id) to call those methods from the
 * Connections tab.
 *
 * WifiCamera is registered lazily via registerWifiCamera() after the user
 * has configured a baseUrl.
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
  getWifiCameraConfig,
  restoreWifiCameraConfig,
  type WifiCameraProvider,
} from "../vision/wifi-camera-provider";
import {
  createBleMoistureMeterProvider,
  type BleMoistureMeterProvider,
  createBleLaserDistanceProvider,
  type BleLaserDistanceProvider,
  createBleTemperatureProvider,
  type BleTemperatureProvider,
  createBleCO2Provider,
  type BleCO2Provider,
  createBleAcousticSensorProvider,
  type BleAcousticSensorProvider,
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

// ─── BLE sensor union type ────────────────────────────────────────────────────

/** Union of all BLE sensor providers that expose setPairedDevice / clearPairedDevice. */
export type BleSensorProvider =
  | BleMoistureMeterProvider
  | BleLaserDistanceProvider
  | BleTemperatureProvider
  | BleCO2Provider
  | BleAcousticSensorProvider;

// ─── DevicePlugin ─────────────────────────────────────────────────────────────

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
    "sensor.temperature",
    "sensor.co2",
    "sensor.acoustic",
  ];

  readonly registry: DeviceRegistry = createDeviceRegistry();

  private readonly _measurementProviders = new Map<string, MeasurementDeviceProvider>();
  /** Full-typed BLE sensor providers for setPairedDevice / clearPairedDevice access. */
  private readonly _bleSensorProviders = new Map<string, BleSensorProvider>();

  constructor(
    private readonly cameraRef: RefObject<CameraView | null>,
  ) {}

  async initialize(_context?: unknown): Promise<void> {
    // ── Restore persisted Wi-Fi camera config (#107) ───────────────────────
    // Must run before providers are registered so the camera is available
    // from the first render of the Connections tab or inspection workspace.
    await restoreWifiCameraConfig();
    const savedWifiConfig = getWifiCameraConfig();
    if (savedWifiConfig) {
      this.registerWifiCamera(savedWifiConfig);
    }

    // ── Camera providers ───────────────────────────────────────────────────
    const native = createNativeCameraProvider(this.cameraRef);
    const mediaImport = createMediaImportProvider();

    await native.initialize();
    await mediaImport.initialize();

    this.registry.register(toCameraDeviceProvider(native));
    this.registry.register(toCameraDeviceProvider(mediaImport));

    // ── BLE sensor providers ───────────────────────────────────────────────
    // All start disconnected; the user pairs them via the Connections tab.
    const sensors: BleSensorProvider[] = [
      createBleMoistureMeterProvider(),
      createBleLaserDistanceProvider(),
      createBleTemperatureProvider(),
      createBleCO2Provider(),
      createBleAcousticSensorProvider(),
    ];

    for (const sensor of sensors) {
      await sensor.initialize();
      this.registry.register(sensor as unknown as DeviceProvider);
      this._measurementProviders.set(sensor.id, sensor);
      this._bleSensorProviders.set(sensor.id, sensor);
    }
  }

  async teardown(): Promise<void> {
    const providers = this.registry.list();
    await Promise.all(providers.map((p) => p.teardown?.()));
    this._measurementProviders.clear();
    this._bleSensorProviders.clear();
  }

  getMeasurementDevice(id: string): MeasurementDeviceProvider | undefined {
    return this._measurementProviders.get(id);
  }

  getMeasurementDevices(): MeasurementDeviceProvider[] {
    return Array.from(this._measurementProviders.values());
  }

  /**
   * Returns the full-typed BLE sensor provider by id so the Connections tab
   * can call setPairedDevice / clearPairedDevice before connect().
   */
  getBleSensorProvider(id: string): BleSensorProvider | undefined {
    return this._bleSensorProviders.get(id);
  }

  /** All BLE sensor providers in registration order. */
  getBleSensorProviders(): BleSensorProvider[] {
    return Array.from(this._bleSensorProviders.values());
  }

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
