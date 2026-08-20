/**
 * Degenerate-geometry guard for BurstMeasurementPipeline results.
 *
 * A near-zero reference box can drive ReferenceScaleAnchor to divide by ~0,
 * producing Infinity or NaN dimensions.  These helpers are the single source
 * of truth for the two guards that keep invalid results out of the UI and the
 * measurement bridge:
 *
 *   assertFiniteDimensions — called in handleRunBurstMeasure; throws so the
 *     catch block shows a friendly alert and setMeasureResult() is never called.
 *
 *   isStampableResult — called in handleStampMeasureResult; returns false so
 *     setLastMeasurementReading() is never called for a non-finite result.
 *
 * Extracting them here lets vitest import and test the real guard logic
 * without React Native, while new-inspection.tsx stays authoritative.
 */

export interface BurstDimensions {
  widthInches: number;
  heightInches: number;
  areaSqInches: number;
}

/** The exact message shown to the technician when a guard fires. */
export const DEGENERATE_GEOMETRY_ERROR =
  "Measurement produced invalid dimensions — refit the reference box and try again";

/**
 * Throws {@link DEGENERATE_GEOMETRY_ERROR} when any dimension is non-finite
 * (Infinity or NaN).  Called by handleRunBurstMeasure before setMeasureResult()
 * so a corrupt result can never reach the results sheet.
 */
export function assertFiniteDimensions(result: BurstDimensions): void {
  if (
    !Number.isFinite(result.widthInches) ||
    !Number.isFinite(result.heightInches) ||
    !Number.isFinite(result.areaSqInches)
  ) {
    throw new Error(DEGENERATE_GEOMETRY_ERROR);
  }
}

/**
 * Returns true when `result` is safe to stamp.  Mirrors the early-return guard
 * in handleStampMeasureResult — false prevents setLastMeasurementReading() from
 * being called for a non-finite result.
 */
export function isStampableResult<T extends BurstDimensions>(result: T | null): result is T {
  return result !== null && Number.isFinite(result.widthInches);
}
