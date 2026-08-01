/**
 * BLE Laser Distance Meter provider — Bosch GLM 50-27 CG (and compatible).
 *
 * ─── GATT Profile ────────────────────────────────────────────────────────────
 *
 *   Uses Nordic UART Service (NUS) — the same protocol used by the Bosch GLM
 *   over BLE. Request-response: phone writes a measure trigger, device replies
 *   with the distance reading.
 *
 *   Service:   NUS_SERVICE_UUID  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
 *   TX (read): NUS_TX_UUID       "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
 *   RX (write):NUS_RX_UUID       "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
 *
 *   Command:   write 0x51 0x00 0x01 to RX (GLM measure trigger)
 *   Response:  4-byte little-endian float on TX (distance in metres)
 *
 * ─── MeasurementKind mapping ─────────────────────────────────────────────────
 *   kind: "distance"
 *   unit: "m"
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
  bytesToBase64,
  readFloat32LE,
} from "../ble/ble-sensor-adapter";
import { getSensorBleManager } from "../ble/ble-sensor-manager";

// ─── GATT UUIDs (Nordic UART Service) ────────────────────────────────────────

const NUS_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const NUS_TX_UUID      = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; // notify (phone reads)
const NUS_RX_UUID      = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; // write (phone sends)

/** GLM measure trigger: 0x51 0x00 0x01 */
const MEASURE_CMD = bytesToBase64(new Uint8Array([0x51, 0x00, 0x01]));

const NAME_PATTERNS = ["GLM", "Bosch", "Laser", "ReadyLoq Laser"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

export type BleLaserDistanceProvider = MeasurementDeviceProvider & {
  setPairedDevice(id: string, name: string): void;
  clearPairedDevice(): void;
  readonly pairedDeviceName: string | null;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createBleLaserDistanceProvider(): BleLaserDistanceProvider {
  const DEVICE_ID = "laser-distance-ble";

  const adapter = new BleSensorAdapter(
    getSensorBleManager(),
    [NUS_SERVICE_UUID],
    NAME_PATTERNS,
    DEVICE_ID,
  );
  const emitter = makeEmitter();

  const identity: DeviceIdentity = {
    manufacturer: "Bosch",
    model: "GLM 50-27 CG",
    hardwareVersion: "1.x",
    firmwareVersion: "unknown",
  };

  const capabilities: DeviceCapabilities = {
    categories: ["sensor", "diagnostic"],
    transports: ["ble"],
    hasLivePreview: false,
    producesMedia: false,
    requiresPairing: true,
    supportsStreaming: false, // Request-response only
    supportsOffline: false,
    tokens: ["sensor.distance"],
  };

  const measurementCapabilities: MeasurementDeviceCapabilities = {
    supportedKinds: ["distance"],
    nativeUnits: ["m"],
    rangeMin: 0.05,
    rangeMax: 50,
    accuracy: 0.001,
    supportsStreaming: false,
    supportsSelfCalibration: false,
  };

  /** Request one measurement via NUS and return the float response. */
  async function requestMeasurement(): Promise<number> {
    // Subscribe for TX notification BEFORE sending the command
    return new Promise<number>((resolve, reject) => {
      let unsub: (() => void) | null = null;
      const timeout = setTimeout(() => {
        unsub?.();
        reject(new Error("Laser measurement timed out (5 s)"));
      }, 5000);

      try {
        unsub = adapter.subscribeCharacteristic(NUS_SERVICE_UUID, NUS_TX_UUID, (b64) => {
          clearTimeout(timeout);
          unsub?.();
          const bytes = base64ToBytes(b64);
          if (bytes.length < 4) { reject(new Error("Short response from laser")); return; }
          resolve(Math.round(readFloat32LE(bytes) * 1000) / 1000); // 3 decimal places, metres
        }, (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }

      adapter.writeCharacteristic(NUS_SERVICE_UUID, NUS_RX_UUID, MEASURE_CMD).catch((err) => {
        clearTimeout(timeout);
        unsub?.();
        reject(err);
      });
    });
  }

  return {
    id: DEVICE_ID,
    name: "Bosch GLM Laser Distance",
    priority: 55,
    identity,
    capabilities,
    measurementCapabilities,

    get pairedDeviceName() { return adapter.pairedName; },
    setPairedDevice(id, name) { adapter.setPairedDevice(id, name); },
    clearPairedDevice() { adapter.clearPairedDevice(); },

    async initialize(): Promise<void> { await adapter.restorePersistedDevice(); },

    async teardown(): Promise<void> { adapter.destroy(); },

    async connect(): Promise<void> {
      if (!adapter.pairedId) {
        throw new Error("No laser meter paired. Scan in the Connections tab.");
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
          state: adapter.isConnected ? "connected" : "disconnected",
          transport: "ble",
          connectedAt: adapter.isConnected ? now : undefined,
        },
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const now = new Date().toISOString();
      return adapter.isConnected
        ? { status: "healthy", message: "Laser distance meter connected", checkedAt: now }
        : { status: "degraded", message: adapter.pairedId ? "Device paired but not connected" : "No device paired", checkedAt: now };
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
      if (!adapter.isConnected) throw new Error("Laser meter not connected.");
      const metres = await requestMeasurement();
      return {
        deviceId: DEVICE_ID,
        kind: "distance",
        value: metres,
        unit: "m",
        signalQuality: 1.0,
        capturedAt: new Date().toISOString(),
      };
    },

    subscribe(listener: (r: MeasurementReading) => void, intervalMs = 3000): () => void {
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
