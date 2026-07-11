/**
 * Universal AI Vision Platform — core contracts.
 *
 * ReadyLoq's inspection workflow is camera-agnostic: evidence can come from
 * the phone camera, imported footage (GoPro / smart-glasses / body-cam clips
 * pulled off the camera roll), or — in future tiers — live external streams
 * (USB scopes, Wi-Fi/drone cams) and push devices (Meta Ray-Ban glasses).
 * Every source funnels through the same `EvidenceItem` contract into the same
 * local-first persistence, upload, and AI-analysis pipeline. Providers are
 * dumb capture adapters; ALL business logic (persist → sync → analyze) stays
 * outside this module.
 *
 * The abstraction has three layers:
 *   1. `EvidenceItem`      — the universal, source-agnostic output (never change).
 *   2. capability model    — how a source produces evidence (pull / stream / push).
 *   3. provider registry   — runtime discovery (see provider-registry.ts).
 * Adding a new camera = implementing one provider + one registry definition;
 * nothing downstream of `EvidenceItem` changes.
 */

/**
 * Where a piece of evidence physically came from. Stored on the server row
 * (`inspection_media.capture_source`) for provenance and per-source analytics.
 * Tier 1 ships `phone_camera` and `media_import`; the rest are reserved so the
 * schema never needs a migration when new providers land.
 */
export type CaptureSource =
  | "phone_camera" // live capture via the in-app camera
  | "media_import" // imported from the device library (GoPro, glasses, drone…)
  | "wifi_stream" // future: direct Wi-Fi preview/pull from an action/drone cam
  | "usb_camera" // future: UVC borescope / endoscope over USB-OTG
  | "smart_glasses" // future: paired glasses SDK (Meta Ray-Ban)
  | "wearable_camera"; // future: body-cam / other wearables

/** A single captured/imported piece of evidence, pre-upload. */
export type EvidenceItem = {
  /** Local file URI (may live in a cache dir — persist it immediately). */
  uri: string;
  source: CaptureSource;
  /** ISO timestamp of capture/import. */
  capturedAt: string;
  /** Pixel dimensions when the provider knows them. */
  width?: number;
  height?: number;
  /** File size in bytes when the provider knows it. */
  fileSize?: number;
  /**
   * Provider-specific context (EXIF, original filename, device model, GPS,
   * source-side asset id for idempotent re-pulls…). Persisted verbatim to
   * `inspection_media.capture_metadata`.
   */
  metadata?: Record<string, unknown>;
};

/** Result of the on-device quality gate. Advisory only — never blocks capture. */
export type QualityAssessment = {
  /** 0–100. Higher is better. */
  score: number;
  /** False when the evidence is likely too poor for reliable AI analysis. */
  acceptable: boolean;
  /** Human-readable reasons (shown to the technician as a warning). */
  reasons: string[];
};

// ─── Capability model ───────────────────────────────────────────────────────
// Describes HOW a source delivers evidence, so the capture UI can render the
// right controls (shutter vs. connect+grab vs. "listening for device") without
// knowing anything about the specific hardware.

/**
 * - `request_response`: app asks, gets a finite result now (phone, library import,
 *   USB/Wi-Fi still-grab). Implements `RequestCaptureProvider`.
 * - `session_stream`: connection-oriented live feed; app grabs frames on demand
 *   (USB scope, Wi-Fi/drone). Implements `SessionCaptureProvider`.
 * - `async_push`: the DEVICE initiates; evidence arrives later, out of band,
 *   possibly while the capture screen is closed (glasses, wearables).
 *   Implements `PushCaptureProvider`.
 */
export type CaptureMode = "request_response" | "session_stream" | "async_push";

/** Physical transport a source uses — drives availability probing + permissions. */
export type CaptureTransport =
  | "on_device"
  | "on_device_library"
  | "usb"
  | "wifi"
  | "ble"
  | "cloud";

/** How the capture screen should render this source's live preview, if any. */
export type PreviewKind = "native_camera" | "stream_url" | "none";

export type CaptureCapabilities = {
  mode: CaptureMode;
  transport: CaptureTransport;
  hasLivePreview: boolean;
  producesVideo: boolean;
  requiresPairing: boolean;
};

/** Whether a source is usable on THIS device right now. */
export type ProviderAvailability =
  | { available: true }
  | { available: false; reason: string };

/** Live connection state for session/push providers. */
export type ProviderStatus =
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "ready"
  | "capturing"
  | "error";

/**
 * The single sink every source feeds. Request/response callers pass the result
 * of `capture()` here; session/push providers call it whenever frames arrive —
 * even asynchronously. This is what decouples "evidence arrived" from "the user
 * pressed a button" (the requirement for glasses/drone). The implementation
 * (persist → dedupe → quality-gate → sync) lives in the capture screen and
 * needs no change when a new source is added.
 */
export type EvidenceIntake = (
  items: EvidenceItem[],
  ctx: { providerId: string; source: CaptureSource },
) => Promise<void>;

/** Common fields shared by every capture provider. */
export type CaptureProviderBase = {
  id: string;
  source: CaptureSource;
  label: string;
  capabilities: CaptureCapabilities;
};

/** Pull model: phone camera, library import, USB/Wi-Fi still-grab. */
export type RequestCaptureProvider = CaptureProviderBase & {
  /**
   * Resolves with zero or more evidence items — zero when the user cancels,
   * several for multi-select imports. MUST throw on real failures (never
   * swallow) so callers can surface errors.
   */
  capture: () => Promise<EvidenceItem[]>;
};

/** An open connection to a streaming source. */
export type CaptureSession = {
  /** Grab a still/frame from the live feed on demand. */
  grab: () => Promise<EvidenceItem[]>;
  disconnect: () => Promise<void>;
};

/** Session model: connection-oriented live streams (USB scope, Wi-Fi/drone). */
export type SessionCaptureProvider = CaptureProviderBase & {
  previewKind: PreviewKind;
  /** Open the connection; frames grabbed later flow through `intake`. */
  connect: (intake: EvidenceIntake) => Promise<CaptureSession>;
};

/** A live push session that delivers evidence until ended. */
export type PushCaptureSession = { end: () => Promise<void> };

/** Push model: the device initiates capture (glasses, wearables). */
export type PushCaptureProvider = CaptureProviderBase & {
  /** Start listening; the device pushes evidence through `intake` as it arrives. */
  startSession: (intake: EvidenceIntake) => Promise<PushCaptureSession>;
};

export type CaptureProvider =
  | RequestCaptureProvider
  | SessionCaptureProvider
  | PushCaptureProvider;

/**
 * @deprecated Use `RequestCaptureProvider`. Retained as an alias so existing
 * imports keep compiling; the two are structurally identical.
 */
export type VisionProvider = RequestCaptureProvider;
