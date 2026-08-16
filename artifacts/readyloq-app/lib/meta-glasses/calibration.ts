/**
 * lib/meta-glasses/calibration.ts
 *
 * Persistence helpers for BasicCalibrationProfile keyed by the glasses
 * device MAC address.  Uses expo-secure-store so the profile survives
 * app restarts without being accessible from other processes.
 *
 * Key format: @readyloq:glasses_calibration:<deviceId>
 *
 * The stored profile is a JSON-serialised BasicCalibrationProfile.
 * `focalLengthPx` is the only field required by BurstMeasurementPipeline
 * and BasicDimensionEstimator; the remaining fields are recorded for
 * diagnostics and future re-calibration nudges.
 */

import * as SecureStore from "expo-secure-store";
import type { BasicCalibrationProfile } from "@platform/measurement-core";
import { REFERENCE_OBJECTS } from "@platform/measurement-core";

// ─── Storage key helpers ──────────────────────────────────────────────────────

/**
 * SecureStore key for the calibration profile belonging to `deviceId`.
 * deviceId is typically the BLE MAC address or BLE device UUID.
 */
function calibrationKey(deviceId: string): string {
  // SecureStore keys must be ≤ 128 chars and must not contain special chars
  // beyond alphanumeric, underscore, hyphen, and colon.
  const safe = deviceId.replace(/[^a-zA-Z0-9\-:]/g, "_");
  return `@readyloq:glasses_calibration:${safe}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the persisted calibration profile for a given glasses device.
 * Returns `null` when no profile has been saved yet.
 */
export async function loadCalibrationProfile(
  deviceId: string,
): Promise<BasicCalibrationProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(calibrationKey(deviceId));
    if (!raw) return null;
    return JSON.parse(raw) as BasicCalibrationProfile;
  } catch {
    return null;
  }
}

/**
 * Persist a calibration profile for a given glasses device.
 * Overwrites any previously saved profile for the same device.
 */
export async function saveCalibrationProfile(
  deviceId: string,
  profile: BasicCalibrationProfile,
): Promise<void> {
  await SecureStore.setItemAsync(
    calibrationKey(deviceId),
    JSON.stringify(profile),
  );
}

/**
 * Remove the stored calibration profile for a device (reset to factory
 * defaults on next pipeline instantiation).
 */
export async function clearCalibrationProfile(deviceId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(calibrationKey(deviceId));
  } catch {
    /* already gone — ignore */
  }
}

// ─── Back-solve helper ────────────────────────────────────────────────────────

/**
 * Derive `focalLengthPx` from a credit-card corner measurement.
 *
 * Uses the pinhole-camera similar-triangles model:
 *   realWidth_m = pixelWidth × depthMeters / focalLengthPx
 *   → focalLengthPx = pixelWidth × depthMeters / realWidth_m
 *                   = pixelWidth × depthMeters × 1000 / knownWidthMm
 *
 * @param pixelWidth       Pixel distance between the left-side and right-side
 *                         corner-tap midpoints on the reference-object image.
 * @param depthMeters      Distance from glasses to the card surface (metres).
 * @param referenceKind    Key into REFERENCE_OBJECTS (default "credit_card").
 */
export function backSolveFocalLength(
  pixelWidth: number,
  depthMeters: number,
  referenceKind: string = "credit_card",
): number {
  const ref = REFERENCE_OBJECTS[referenceKind];
  if (!ref) throw new Error(`Unknown reference object: ${referenceKind}`);
  // focalLengthPx = pixelWidth × depthMeters × 1000 / knownWidthMm
  return (pixelWidth * depthMeters * 1000) / ref.widthMm;
}

/**
 * Build a complete BasicCalibrationProfile from back-solved values.
 *
 * @param deviceId     Glasses BLE device identifier.
 * @param focalLengthPx  Back-solved focal length in pixels.
 * @param imageWidthPx   Width of the calibration image in pixels.
 * @param depthMeters    Depth used during calibration (for metadata).
 */
export function buildCalibrationProfile(
  deviceId: string,
  focalLengthPx: number,
  imageWidthPx: number,
  depthMeters: number,
): BasicCalibrationProfile {
  // pixelToInchRatio at reference depth (matches MeasurementDevicePanel convention)
  const pixelToInchRatio = (depthMeters * 39.3701) / focalLengthPx;
  return {
    deviceId,
    focalLengthPx,
    pixelToInchRatio,
    calibratedAt: Date.now(),
  };
}

/** Focal length used as a fallback when no calibration profile is available. */
export const DEFAULT_FOCAL_LENGTH_PX = 800;
