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
 */

// expo-file-system v19 moved cacheDirectory/deleteAsync/copyAsync to /legacy
import * as FileSystem from "expo-file-system/legacy";

import type { BurstFrame } from "@platform/measurement-core";
import { sfmDepthEngine } from "./SfMDepthEngine";

// Re-export so callers don't need to import the platform package directly.
export type { BurstFrame };

// ─── Result type ──────────────────────────────────────────────────────────────

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
}

// ─── Manager ──────────────────────────────────────────────────────────────────

class BurstMeasurementManager {
  /**
   * Captures a rapid 3–5 frame burst for motion triangulation.
   *
   * Frames are written to `FileSystem.cacheDirectory` with unique names.
   * Always call cleanupBurst() after you are done to avoid accumulating
   * temporary JPEGs across inspections.
   *
   * @param cameraRef   A live expo-camera ref with takePictureAsync available.
   * @param frameCount  Number of frames (default 4; clamped to 2–6).
   */
  public async captureBurst(
    cameraRef: { takePictureAsync: (opts: object) => Promise<{ uri: string }> },
    frameCount: number = 4,
  ): Promise<BurstFrame[]> {
    const count = Math.max(2, Math.min(6, frameCount));
    const frames: BurstFrame[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const photo = await cameraRef.takePictureAsync({
          skipProcessing: true, // eliminates 3–8 s JPEG compression delay
          quality: 0.8,
        });

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

    return frames;
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
    focalLengthPx: number = 800,
    heightP1?: { x: number; y: number },
    heightP2?: { x: number; y: number },
  ): BlendedMeasurementResult {
    if (referencePixelLength <= 0) {
      throw new Error("BurstMeasurementManager: referencePixelLength must be > 0");
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
    const refResolutionScore  = Math.min(1, referencePixelLength / 120);
    const depthScore          = estimatedDepthMeters >= 0.2 && estimatedDepthMeters <= 4
      ? 1 - Math.abs(estimatedDepthMeters - 1.5) / 3  // peak at 1.5 m
      : 0.3;
    const confidence = Math.min(1, refResolutionScore * 0.6 + depthScore * 0.4);

    // ── Surface normal ────────────────────────────────────────────────────
    // Default: perpendicular to vertical wall facing camera (z-forward).
    // Upgrade path: pass PlaneEstimator.fitPlane() result from BurstMeasurementPipeline.
    const surfaceNormal = { x: 0, y: 0, z: 1 };

    return { widthMm, heightMm, confidence, surfaceNormal, pxToMmScale };
  }

  /**
   * Convenience wrapper: derives metric depth from the burst frames via the
   * SfM engine and then computes reference-anchored dimensions in one call.
   *
   * ─── When to use this vs computeScaledDimensions ──────────────────────────
   *   • Use this method when you have burst frames but no external depth source
   *     (no BLE laser, no ARKit depth).
   *   • Use computeScaledDimensions directly when you already have a reliable
   *     depth estimate (e.g. from a BLE distance meter).
   *
   * @param frames               Output of captureBurst().
   * @param widthP1              Near endpoint of the target dimension.
   * @param widthP2              Far endpoint of the target dimension.
   * @param referenceKnownMm     Physical width of the reference object (mm).
   * @param referencePixelLength Pixel distance across the reference object.
   * @param focalLengthPx        Camera focal length in pixels (default 1000).
   * @param fallbackDepthMeters  Used when SfM triangulation yields no points
   *                             (e.g. identical frames, pure zoom motion).
   *                             Defaults to 1.0 m — a reasonable arm's-length
   *                             prior for indoor inspections.
   * @param heightP1             Optional: near endpoint of a height dimension.
   * @param heightP2             Optional: far endpoint of a height dimension.
   */
  public async computeScaledDimensionsFromBurst(
    frames: BurstFrame[],
    widthP1: { x: number; y: number },
    widthP2: { x: number; y: number },
    referenceKnownMm: number,
    referencePixelLength: number,
    focalLengthPx: number = 1000,
    fallbackDepthMeters: number = 1.0,
    heightP1?: { x: number; y: number },
    heightP2?: { x: number; y: number },
  ): Promise<BlendedMeasurementResult & { depthSource: "sfm" | "fallback"; depthMeters: number }> {
    const frameUris = frames.map((f) => f.uri);

    // Ask the SfM engine for a median depth estimate from disparity.
    const sfmDepth = await sfmDepthEngine.estimateMedianDepth(
      frameUris,
      0.08,          // 8 cm hand-motion baseline
      focalLengthPx,
    );

    const depthMeters = sfmDepth ?? fallbackDepthMeters;
    const depthSource: "sfm" | "fallback" = sfmDepth !== null ? "sfm" : "fallback";

    const result = this.computeScaledDimensions(
      widthP1,
      widthP2,
      referenceKnownMm,
      referencePixelLength,
      depthMeters,
      focalLengthPx,
      heightP1,
      heightP2,
    );

    return { ...result, depthSource, depthMeters };
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
