/**
 * BurstMeasurementManager
 *
 * Captures a rapid burst of frames via expo-camera and computes reference-
 * anchored, depth-corrected dimensions using the pinhole camera model.
 *
 * ─── Pipeline overview ──────────────────────────────────────────────────────
 *
 *   1. captureBurst()          — 3–5 frames with ~80 ms spacing; natural hand
 *                               motion provides the spatial baseline for SfM.
 *                               Each burst request captures EXIF from the first
 *                               frame and derives focalLengthPx via the
 *                               FocalLenIn35mmFilm field (cached after first
 *                               derivation so subsequent bursts skip the parse).
 *   2. computeScaledDimensions() — reference-anchored pixel→mm scale, depth-
 *                               corrected via (Z / f), with optional planar
 *                               surface-normal projection.
 *   3. cleanupBurst()          — deletes temporary JPEG files from the cache
 *                               directory; must always be called after a burst.
 *
 * ─── Type alignment with @platform/measurement-core ──────────────────────────
 *   BurstFrame is re-exported from the platform package to keep all consumers
 *   on a single type. BlendedMeasurementResult is a local type that carries
 *   the output of this class; it intentionally does NOT extend the platform's
 *   MeasurementResult (which is AI-inference-oriented).
 *
 * ─── Height computation ───────────────────────────────────────────────────────
 *   computeScaledDimensions takes a single endpoint pair (widthP1/widthP2).
 *   Pass heightP1/heightP2 for a second dimension; omit them and heightMm is
 *   null. The old "* 0.75 aspect-ratio fallback" is explicitly removed — a
 *   fabricated height is worse than an honest null.
 *
 * ─── Focal length derivation ──────────────────────────────────────────────────
 *   Phone camera focal lengths vary widely (≈500–1600 px equivalent).
 *   captureBurst() captures EXIF on the first frame and derives focalLengthPx
 *   using the FocalLenIn35mmFilm EXIF field (most portable across Android/iOS):
 *
 *     focalLengthPx = (FocalLenIn35mmFilm / 36 mm) × PixelXDimension
 *
 *   The derived value is cached in module scope for the app session (phone
 *   hardware doesn't change). When EXIF is absent or incomplete, 800 px
 *   (the historical default) is used as a last-resort fallback and the caller
 *   receives `focalLengthSource: "fallback"` so it can surface a warning.
 */

// expo-file-system v19 moved cacheDirectory/deleteAsync/copyAsync to /legacy
import * as FileSystem from "expo-file-system/legacy";

import type { BurstFrame } from "@platform/measurement-core";

// Re-export so callers don't need to import the platform package directly.
export type { BurstFrame };

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Last-resort focal length (pixels) used when EXIF data is unavailable.
 * Corresponds to a typical wide-angle smartphone camera at 1080 px width.
 * Actual device values vary roughly 500–1600 px; relying on this constant
 * introduces a proportional error in all depth-corrected dimensions.
 */
export const DEFAULT_FOCAL_LENGTH_PX = 800;

// ─── Module-level EXIF focal-length cache ─────────────────────────────────────
// Phone camera hardware (and thus focal length) doesn't change during an app
// session; cache the derived value after the first successful EXIF parse.

let _cachedFocalLengthPx: number | null = null;
let _cachedFocalLengthSource: "exif" | "fallback" = "fallback";

/**
 * Derive the effective focal length in pixels from photo EXIF data.
 *
 * Strategy — in priority order:
 *   1. FocalLenIn35mmFilm  (most portable — already normalised to 35mm equiv)
 *        focalPx = (fl35mm / 36 mm) × PixelXDimension
 *   2. Returns null when derivation is not possible from the supplied EXIF.
 *
 * @param exif  Raw EXIF object from expo-camera (takePictureAsync exif:true).
 * @returns Derived focal length in pixels, or null if EXIF is insufficient.
 */
function _deriveFocalLengthPxFromExif(
  exif: Record<string, unknown>,
): number | null {
  // Image pixel width is required to convert mm focal length → pixels.
  const imagePx =
    typeof exif["PixelXDimension"] === "number" ? exif["PixelXDimension"] : null;
  if (!imagePx || imagePx <= 0) return null;

  // Path 1: FocalLenIn35mmFilm — 35 mm equivalent, normalised across sensor sizes.
  // A full-frame 35 mm sensor is 36 mm wide.
  const fl35 =
    typeof exif["FocalLenIn35mmFilm"] === "number"
      ? exif["FocalLenIn35mmFilm"]
      : null;
  if (fl35 && fl35 > 0) {
    const derived = (fl35 / 36) * imagePx;
    // Sanity-check: plausible range for smartphone cameras is 250–2500 px.
    if (derived >= 250 && derived <= 2500) {
      return derived;
    }
  }

  return null;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface BlendedMeasurementResult {
  /** Computed width (p1 → p2 distance), in millimetres. */
  widthMm: number;
  /**
   * Computed height (heightP1 → heightP2 distance), in millimetres.
   * null when no height endpoint pair was supplied.
   */
  heightMm: number | null;
  /**
   * Composite confidence score (0–1).
   * Derived from reference pixel length (longer = sharper scale resolution)
   * and estimated depth (closer = higher confidence from the pinhole model).
   * Penalised by 0.4× when the reference object is clipped (see `clipped`).
   */
  confidence: number;
  /**
   * Surface normal used for planar projection.
   * Defaults to (0, 0, 1) — perpendicular to a vertical wall facing the camera.
   * Future: derive from PlaneEstimator.fitPlane() when SfM depth is available.
   */
  surfaceNormal: { x: number; y: number; z: number };
  /** Pixel-to-mm scale factor, useful for overlaying dimension lines in the UI. */
  pxToMmScale: number;
  /**
   * True when either reference endpoint lies at or beyond an image edge,
   * meaning the reference object was partially out of frame. When true,
   * `referencePixelLength` understates the true object width, so the computed
   * pxToMmScale and all derived dimensions are unreliable.
   * Only populated when `options.referenceP1/P2` and image dimensions are
   * supplied to `computeScaledDimensions`; false otherwise.
   */
  clipped: boolean;
  /**
   * Human-readable warnings produced during computation.
   * Surface every entry to the technician before allowing them to stamp the
   * result into an inspection record.
   */
  warnings: string[];
}

/**
 * Result returned by `captureBurst`.
 *
 * Carries the captured frames alongside the EXIF-derived focal length so
 * callers can construct an accurate `BurstMeasurementPipeline` for this device.
 */
export interface BurstCaptureResult {
  /** Frames captured during the burst, written to the cache directory. */
  frames: BurstFrame[];
  /**
   * Effective camera focal length in pixels.
   * Derived from EXIF `FocalLenIn35mmFilm` when available; otherwise the
   * 800 px last-resort fallback (see `DEFAULT_FOCAL_LENGTH_PX`).
   *
   * Pass this directly to `new BurstMeasurementPipeline(sfm, focalLengthPx)`.
   */
  focalLengthPx: number;
  /**
   * Origin of `focalLengthPx`.
   * "exif"     — derived from EXIF; accurate for this device.
   * "fallback" — EXIF was absent or incomplete; 800 px default was used.
   *              Callers should surface a warning so the technician knows
   *              dimensions may be less accurate.
   */
  focalLengthSource: "exif" | "fallback";
}

// ─── Manager ──────────────────────────────────────────────────────────────────

class BurstMeasurementManager {
  /**
   * Captures a rapid 3–5 frame burst for motion triangulation.
   *
   * Requests EXIF data on the first frame and derives the device focal length
   * in pixels via `FocalLenIn35mmFilm` (cached for the app session).
   * Frames are written to `FileSystem.cacheDirectory` with unique names.
   * Always call cleanupBurst() after you are done to avoid accumulating
   * temporary JPEGs across inspections.
   *
   * @param cameraRef   A live expo-camera ref with takePictureAsync available.
   * @param frameCount  Number of frames (default 4; clamped to 2–6).
   */
  public async captureBurst(
    cameraRef: {
      takePictureAsync: (opts: object) => Promise<{
        uri: string;
        exif?: Record<string, unknown>;
      }>;
    },
    frameCount: number = 4,
  ): Promise<BurstCaptureResult> {
    const count = Math.max(2, Math.min(6, frameCount));
    const frames: BurstFrame[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const photo = await cameraRef.takePictureAsync({
          skipProcessing: true, // eliminates 3–8 s JPEG compression delay
          quality: 0.8,
          exif: true, // request EXIF so we can derive the real focal length
        });

        // ── EXIF focal-length derivation (first frame only, cached) ───────────
        // We only need one EXIF read per camera session; subsequent bursts reuse
        // the cached value without re-parsing.
        if (i === 0 && _cachedFocalLengthPx === null && photo.exif) {
          const derived = _deriveFocalLengthPxFromExif(photo.exif);
          if (derived !== null) {
            _cachedFocalLengthPx = derived;
            _cachedFocalLengthSource = "exif";
            console.log(
              `[BurstMeasurement] EXIF focal length derived: ${derived.toFixed(1)} px`,
            );
          } else {
            console.log(
              "[BurstMeasurement] EXIF present but insufficient for focal length derivation; using fallback",
            );
          }
        }

        const localUri = `${FileSystem.cacheDirectory}burst_${Date.now()}_${i}.jpg`;
        await FileSystem.copyAsync({ from: photo.uri, to: localUri });

        frames.push({ uri: localUri, capturedAt: Date.now() });

        // ~80 ms gap gives ~5–10 px natural hand-motion baseline at arm's length.
        if (i < count - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 80));
        }
      } catch (err) {
        console.warn(`[BurstMeasurement] Frame ${i} failed — skipping:`, err);
      }
    }

    return {
      frames,
      focalLengthPx: _cachedFocalLengthPx ?? DEFAULT_FOCAL_LENGTH_PX,
      focalLengthSource: _cachedFocalLengthPx !== null ? _cachedFocalLengthSource : "fallback",
    };
  }

  /**
   * Computes reference-anchored, depth-corrected dimensions.
   *
   * Formula:
   *   pxToMmScale  = referenceKnownMm / referencePixelLength
   *   rawMm        = targetPixelLength × pxToMmScale × (depthMeters × 1000 / focalLengthPx)
   *
   * The depth correction factor (Z / f) compensates for the angular
   * foreshortening that makes objects appear smaller at distance.
   *
   * @param widthP1              Near endpoint of the target dimension.
   * @param widthP2              Far endpoint of the target dimension.
   * @param referenceKnownMm     Physical width of the reference object (mm).
   * @param referencePixelLength Pixel distance across the reference object.
   * @param estimatedDepthMeters Subject depth from BLE laser or SfM anchor.
   * @param focalLengthPx        Camera focal length in pixels (default 800).
   * @param heightP1             Optional: near endpoint of a second (height) dimension.
   * @param heightP2             Optional: far endpoint of a second (height) dimension.
   */
  public computeScaledDimensions(
    widthP1: { x: number; y: number },
    widthP2: { x: number; y: number },
    referenceKnownMm: number,
    referencePixelLength: number,
    estimatedDepthMeters: number,
    focalLengthPx: number = DEFAULT_FOCAL_LENGTH_PX,
    heightP1?: { x: number; y: number },
    heightP2?: { x: number; y: number },
    options?: {
      /**
       * Pixel-space endpoints of the reference object drag gesture.
       * Required together with `imageWidthPx`/`imageHeightPx` for clipping
       * detection.  When supplied, any endpoint within 2 px of an image
       * edge is treated as clipped — meaning the reference object extends
       * past the frame and the pixel length is understated.
       */
      referenceP1?: { x: number; y: number };
      referenceP2?: { x: number; y: number };
      /** Width of the captured image in pixels. */
      imageWidthPx?: number;
      /** Height of the captured image in pixels. */
      imageHeightPx?: number;
    },
  ): BlendedMeasurementResult {
    if (referencePixelLength <= 0) {
      throw new Error("BurstMeasurementManager: referencePixelLength must be > 0");
    }

    // ── Clipping detection ────────────────────────────────────────────────
    // If either reference endpoint is at or past an image edge the drag was
    // clamped to the visible boundary; the true pixel width is larger than
    // what was measured.  We require both endpoints AND image dimensions to
    // make a definitive determination; without them we cannot know.
    const EDGE_MARGIN_PX = 2;
    let clipped = false;
    const warnings: string[] = [];

    const { referenceP1, referenceP2, imageWidthPx, imageHeightPx } = options ?? {};
    if (referenceP1 && referenceP2 && imageWidthPx && imageHeightPx) {
      const pts = [referenceP1, referenceP2];
      clipped = pts.some(
        (p) =>
          p.x <= EDGE_MARGIN_PX ||
          p.y <= EDGE_MARGIN_PX ||
          p.x >= imageWidthPx  - EDGE_MARGIN_PX ||
          p.y >= imageHeightPx - EDGE_MARGIN_PX,
      );
    }

    if (clipped) {
      warnings.push(
        "Reference object partially out of frame — re-centre and retry",
      );
    }

    // ── Scale factor ───────────────────────────────────────────────────────
    const pxToMmScale = referenceKnownMm / referencePixelLength;

    // ── Depth correction (pinhole similar-triangles) ───────────────────────
    // depthCorrection = Z(mm) / focalLength(px) — dimensionless ratio that
    // converts an on-sensor pixel distance to a real-world mm distance.
    const depthCorrectionFactor = (estimatedDepthMeters * 1000) / focalLengthPx;

    // ── Width ─────────────────────────────────────────────────────────────
    const widthPixels = Math.hypot(widthP2.x - widthP1.x, widthP2.y - widthP1.y);
    const widthMm     = Math.round(widthPixels * pxToMmScale * depthCorrectionFactor);

    // ── Height (only when both endpoints are provided) ────────────────────
    let heightMm: number | null = null;
    if (heightP1 && heightP2) {
      const heightPixels = Math.hypot(heightP2.x - heightP1.x, heightP2.y - heightP1.y);
      heightMm = Math.round(heightPixels * pxToMmScale * depthCorrectionFactor);
    }

    // ── Confidence ────────────────────────────────────────────────────────
    // Two independent contributors:
    //   • Reference resolution: longer reference object in frame → sharper px/mm
    //     Full confidence at ≥ 120 px (credit card width at ~0.5 m).
    //   • Depth plausibility: 0.2 m–4 m is the reliable range for this model.
    // Clipping imposes an additional 0.4× penalty because the scale factor is
    // derived from an understated pixel length.
    const refResolutionScore = Math.min(1, referencePixelLength / 120);
    const depthScore =
      estimatedDepthMeters >= 0.2 && estimatedDepthMeters <= 4
        ? 1 - Math.abs(estimatedDepthMeters - 1.5) / 3 // peak at 1.5 m
        : 0.3;
    const clippingPenalty = clipped ? 0.4 : 1.0;
    const confidence = Math.min(
      1,
      (refResolutionScore * 0.6 + depthScore * 0.4) * clippingPenalty,
    );

    // ── Surface normal ────────────────────────────────────────────────────
    // Default: perpendicular to vertical wall facing camera (z-forward).
    // Upgrade path: pass PlaneEstimator.fitPlane() result from BurstMeasurementPipeline.
    const surfaceNormal = { x: 0, y: 0, z: 1 };

    return { widthMm, heightMm, confidence, surfaceNormal, pxToMmScale, clipped, warnings };
  }

  /**
   * Deletes all temporary burst frame files from the cache directory.
   * Always call this when you are done with a burst — failure to do so
   * accumulates JPEGs across inspections (analogous to the voice-context
   * temp-file accumulation fixed in the sync layer).
   */
  public async cleanupBurst(frames: BurstFrame[]): Promise<void> {
    await Promise.allSettled(
      frames.map((f) =>
        FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => {
          // Already gone or never written — safe to ignore.
        }),
      ),
    );
  }
}

export const burstMeasurementManager = new BurstMeasurementManager();
