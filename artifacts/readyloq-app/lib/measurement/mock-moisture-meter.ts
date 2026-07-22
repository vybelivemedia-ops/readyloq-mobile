/**
 * Mock Protimeter Surveymaster moisture meter provider.
 *
 * Simulates a Protimeter Surveymaster — a professional moisture meter used
 * by pest control and property inspection technicians to detect damp areas
 * in walls, flooring, and structural elements.
 *
 * In production this would be replaced by a real BLE adapter that reads
 * characteristic values from the Protimeter's GATT service. This mock
 * generates realistic readings for development and demo purposes.
 *
 * MeasurementKind mapping:
 *   kind: "thickness"  — used as a proxy for moisture content depth/level.
 *   unit: "mm"         — values 8–45 represent %WME (wood moisture equivalent)
 *                        in the mock; real hardware would emit a dedicated unit.
 *
 * DeviceCapabilities:
 *   categories:  ["sensor", "diagnostic"]
 *   transports:  ["ble"]  (simulated — connects instantly)
 *   tokens:      ["sensor.moisture"]
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

/** Simulate a realistic moisture reading (8–45 %WME, reported as mm). */
function simulateMoistureReading(): number {
  const base = 12 + Math.random() * 8;
  const spike = Math.random() < 0.15 ? Math.random() * 25 : 0;
  return Math.round((base + spike) * 10) / 10;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type MockMoistureMeterProvider = MeasurementDeviceProvider;

export function createMockMoistureMeterProvider(): MockMoistureMeterProvider {
  const emitter = makeEmitter();
  let _connected = false;
  let _lastReading: MeasurementReading | null = null;

  const deviceId = "protimeter-mock";

  const identity: DeviceIdentity = {
    manufacturer: "Protimeter",
    model: "Surveymaster (Mock)",
    hardwareVersion: "2.0",
    firmwareVersion: "sim-1.0.0",
  };

  const capabilities: DeviceCapabilities = {
    categories: ["sensor", "diagnostic"],
    transports: ["ble"],
    hasLivePreview: false,
    producesMedia: false,
    requiresPairing: false,
    supportsStreaming: true,
    supportsOffline: true,
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
    id: deviceId,
    name: "Protimeter Surveymaster (Mock)",
    priority: 60,
    identity,
    capabilities,
    measurementCapabilities,

    async initialize(): Promise<void> {
      // BLE scan would happen here in a real implementation
    },

    async teardown(): Promise<void> {
      _connected = false;
    },

    async connect(): Promise<void> {
      await new Promise<void>((r) => setTimeout(r, 300));
      _connected = true;
      emitter.emit({
        kind: "device.connected",
        deviceId,
        timestamp: new Date().toISOString(),
      });
    },

    async disconnect(): Promise<void> {
      _connected = false;
      emitter.emit({
        kind: "device.disconnected",
        deviceId,
        timestamp: new Date().toISOString(),
      });
    },

    async getStatus(): Promise<DeviceStatus> {
      const now = new Date().toISOString();
      return {
        operational: _connected ? "idle" : "unavailable",
        connection: {
          state: _connected ? "connected" : "disconnected",
          transport: "ble",
          signalStrength: _connected ? 78 : undefined,
          connectedAt: _connected ? now : undefined,
        },
        battery: _connected ? { level: 82, isCharging: false } : undefined,
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const now = new Date().toISOString();
      if (_connected) {
        return { status: "healthy", message: "Moisture meter connected via BLE", checkedAt: now };
      }
      return { status: "degraded", message: "Moisture meter not connected", checkedAt: now };
    },

    getPermissions(): DevicePermissions {
      return {
        granted: true,
        required: ["android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN"],
        async request(): Promise<boolean> {
          return true;
        },
      };
    },

    async read(): Promise<MeasurementReading> {
      if (!_connected) {
        throw new Error("Moisture meter is not connected. Call connect() first.");
      }
      const value = simulateMoistureReading();
      const reading: MeasurementReading = {
        deviceId,
        kind: "thickness",
        value,
        unit: "mm",
        signalQuality: 0.9 + Math.random() * 0.1,
        capturedAt: new Date().toISOString(),
      };
      _lastReading = reading;
      return reading;
    },

    subscribe(
      listener: (reading: MeasurementReading) => void,
      intervalMs = 2000,
    ): () => void {
      const id = setInterval(async () => {
        if (!_connected) return;
        try {
          const reading = await this.read();
          listener(reading);
        } catch {
          // swallow read errors in streaming mode
        }
      }, intervalMs);
      return () => clearInterval(id);
    },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}
