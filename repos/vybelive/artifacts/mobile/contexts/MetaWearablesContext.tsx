/**
 * MetaWearablesContext
 *
 * Wraps the `expo-meta-wearables-dat` package (Meta Wearables Device Access
 * Toolkit, Developer Preview) and exposes a single app-wide interface for
 * registration, device discovery, the Mock Device Kit, and session-based
 * video streaming from Ray-Ban / Oakley Meta glasses.
 *
 * Two independent "no real hardware" paths are supported:
 *
 *   1. Mock Device Kit (real SDK feature, dev/debug build only)
 *      enableMockKit() → enableMockDeviceKit() + pairMockDevice() +
 *      mockDeviceSetCameraFeedFromCamera(). The SDK simulates a paired pair of
 *      glasses and uses the phone camera as the glasses feed. This is the
 *      official way to test the full DAT flow without owning hardware.
 *
 *   2. Real device connection
 *      startRegistration() opens the Meta AI app to authorise VYBE LIVE; once
 *      registered, connected glasses appear in `devices` and streaming works
 *      against the real hardware.
 *
 * Expo Go fallback:
 *   The native module cannot load in Expo Go (it crashes at module-load time,
 *   same as react-native-agora). When running in Expo Go we substitute a small
 *   JS simulation hook so the UI flow remains testable; the phone camera stands
 *   in for the glasses feed (see GlassesStreamView).
 *
 * Credentials (META_APP_ID / META_APP_SECRET) are injected at build time via
 * the Expo config plugin in app.config.ts. Without them the SDK runs in
 * developer mode, where the Mock Device Kit is still available.
 *
 * SDK: https://github.com/facebook/meta-wearables-dat-ios
 * Package: expo-meta-wearables-dat v1.3.0 (MIT)
 * Max stream: 720p @ 30fps (Bluetooth-constrained)
 */

import Constants from "expo-constants";
import { Linking } from "react-native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Type-only import — fully erased at compile time, so it never triggers a
// runtime require() and is safe in Expo Go.
import type {
  CameraFacing,
  Device,
  DeviceType,
  LinkState,
  MockDeviceKitConfig,
  Permission,
  PermissionStatus,
  PhotoCaptureFormat,
  RegistrationState,
  StreamSessionConfig,
  StreamSessionState,
} from "expo-meta-wearables-dat";

// Re-export the SDK state types under stable aliases used across the app.
export type DATRegistrationState = RegistrationState;
export type DATStreamState = StreamSessionState;
export type { LinkState, DeviceType, PermissionStatus };

// ── Runtime environment guard ─────────────────────────────────────────────────
// Static import of expo-meta-wearables-dat crashes Expo Go at module-load time;
// we guard with appOwnership before require() (same pattern as Agora).
const IS_EXPO_GO = Constants.appOwnership === "expo";

// ── Subset of the SDK hook surface this context actually consumes ─────────────

interface MetaHookOptions {
  onStreamStateChange?: (state: StreamSessionState) => void;
  onPhotoCaptured?: (photo: { filePath: string }) => void;
  onRegistrationStateChange?: (state: RegistrationState) => void;
  onDevicesChange?: (devices: Device[]) => void;
}

interface MetaHook {
  isConfigured: boolean;
  registrationState: RegistrationState;
  permissionStatus: PermissionStatus;
  devices: Device[];
  streamState: StreamSessionState;
  startRegistration: () => Promise<void>;
  startUnregistration: () => Promise<void>;
  requestPermission: (permission: Permission) => Promise<PermissionStatus>;
  refreshDevices: () => Promise<Device[]>;
  createSession: (deviceId?: string) => Promise<string>;
  startSession: (sessionId: string) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  addStreamToSession: (sessionId: string, config?: Partial<StreamSessionConfig>) => Promise<void>;
  capturePhoto: (format?: PhotoCaptureFormat) => Promise<void>;
  enableMockDeviceKit: (config?: MockDeviceKitConfig) => Promise<void>;
  disableMockDeviceKit: () => Promise<void>;
  isMockDeviceKitEnabled: () => Promise<boolean>;
  pairMockDevice: () => Promise<string>;
  unpairMockDevice: (deviceId: string) => Promise<void>;
  mockDeviceSetCameraFeedFromCamera: (deviceId: string, facing: CameraFacing) => Promise<void>;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Expo Go simulation hook ───────────────────────────────────────────────────
// Mirrors the real hook's reactive shape so the UI behaves identically.

function useSimulatedMetaWearables(_opts?: MetaHookOptions): MetaHook {
  const [registrationState, setRegistrationState] = useState<RegistrationState>("available");
  const [streamState, setStreamState] = useState<StreamSessionState>("stopped");
  const [devices, setDevices] = useState<Device[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("granted");
  const mockEnabledRef = useRef(false);
  const sessionCounter = useRef(0);
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SIM_DEVICE: Device = {
    identifier: "sim-rayban-1",
    name: "Ray-Ban Meta (Simulated)",
    linkState: "connected",
    deviceType: "rayBanMeta",
    compatibility: "compatible",
  };

  return {
    isConfigured: true,
    registrationState,
    permissionStatus,
    devices,
    streamState,
    startRegistration: async () => {
      setRegistrationState("registering");
      await delay(1200);
      setRegistrationState("registered");
      setDevices([SIM_DEVICE]);
    },
    startUnregistration: async () => {
      setRegistrationState("available");
      setDevices([]);
    },
    requestPermission: async () => {
      setPermissionStatus("granted");
      return "granted";
    },
    refreshDevices: async () => devices,
    createSession: async () => `sim-session-${++sessionCounter.current}`,
    startSession: async () => {
      setStreamState("starting");
    },
    stopSession: async () => {
      if (streamTimer.current) clearTimeout(streamTimer.current);
      setStreamState("stopped");
    },
    addStreamToSession: async () => {
      setStreamState("starting");
      streamTimer.current = setTimeout(() => setStreamState("streaming"), 600);
    },
    capturePhoto: async () => {
      /* no-op in simulation */
    },
    enableMockDeviceKit: async () => {
      mockEnabledRef.current = true;
      setRegistrationState("registered");
      setDevices([SIM_DEVICE]);
    },
    disableMockDeviceKit: async () => {
      mockEnabledRef.current = false;
      setRegistrationState("available");
      setDevices([]);
    },
    isMockDeviceKitEnabled: async () => mockEnabledRef.current,
    pairMockDevice: async () => SIM_DEVICE.identifier,
    unpairMockDevice: async () => {
      setDevices([]);
    },
    mockDeviceSetCameraFeedFromCamera: async () => {
      /* phone camera stand-in is rendered by GlassesStreamView */
    },
  };
}

// ── Load the real native hook once at module init (stable reference) ──────────

let _realHook: ((opts?: MetaHookOptions) => MetaHook) | null = null;
let _realHandleUrl: ((url: string) => void) | null = null;
let _isRealSDK = false;

if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-meta-wearables-dat") as {
      useMetaWearables?: unknown;
      handleUrl?: (url: string) => void;
    };
    if (typeof mod.useMetaWearables === "function") {
      _realHook = mod.useMetaWearables as unknown as (opts?: MetaHookOptions) => MetaHook;
      _realHandleUrl = mod.handleUrl ?? null;
      _isRealSDK = true;
    }
  } catch {
    // Native module unavailable (e.g. dev build without prebuild) — use simulation.
  }
}

const useDAT: (opts?: MetaHookOptions) => MetaHook = _realHook ?? useSimulatedMetaWearables;

// ── Normalized device shape exposed to the app ────────────────────────────────

export interface MetaDevice {
  id: string;
  name: string;
  linkState: LinkState;
  deviceType: DeviceType;
  isConnected: boolean;
  /**
   * Battery percentage when available. The DAT SDK's Device type does not
   * currently expose battery, so this is null for real hardware and only
   * populated in Mock Device Kit / Expo Go simulation for UI demonstration.
   */
  batteryLevel: number | null;
}

const MOCK_BATTERY = 82;

export function deviceTypeLabel(t: DeviceType): string {
  switch (t) {
    case "rayBanMeta":
      return "Ray-Ban Meta";
    case "oakleyMetaHSTN":
      return "Oakley Meta HSTN";
    case "oakleyMetaVanguard":
      return "Oakley Meta Vanguard";
    case "metaRayBanDisplay":
      return "Meta Ray-Ban Display";
    case "rayBanMetaOptics":
      return "Ray-Ban Meta (Optics)";
    default:
      return "Meta Glasses";
  }
}

// ── Context interface ─────────────────────────────────────────────────────────

interface MetaWearablesContextValue {
  /** True when the native DAT SDK is loaded; false in Expo Go (simulation). */
  isRealSDK: boolean;
  /** True when running inside Expo Go. */
  isExpoGo: boolean;
  isConfigured: boolean;
  registrationState: RegistrationState;
  permissionStatus: PermissionStatus;
  devices: MetaDevice[];
  /** First connected device (or first known device) — what we stream from. */
  connectedDevice: MetaDevice | null;
  /** Battery of the connected device when available, else null. */
  batteryLevel: number | null;
  /** Whether the SDK Mock Device Kit is currently enabled. */
  mockKitEnabled: boolean;
  /** Active DAT session ID, populated while a stream session is running. */
  sessionId: string | null;
  streamState: StreamSessionState;
  /** Register with the Meta AI app (real-device path). */
  startRegistration: () => Promise<void>;
  /** Tear down registration. */
  unregister: () => Promise<void>;
  /** Enable the Mock Device Kit: pairs a mock device fed by the phone camera. */
  enableMockKit: () => Promise<void>;
  /** Disable the Mock Device Kit. */
  disableMockKit: () => Promise<void>;
  /** Create a DAT session and start streaming from the glasses. */
  startGlassesStream: () => Promise<void>;
  /** Stop the active DAT session. */
  stopGlassesStream: () => Promise<void>;
  /** Capture a still photo from the glasses camera. */
  captureGlassesPhoto: () => Promise<void>;
}

// ── Provider ──────────────────────────────────────────────────────────────────

const MetaWearablesContext = createContext<MetaWearablesContextValue | null>(null);

export function MetaWearablesProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mockKitEnabled, setMockKitEnabled] = useState(false);
  // Mirror sessionId in a ref so the lifecycle callbacks can stay referentially
  // stable. Without this, an effect cleanup in a consumer can capture a stale
  // (pre-session) stopGlassesStream and no-op, leaking the DAT session.
  const sessionIdRef = useRef<string | null>(null);
  const setSession = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  const dat = useDAT({
    onPhotoCaptured: (photo) => {
      console.log("[MetaDAT] Photo captured:", photo.filePath);
    },
  });

  // Keep a stable ref to the latest hook value so callbacks don't churn.
  const datRef = useRef(dat);
  datRef.current = dat;

  // Handle deep-link callbacks from the Meta AI app (registration flow).
  useEffect(() => {
    const handleIncomingUrl = (url: string) => {
      if (url.startsWith("vybelive://") && _realHandleUrl) {
        _realHandleUrl(url);
      }
    };
    const sub = Linking.addEventListener("url", ({ url }) => handleIncomingUrl(url));
    void Linking.getInitialURL().then((url) => {
      if (url) handleIncomingUrl(url);
    });
    return () => sub.remove();
  }, []);

  // Sync the Mock Device Kit flag on mount.
  useEffect(() => {
    let cancelled = false;
    datRef.current
      .isMockDeviceKitEnabled()
      .then((v) => {
        if (!cancelled) setMockKitEnabled(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const enableMockKit = useCallback(async () => {
    const d = datRef.current;
    await d.enableMockDeviceKit({ initiallyRegistered: true, initialPermissionsGranted: true });
    try {
      const id = await d.pairMockDevice();
      // Use the phone's back camera as the simulated glasses feed.
      await d.mockDeviceSetCameraFeedFromCamera(id, "back");
    } catch {
      // Pairing/feed setup is best-effort; the kit is still enabled.
    }
    setMockKitEnabled(true);
  }, []);

  const disableMockKit = useCallback(async () => {
    try {
      await datRef.current.disableMockDeviceKit();
    } catch {
      /* ignore */
    }
    setMockKitEnabled(false);
  }, []);

  const startGlassesStream = useCallback(async () => {
    const d = datRef.current;
    if (sessionIdRef.current) return; // session already active
    // Ensure camera permission before opening a session.
    if (d.permissionStatus !== "granted") {
      try {
        await d.requestPermission("camera");
      } catch {
        /* surfaced via stream state / UI */
      }
    }
    // Open the session, then mark it active only once it is fully started.
    // On any failure, tear it down so a stale sessionId can't block retries.
    const id = await d.createSession();
    try {
      await d.startSession(id);
      await d.addStreamToSession(id, { resolution: "medium", frameRate: 30 });
      setSession(id);
      // streamState transitions to "streaming" reactively via the hook.
    } catch (err) {
      try {
        await d.stopSession(id);
      } catch {
        /* best-effort cleanup */
      }
      setSession(null);
      throw err;
    }
  }, [setSession]);

  const stopGlassesStream = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await datRef.current.stopSession(id);
    } catch {
      /* ignore cleanup errors */
    }
    setSession(null);
  }, [setSession]);

  const captureGlassesPhoto = useCallback(async () => {
    // Let failures propagate so the POV UI can show real success/error feedback.
    await datRef.current.capturePhoto("jpeg");
  }, []);

  // Normalize devices and derive the connected device + battery.
  const isSimulated = IS_EXPO_GO || mockKitEnabled;
  const devices: MetaDevice[] = dat.devices.map((d) => ({
    id: d.identifier,
    name: d.name,
    linkState: d.linkState,
    deviceType: d.deviceType,
    isConnected: d.linkState === "connected",
    batteryLevel: isSimulated ? MOCK_BATTERY : null,
  }));
  const connectedDevice = devices.find((d) => d.isConnected) ?? devices[0] ?? null;
  const batteryLevel = connectedDevice?.batteryLevel ?? null;

  return (
    <MetaWearablesContext.Provider
      value={{
        isRealSDK: _isRealSDK,
        isExpoGo: IS_EXPO_GO,
        isConfigured: dat.isConfigured,
        registrationState: dat.registrationState,
        permissionStatus: dat.permissionStatus,
        devices,
        connectedDevice,
        batteryLevel,
        mockKitEnabled,
        sessionId,
        streamState: dat.streamState,
        startRegistration: dat.startRegistration,
        unregister: dat.startUnregistration,
        enableMockKit,
        disableMockKit,
        startGlassesStream,
        stopGlassesStream,
        captureGlassesPhoto,
      }}
    >
      {children}
    </MetaWearablesContext.Provider>
  );
}

export function useMetaWearablesContext(): MetaWearablesContextValue {
  const ctx = useContext(MetaWearablesContext);
  if (!ctx) throw new Error("useMetaWearablesContext must be used within MetaWearablesProvider");
  return ctx;
}
