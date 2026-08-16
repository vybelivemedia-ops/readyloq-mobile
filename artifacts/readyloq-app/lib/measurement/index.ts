/**
 * ReadyLoq measurement device providers.
 *
 * Exports concrete MeasurementDeviceProvider implementations that can be
 * registered with the DeviceRegistry via the DevicePlugin.
 *
 * Mock providers ship in all builds and are used for:
 *   - Development and QA without physical hardware
 *   - Demo mode
 *   - Unit and integration testing
 *
 * Real BLE adapters (Protimeter, Bosch, FLIR) will be added as separate
 * provider files following the same factory pattern.
 */

// ── Mock providers (development / demo / testing) ─────────────────────────────
export {
  createMockMoistureMeterProvider,
  type MockMoistureMeterProvider,
} from "./mock-moisture-meter";

export {
  createMockLaserDistanceMeterProvider,
  type MockLaserDistanceMeterProvider,
} from "./mock-laser-distance-meter";

// ── Real BLE providers ────────────────────────────────────────────────────────
export {
  createBleMoistureMeterProvider,
  type BleMoistureMeterProvider,
} from "./ble-moisture-meter-provider";

export {
  createBleLaserDistanceProvider,
  type BleLaserDistanceProvider,
} from "./ble-laser-distance-provider";

export {
  createBleTemperatureProvider,
  type BleTemperatureProvider,
} from "./ble-temperature-provider";

export {
  createBleCO2Provider,
  type BleCO2Provider,
} from "./ble-co2-provider";

export {
  createBleAcousticSensorProvider,
  type BleAcousticSensorProvider,
} from "./ble-acoustic-sensor-provider";

// ── Burst measurement ─────────────────────────────────────────────────────────
export {
  burstMeasurementManager,
  DEFAULT_FOCAL_LENGTH_PX,
  type BurstFrame,
  type BlendedMeasurementResult,
  type BurstCaptureResult,
} from "./BurstMeasurementManager";

// SfMDepthEngine is intentionally NOT exported here.
// It uses a hardcoded mock feature-pair implementation as a development stand-in
// and must not be shipped as a production measurement path until a real native
// feature-tracking bridge is implemented and validated (see task #601).

// ── Measurement Bridge ────────────────────────────────────────────────────────
export {
  setLastMeasurementReading,
  getLastMeasurementReading,
  hasFreshMeasurementReading,
  consumeLastMeasurementReading,
  clearMeasurementReading,
  measurementAge,
  useMeasurementBridge,
  readingToLinearFt,
  formatReadingCompact,
} from "./measurement-bridge";
