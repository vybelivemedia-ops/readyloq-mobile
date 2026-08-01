/**
 * BleSensorAdapter — per-provider BLE connection manager.
 *
 * Handles: scan → connect → read/notify → disconnect lifecycle for a single
 * GATT peripheral. Each MeasurementDeviceProvider owns one adapter instance.
 *
 * ─── Task #91 — Persistence ──────────────────────────────────────────────────
 * Pass a `storageKey` as the 4th constructor argument (use the provider ID).
 * setPairedDevice() automatically writes to AsyncStorage.
 * clearPairedDevice() removes the entry.
 * Call `await adapter.restorePersistedDevice()` inside provider.initialize()
 * so the paired device ID is available across app restarts without re-scanning.
 *
 * ─── Task #88 — Background continuity ───────────────────────────────────────
 * After a successful connect(), an AppState listener is registered.
 * When the app returns to the foreground and the BLE connection has dropped
 * (e.g. phone slept mid-inspection), the adapter automatically retries the
 * connection to the last paired device without requiring a new scan.
 *
 * iOS: requires UIBackgroundModes = ["bluetooth-central"] in app.json
 * Android: react-native-ble-plx handles background connections via
 * a system-level autoConnect flag — no additional service needed.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   const adapter = new BleSensorAdapter(
 *     getSensorBleManager(),
 *     [SERVICE_UUID],
 *     ["Protimeter", "PTM"],
 *     "protimeter-ble",      // ← storageKey for persistence
 *   );
 *
 *   // Restore persisted device on startup:
 *   await adapter.restorePersistedDevice();
 *
 *   // Scan phase (done via DeviceScannerModal):
 *   const stop = adapter.scan((device) => { ... }, 15_000);
 *
 *   // Connect phase (after user selects a device):
 *   await adapter.connect(adapter.pairedId ?? deviceId);
 *
 * Important: monitorCharacteristicForService returns a Subscription — call
 * sub.remove(), NOT sub() to unsubscribe.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import type { BleManager, Device } from "react-native-ble-plx";

const SCAN_TIMEOUT_MS = 15_000;
const STORAGE_PREFIX  = "@readyloq:sensor:";

// ─── Public types ─────────────────────────────────────────────────────────────

export type SensorConnectionState =
  | "idle"
  | "scanning"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export interface DiscoveredSensor {
  id: string;
  name: string;
  rssi: number;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class BleSensorAdapter {
  private _device:      Device | null         = null;
  private _state:       SensorConnectionState = "idle";
  private _lastError:   string | null         = null;
  private _pairedId:    string | null         = null;
  private _pairedName:  string | null         = null;

  // #88 — background reconnect tracking
  private _wasConnected = false;
  private _appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

  constructor(
    private readonly manager:       BleManager,
    private readonly serviceUUIDs:  string[],
    private readonly namePatterns:  string[],
    /** Provider ID used as the AsyncStorage persistence key (optional). */
    private readonly storageKey?:   string,
  ) {}

  // ─── Getters ────────────────────────────────────────────────────────────────

  get state():       SensorConnectionState { return this._state; }
  get isConnected(): boolean               { return this._state === "connected"; }
  get pairedId():    string | null         { return this._pairedId; }
  get pairedName():  string | null         { return this._pairedName; }
  get lastError():   string | null         { return this._lastError; }
  get deviceId():    string | null         { return this._device?.id ?? null; }

  // ─── Pairing ────────────────────────────────────────────────────────────────

  /** Store the target device chosen by the user via DeviceScannerModal and persist it. */
  setPairedDevice(id: string, name: string): void {
    this._pairedId   = id;
    this._pairedName = name;
    if (this.storageKey) {
      void AsyncStorage.setItem(
        `${STORAGE_PREFIX}${this.storageKey}`,
        JSON.stringify({ id, name }),
      );
    }
  }

  /** Clear pairing (and persistence) so the next scan starts fresh. */
  clearPairedDevice(): void {
    this._pairedId   = null;
    this._pairedName = null;
    if (this.storageKey) {
      void AsyncStorage.removeItem(`${STORAGE_PREFIX}${this.storageKey}`);
    }
  }

  /**
   * Load a previously paired device from AsyncStorage.
   * Call this inside provider.initialize() so sessions don't require re-scanning.
   */
  async restorePersistedDevice(): Promise<void> {
    if (!this.storageKey) return;
    try {
      const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}${this.storageKey}`);
      if (raw) {
        const { id, name } = JSON.parse(raw) as { id: string; name: string };
        // Set directly — no need to re-persist what was just loaded.
        this._pairedId   = id;
        this._pairedName = name;
      }
    } catch {
      // Ignore parse / storage errors; technician can re-pair.
    }
  }

  // ─── Scan ───────────────────────────────────────────────────────────────────

  /**
   * Start scanning. Returns a stop function; also auto-stops after timeoutMs.
   * Calls onDiscover for each unique device found that matches the filter.
   */
  scan(onDiscover: (s: DiscoveredSensor) => void, timeoutMs = SCAN_TIMEOUT_MS): () => void {
    this._state     = "scanning";
    this._lastError = null;
    const seen      = new Set<string>();

    this.manager.startDeviceScan(
      this.serviceUUIDs.length > 0 ? this.serviceUUIDs : null,
      { allowDuplicates: false },
      (err, device) => {
        if (err) {
          this._state     = "error";
          this._lastError = err.message;
          return;
        }
        if (!device) return;

        const nameOk =
          this.namePatterns.length === 0 ||
          this.namePatterns.some(
            (p) => device.name?.includes(p) || device.localName?.includes(p),
          );
        if (!nameOk) return;
        if (seen.has(device.id)) return;
        seen.add(device.id);

        onDiscover({
          id:   device.id,
          name: device.name ?? device.localName ?? "Unknown Device",
          rssi: device.rssi ?? -100,
        });
      },
    );

    const timer = setTimeout(() => this.stopScan(), timeoutMs);
    return () => { clearTimeout(timer); this.stopScan(); };
  }

  stopScan(): void {
    if (this._state === "scanning") {
      try { this.manager.stopDeviceScan(); } catch { /* ignore */ }
      this._state = "idle";
    }
  }

  // ─── Connect ────────────────────────────────────────────────────────────────

  /** Connect to the device identified by deviceId. Discovers all services. */
  async connect(deviceId: string): Promise<void> {
    this.stopScan();
    this._state     = "connecting";
    this._lastError = null;
    try {
      const device = await this.manager.connectToDevice(deviceId, {
        requestMTU:  512,
        autoConnect: false,
      });
      await device.discoverAllServicesAndCharacteristics();
      this._device       = device;
      this._state        = "connected";
      this._wasConnected = true;
      this._startAppStateListener();  // #88
    } catch (err) {
      this._state     = "error";
      this._lastError = (err as Error).message;
      throw err;
    }
  }

  // ─── Read / Write / Subscribe ────────────────────────────────────────────────

  /** Read one characteristic value. Returns raw base64. */
  async readCharacteristic(serviceUUID: string, charUUID: string): Promise<string> {
    this.assertConnected();
    const char = await this._device!.readCharacteristicForService(serviceUUID, charUUID);
    if (!char.value) throw new Error("Empty characteristic value");
    return char.value;
  }

  /**
   * Write a command (base64-encoded) to a write/write-without-response characteristic.
   * withResponse = true (default) waits for GATT confirmation.
   */
  async writeCharacteristic(
    serviceUUID:  string,
    charUUID:     string,
    base64Value:  string,
    withResponse = true,
  ): Promise<void> {
    this.assertConnected();
    if (withResponse) {
      await this._device!.writeCharacteristicWithResponseForService(
        serviceUUID, charUUID, base64Value,
      );
    } else {
      await this._device!.writeCharacteristicWithoutResponseForService(
        serviceUUID, charUUID, base64Value,
      );
    }
  }

  /**
   * Subscribe to a notify characteristic. Returns an unsubscribe function.
   * Note: monitorCharacteristicForService returns a Subscription — call .remove().
   */
  subscribeCharacteristic(
    serviceUUID: string,
    charUUID:    string,
    onValue:     (base64: string) => void,
    onError?:    (err: Error) => void,
  ): () => void {
    this.assertConnected();
    const sub = this._device!.monitorCharacteristicForService(
      serviceUUID,
      charUUID,
      (err, char) => {
        if (err) { onError?.(err); return; }
        if (char?.value) onValue(char.value);
      },
    );
    return () => sub.remove();
  }

  // ─── Disconnect ──────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this._stopAppStateListener();   // #88
    this._wasConnected = false;
    if (!this._device) return;
    this._state = "disconnecting";
    try {
      await this._device.cancelConnection();
    } finally {
      this._device = null;
      this._state  = "idle";
    }
  }

  destroy(): void {
    this._stopAppStateListener();   // #88
    this.stopScan();
    if (this._device) {
      void this._device.cancelConnection().catch(() => undefined);
      this._device = null;
    }
    this._state        = "idle";
    this._wasConnected = false;
  }

  // ─── #88 — AppState reconnect ────────────────────────────────────────────────

  private _startAppStateListener(): void {
    if (this._appStateSub) return;
    this._appStateSub = AppState.addEventListener("change", this._handleAppStateChange);
  }

  private _stopAppStateListener(): void {
    this._appStateSub?.remove();
    this._appStateSub = null;
  }

  private readonly _handleAppStateChange = (nextState: AppStateStatus): void => {
    if (nextState !== "active") return;
    // App came back to foreground. If we were connected but the BLE link dropped
    // (e.g. phone went to sleep and the peripheral timed out), quietly reconnect.
    if (this._wasConnected && !this.isConnected && this._pairedId) {
      void this.connect(this._pairedId).catch(() => {
        // Silent — the sensor card in the Connections tab will show Disconnected.
        // Technician can manually reconnect if needed.
      });
    }
  };

  // ─── Internal ────────────────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this._device || this._state !== "connected") {
      throw new Error("BleSensorAdapter: not connected");
    }
  }
}

// ─── GATT decode helpers ──────────────────────────────────────────────────────

/** Decode a base64 string to Uint8Array. */
export function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Encode a Uint8Array to base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Read a little-endian signed int16 from bytes[offset]. */
export function readInt16LE(bytes: Uint8Array, offset = 0): number {
  const u = bytes[offset] | (bytes[offset + 1] << 8);
  return u > 0x7fff ? u - 0x10000 : u;
}

/** Read a little-endian unsigned uint16 from bytes[offset]. */
export function readUint16LE(bytes: Uint8Array, offset = 0): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/** Read a little-endian IEEE 754 float32 from bytes[offset]. */
export function readFloat32LE(bytes: Uint8Array, offset = 0): number {
  const buf = new ArrayBuffer(4);
  new Uint8Array(buf).set(bytes.slice(offset, offset + 4));
  return new DataView(buf).getFloat32(0, true);
}
