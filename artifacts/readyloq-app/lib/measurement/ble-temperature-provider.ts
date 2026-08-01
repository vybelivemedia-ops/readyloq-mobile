/**
 * BLE Temperature / Humidity provider — Bluetooth SIG Environmental Sensing.
 *
 * ─── GATT Profile ────────────────────────────────────────────────────────────
 *
 *   Service:     0x181A  Environmental Sensing Service (standard BT SIG)
 *   Temperature: 0x2A6E  — sint16, value × 0.01 = °C
 *   Humidity:    0x2A6F  — uint16, value × 0.01 = %RH
 *
 *   Compatible with: Govee H5075, Inkbird IBS-TH2, SensorTag, Aranet,
 *   most generic ESS sensors, and ReadyLoq's own temp/humidity probe.
 *
 * ─── MeasurementKind mapping ─────────────────────────────────────────────────
 *   Primary read: temperature (°C), secondary: humidity (%)
 *   Both are returned in a single MeasurementReading via metadata.
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
  readInt16LE,
  readUint16LE,
} from "../ble/ble-sensor-adapter";
import { getSensorBleManager } from "../ble/ble-sensor-manager";

// ─── GATT UUIDs ───────────────────────────────────────────────────────────────

const ESS_SERVICE_UUID     = "0000181A-0000-1000-8000-00805F9B34FB";
const ESS_TEMP_CHAR_UUID   = "00002A6E-0000-1000-8000-00805F9B34FB";
const ESS_HUMID_CHAR_UUID  = "00002A6F-0000-1000-8000-00805F9B34FB";

const NAME_PATTERNS = [
  "Govee", "Inkbird", "SensorTag", "Aranet",
  "ReadyLoq Temp", "RL-Temp", "SHT", "BME",
];

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

export type BleTemperatureProvider = MeasurementDeviceProvider & {
  setPairedDevice(id: string, name: string): void;
  clearPairedDevice(): void;
  readonly pairedDeviceName: string | null;
};

export function createBleTemperatureProvider(): BleTemperatureProvider {
  const DEVICE_ID = "temperature-ble";

  const adapter = new BleSensorAdapter(
    getSensorBleManager(),
    [ESS_SERVICE_UUID],
    NAME_PATTERNS,
    DEVICE_ID,
  );
  const emitter = makeEmitter();

  const identity: DeviceIdentity = {
    manufacturer: "ReadyLoq",
    model: "Temp / Humidity Probe",
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
    tokens: ["sensor.temperature", "sensor.humidity"],
  };

  const measurementCapabilities: MeasurementDeviceCapabilities = {
    supportedKinds: ["temperature"],
    nativeUnits: ["c"],
    rangeMin: -40,
    rangeMax: 85,
    accuracy: 0.1,
    supportsStreaming: true,
    supportsSelfCalibration: false,
  };

  return {
    id: DEVICE_ID,
    name: "Temp / Humidity Sensor",
    priority: 50,
    identity,
    capabilities,
    measurementCapabilities,

    get pairedDeviceName() { return adapter.pairedName; },
    setPairedDevice(id, name) { adapter.setPairedDevice(id, name); },
    clearPairedDevice() { adapter.clearPairedDevice(); },

    async initialize(): Promise<void> { await adapter.restorePersistedDevice(); },

    async teardown(): Promise<void> { adapter.destroy(); },

    async connect(): Promise<void> {
      if (!adapter.pairedId) throw new Error("No temp sensor paired. Scan in Connections tab.");
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
        ? { status: "healthy", message: "Temperature sensor connected", checkedAt: now }
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
      if (!adapter.isConnected) throw new Error("Temperature sensor not connected.");

      const [tempRaw, humidRaw] = await Promise.all([
        adapter.readCharacteristic(ESS_SERVICE_UUID, ESS_TEMP_CHAR_UUID),
        adapter.readCharacteristic(ESS_SERVICE_UUID, ESS_HUMID_CHAR_UUID).catch(() => null),
      ]);

      const tempBytes = base64ToBytes(tempRaw);
      const tempC = Math.round(readInt16LE(tempBytes) * 0.01 * 10) / 10; // sint16 × 0.01 = °C

      let humidPct: number | undefined;
      if (humidRaw) {
        const humidBytes = base64ToBytes(humidRaw);
        humidPct = Math.round(readUint16LE(humidBytes) * 0.01 * 10) / 10; // uint16 × 0.01 = %RH
      }

      return {
        deviceId: DEVICE_ID,
        kind: "temperature",
        value: tempC,
        unit: "c",
        signalQuality: 1.0,
        capturedAt: new Date().toISOString(),
        // Secondary reading stored in metadata for UI display
        ...(humidPct !== undefined ? { metadata: { humidity_pct: humidPct } } : {}),
      };
    },

    subscribe(listener: (r: MeasurementReading) => void, intervalMs = 5000): () => void {
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
