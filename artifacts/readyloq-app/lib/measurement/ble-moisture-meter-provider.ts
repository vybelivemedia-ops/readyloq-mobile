/**
 * BLE Moisture Meter provider — Protimeter Surveymaster (and compatible sensors).
 *
 * ─── GATT Profile ────────────────────────────────────────────────────────────
 *
 *   Service:    PROTIMETER_SERVICE_UUID  (Protimeter vendor GATT service)
 *   WME char:   MOISTURE_WME_CHAR_UUID   — uint16, value / 10 = %WME
 *                (Wood Moisture Equivalent: 0–100 %; alarm at ~20 %)
 *   Depth char: MOISTURE_DEPTH_CHAR_UUID — uint16, value = mm (0–300 mm)
 *
 *   Fallback: if the vendor service is not found, falls back to reading
 *   the standard ESS Humidity characteristic (0x2A6F) scaled as %WME.
 *
 * ─── Connection flow ─────────────────────────────────────────────────────────
 *   1. DeviceScannerModal scans for devices matching namePatterns.
 *   2. User selects a device → UI calls provider.setPairedDevice(id, name).
 *   3. UI calls provider.connect() — adapter opens GATT, discovers services.
 *   4. During inspection, MeasurementDevicePanel calls provider.read().
 *
 * ─── MeasurementKind mapping ─────────────────────────────────────────────────
 *   kind: "thickness"  — used as proxy for moisture level
 *   unit: "mm"         — values represent %WME × 10 encoded as mm for compat
 *                        with existing MeasurementReading schema
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

const PROTIMETER_SERVICE_UUID    = "59462F12-9543-9999-12C8-58B459A2712D";
const MOISTURE_WME_CHAR_UUID     = "5C3A659E-897E-45E1-B016-007107C96DF6";
const MOISTURE_DEPTH_CHAR_UUID   = "5C3A659E-897E-45E1-B016-007107C96DF7";

// Standard ESS fallback
const ESS_SERVICE_UUID           = "0000181A-0000-1000-8000-00805F9B34FB";
const ESS_HUMIDITY_CHAR_UUID     = "00002A6F-0000-1000-8000-00805F9B34FB";

const NAME_PATTERNS = ["Protimeter", "PTM", "Surveymaster", "ReadyLoq Moisture"];

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

export type BleMoistureMeterProvider = MeasurementDeviceProvider & {
  /** Set the BLE device to connect to (called by DeviceScannerModal flow). */
  setPairedDevice(id: string, name: string): void;
  /** Clear pairing so the device can be re-scanned. */
  clearPairedDevice(): void;
  /** Display name of the currently paired device, or null. */
  readonly pairedDeviceName: string | null;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createBleMoistureMeterProvider(): BleMoistureMeterProvider {
  const DEVICE_ID = "protimeter-ble";

  const adapter = new BleSensorAdapter(
    getSensorBleManager(),
    [PROTIMETER_SERVICE_UUID, ESS_SERVICE_UUID],
    NAME_PATTERNS,
    DEVICE_ID, // storageKey — persists paired device across sessions (#91)
  );
  const emitter = makeEmitter();

  const identity: DeviceIdentity = {
    manufacturer: "Protimeter",
    model: "Surveymaster BLE",
    hardwareVersion: "2.x",
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
    tokens: ["sensor.moisture"],
  };

  const measurementCapabilities: MeasurementDeviceCapabilities = {
    supportedKinds: ["thickness"],
    nativeUnits: ["mm"],
    rangeMin: 0,
    rangeMax: 100,
    accuracy: 0.5,
    supportsStreaming: true,
    supportsSelfCalibration: false,
  };

  return {
    id: DEVICE_ID,
    name: "Protimeter Surveymaster",
    priority: 60,
    identity,
    capabilities,
    measurementCapabilities,

    get pairedDeviceName() { return adapter.pairedName; },

    setPairedDevice(id: string, name: string) {
      adapter.setPairedDevice(id, name);
    },

    clearPairedDevice() {
      adapter.clearPairedDevice();
    },

    async initialize(): Promise<void> {
      // Restore the previously paired device ID from AsyncStorage (#91).
      await adapter.restorePersistedDevice();
    },

    async teardown(): Promise<void> {
      adapter.destroy();
    },

    async connect(): Promise<void> {
      if (!adapter.pairedId) {
        throw new Error("No device paired. Scan for a moisture meter in the Connections tab.");
      }
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
        connection: {
          state: adapter.isConnected ? "connected" : (adapter.pairedId ? "disconnected" : "disconnected"),
          transport: "ble",
          connectedAt: adapter.isConnected ? now : undefined,
        },
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const now = new Date().toISOString();
      if (adapter.isConnected) {
        return { status: "healthy", message: "Moisture meter connected via BLE", checkedAt: now };
      }
      return {
        status: "degraded",
        message: adapter.pairedId
          ? `${adapter.pairedName ?? "Device"} paired but not connected`
          : "No moisture meter paired",
        checkedAt: now,
      };
    },

    getPermissions(): DevicePermissions {
      return {
        granted: false,
        required: [
          "android.permission.BLUETOOTH_CONNECT",
          "android.permission.BLUETOOTH_SCAN",
        ],
        async request(): Promise<boolean> {
          const { requestBlePermissions } = await import("../ble");
          const status = await requestBlePermissions();
          return status === "granted";
        },
      };
    },

    async read(): Promise<MeasurementReading> {
      if (!adapter.isConnected) {
        throw new Error("Moisture meter not connected. Connect it in the Connections tab.");
      }

      // Try vendor service first, fall back to ESS
      let wme: number;
      try {
        const raw = await adapter.readCharacteristic(PROTIMETER_SERVICE_UUID, MOISTURE_WME_CHAR_UUID);
        const bytes = base64ToBytes(raw);
        wme = readUint16LE(bytes) / 10; // uint16 / 10 = %WME
      } catch {
        const raw = await adapter.readCharacteristic(ESS_SERVICE_UUID, ESS_HUMIDITY_CHAR_UUID);
        const bytes = base64ToBytes(raw);
        wme = readUint16LE(bytes) / 100; // ESS: uint16 / 100 = %RH (used as WME proxy)
      }

      return {
        deviceId: DEVICE_ID,
        kind: "thickness",
        value: Math.round(wme * 10) / 10,
        unit: "mm",
        signalQuality: 1.0,
        capturedAt: new Date().toISOString(),
      };
    },

    subscribe(listener: (r: MeasurementReading) => void, intervalMs = 2000): () => void {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      const id = setInterval(async () => {
        if (!adapter.isConnected) return;
        try { listener(await self.read()); } catch { /* swallow in streaming */ }
      }, intervalMs);
      return () => clearInterval(id);
    },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}
