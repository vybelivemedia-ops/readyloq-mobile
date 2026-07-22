/**
 * @platform/device-core
 *
 * Universal hardware abstraction layer.
 *
 * Every hardware provider — camera, microphone, sensor, wearable, IoT device —
 * implements DeviceProvider. The inspection engine and stream engine never know
 * the manufacturer. They ask for a DeviceProvider with certain DeviceCapabilities
 * and the DeviceRegistry routes to the best available one.
 *
 * NEW DEVICE IN 3 YEARS?
 *   Write one new DeviceProvider implementation. Register it.
 *   The rest of the platform works unchanged.
 *
 * READYLOQ DEVICES (all implement DeviceProvider):
 *   Native camera     — already registered via camera-core
 *   Moisture meters   — sensor category, wired/ble transport
 *   Thermal imagers   — sensor + camera category, usb/wifi transport
 *   Borescopes        — camera category, usb/wifi transport
 *   Laser distance    — sensor category, ble transport
 *   Environmental     — sensor category, ble/wifi transport
 *   Smart bait traps  — sensor + actuator category, ble/cellular transport
 *   BLE IoT devices   — sensor category, ble transport
 *
 * VYBE DEVICES (all implement DeviceProvider):
 *   Native camera     — already registered via camera-core
 *   Meta Ray-Ban      — wearable + camera category, ble/wifi transport
 *   GoPro             — camera category, usb/wifi transport
 *   DJI               — camera category, wifi/cellular transport
 *   Insta360          — camera category, usb/wifi transport
 *   FLIR thermal      — camera + sensor category, usb/wifi transport
 *   Future LiDAR      — sensor category, usb/wifi transport
 *
 * DEPENDENCY GRAPH:
 *   device-core → core
 *   device-core → shared-types
 *   device-core → provider-registry  (DeviceRegistry extends ManagedRegistry)
 *
 * hardware packages depend on device-core:
 *   camera-core, voice-intelligence, measurement-core, meta-wearables
 *   (refactor pass — they adopt DeviceProvider as their foundation)
 *
 * GOVERNANCE:
 *   No domain logic lives here. DeviceCapabilities.tokens are generic strings.
 *   The application layer assigns meaning (e.g. "capture.photo", "sensor.temperature").
 *   DeviceProfile.settings is Record<string, unknown> — the app defines the schema.
 */

import type {
  CapabilityProvider,
  ManagedRegistry,
  Discovery,
  Lifecycle,
  PrioritizedProvider,
  HealthCheckResult,
} from "@platform/provider-registry";

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE TAXONOMY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Physical transport layer the device uses to connect to the host.
 * A device may support multiple transports (e.g. a GoPro: usb + wifi).
 */
export type DeviceTransport =
  | "usb"       // Wired USB/USB-C
  | "ble"       // Bluetooth Low Energy
  | "wifi"      // Wi-Fi (direct or network)
  | "nfc"       // Near-field communication
  | "cellular"  // LTE/5G modem
  | "wired"     // Generic wired (serial, HDMI capture, etc.)
  | "internal"; // Built-in device (e.g. native phone camera/microphone)

/**
 * Broad functional category of the device.
 * A device may satisfy multiple categories (e.g. a thermal imager is both
 * "camera" and "sensor").
 */
export type DeviceCategory =
  | "camera"      // Photo / video capture
  | "microphone"  // Audio capture
  | "sensor"      // Environmental / physical sensors (temperature, humidity, gas, etc.)
  | "display"     // Output display
  | "scanner"     // Barcode, QR code, laser rangefinder
  | "actuator"    // Motors, valves, triggers, locks
  | "wearable"    // Head-mounted, body-worn, AR glasses
  | "compute"     // Edge compute / co-processor devices
  | "storage"     // External storage media
  | "network"     // Network interface devices
  | "diagnostic"; // Testing and diagnostic instruments (moisture meters, FLIR, borescopes)

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE CAPABILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What this device can do. Discovered dynamically at runtime.
 *
 * The application layer inspects capabilities to decide which workflow
 * steps the device can satisfy — the platform never hardcodes manufacturer
 * assumptions.
 *
 * tokens: generic capability strings the application defines.
 *   ReadyLoq examples: "capture.photo", "capture.video", "sensor.temperature",
 *                      "sensor.humidity", "sensor.moisture", "scan.qr"
 *   VYBE examples:     "capture.video", "capture.stream", "capture.360"
 */
export interface DeviceCapabilities {
  /** One or more functional categories this device covers. */
  categories: DeviceCategory[];
  /** One or more physical transports this device supports. */
  transports: DeviceTransport[];
  /** Whether the device can show a live preview on the host screen. */
  hasLivePreview: boolean;
  /** Whether the device produces storable media (photo, video, audio). */
  producesMedia: boolean;
  /** Whether the device requires a pairing step before first use. */
  requiresPairing: boolean;
  /** Whether the device can stream data continuously to the host. */
  supportsStreaming: boolean;
  /** Whether the device can operate without a host connection (store-and-forward). */
  supportsOffline: boolean;
  /**
   * Specific capability tokens. The platform stores and queries these;
   * the application assigns meaning.
   */
  tokens: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable identity information for a physical device.
 * Populated from device handshake or OS device APIs.
 */
export interface DeviceIdentity {
  manufacturer: string;
  model: string;
  serialNumber?: string;
  hardwareVersion?: string;
  firmwareVersion?: string;
  /** MAC address or other hardware-layer unique ID. */
  hardwareId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE CONNECTION
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceConnectionState =
  | "disconnected"
  | "discovering"
  | "connecting"
  | "connected"
  | "pairing"
  | "paired"
  | "reconnecting"
  | "error";

export interface DeviceConnection {
  readonly state: DeviceConnectionState;
  /** Which transport is currently in use. */
  readonly transport: DeviceTransport;
  /**
   * Signal strength for wireless transports (BLE, Wi-Fi). 0–100.
   * Undefined for wired/internal transports.
   */
  readonly signalStrength?: number;
  readonly connectedAt?: string; // ISO-8601
  readonly error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE STATUS
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceOperationalStatus =
  | "idle"        // Connected, ready, not currently in use
  | "active"      // Currently in use by a workflow step
  | "busy"        // In use by another process; not available
  | "error"       // Non-fatal error; may recover
  | "updating"    // Firmware update in progress
  | "calibrating" // Sensor calibration in progress
  | "unavailable"; // Cannot be used (e.g. OS permission denied, hardware fault)

export interface DeviceStatus {
  operational: DeviceOperationalStatus;
  connection: DeviceConnection;
  battery?: DeviceBattery;
  thermal?: DeviceThermal;
  /** ISO-8601 timestamp of the last status update received from the device. */
  lastSeenAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE BATTERY
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceBattery {
  /** 0–100. */
  level: number;
  isCharging: boolean;
  estimatedRemainingMinutes?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE THERMAL
// ─────────────────────────────────────────────────────────────────────────────

export type ThermalState =
  | "nominal"   // Normal operating temperature
  | "fair"      // Slightly elevated; monitor
  | "serious"   // Throttling likely; alert user
  | "critical"; // Throttling or shutdown imminent

export interface DeviceThermal {
  state: ThermalState;
  /** Celsius. Undefined if device does not expose temperature. */
  temperatureCelsius?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface DevicePermissions {
  /** Whether the OS has granted access to this device type. */
  granted: boolean;
  /**
   * OS permission identifiers required for this device.
   * Examples: "android.permission.BLUETOOTH_CONNECT", "NSCameraUsageDescription"
   */
  required: string[];
  /**
   * Trigger the OS permission prompt for any not-yet-granted permissions.
   * Returns true if all permissions are now granted.
   */
  request(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE FIRMWARE
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceFirmware {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  /**
   * Initiate a firmware update. Resolves when the update completes.
   * Undefined if this device does not support OTA updates.
   */
  update?: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosticsTest {
  name: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
}

export interface DiagnosticsResult {
  passed: boolean;
  tests: DiagnosticsTest[];
  ranAt: string; // ISO-8601
}

export interface DeviceDiagnostics {
  /** Run a self-test sequence and return the result. */
  runSelfTest(): Promise<DiagnosticsResult>;
  /** The most recent self-test result, if any. */
  lastResult?: DiagnosticsResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A stored configuration snapshot for a specific device instance.
 * The platform stores and retrieves profiles; the application defines
 * what `settings` contains (e.g. capture resolution, sensitivity thresholds).
 */
export interface DeviceProfile {
  id: string;
  deviceId: string;
  /** Human-readable profile name (e.g. "High Resolution", "Night Mode"). */
  name: string;
  settings: Record<string, unknown>;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceEventKind =
  | "device.connected"
  | "device.disconnected"
  | "device.paired"
  | "device.unpaired"
  | "device.battery_low"       // battery.level ≤ 20
  | "device.battery_critical"  // battery.level ≤ 5
  | "device.thermal_warning"   // thermal.state = "serious"
  | "device.thermal_critical"  // thermal.state = "critical"
  | "device.firmware_update_available"
  | "device.error"
  | "device.status_changed";

export interface DeviceEvent {
  kind: DeviceEventKind;
  deviceId: string;
  timestamp: string; // ISO-8601
  payload?: Record<string, unknown>;
}

export type DeviceEventListener = (event: DeviceEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE PROVIDER — the main interface every hardware provider implements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The contract every hardware provider must implement.
 *
 * Extends:
 *   CapabilityProvider<DeviceCapabilities>  — id, name, capabilities
 *   Lifecycle                               — initialize(), teardown()
 *   PrioritizedProvider                     — priority ranking for DeviceRegistry.getPrimary()
 *
 * All hardware integrations (Meta Ray-Ban, GoPro, DJI, moisture meters, FLIR, etc.)
 * implement this interface. The platform and application code only ever interact
 * with DeviceProvider — never with a concrete implementation.
 */
export interface DeviceProvider
  extends CapabilityProvider<DeviceCapabilities>,
    Lifecycle,
    PrioritizedProvider {

  readonly identity: DeviceIdentity;

  // ── Connection ────────────────────────────────────────────────────────────

  /** Connect to the physical device. Resolves when connected and ready. */
  connect(): Promise<void>;
  /** Gracefully disconnect. Resolves when fully disconnected. */
  disconnect(): Promise<void>;

  // ── Status ────────────────────────────────────────────────────────────────

  /** Fetch the current device status (operational, connection, battery, thermal). */
  getStatus(): Promise<DeviceStatus>;

  /**
   * Probe liveness — lightweight alternative to getStatus() for health checks.
   * Returns a HealthCheckResult compatible with @platform/provider-registry.
   */
  checkHealth(): Promise<HealthCheckResult>;

  // ── Permissions ───────────────────────────────────────────────────────────

  getPermissions(): DevicePermissions;

  // ── Optional capabilities ─────────────────────────────────────────────────

  /**
   * Firmware information and OTA update capability.
   * Undefined if this device type does not support firmware inspection.
   */
  getFirmware?(): Promise<DeviceFirmware>;

  /**
   * Self-test / diagnostic capability.
   * Undefined if this device type does not support diagnostics.
   */
  getDiagnostics?(): DeviceDiagnostics;

  // ── Events ────────────────────────────────────────────────────────────────

  /**
   * Subscribe to a device event kind.
   * Returns an unsubscribe function — call it to stop listening.
   */
  on(event: DeviceEventKind, listener: DeviceEventListener): () => void;

  /**
   * Emit a device event. Called internally by the provider implementation.
   * External code should subscribe via on(), not call emit() directly.
   */
  emit(event: DeviceEvent): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE REGISTRY — domain-specific extension of ManagedRegistry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The central registry for DeviceProvider instances.
 *
 * Extends ManagedRegistry<DeviceProvider> from @platform/provider-registry,
 * adding device-specific query methods (findByCategory, findByToken, getPrimary).
 *
 * Registration is done by each hardware plugin during its initialize() call.
 * The application never creates DeviceProviders directly — it always goes
 * through the DeviceRegistry.
 */
export interface DeviceRegistry extends ManagedRegistry<DeviceProvider> {
  /** All registered devices of a given category (e.g. "camera", "sensor"). */
  findByCategory(category: DeviceCategory): DeviceProvider[];
  /** All registered devices that support a specific transport. */
  findByTransport(transport: DeviceTransport): DeviceProvider[];
  /**
   * All registered devices that carry a specific capability token.
   * Example: findByToken("sensor.temperature") → all temperature-capable devices.
   */
  findByToken(token: string): DeviceProvider[];
  /**
   * The highest-priority healthy device for a category.
   * Uses PrioritizedProvider.priority + last known health.
   * Returns undefined if no device of that category is registered.
   */
  getPrimary(category: DeviceCategory): DeviceProvider | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE DISCOVERY — scan for new hardware at runtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extends the generic Discovery<DeviceProvider> contract with transport-scoped
 * scanning (e.g. scan BLE-only vs. USB-only).
 *
 * Implementations typically register discovered devices with the DeviceRegistry
 * as a side effect of scan().
 */
export interface DeviceDiscovery {
  /**
   * Scan for devices on a specific transport.
   * @param transport  Which transport layer to scan.
   * @param timeoutMs  Maximum scan duration. Default: implementation-defined.
   */
  scan(transport: DeviceTransport, timeoutMs?: number): Promise<DeviceProvider[]>;
  /** Cancel any in-progress scan. */
  stopScan(): void;
  readonly isScanning: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE REGISTRY — concrete factory
// ─────────────────────────────────────────────────────────────────────────────

export { createDeviceRegistry } from "./device-registry-impl";

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE LIFECYCLE — subsystem-level lifecycle (manages the whole registry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Higher-level lifecycle that manages the device subsystem as a whole.
 * Distinct from DeviceProvider's Lifecycle (which manages a single device).
 *
 * Implemented by the DevicePlugin in platform-intelligence.
 */
export interface DeviceLifecycle {
  /**
   * Start the device subsystem.
   * Runs initial discovery and registers found devices with the provided registry.
   * Called once at app startup by the DevicePlugin.initialize().
   */
  start(registry: DeviceRegistry): Promise<void>;
  /**
   * Gracefully shut down all active devices.
   * Calls teardown() on every registered DeviceProvider.
   */
  shutdown(): Promise<void>;
  /**
   * Reconnect all previously paired devices.
   * Called after app-backgrounding or network restoration.
   */
  reconnect(): Promise<void>;
}
