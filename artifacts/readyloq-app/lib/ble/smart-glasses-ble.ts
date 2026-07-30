/**
 * Smart Glasses BLE driver — Meta Ray-Ban (react-native-ble-plx v3)
 *
 * ─── ReadyLoq BLE Protocol ───────────────────────────────────────────────────
 *
 * Primary service (ReadyLoq Glasses):
 *   GLASSES_SERVICE_UUID    — GATT service advertised by the glasses firmware
 *   FRAME_CHAR_UUID         — notify: JPEG frame chunks (6-byte header + data)
 *   AUDIO_CHAR_UUID         — notify: PCM int16 audio chunks (6-byte header + data)
 *   CONTROL_CHAR_UUID       — write: command bytes (see ControlCmd enum)
 *
 * Fallback service (Nordic UART Service — for prototyping / third-party firmware):
 *   NORDIC_UART_SERVICE_UUID / NORDIC_UART_TX_UUID — single bidirectional channel
 *
 * Frame chunk format (big-endian):
 *   [2] frame_seq    — monotonically increasing frame ID
 *   [2] chunk_idx    — 0-based index of this chunk within the frame
 *   [2] total_chunks — total chunks that make up this frame
 *   [N] jpeg_data    — raw JPEG bytes for this chunk
 *
 * Audio chunk format (big-endian):
 *   [4] timestamp_ms — device clock at recording start
 *   [N] pcm_int16    — 16kHz mono PCM samples (little-endian int16)
 *
 * Control commands (phone → glasses):
 *   0x01  REQUEST_SNAPSHOT   — trigger a single photo
 *   0x02  ACK_FRAME          — acknowledge frame delivery
 *   0x03  ENABLE_AUDIO       — start audio stream
 *   0x04  DISABLE_AUDIO      — stop audio stream
 *
 * Device filtering:
 *   Primary:  device advertises GLASSES_SERVICE_UUID
 *   Fallback: device name contains one of GLASSES_NAME_PATTERNS
 *
 * Persistence:
 *   Paired device ID is stored in AsyncStorage so the screen can offer
 *   auto-reconnect on next mount.
 */

import { BleManager, State as BleHwState } from "react-native-ble-plx";
import type { Device, Characteristic } from "react-native-ble-plx";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── UUIDs ───────────────────────────────────────────────────────────────────

/** ReadyLoq custom GATT service for smart glasses. */
export const GLASSES_SERVICE_UUID =
  "0000A001-0000-1000-8000-00805F9B34FB";
/** JPEG frame chunk notify characteristic. */
export const FRAME_CHAR_UUID =
  "0000A002-0000-1000-8000-00805F9B34FB";
/** PCM audio chunk notify characteristic. */
export const AUDIO_CHAR_UUID =
  "0000A003-0000-1000-8000-00805F9B34FB";
/** Control write characteristic. */
export const CONTROL_CHAR_UUID =
  "0000A004-0000-1000-8000-00805F9B34FB";

/** Nordic UART Service — fallback for prototyping firmware. */
export const NORDIC_UART_SERVICE_UUID =
  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
export const NORDIC_UART_TX_UUID =
  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

/** Device name substrings that identify Meta Ray-Ban glasses. */
const GLASSES_NAME_PATTERNS = ["Ray-Ban", "Meta Smart", "ReadyLoq Glasses"];

/** Scan for devices advertising either ReadyLoq or UART service. */
const SCAN_SERVICE_UUIDS: string[] = [
  GLASSES_SERVICE_UUID,
  NORDIC_UART_SERVICE_UUID,
];

/** AsyncStorage key for the last successfully paired device ID. */
const PAIRED_DEVICE_KEY = "@readyloq:paired_glasses_id";
const PAIRED_DEVICE_NAME_KEY = "@readyloq:paired_glasses_name";

/** Max time (ms) to wait to collect all chunks for a single frame. */
const FRAME_REASSEMBLY_TTL_MS = 5000;
/** Scan timeout (ms) before auto-stop. */
const SCAN_TIMEOUT_MS = 15_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export type GlassesConnectionState =
  | "idle"
  | "scanning"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export interface DiscoveredGlasses {
  id: string;
  name: string;
  rssi: number;
}

export interface SmartGlassesBleState {
  /** Host Bluetooth adapter state. */
  hwState: BleHwState;
  /** Driver connection state machine. */
  connectionState: GlassesConnectionState;
  /** Devices found during the current scan. */
  discovered: DiscoveredGlasses[];
  /** ID of the currently connected device (null if not connected). */
  connectedDeviceId: string | null;
  /** Display name of the connected device. */
  connectedDeviceName: string | null;
  /** Last error message; cleared on next action. */
  error: string | null;
  /** Persisted ID of the last successfully paired device (auto-reconnect). */
  pairedDeviceId: string | null;
  /** Persisted name of the last successfully paired device. */
  pairedDeviceName: string | null;
}

export type FrameCallback = (jpegBytes: Uint8Array) => void;
export type AudioCallback = (pcmBytes: Uint8Array, timestampMs: number) => void;
export type StateChangeCallback = (state: SmartGlassesBleState) => void;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

/** Control command bytes (phone → glasses). */
const ControlCmd = {
  REQUEST_SNAPSHOT: new Uint8Array([0x01]),
  ACK_FRAME: new Uint8Array([0x02]),
  ENABLE_AUDIO: new Uint8Array([0x03]),
  DISABLE_AUDIO: new Uint8Array([0x04]),
} as const;

// ─── Frame reassembly buffer ──────────────────────────────────────────────────

interface FrameBuffer {
  chunks: Map<number, Uint8Array>; // chunk_idx → data
  totalChunks: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

// ─── Manager singleton ────────────────────────────────────────────────────────

class SmartGlassesBleManager {
  private readonly _ble = new BleManager();

  private _state: SmartGlassesBleState = {
    hwState: BleHwState.Unknown,
    connectionState: "idle",
    discovered: [],
    connectedDeviceId: null,
    connectedDeviceName: null,
    error: null,
    pairedDeviceId: null,
    pairedDeviceName: null,
  };

  private _stateListeners = new Set<StateChangeCallback>();
  private _frameListeners = new Set<FrameCallback>();
  private _audioListeners = new Set<AudioCallback>();

  private _scanTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectedDevice: Device | null = null;
  private _frameBuffers = new Map<number, FrameBuffer>();

  // Subscriptions returned by ble-plx that must be removed on disconnect
  private _subscriptions: { remove(): void }[] = [];

  constructor() {
    // Monitor Bluetooth hardware state
    this._ble.onStateChange((hwState) => {
      this._patch({ hwState });
    }, true /* emit current state immediately */);

    // Restore persisted paired device
    void AsyncStorage.multiGet([PAIRED_DEVICE_KEY, PAIRED_DEVICE_NAME_KEY])
      .then(([[, id], [, name]]) => {
        if (id) {
          this._patch({ pairedDeviceId: id, pairedDeviceName: name ?? null });
        }
      })
      .catch(() => {
        /* non-fatal */
      });
  }

  // ── Public accessors ──────────────────────────────────────────────────────

  getState(): SmartGlassesBleState {
    return this._state;
  }

  subscribe(cb: StateChangeCallback): () => void {
    this._stateListeners.add(cb);
    cb(this._state);
    return () => this._stateListeners.delete(cb);
  }

  onFrame(cb: FrameCallback): () => void {
    this._frameListeners.add(cb);
    return () => this._frameListeners.delete(cb);
  }

  onAudio(cb: AudioCallback): () => void {
    this._audioListeners.add(cb);
    return () => this._audioListeners.delete(cb);
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  /**
   * Start a BLE scan (max SCAN_TIMEOUT_MS).
   * Filters by ReadyLoq service UUID; also accepts devices by name pattern.
   */
  startScan(): void {
    if (
      this._state.connectionState === "scanning" ||
      this._state.connectionState === "connected" ||
      this._state.connectionState === "connecting"
    ) {
      return;
    }

    this._patch({
      connectionState: "scanning",
      discovered: [],
      error: null,
    });

    // Scan for both service UUIDs so we catch glasses in both firmware modes.
    // react-native-ble-plx treats this as OR: device must advertise any listed UUID.
    this._ble.startDeviceScan(
      SCAN_SERVICE_UUIDS,
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          this._stopScan();
          this._patch({
            connectionState: "error",
            error: error.message ?? "BLE scan failed.",
          });
          return;
        }

        if (!device) return;

        // Also accept any device whose name matches the known patterns,
        // in case the glasses are advertising without the custom service UUID.
        const nameMatch =
          device.name &&
          GLASSES_NAME_PATTERNS.some((p) => device.name!.includes(p));

        if (!nameMatch && !SCAN_SERVICE_UUIDS.some((uuid) =>
          device.serviceUUIDs?.includes(uuid)
        )) {
          return;
        }

        const existing = this._state.discovered.find((d) => d.id === device.id);
        if (existing) return; // already listed

        const entry: DiscoveredGlasses = {
          id: device.id,
          name: device.name ?? "Unknown glasses",
          rssi: device.rssi ?? -100,
        };

        this._patch({
          discovered: [...this._state.discovered, entry],
        });
      },
    );

    // Auto-stop after timeout
    this._scanTimer = setTimeout(() => {
      this._stopScan();
      if (this._state.connectionState === "scanning") {
        this._patch({ connectionState: "idle" });
      }
    }, SCAN_TIMEOUT_MS);
  }

  stopScan(): void {
    this._stopScan();
    if (this._state.connectionState === "scanning") {
      this._patch({ connectionState: "idle" });
    }
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Connect to a specific device by ID.
   * Runs full GATT discovery and subscribes to frame / audio characteristics.
   */
  async connect(deviceId: string, deviceName: string): Promise<void> {
    this._stopScan();
    this._patch({ connectionState: "connecting", error: null });

    try {
      const device = await this._ble.connectToDevice(deviceId, {
        requestMTU: 247, // maximize chunk payload (~241 bytes after header)
      });

      await device.discoverAllServicesAndCharacteristics();

      this._connectedDevice = device;
      this._setupNotifications(device);
      this._setupDisconnectHandler(device);

      // Persist paired device
      await AsyncStorage.multiSet([
        [PAIRED_DEVICE_KEY, deviceId],
        [PAIRED_DEVICE_NAME_KEY, deviceName],
      ]);

      this._patch({
        connectionState: "connected",
        connectedDeviceId: deviceId,
        connectedDeviceName: deviceName,
        pairedDeviceId: deviceId,
        pairedDeviceName: deviceName,
        error: null,
      });

      // Ask glasses to enable audio stream
      await this._writeControl(device, ControlCmd.ENABLE_AUDIO);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed.";
      this._patch({
        connectionState: "error",
        error: msg,
      });
      throw err;
    }
  }

  /** Disconnect from the current device. */
  async disconnect(): Promise<void> {
    if (!this._connectedDevice) return;

    this._patch({ connectionState: "disconnecting" });

    try {
      await this._writeControl(this._connectedDevice, ControlCmd.DISABLE_AUDIO);
    } catch {
      /* ignore — we're tearing down regardless */
    }

    this._removeSubscriptions();

    try {
      await this._connectedDevice.cancelConnection();
    } catch {
      /* ignore */
    }

    this._connectedDevice = null;
    this._frameBuffers.clear();

    this._patch({
      connectionState: "idle",
      connectedDeviceId: null,
      connectedDeviceName: null,
    });
  }

  /**
   * Request a single snapshot from the glasses.
   * The JPEG frame will arrive via the frame notify characteristic.
   */
  async requestSnapshot(): Promise<void> {
    if (!this._connectedDevice || this._state.connectionState !== "connected") {
      throw new Error("No glasses connected.");
    }
    await this._writeControl(this._connectedDevice, ControlCmd.REQUEST_SNAPSHOT);
  }

  /** Forget the persisted paired device (requires re-scan to reconnect). */
  async forgetPairedDevice(): Promise<void> {
    await AsyncStorage.multiRemove([PAIRED_DEVICE_KEY, PAIRED_DEVICE_NAME_KEY]);
    this._patch({ pairedDeviceId: null, pairedDeviceName: null });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _stopScan(): void {
    if (this._scanTimer !== null) {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }
    this._ble.stopDeviceScan();
  }

  private _patch(partial: Partial<SmartGlassesBleState>): void {
    this._state = { ...this._state, ...partial };
    this._stateListeners.forEach((cb) => cb(this._state));
  }

  private _setupNotifications(device: Device): void {
    // ── Frame characteristic ──────────────────────────────────────────────
    const frameSub = device.monitorCharacteristicForService(
      GLASSES_SERVICE_UUID,
      FRAME_CHAR_UUID,
      (error: Error | null, char: Characteristic | null) => {
        if (error || !char?.value) return;
        this._handleFrameChunk(base64ToBytes(char.value));
      },
    );
    this._subscriptions.push(frameSub);

    // ── Audio characteristic ──────────────────────────────────────────────
    const audioSub = device.monitorCharacteristicForService(
      GLASSES_SERVICE_UUID,
      AUDIO_CHAR_UUID,
      (error: Error | null, char: Characteristic | null) => {
        if (error || !char?.value) return;
        this._handleAudioChunk(base64ToBytes(char.value));
      },
    );
    this._subscriptions.push(audioSub);

    // ── Nordic UART TX fallback ───────────────────────────────────────────
    // If the glasses firmware uses NUS, all data arrives on the TX characteristic.
    // monitorCharacteristicForService returns a Subscription synchronously;
    // if the service doesn't exist the callback fires once with an error, which
    // we silently ignore — expected when the ReadyLoq service is used instead.
    try {
      const nusSub = device.monitorCharacteristicForService(
        NORDIC_UART_SERVICE_UUID,
        NORDIC_UART_TX_UUID,
        (error: Error | null, char: Characteristic | null) => {
          if (error || !char?.value) return;
          // On NUS the raw bytes contain the frame chunk — treat as frame data
          this._handleFrameChunk(base64ToBytes(char.value));
        },
      );
      this._subscriptions.push(nusSub);
    } catch {
      /* NUS not available on this firmware — expected for ReadyLoq firmware */
    }
  }

  private _setupDisconnectHandler(device: Device): void {
    this._ble.onDeviceDisconnected(device.id, (_error, _dev) => {
      this._removeSubscriptions();
      this._connectedDevice = null;
      this._frameBuffers.clear();

      this._patch({
        connectionState: "idle",
        connectedDeviceId: null,
        connectedDeviceName: null,
        error: "Glasses disconnected.",
      });
    });
  }

  private _removeSubscriptions(): void {
    this._subscriptions.forEach((s) => {
      try {
        s.remove();
      } catch {
        /* ignore */
      }
    });
    this._subscriptions = [];
  }

  private async _writeControl(
    device: Device,
    cmd: Uint8Array,
  ): Promise<void> {
    try {
      await device.writeCharacteristicWithResponseForService(
        GLASSES_SERVICE_UUID,
        CONTROL_CHAR_UUID,
        bytesToBase64(cmd),
      );
    } catch {
      /* best-effort control write — not fatal */
    }
  }

  // ── Frame reassembly ──────────────────────────────────────────────────────

  private _handleFrameChunk(bytes: Uint8Array): void {
    if (bytes.length < 6) return; // malformed chunk

    const frameSeq = readUint16BE(bytes, 0);
    const chunkIdx = readUint16BE(bytes, 2);
    const totalChunks = readUint16BE(bytes, 4);
    const data = bytes.slice(6);

    let buf = this._frameBuffers.get(frameSeq);
    if (!buf) {
      buf = {
        chunks: new Map(),
        totalChunks,
        timeoutHandle: setTimeout(() => {
          this._frameBuffers.delete(frameSeq);
        }, FRAME_REASSEMBLY_TTL_MS),
      };
      this._frameBuffers.set(frameSeq, buf);
    }

    buf.chunks.set(chunkIdx, data);

    if (buf.chunks.size === totalChunks) {
      clearTimeout(buf.timeoutHandle);
      this._frameBuffers.delete(frameSeq);

      // Reassemble in order
      let totalBytes = 0;
      for (let i = 0; i < totalChunks; i++) {
        totalBytes += buf.chunks.get(i)?.length ?? 0;
      }
      const jpeg = new Uint8Array(totalBytes);
      let offset = 0;
      for (let i = 0; i < totalChunks; i++) {
        const chunk = buf.chunks.get(i);
        if (chunk) {
          jpeg.set(chunk, offset);
          offset += chunk.length;
        }
      }

      // Acknowledge delivery
      if (this._connectedDevice) {
        void this._writeControl(this._connectedDevice, ControlCmd.ACK_FRAME);
      }

      this._frameListeners.forEach((cb) => cb(jpeg));
    }
  }

  // ── Audio chunk handler ───────────────────────────────────────────────────

  private _handleAudioChunk(bytes: Uint8Array): void {
    if (bytes.length < 4) return;
    const timestampMs = readUint32BE(bytes, 0);
    const pcm = bytes.slice(4);
    this._audioListeners.forEach((cb) => cb(pcm, timestampMs));
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

export const smartGlassesBle = new SmartGlassesBleManager();
