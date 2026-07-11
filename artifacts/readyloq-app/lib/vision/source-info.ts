/**
 * Presentation metadata for a capture source. Pure data (no React) so it can
 * be used anywhere evidence provenance is surfaced — gallery thumbnails, the
 * full-screen viewer, server-media grids. Keep in sync with `CaptureSource`.
 */

import type { CaptureSource } from "./types";

export type CaptureSourceInfo = {
  /** Short human label, e.g. "GoPro / imported". */
  label: string;
  /** Ionicons glyph name. */
  icon: string;
  /** True for the default in-app camera — callers usually hide the badge for it. */
  isDefault: boolean;
};

const INFO: Record<CaptureSource, CaptureSourceInfo> = {
  phone_camera: { label: "Phone camera", icon: "camera-outline", isDefault: true },
  media_import: { label: "Imported", icon: "images-outline", isDefault: false },
  wifi_stream: { label: "Wi-Fi camera", icon: "wifi-outline", isDefault: false },
  usb_camera: { label: "USB scope", icon: "hardware-chip-outline", isDefault: false },
  smart_glasses: { label: "Smart glasses", icon: "glasses-outline", isDefault: false },
  wearable_camera: { label: "Wearable cam", icon: "body-outline", isDefault: false },
};

const FALLBACK: CaptureSourceInfo = {
  label: "Other source",
  icon: "ellipse-outline",
  isDefault: false,
};

/** Resolve display info for any capture-source string (unknown values included). */
export function describeCaptureSource(source: string | null | undefined): CaptureSourceInfo {
  if (!source) return INFO.phone_camera;
  return INFO[source as CaptureSource] ?? FALLBACK;
}

/** Below this 0–100 score the evidence is flagged low-quality in the UI. */
export const LOW_QUALITY_THRESHOLD = 50;

/** True when a score is present and below the low-quality threshold. */
export function isLowQuality(qualityScore: number | null | undefined): boolean {
  return typeof qualityScore === "number" && qualityScore < LOW_QUALITY_THRESHOLD;
}
