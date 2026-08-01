/**
 * Shared BleManager singleton for ReadyLoq sensor providers.
 *
 * react-native-ble-plx recommends a single BleManager per app. Sensor
 * providers share this instance via getSensorBleManager(); they must NOT
 * create their own managers. Only one scan may run at a time — the
 * DeviceScannerModal serialises scans through this shared instance.
 *
 * Note: the smart-glasses driver retains its own manager for historical
 * reasons; a future cleanup task should unify them.
 */

import { BleManager } from "react-native-ble-plx";

let _manager: BleManager | null = null;

/** Returns the app-wide BLE manager for sensors, creating it on first call. */
export function getSensorBleManager(): BleManager {
  if (!_manager) {
    _manager = new BleManager();
  }
  return _manager;
}

/** Tears down the manager (call on app shutdown, not between scans). */
export function destroySensorBleManager(): void {
  if (_manager) {
    _manager.destroy();
    _manager = null;
  }
}
