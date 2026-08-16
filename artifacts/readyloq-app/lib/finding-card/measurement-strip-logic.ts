/**
 * Pure-logic helpers for the FindingCard measurement strip.
 *
 * FindingCard.tsx imports and uses these so the rendering decisions are
 * testable without a React Native environment.
 */

/** Sub-object stored inside captureMetadata.laserMeasurement */
export interface LaserMeasurement {
  kind?: string;
  value?: number;
  unit?: string;
  signalQuality?: number;
  metadata?: {
    method?: string;
    heightInches?: number;
    areaSqInches?: number;
    confidence?: number;
    warnings?: string[];
  };
}

/**
 * What the measurement strip should display.
 * - "burst"  → full W/H/area block (method === "burst_reference")
 * - "laser"  → width-only block (any other laser measurement present)
 * - "absent" → no strip (captureMetadata absent or has no laserMeasurement)
 */
export type MeasurementStripVariant = "burst" | "laser" | "absent";

/**
 * Extract the LaserMeasurement from a captureMetadata record.
 * Returns null when captureMetadata is absent or has no laserMeasurement key.
 */
export function resolveLaserMeasurement(
  captureMetadata: Record<string, unknown> | null | undefined,
): LaserMeasurement | null {
  if (!captureMetadata) return null;
  const laser = captureMetadata.laserMeasurement;
  if (!laser || typeof laser !== "object") return null;
  return laser as LaserMeasurement;
}

/**
 * True when the laser measurement was produced by the burst-reference pipeline
 * (i.e. full W/H/area are available).
 */
export function isBurstMeasurement(laser: LaserMeasurement): boolean {
  return laser.metadata?.method === "burst_reference";
}

/**
 * Returns the best available confidence score for a laser measurement.
 * The inner `metadata.confidence` (burst pipeline score) is preferred over
 * the outer `signalQuality` (hardware signal level).
 * Returns null when neither is present.
 */
export function measurementConfidence(laser: LaserMeasurement): number | null {
  const inner = laser.metadata?.confidence;
  if (inner != null) return inner;
  const outer = laser.signalQuality;
  if (outer != null) return outer;
  return null;
}

/**
 * True when the resolved confidence score is below the 50 % amber threshold.
 * Null confidence is treated as NOT low-confidence (strip renders normally).
 */
export function isLowConfidence(conf: number | null): boolean {
  return conf != null && conf < 0.5;
}

/**
 * Determine which strip variant to render for a given captureMetadata.
 * This is the single decision point that FindingCard's IIFE evaluates.
 */
export function measurementStripVariant(
  captureMetadata: Record<string, unknown> | null | undefined,
): MeasurementStripVariant {
  const laser = resolveLaserMeasurement(captureMetadata);
  if (!laser) return "absent";
  return isBurstMeasurement(laser) ? "burst" : "laser";
}
