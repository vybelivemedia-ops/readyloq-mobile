/**
 * Universal AI Vision Platform — core contracts.
 *
 * ReadyLoq's inspection workflow is camera-agnostic: evidence can come from
 * the phone camera, imported footage (GoPro / smart-glasses / body-cam clips
 * pulled off the camera roll), or — in future tiers — live external streams.
 * Every source funnels through the same `EvidenceItem` contract into the same
 * local-first persistence, upload, and AI-analysis pipeline. Providers are
 * dumb capture adapters; ALL business logic (persist → sync → analyze) stays
 * outside this module.
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
  | "wifi_stream" // future: direct Wi-Fi preview/pull from an action cam
  | "usb_camera" // future: UVC borescope / endoscope over USB-OTG
  | "smart_glasses"; // future: paired glasses SDK

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
   * Provider-specific context (EXIF, original filename, device model…).
   * Persisted verbatim to `inspection_media.capture_metadata`.
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

/**
 * A capture adapter. `capture()` resolves with zero or more evidence items —
 * zero when the user cancels, several for multi-select imports. Providers must
 * throw on real failures (never swallow) so callers can surface errors.
 */
export type VisionProvider = {
  id: string;
  source: CaptureSource;
  label: string;
  capture: () => Promise<EvidenceItem[]>;
};
