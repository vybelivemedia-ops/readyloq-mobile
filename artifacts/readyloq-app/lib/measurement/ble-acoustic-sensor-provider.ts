/**
 * BLE Acoustic / Vibration Sensor provider — termite & pest activity detection.
 *
 * ─── GATT Profile ────────────────────────────────────────────────────────────
 *
 *   Service:    RL_ACOUSTIC_SERVICE_UUID  (ReadyLoq vendor GATT service)
 *   Amplitude:  RL_AMPLITUDE_CHAR_UUID   — uint16, 0–1000 (peak vibration)
 *   Frequency:  RL_FREQ_CHAR_UUID        — uint16, Hz (dominant frequency)
 *   Activity:   RL_ACTIVITY_CHAR_UUID    — uint8, activity classification
 *                 0 = none  1 = low  2 = moderate  3 = high  4 = alarm
 *
 *   The sensor is placed against structural elements (wood, drywall). Termite
 *   feeding produces acoustic signals in the 1–20 kHz range with characteristic
 *   amplitude patterns. The activity byte is the hardware-classified result.
 *
 * ─── MeasurementKind mapping ─────────────────────────────────────────────────
 *   kind: "acoustic"   unit: "level"   (0–1000 amplitude)
 *   Frequency and activity classification in metadata.
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

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  BleSensorAdapter,
  base64ToBytes,
  readUint16LE,
} from "../ble/ble-sensor-adapter";
import { getSensorBleManager } from "../ble/ble-sensor-manager";

// ─── GATT UUIDs ───────────────────────────────────────────────────────────────

const RL_ACOUSTIC_SERVICE_UUID = "0000F001-0000-1000-8000-00805F9B34FB";
const RL_AMPLITUDE_CHAR_UUID   = "0000F002-0000-1000-8000-00805F9B34FB";
const RL_FREQ_CHAR_UUID        = "0000F003-0000-1000-8000-00805F9B34FB";
const RL_ACTIVITY_CHAR_UUID    = "0000F004-0000-1000-8000-00805F9B34FB";

const ACTIVITY_LABELS: Record<number, string> = {
  0: "none", 1: "low", 2: "moderate", 3: "high", 4: "alarm",
};

const NAME_PATTERNS = ["ReadyLoq Acoustic", "RL-Acoustic", "RL-Vibration"];

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

export type BleAcousticSensorProvider = MeasurementDeviceProvider & {
  setPairedDevice(id: string, name: string): void;
  clearPairedDevice(): void;
  readonly pairedDeviceName: string | null;
  /** Bait station slot this sensor is assigned to (#89). null = unassigned. */
  readonly stationSlot: string | null;
  setStationSlot(slotId: string | null): void;
};

const SLOT_STORAGE_KEY = "@readyloq:sensor:acoustic-sensor-ble:slot";

export function createBleAcousticSensorProvider(): BleAcousticSensorProvider {
  const DEVICE_ID = "acoustic-sensor-ble";

  const adapter = new BleSensorAdapter(
    getSensorBleManager(),
    [RL_ACOUSTIC_SERVICE_UUID],
    NAME_PATTERNS,
    DEVICE_ID,
  );
  const emitter = makeEmitter();

  // ── #89 station slot state ─────────────────────────────────────────────────
  let _stationSlot: string | null = null;

  const identity: DeviceIdentity = {
    manufacturer: "ReadyLoq",
    model: "Acoustic Activity Sensor",
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
    tokens: ["sensor.acoustic", "sensor.vibration"],
  };

  const measurementCapabilities: MeasurementDeviceCapabilities = {
    supportedKinds: ["acoustic"],
    nativeUnits: ["level"],
    rangeMin: 0,
    rangeMax: 1000,
    accuracy: 5,
    supportsStreaming: true,
    supportsSelfCalibration: false,
  };

  return {
    id: DEVICE_ID,
    name: "Acoustic Activity Sensor",
    priority: 40,
    identity,
    capabilities,
    measurementCapabilities,

    get pairedDeviceName() { return adapter.pairedName; },
    setPairedDevice(id, name) { adapter.setPairedDevice(id, name); },
    clearPairedDevice() { adapter.clearPairedDevice(); },

    get stationSlot() { return _stationSlot; },
    setStationSlot(slotId: string | null) {
      _stationSlot = slotId;
      if (slotId) {
        void AsyncStorage.setItem(SLOT_STORAGE_KEY, slotId);
      } else {
        void AsyncStorage.removeItem(SLOT_STORAGE_KEY);
      }
    },

    async initialize(): Promise<void> {
      // Restore paired device (#91)
      await adapter.restorePersistedDevice();
      // Restore station slot assignment (#89)
      try {
        const saved = await AsyncStorage.getItem(SLOT_STORAGE_KEY);
        if (saved) _stationSlot = saved;
      } catch { /* ignore */ }
    },
    async teardown(): Promise<void> { adapter.destroy(); },

    async connect(): Promise<void> {
      if (!adapter.pairedId) throw new Error("No acoustic sensor paired.");
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
        ? { status: "healthy", message: "Acoustic sensor connected", checkedAt: now }
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
      if (!adapter.isConnected) throw new Error("Acoustic sensor not connected.");

      const [ampRaw, freqRaw, actRaw] = await Promise.all([
        adapter.readCharacteristic(RL_ACOUSTIC_SERVICE_UUID, RL_AMPLITUDE_CHAR_UUID),
        adapter.readCharacteristic(RL_ACOUSTIC_SERVICE_UUID, RL_FREQ_CHAR_UUID).catch(() => null),
        adapter.readCharacteristic(RL_ACOUSTIC_SERVICE_UUID, RL_ACTIVITY_CHAR_UUID).catch(() => null),
      ]);

      const amplitude = readUint16LE(base64ToBytes(ampRaw));
      const freqHz = freqRaw ? readUint16LE(base64ToBytes(freqRaw)) : undefined;
      const actCode = actRaw ? base64ToBytes(actRaw)[0] : undefined;
      const actLabel = actCode !== undefined ? (ACTIVITY_LABELS[actCode] ?? "unknown") : undefined;

      return {
        deviceId: DEVICE_ID,
        kind: "acoustic",
        value: amplitude,
        unit: "level",
        signalQuality: 1.0,
        capturedAt: new Date().toISOString(),
        metadata: {
          ...(freqHz !== undefined ? { frequency_hz: freqHz } : {}),
          ...(actLabel !== undefined ? { activity: actLabel } : {}),
        },
      };
    },

    subscribe(listener: (r: MeasurementReading) => void, intervalMs = 1000): () => void {
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
