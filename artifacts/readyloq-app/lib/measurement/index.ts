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

export {
  createMockMoistureMeterProvider,
  type MockMoistureMeterProvider,
} from "./mock-moisture-meter";

export {
  createMockLaserDistanceMeterProvider,
  type MockLaserDistanceMeterProvider,
} from "./mock-laser-distance-meter";
