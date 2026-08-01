/**
 * BLE CO₂ / Air Quality provider — ReadyLoq CO₂ sensor hardware.
 *
 * ─── GATT Profile ────────────────────────────────────────────────────────────
 *
 *   Service:  RL_CO2_SERVICE_UUID  (ReadyLoq vendor GATT service)
 *   CO₂ ppm:  RL_CO2_CHAR_UUID    — uint16, raw value = CO₂ in ppm
 *   TVOC ppb: RL_TVOC_CHAR_UUID   — uint16, raw value = TVOC in ppb
 *
 *   Fallback: Aranet4 uses the same CO₂ service structure; sensor name
 *   "Aranet4" is included in the name filter for compatibility.
 *
 *   Elevated CO₂ (>1000 ppm) and TVOC (>300 ppb) can indicate mold, poor
 *   ventilation, or pest harborage conditions relevant to pest inspection.
 *
 * ─── MeasurementKind mapping ─────────────────────────────────────────────────
 *   kind: "co2"   unit: "ppm"
 *   Secondary TVOC in metadata.
 */

import type { HealthCheckResult } from "@platform/provider-registry";
import type {
  DeviceStatus,
  DevicePermissions,
  DeviceEvent,
  DeviceEventKind,
  DeviceEventListener,
  DeviceIdentity,
  DeviceCapabilities,
} from "@platform/device-core";
import type {
  MeasurementDeviceProvider,
  MeasurementDeviceCapabilities,
  MeasurementReading,
} from "@platform/measurement-core";

import {
  BleSensorAdapter,
  base64ToBytes,
  readUint16LE,
} from "../ble/ble-sensor-adapter";
import { getSensorBleManager } from "../ble/ble-sensor-manager";

// ─── GATT UUIDs ───────────────────────────────────────────────────────────────

const RL_CO2_SERVICE_UUID = "0000E001-0000-1000-8000-00805F9B34FB";
const RL_CO2_CHAR_UUID    = "0000E002-0000-1000-8000-00805F9B34FB";
const RL_TVOC_CHAR_UUID   = "0000E003-0000-1000-8000-00805F9B34FB";

const NAME_PATTERNS = ["ReadyLoq CO2", "RL-CO2", "Aranet4", "SCD", "MH-Z19", "CO2"];

function makeEmitter() {
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

export type BleCO2Provider = MeasurementDeviceProvider & {
  setPairedDevice(id: string, name: string): void;
  clearPairedDevice(): void;
  readonly pairedDeviceName: string | null;
};

export function createBleCO2Provider(): BleCO2Provider {
  const DEVICE_ID = "co2-ble";

  const adapter = new BleSensorAdapter(
    getSensorBleManager(),
    [RL_CO2_SERVICE_UUID],
    NAME_PATTERNS,
    DEVICE_ID,
  );
  const emitter = makeEmitter();

  const identity: DeviceIdentity = {
    manufacturer: "ReadyLoq",
    model: "CO₂ / Air Quality Sensor",
    hardwareVersion: "1.x",
    firmwareVersion: "unknown",
  };

  const capabilities: DeviceCapabilities = {
    categories: ["sensor", "diagnostic"],
    transports: ["ble"],
    hasLivePreview: false,
    producesMedia: false,
    requiresPairing: true,
    supportsStreaming: true,
    supportsOffline: false,
    tokens: ["sensor.co2", "sensor.air_quality"],
  };

  const measurementCapabilities: MeasurementDeviceCapabilities = {
    supportedKinds: ["co2"],
    nativeUnits: ["ppm"],
    rangeMin: 400,
    rangeMax: 5000,
    accuracy: 30,
    supportsStreaming: true,
    supportsSelfCalibration: true,
  };

  return {
    id: DEVICE_ID,
    name: "CO₂ / Air Quality Sensor",
    priority: 45,
    identity,
    capabilities,
    measurementCapabilities,

    get pairedDeviceName() { return adapter.pairedName; },
    setPairedDevice(id, name) { adapter.setPairedDevice(id, name); },
    clearPairedDevice() { adapter.clearPairedDevice(); },

    async initialize(): Promise<void> { await adapter.restorePersistedDevice(); },
    async teardown(): Promise<void> { adapter.destroy(); },

    async connect(): Promise<void> {
      if (!adapter.pairedId) throw new Error("No CO₂ sensor paired.");
      await adapter.connect(adapter.pairedId);
      emitter.emit({ kind: "device.connected", deviceId: DEVICE_ID, timestamp: new Date().toISOString() });
    },

    async disconnect(): Promise<void> {
      await adapter.disconnect();
      emitter.emit({ kind: "device.disconnected", deviceId: DEVICE_ID, timestamp: new Date().toISOString() });
    },

    async getStatus(): Promise<DeviceStatus> {
      const now = new Date().toISOString();
      return {
        operational: adapter.isConnected ? "idle" : "unavailable",
        connection: { state: adapter.isConnected ? "connected" : "disconnected", transport: "ble" },
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const now = new Date().toISOString();
      return adapter.isConnected
        ? { status: "healthy", message: "CO₂ sensor connected", checkedAt: now }
        : { status: "degraded", message: adapter.pairedId ? "Paired but not connected" : "No sensor paired", checkedAt: now };
    },

    getPermissions(): DevicePermissions {
      return {
        granted: false,
        required: ["android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN"],
        async request(): Promise<boolean> {
          const { requestBlePermissions } = await import("../ble");
          return (await requestBlePermissions()) === "granted";
        },
      };
    },

    async read(): Promise<MeasurementReading> {
      if (!adapter.isConnected) throw new Error("CO₂ sensor not connected.");

      const [co2Raw, tvocRaw] = await Promise.all([
        adapter.readCharacteristic(RL_CO2_SERVICE_UUID, RL_CO2_CHAR_UUID),
        adapter.readCharacteristic(RL_CO2_SERVICE_UUID, RL_TVOC_CHAR_UUID).catch(() => null),
      ]);

      const co2Ppm = readUint16LE(base64ToBytes(co2Raw));
      const tvocPpb = tvocRaw ? readUint16LE(base64ToBytes(tvocRaw)) : undefined;

      return {
        deviceId: DEVICE_ID,
        kind: "co2",
        value: co2Ppm,
        unit: "ppm",
        signalQuality: 1.0,
        capturedAt: new Date().toISOString(),
        ...(tvocPpb !== undefined ? { metadata: { tvoc_ppb: tvocPpb } } : {}),
      };
    },

    subscribe(listener: (r: MeasurementReading) => void, intervalMs = 10_000): () => void {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      const id = setInterval(async () => {
        if (!adapter.isConnected) return;
        try { listener(await self.read()); } catch { /* swallow */ }
      }, intervalMs);
      return () => clearInterval(id);
    },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}
