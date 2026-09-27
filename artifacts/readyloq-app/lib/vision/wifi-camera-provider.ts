/**
 * Wi-Fi camera capture provider.
 *
 * Supports GoPro cameras (via their local HTTP API) and any generic camera
 * that serves a JPEG still at a configurable URL (e.g. /snapshot.jpg,
 * /capture, /photo). The configured URL is stored in-memory for the session.
 *
 * Usage pattern:
 *   1. Call `configureWifiCamera({ baseUrl })` before use.
 *   2. Call `probeWifiCamera()` to verify the camera is reachable.
 *   3. The provider is registered in the registry and capture works normally.
 *
 * DEVICE-CORE LIFECYCLE (Phase 29):
 *   All optional CaptureDeviceProvider lifecycle methods are now implemented so
 *   this provider can be registered in the DeviceRegistry and participate in
 *   health monitoring and event streaming. connect() performs a live HTTP probe.
 */

import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { HealthCheckResult } from "@platform/provider-registry";
import type {
  DeviceStatus,
  DevicePermissions,
  DeviceEvent,
  DeviceEventKind,
  DeviceEventListener,
  DeviceIdentity,
} from "@platform/device-core";
import type { EvidenceItem, RequestCaptureProvider } from "./types";

// ─── Configuration ────────────────────────────────────────────────────────────

interface WifiCameraConfig {
  baseUrl: string;
  capturePath?: string;
  label?: string;
}

const WIFI_CAM_STORAGE_KEY = "@readyloq:wifi-camera-config";

let _config: WifiCameraConfig | null = null;

export function configureWifiCamera(config: WifiCameraConfig): void {
  _config = {
    ...config,
    baseUrl: config.baseUrl.replace(/\/$/, ""),
    capturePath: config.capturePath ?? detectCapturePath(config.baseUrl),
  };
  // Fire-and-forget — never blocks the caller.
  void AsyncStorage.setItem(WIFI_CAM_STORAGE_KEY, JSON.stringify(_config));
}

export function getWifiCameraConfig(): WifiCameraConfig | null {
  return _config;
}

export function clearWifiCameraConfig(): void {
  _config = null;
  void AsyncStorage.removeItem(WIFI_CAM_STORAGE_KEY);
}

/**
 * Restore a previously configured Wi-Fi camera URL from AsyncStorage.
 * Call once at app startup (DevicePlugin.initialize()) so the provider is
 * ready before the user opens the Connections tab or starts an inspection.
 */
export async function restoreWifiCameraConfig(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(WIFI_CAM_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as WifiCameraConfig;
      // Apply the same normalisation as configureWifiCamera but skip the
      // AsyncStorage write (config is already persisted).
      _config = {
        ...stored,
        baseUrl: stored.baseUrl.replace(/\/$/, ""),
        capturePath: stored.capturePath ?? detectCapturePath(stored.baseUrl),
      };
    }
  } catch {
    // Corrupt or missing entry — start unconfigured.
    _config = null;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function detectCapturePath(baseUrl: string): string {
  if (baseUrl.includes("10.5.5.9") || baseUrl.includes("gopro")) {
    return "/gp/gpControl/execute?p1=gpStream&a1=proto_v2&c1=restart";
  }
  return "/snapshot.jpg";
}

function buildCaptureUrl(config: WifiCameraConfig): string {
  const base = config.baseUrl;
  if (base.includes("10.5.5.9")) {
    return `${base}/gp/gpMediaList`;
  }
  return `${base}${config.capturePath ?? "/snapshot.jpg"}`;
}

type ProbeResult = { available: true } | { available: false; reason: string };

export async function probeWifiCamera(): Promise<ProbeResult> {
  if (!_config) return { available: false, reason: "No Wi-Fi camera configured." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const probeUrl = `${_config.baseUrl}/`;
    const res = await fetch(probeUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok || res.status === 404) {
      return { available: true };
    }
    return { available: false, reason: `Camera responded with HTTP ${res.status}.` };
  } catch {
    clearTimeout(timeout);
    return { available: false, reason: "Camera not reachable — check Wi-Fi and IP address." };
  }
}

async function captureFromWifiCamera(): Promise<EvidenceItem[]> {
  if (!_config) throw new Error("Wi-Fi camera is not configured.");

  const url = buildCaptureUrl(_config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let blob: Blob;
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Camera returned HTTP ${res.status}`);
    blob = await res.blob();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  const fileReader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    fileReader.onload = () => resolve(fileReader.result as string);
    fileReader.onerror = reject;
    fileReader.readAsDataURL(blob);
  });

  return [
    {
      id: Crypto.randomUUID(),
      uri: dataUrl,
      source: "wifi_stream",
      capturedAt: new Date().toISOString(),
    },
  ];
}

// ─── Minimal event emitter ───────────────────────────────────────────────────

function makeDeviceEmitter() {
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

// ─── Extended provider type ──────────────────────────────────────────────────

export type WifiCameraProvider = RequestCaptureProvider & {
  readonly name: string;
  readonly priority: number;
  readonly identity: DeviceIdentity;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<DeviceStatus>;
  checkHealth(): Promise<HealthCheckResult>;
  getPermissions(): DevicePermissions;
  on(kind: DeviceEventKind, listener: DeviceEventListener): () => void;
  emit(event: DeviceEvent): void;
  initialize(): Promise<void>;
  teardown(): Promise<void>;
};

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createWifiCameraProvider(): WifiCameraProvider {
  const config = _config;
  if (!config) throw new Error("Wi-Fi camera is not configured.");

  const emitter = makeDeviceEmitter();
  let _connected = false;

  return {
    id: "wifi-camera",
    source: "wifi_stream",
    label: config.label ?? "Wi-Fi camera",
    name: config.label ?? "Wi-Fi camera",
    priority: 75,
    identity: {
      manufacturer: config.label ?? "Wi-Fi Camera",
      model: config.baseUrl,
    },
    capabilities: {
      mode: "request_response",
      transport: "wifi",
      hasLivePreview: false,
      producesVideo: false,
      requiresPairing: false,
    },

    async initialize(): Promise<void> {
      // No-op: the Wi-Fi connection is established in connect()
    },

    async teardown(): Promise<void> {
      _connected = false;
    },

    async connect(): Promise<void> {
      const probe = await probeWifiCamera();
      if (!probe.available) {
        throw new Error(`Wi-Fi camera unreachable: ${probe.reason}`);
      }
      _connected = true;
      emitter.emit({
        kind: "device.connected",
        deviceId: "wifi-camera",
        timestamp: new Date().toISOString(),
      });
    },

    async disconnect(): Promise<void> {
      _connected = false;
      emitter.emit({
        kind: "device.disconnected",
        deviceId: "wifi-camera",
        timestamp: new Date().toISOString(),
      });
    },

    async getStatus(): Promise<DeviceStatus> {
      const probe = await probeWifiCamera();
      const now = new Date().toISOString();
      const reachable = probe.available;
      // A reachable endpoint is not the same as an active connection: the
      // camera may simply be sitting on the network without ever having been
      // connect()-ed (or after a disconnect()). Report "connected" only when
      // _connected is actually true, so callers (e.g. DeviceHealthStrip)
      // can't mistake "reachable" for "in use" and render a false-healthy dot.
      const state = _connected ? "connected" : reachable ? "disconnected" : "error";
      return {
        operational: reachable ? (_connected ? "idle" : "unavailable") : "error",
        connection: {
          state,
          transport: "wifi",
          error: reachable ? undefined : (probe as { available: false; reason: string }).reason,
          connectedAt: _connected ? now : undefined,
        },
        lastSeenAt: now,
      };
    },

    async checkHealth(): Promise<HealthCheckResult> {
      const start = Date.now();
      const probe = await probeWifiCamera();
      const latencyMs = Date.now() - start;
      if (probe.available) {
        return {
          status: "healthy",
          message: `Wi-Fi camera reachable at ${config.baseUrl}`,
          checkedAt: new Date().toISOString(),
          latencyMs,
        };
      }
      return {
        status: "unhealthy",
        message: probe.reason,
        checkedAt: new Date().toISOString(),
        latencyMs,
      };
    },

    getPermissions(): DevicePermissions {
      return {
        granted: true, // Wi-Fi cameras require no OS permissions beyond network access
        required: [],
        async request(): Promise<boolean> {
          return true;
        },
      };
    },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),

    capture: captureFromWifiCamera,
  };
}
