/**
 * Mock Bosch GLM laser distance meter provider.
 *
 * Simulates a Bosch GLM 50-27 CG — a professional BLE-enabled laser distance
 * meter used by technicians to record room dimensions, wall-to-wall distances,
 * and structural measurements during property inspections.
 *
 * In production this would be replaced by a real BLE adapter that reads
 * characteristic values from the Bosch Smart System GATT profile. This mock
 * generates realistic distance readings for development and demo purposes.
 *
 * MeasurementKind mapping:
 *   kind: "distance"  — straight-line laser distance measurement
 *   unit: "m"         — meters (the Bosch native unit)
 *
 * DeviceCapabilities:
 *   categories:  ["sensor"]
 *   transports:  ["ble"]  (simulated — connects instantly)
 *   tokens:      ["sensor.distance"]
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

/** Simulate a realistic room dimension reading (0.3 – 15.0 m). */
function simulateDistanceReading(): number {
  const roomDimensions = [2.4, 3.2, 3.6, 4.0, 4.5, 5.0, 6.0, 7.2, 8.0, 10.0, 12.0];
  const base = roomDimensions[Math.floor(Math.random() * roomDimensions.length)];
  const jitter = (Math.random() - 0.5) * 0.04;
  return Math.round((base + jitter) * 1000) / 1000;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type MockLaserDistanceMeterProvider = MeasurementDeviceProvider;

export function createMockLaserDistanceMeterProvider(): MockLaserDistanceMeterProvider {
  const emitter = makeEmitter();
  let _connected = false;
  let _lastReading: MeasurementReading | null = null;

  const deviceId = "bosch-glm-mock";

  const identity: DeviceIdentity = {
    manufacturer: "Bosch",
    model: "GLM 50-27 CG (Mock)",
    hardwareVersion: "1.0",
    firmwareVersion: "sim-1.0.0",
  };

  const capabilities: DeviceCapabilities = {
    categories: ["sensor"],
    transports: ["ble"],
    hasLivePreview: false,
    producesMedia: false,
    requiresPairing: false,
    supportsStreaming: false,
    supportsOffline: true,
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

  return {
    id: deviceId,
    name: "Bosch GLM 50-27 CG (Mock)",
    priority: 55,
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
      await new Promise<void>((r) => setTimeout(r, 400));
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
          signalStrength: _connected ? 85 : undefined,
          connectedAt: _connected ? now : undefined,
        },
        battery: _connected ? { level: 91, isCharging: false } : undefined,
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const now = new Date().toISOString();
      if (_connected) {
        return { status: "healthy", message: "Laser distance meter connected via BLE", checkedAt: now };
      }
      return { status: "degraded", message: "Laser distance meter not connected", checkedAt: now };
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
        throw new Error("Laser distance meter is not connected. Call connect() first.");
      }
      await new Promise<void>((r) => setTimeout(r, 150));
      const value = simulateDistanceReading();
      const reading: MeasurementReading = {
        deviceId,
        kind: "distance",
        value,
        unit: "m",
        signalQuality: 0.95 + Math.random() * 0.05,
        capturedAt: new Date().toISOString(),
      };
      _lastReading = reading;
      return reading;
    },

    subscribe(
      listener: (reading: MeasurementReading) => void,
      intervalMs = 3000,
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
