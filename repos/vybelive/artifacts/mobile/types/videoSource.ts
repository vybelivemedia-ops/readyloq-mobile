/**
 * Wearable Device Abstraction Layer — Type Definitions
 *
 * All video sources (phone camera, Meta glasses, GoPro, RTMP encoder, USB cam,
 * WebRTC) implement IVideoSource. The streaming pipeline (Agora RTC + RTMP
 * ingest) never needs to know which physical device is attached.
 *
 * Integration path for a new device:
 *  1. Add a value to VideoSourceType.
 *  2. Create `sources/<YourDevice>Source.ts` extending BaseVideoSource.
 *  3. Add a case to `sources/index.ts` createVideoSource().
 *  4. Add an entry to VIDEO_SOURCE_CATALOG.
 *  5. Add the value to deviceTypeEnum in lib/db/src/schema/index.ts.
 *  6. Add the value to the OpenAPI DeviceType enum and run codegen.
 *  No changes to pov.tsx, agoraPush.ts, clipProcessor.ts, or any other
 *  infrastructure are required.
 */

// Mirror of DB deviceTypeEnum — kept in sync with lib/db/src/schema/index.ts.
export type VideoSourceType =
  | "phone"
  | "gopro"
  | "meta_glasses"
  | "external_rtmp"
  | "usb_camera"
  | "webrtc";

/**
 * How a source feeds video into the Agora pipeline.
 *
 * sdk_capture  — Agora SDK captures frames directly from this device.
 *                The Agora RTC channel carries the video; no separate RTMP hop.
 *                Examples: phone camera, future Meta glasses BLE bridge.
 *
 * rtmp_ingest  — An external encoder pushes RTMP to Agora's cloud ingest URL.
 *                The phone acts as a signalling/monitoring surface only.
 *                Examples: GoPro (WiFi), OBS/Wirecast, WebRTC re-encoder.
 */
export type VideoSourceMode = "sdk_capture" | "rtmp_ingest";

/** Fixed hardware characteristics; never changes at runtime. */
export interface VideoSourceCapabilities {
  maxResolution: { width: number; height: number };
  maxFrameRate: number;
  hasStabilization: boolean;
  hasMicrophone: boolean;
  isWireless: boolean;
  requiresPairing: boolean;
  /** Whether the source supports flipping between front and back view. */
  supportsFlip: boolean;
  mode: VideoSourceMode;
}

export type VideoSourceStatus =
  | "idle"           // not yet connected / no action taken
  | "connecting"     // pairing or permission in progress
  | "connected"      // ready but not yet streaming
  | "streaming"      // actively sending video
  | "error"          // unrecoverable error; see state.error
  | "not_available"; // hardware absent or not supported on this platform

/** Mutable runtime state; emitted to onStateChange listeners on every update. */
export interface VideoSourceState {
  status: VideoSourceStatus;
  /** Battery percentage 0–100. undefined when the source does not report it. */
  batteryLevel?: number;
  /** Wireless signal strength 0–4. undefined for wired sources. */
  signalStrength?: number;
  /** Human-readable error detail; populated when status === 'error'. */
  error?: string;
  /**
   * Human-readable guidance for fixing the error or completing pairing.
   * Shown beneath the error in the UI.
   */
  guidance?: string;
  /** Populated for rtmp_ingest sources once connected. */
  rtmpIngestUrl?: string;
  /** Populated for rtmp_ingest sources once connected. */
  streamKey?: string;
}

/** Passed to connect() by the caller for sources that need runtime config. */
export interface VideoSourceConfig {
  /** RTMP ingest URL generated for the active stream (rtmp_ingest sources). */
  rtmpIngestUrl?: string;
  /** Stream key for RTMP authentication (rtmp_ingest sources). */
  streamKey?: string;
}

export type VideoSourceStateChangeHandler = (state: VideoSourceState) => void;

export interface IVideoSource {
  readonly type: VideoSourceType;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: VideoSourceCapabilities;
  /** Current state snapshot. Always up to date. */
  readonly state: VideoSourceState;

  /**
   * Initialize / connect to this source.
   * - Requests permissions if needed (phone camera).
   * - Begins pairing handshake if required (Meta glasses, GoPro).
   * - Validates config for RTMP ingest.
   * Throws VideoSourceError on any failure.
   * Safe to call when already connected (no-op).
   */
  connect(config?: VideoSourceConfig): Promise<void>;

  /** Disconnect and release all hardware/OS resources. */
  disconnect(): Promise<void>;

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function — call it on component unmount.
   */
  onStateChange(handler: VideoSourceStateChangeHandler): () => void;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export type VideoSourceErrorCode =
  | "NOT_IMPLEMENTED"           // integration is on the roadmap but not yet built
  | "PERMISSION_DENIED"         // OS refused camera / microphone / BLE permission
  | "DEVICE_NOT_FOUND"          // hardware not detected
  | "PAIRING_FAILED"            // BLE / WiFi handshake did not complete
  | "CONNECTION_FAILED"         // general connection error
  | "NOT_SUPPORTED_ON_PLATFORM" // e.g. USB camera on Android
  | "ALREADY_CONNECTED"         // connect() called redundantly (usually harmless)
  | "MISSING_CONFIG";           // required VideoSourceConfig fields were absent

/**
 * Thrown by IVideoSource.connect() on any unrecoverable failure.
 * Always surfaces as an explicit error — no silent fallbacks.
 */
export class VideoSourceError extends Error {
  constructor(
    public readonly code: VideoSourceErrorCode,
    message: string,
    /** Optional actionable guidance shown to the user beneath the error. */
    public readonly guidance?: string
  ) {
    super(message);
    this.name = "VideoSourceError";
  }
}
