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
 *
 * Expiry
 * ──────
 * Profiles built with buildCalibrationProfile() carry an `expiresAt` field
 * (ISO-8601) set 90 days in the future.  loadCalibrationProfile() treats an
 * expired profile as absent (returns null) so the pipeline falls back to the
 * default focal length.  loadCalibrationProfileWithStatus() returns the raw
 * profile alongside a status tag for UI use (display the calibration date and
 * a Recalibrate nudge without discarding the profile data).
 */

import * as SecureStore from "expo-secure-store";
import type { BasicCalibrationProfile } from "@platform/measurement-core";
import { REFERENCE_OBJECTS } from "@platform/measurement-core";

// ─── Expiry constants ─────────────────────────────────────────────────────────

/** Profiles older than this many days are treated as uncalibrated. */
export const CALIBRATION_EXPIRY_DAYS = 90;

/**
 * Profiles expiring within this many days trigger the "approaching expiry"
 * nudge in ConnectedGlassesCard without yet being considered expired.
 */
export const CALIBRATION_WARN_DAYS = 7;

// ─── Public expiry types ──────────────────────────────────────────────────────

/**
 * Freshness bucket for a loaded calibration profile.
 *
 *   valid          — more than CALIBRATION_WARN_DAYS days remain.
 *   expiring_soon  — within CALIBRATION_WARN_DAYS days of expiry.
 *   expired        — effective expiry is in the past; pipeline must not use this
 *                    profile and should fall back to the default focal length.
 *
 * Legacy profiles without an expiresAt are NOT a separate bucket — a derived
 * expiry of calibratedAt + CALIBRATION_EXPIRY_DAYS is used so they are
 * eventually retired rather than trusted forever.
 */
export type CalibrationStatus = "valid" | "expiring_soon" | "expired";

/** Result returned by loadCalibrationProfileWithStatus for UI consumers. */
export interface CalibrationLoadResult {
  profile: BasicCalibrationProfile;
  status: CalibrationStatus;
  /**
   * Whole days until expiry (positive = future, negative = past).
   * Null when the effective expiry cannot be computed (malformed expiresAt).
   */
  daysUntilExpiry: number | null;
  /**
   * The effective expiry as an ISO-8601 string for display purposes.
   * For profiles with a valid expiresAt this is that value; for legacy
   * profiles it is derived from calibratedAt + CALIBRATION_EXPIRY_DAYS.
   * Null when expiresAt is present but cannot be parsed (malformed).
   */
  effectiveExpiresAt: string | null;
}

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

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Classify a raw profile into a CalibrationStatus based on current time.
 * Does not read from storage.
 *
 * Expiry resolution rules (in priority order):
 *   1. expiresAt present and parseable → use it.
 *   2. expiresAt present but unparseable (NaN) → fail-closed: treat as expired.
 *   3. expiresAt absent (legacy profile) → derive from calibratedAt + CALIBRATION_EXPIRY_DAYS
 *      so old profiles are eventually retired rather than trusted forever.
 */
function classifyProfile(profile: BasicCalibrationProfile, now = Date.now()): {
  status: CalibrationStatus;
  daysUntilExpiry: number | null;
  effectiveExpiresAt: string | null;
} {
  let expiresMs: number;
  let effectiveExpiresAt: string | null;

  if (profile.expiresAt !== undefined) {
    expiresMs = new Date(profile.expiresAt).getTime();
    // Unparseable / corrupt expiresAt → fail-closed; cannot show a date.
    if (!Number.isFinite(expiresMs)) {
      return { status: "expired", daysUntilExpiry: null, effectiveExpiresAt: null };
    }
    effectiveExpiresAt = profile.expiresAt;
  } else {
    // Legacy profile: derive a 90-day window from the calibration timestamp.
    expiresMs = profile.calibratedAt + CALIBRATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    effectiveExpiresAt = new Date(expiresMs).toISOString();
  }

  const msRemaining = expiresMs - now;
  const daysUntilExpiry = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  if (msRemaining <= 0) {
    return { status: "expired", daysUntilExpiry, effectiveExpiresAt };
  }
  if (daysUntilExpiry <= CALIBRATION_WARN_DAYS) {
    return { status: "expiring_soon", daysUntilExpiry, effectiveExpiresAt };
  }
  return { status: "valid", daysUntilExpiry, effectiveExpiresAt };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the persisted calibration profile for a given glasses device.
 *
 * Returns `null` when:
 *   - No profile has been saved.
 *   - The stored profile has an `expiresAt` in the past (treat as uncalibrated
 *     so the pipeline uses the safe default focal length instead of a stale one).
 *
 * Legacy profiles without an `expiresAt` field are returned as-is so existing
 * technicians are not silently downgraded before they next re-calibrate.
 *
 * Use loadCalibrationProfileWithStatus() from UI components that need to
 * display the calibration date or an expiry warning even for expired profiles.
 */
export async function loadCalibrationProfile(
  deviceId: string,
): Promise<BasicCalibrationProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(calibrationKey(deviceId));
    if (!raw) return null;
    const profile = JSON.parse(raw) as BasicCalibrationProfile;
    const { status } = classifyProfile(profile);
    if (status === "expired") return null;
    return profile;
  } catch {
    return null;
  }
}

/**
 * Load the persisted calibration profile together with its freshness status.
 *
 * Unlike loadCalibrationProfile(), this function returns expired profiles so
 * UI components can display the calibration date and a "Recalibrate" nudge.
 * The pipeline should never use a profile whose status is "expired".
 *
 * Returns `null` when no profile has been saved.
 */
export async function loadCalibrationProfileWithStatus(
  deviceId: string,
): Promise<CalibrationLoadResult | null> {
  try {
    const raw = await SecureStore.getItemAsync(calibrationKey(deviceId));
    if (!raw) return null;
    const profile = JSON.parse(raw) as BasicCalibrationProfile;
    const { status, daysUntilExpiry, effectiveExpiresAt } = classifyProfile(profile);
    return { profile, status, daysUntilExpiry, effectiveExpiresAt };
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
 * The profile includes an `expiresAt` field set to CALIBRATION_EXPIRY_DAYS
 * days in the future.  loadCalibrationProfile() will return null after that
 * date so the pipeline falls back to the default focal length.
 *
 * @param deviceId       Glasses BLE device identifier.
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
  const now = Date.now();
  const expiresAt = new Date(
    now + CALIBRATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    deviceId,
    focalLengthPx,
    pixelToInchRatio,
    calibratedAt: now,
    expiresAt,
  };
}

/** Focal length used as a fallback when no calibration profile is available. */
export const DEFAULT_FOCAL_LENGTH_PX = 800;
