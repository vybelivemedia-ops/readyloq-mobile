/**
 * SmartGlassesProvider — concrete WearableProvider implementation
 *
 * Wraps the `smartGlassesBle` singleton driver and exposes it through the
 * @platform/meta-wearables WearableProvider interface so that the inspection
 * engine, device picker, and health-check subsystems can treat it the same as
 * any other DeviceProvider without knowing it is BLE-backed.
 *
 * Transport:  BLE (react-native-ble-plx)
 * Mode:       async_push — glasses push JPEG frames when the hardware button
 *             is pressed; audio is streamed via BLE notify characteristic.
 * Connection: Pairing persisted in AsyncStorage; auto-reconnects on mount.
 *
 * Usage:
 *   import { smartGlassesProvider } from "@/lib/ble/smart-glasses-provider";
 *
 *   // Check connection before attempting capture
 *   smartGlassesProvider.isConnected;
 *
 *   // Subscribe to live frames (returns unsubscribe)
 *   const unsub = smartGlassesProvider.onFrame((jpeg) => { ... });
 *
 *   // Trigger manual snapshot from app
 *   await smartGlassesProvider.requestSnapshot();
 */

import type { WearableProvider, WearableProviderMeta } from "@platform/meta-wearables";
import {
  SMART_GLASSES_CAPABILITIES,
  SMART_GLASSES_SOURCE,
} from "@platform/meta-wearables";
import {
  smartGlassesBle,
  checkBlePermissions,
  requestBlePermissions,
  type FrameCallback,
  type StateChangeCallback,
} from "./index";

// ─── SmartGlassesProvider ─────────────────────────────────────────────────────

/**
 * NOTE: Does not formally `implements WearableProvider` to avoid requiring
 * exact DeviceProvider abstract-method signatures that differ across platform
 * package versions. Cast to WearableProvider where registry compliance is needed
 * (same pattern as MetaLiveAIProvider stub in @platform/meta-wearables).
 */
export class SmartGlassesProvider {
  // ── WearableProvider.meta ────────────────────────────────────────────────
  get meta(): WearableProviderMeta {
    const { connectedDeviceName, pairedDeviceName } = smartGlassesBle.getState();
    return {
      hardwareModel:
        connectedDeviceName ?? pairedDeviceName ?? "Custom BLE Glasses",
      connectionAddress:
        smartGlassesBle.getState().connectedDeviceId ?? undefined,
      firmwareVersion: undefined, // not exposed by current GATT profile
      batteryLevel: undefined,    // future: read Battery Service characteristic
    };
  }

  // ── WearableProvider.captureCapabilities / source ─────────────────────────
  readonly captureCapabilities = SMART_GLASSES_CAPABILITIES;
  readonly source = SMART_GLASSES_SOURCE;

  // ── WearableProvider.isConnected ──────────────────────────────────────────
  get isConnected(): boolean {
    return smartGlassesBle.getState().connectionState === "connected";
  }

  // ─── DeviceProvider lifecycle ─────────────────────────────────────────────

  /**
   * Initialize the BLE manager (no-op if already started — the singleton
   * handles this internally).
   */
  async initialize(): Promise<void> {
    // smartGlassesBle auto-initialises on import; nothing more needed here.
  }

  /**
   * Start BLE scan → auto-connects to the paired device if one is saved.
   * If no paired device, the UI should open DeviceScannerModal to let the
   * technician select from discovered devices.
   */
  async connect(): Promise<void> {
    const { connectionState } = smartGlassesBle.getState();
    if (
      connectionState === "connected" ||
      connectionState === "connecting" ||
      connectionState === "scanning"
    ) {
      return; // already in progress
    }
    // startScan() handles auto-connect to pairedDeviceId when found.
    smartGlassesBle.startScan();
  }

  /** Gracefully disconnect and reset the BLE state machine. */
  async disconnect(): Promise<void> {
    await smartGlassesBle.disconnect();
  }

  async teardown(): Promise<void> {
    await this.disconnect();
  }

  // ─── DeviceProvider status / health ──────────────────────────────────────

  async getStatus() {
    const { connectionState, connectedDeviceId } = smartGlassesBle.getState();

    const operationalMap: Record<
      typeof connectionState,
      "available" | "unavailable" | "degraded" | "unknown"
    > = {
      connected: "available",
      connecting: "degraded",
      scanning: "degraded",
      idle: "unavailable",
      disconnecting: "degraded",
      error: "unavailable",
    };

    const connectionStateMap: Record<
      typeof connectionState,
      "connected" | "disconnected" | "connecting" | "disconnecting" | "error"
    > = {
      connected: "connected",
      connecting: "connecting",
      scanning: "connecting",
      idle: "disconnected",
      disconnecting: "disconnecting",
      error: "error",
    };

    return {
      operational: operationalMap[connectionState] ?? "unknown",
      connection: {
        state: connectionStateMap[connectionState] ?? "disconnected",
        transport: "ble" as const,
        ...(connectedDeviceId ? { address: connectedDeviceId } : {}),
      },
      lastSeenAt: new Date().toISOString(),
    };
  }

  async checkHealth() {
    const { connectionState } = smartGlassesBle.getState();
    const healthy = connectionState === "connected";
    return {
      status: healthy ? ("healthy" as const) : ("degraded" as const),
      message: healthy
        ? "Glasses connected via BLE"
        : `BLE state: ${connectionState}`,
      checkedAt: new Date().toISOString(),
    };
  }

  // ─── DeviceProvider permissions ───────────────────────────────────────────

  getPermissions() {
    return {
      granted: true, // Checked at scan time; we optimistically report granted here.
      required: ["BLUETOOTH_SCAN", "BLUETOOTH_CONNECT"],
      request: async () => {
        const result = await requestBlePermissions();
        return result === "granted";
      },
    };
  }

  // ─── DeviceProvider events ────────────────────────────────────────────────

  /**
   * Subscribe to device state changes.
   * Returns an unsubscribe function.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(_event: string, handler: any): () => void {
    return smartGlassesBle.subscribe(handler as StateChangeCallback);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(_event: string, _payload?: any): void {
    // Outbound events are driven by the BLE driver; no manual emission needed.
  }

  // ─── Glasses-specific API ─────────────────────────────────────────────────

  /**
   * Subscribe to incoming JPEG frames from the glasses camera.
   * Frames arrive on button-press (async_push mode).
   * Returns an unsubscribe function.
   */
  onFrame(cb: FrameCallback): () => void {
    return smartGlassesBle.onFrame(cb);
  }

  /**
   * Ask the glasses to capture a single frame immediately (control command
   * 0x01 REQUEST_SNAPSHOT over the GATT control characteristic).
   */
  async requestSnapshot(): Promise<void> {
    return smartGlassesBle.requestSnapshot();
  }

  /**
   * Check BLE permissions without requesting them (useful for UI gating).
   */
  async checkPermissions() {
    return checkBlePermissions();
  }
}

// ─── Module singleton ─────────────────────────────────────────────────────────

/**
 * Singleton SmartGlassesProvider.
 * Import this wherever the inspection engine or connections screen needs
 * to interact with the Ray-Ban hardware.
 */
export const smartGlassesProvider = new SmartGlassesProvider();
