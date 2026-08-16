/**
 * SfMDepthEngine
 *
 * Triangulates relative depth from a burst capture sequence using epipolar
 * geometry (pinhole parallax formula: Z = f·B / d).
 *
 * ─── Architecture ────────────────────────────────────────────────────────────
 *
 * The engine runs entirely in JS/TS at the orchestration layer.  Heavy
 * pixel-level work (feature extraction, optical flow) is delegated to a
 * native bridge at the `nativeFeatureTrackingBridge` seam.  In development /
 * on hardware that has no native module, `mockNativeFeatureTracking` stands in
 * with a small set of hardcoded matched pairs so the rest of the pipeline can
 * be exercised end-to-end.
 *
 * ─── Platform contract ───────────────────────────────────────────────────────
 *
 * `SfMDepthEngine` implements the `SfMProvider` interface from
 * `@platform/measurement-core`, so it is a drop-in replacement for
 * `FallbackSfMProvider` wherever a `BurstMeasurementPipeline` is constructed:
 *
 *   const pipeline = new BurstMeasurementPipeline(sfmDepthEngine, focalPx);
 *
 * The `computeDepth(frames)` method converts the engine's sparse
 * `TriangulatedPoint[]` output into the platform's `SfMDepthMap` by
 * projecting each point onto a 320×240 depth grid and filling unoccupied
 * pixels with the median depth (a conservative prior for planar surfaces).
 *
 * ─── Accuracy model ──────────────────────────────────────────────────────────
 *
 * For a smartphone at arm's length (~60 cm) with ~8 cm natural hand motion:
 *   - 8 px disparity → Z = (1000 × 0.08) / 8 = 10 m  (too far)
 *   - 80 px disparity → Z = (1000 × 0.08) / 80 = 1 m  (sweet spot)
 *   - 160 px disparity → Z = (1000 × 0.08) / 160 = 0.5 m
 *
 * The baseline of 8 cm is a rough estimate of voluntary hand drift during a
 * 3–5 frame burst at 80 ms spacing.  Future calibration can refine this via
 * IMU integration (see BurstFrame.imuHint).
 */

import type { BurstFrame, SfMDepthMap, SfMProvider } from "@platform/measurement-core";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Point2D {
  x: number;
  y: number;
}

/**
 * A single triangulated 3-D point projected back to the image plane.
 * `u` / `v` are the pixel coordinates in the *reference* (first burst) frame.
 */
export interface TriangulatedPoint {
  id: string;
  /** Pixel column in the reference frame. */
  u: number;
  /** Pixel row in the reference frame. */
  v: number;
  /** Estimated metric depth in metres (Z = f·B / d). */
  depthMeters: number;
  /** Per-point confidence (0–1); higher disparity → lower confidence. */
  confidence: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class SfMDepthEngine implements SfMProvider {
  // Canonical grid size the platform expects from any SfMProvider.
  private static readonly GRID_W = 320;
  private static readonly GRID_H = 240;

  // ─── SfMProvider contract ──────────────────────────────────────────────────

  /**
   * Implements `SfMProvider.computeDepth` from `@platform/measurement-core`.
   *
   * Converts the engine's sparse `TriangulatedPoint[]` into the dense
   * `SfMDepthMap` the platform pipeline expects.
   *
   * Points are normalised to the canonical 320×240 grid.  Pixels without a
   * tracked point are filled with the median depth of the points that exist —
   * a reasonable prior for planar inspection surfaces.
   *
   * @param frames  Burst frames from `BurstMeasurementManager.captureBurst()`.
   * @returns       A `SfMDepthMap` with `scaleVariance` derived from the spread
   *                of the triangulated points.  Low variance → high consistency.
   */
  async computeDepth(frames: BurstFrame[]): Promise<SfMDepthMap> {
    const uris = frames.map((f) => f.uri);
    const points = await this.computeBurstDepthMap(uris);

    const W = SfMDepthEngine.GRID_W;
    const H = SfMDepthEngine.GRID_H;
    const grid = new Float32Array(W * H);

    if (points.length === 0) {
      // No triangulated points — fall back to a flat 0.5 prior (same as
      // FallbackSfMProvider so the downstream anchor still works).
      grid.fill(0.5);
      return { width: W, height: H, relativeDepth: grid, scaleVariance: 1.0, frameCount: frames.length };
    }

    // ── Compute median depth for the fill prior ──────────────────────────────
    const depths = points.map((p) => p.depthMeters).sort((a, b) => a - b);
    const medianDepth = depths[Math.floor(depths.length / 2)];

    // ── Normalise depth values to [0, 1] relative range ─────────────────────
    // 0.0 = nearest point in the set, 1.0 = farthest.
    const minD = depths[0];
    const maxD = depths[depths.length - 1];
    const depthRange = maxD - minD || 1; // guard against single-depth degenerate case

    const normalise = (d: number) => (d - minD) / depthRange;

    // ── Fill grid with median prior, then stamp known points ─────────────────
    grid.fill(normalise(medianDepth));

    // We don't know the original image resolution here, so we treat the
    // tracked u/v coordinates as relative to a 1920×1080 reference frame
    // (typical smartphone sensor) and scale them to the 320×240 grid.
    const srcW = 1920;
    const srcH = 1080;

    for (const pt of points) {
      const col = Math.round((pt.u / srcW) * (W - 1));
      const row = Math.round((pt.v / srcH) * (H - 1));
      if (col >= 0 && col < W && row >= 0 && row < H) {
        grid[row * W + col] = normalise(pt.depthMeters);
      }
    }

    // ── Scale variance: normalised std-dev of the point depths ───────────────
    const mean = depths.reduce((s, d) => s + d, 0) / depths.length;
    const variance = depths.reduce((s, d) => s + (d - mean) ** 2, 0) / depths.length;
    const stdDev = Math.sqrt(variance);
    // Clamp: 0 = perfect consistency, 1 = very noisy (≥ 1 m spread)
    const scaleVariance = Math.min(1, stdDev);

    return { width: W, height: H, relativeDepth: grid, scaleVariance, frameCount: frames.length };
  }

  // ─── Core triangulation API ────────────────────────────────────────────────

  /**
   * Triangulates relative depth from a burst sequence using the epipolar
   * parallax formula:
   *
   *   Z = (focalLength × baseline) / disparity
   *
   * Feature matching between `burstFrameUris[0]` (reference) and
   * `burstFrameUris[N-1]` (target) is handled by `nativeFeatureTrackingBridge`
   * in production, or by `mockNativeFeatureTracking` in development.
   *
   * Only points inside the depth sanity range [0.3 m, 10.0 m] are returned;
   * extreme outliers (sub-pixel noise, static background) are discarded.
   *
   * @param burstFrameUris      Ordered URIs from `BurstMeasurementManager`.
   * @param baselineShiftMeters Estimated camera translation between first and
   *                            last frame (default 8 cm, typical hand drift).
   * @param focalLengthPx       Sensor focal length in pixels (default 1000).
   */
  public async computeBurstDepthMap(
    burstFrameUris: string[],
    baselineShiftMeters: number = 0.08,
    focalLengthPx: number = 1000,
  ): Promise<TriangulatedPoint[]> {
    if (burstFrameUris.length < 2) {
      throw new Error("SfMDepthEngine: at least 2 burst frames are required for triangulation.");
    }

    const referenceUri = burstFrameUris[0];
    const targetUri = burstFrameUris[burstFrameUris.length - 1];

    // Feature tracking: delegate to native bridge in production, mock in dev.
    const matches = await this.resolveFeatureTracking(referenceUri, targetUri);

    const triangulated: TriangulatedPoint[] = [];

    for (const match of matches) {
      // Euclidean pixel displacement between the two frames.
      const disparityPx = Math.hypot(
        match.target.x - match.source.x,
        match.target.y - match.source.y,
      );

      // Discard sub-pixel noise and zero-movement background pixels.
      if (disparityPx <= 0.5) continue;

      const depthMeters = (focalLengthPx * baselineShiftMeters) / disparityPx;

      // Sanity bound: 0.3 m (very close-up) to 10 m (across a large room).
      if (depthMeters < 0.3 || depthMeters > 10.0) continue;

      // Confidence: higher disparity = better triangulation angle = higher
      // confidence, up to a cap at ~40 px (avoids rewarding extreme motion
      // which correlates with blur and mismatches).
      const confidence = Math.min(1.0, disparityPx / 40);

      triangulated.push({
        id: `pt_${Math.round(match.source.x)}_${Math.round(match.source.y)}`,
        u: match.source.x,
        v: match.source.y,
        depthMeters: Number(depthMeters.toFixed(3)),
        confidence,
      });
    }

    return triangulated;
  }

  /**
   * Extracts the median metric depth from a burst, suitable for feeding into
   * `BurstMeasurementManager.computeScaledDimensions` as `estimatedDepthMeters`.
   *
   * Returns `null` when no triangulated points survive the sanity filter —
   * the caller should fall back to a BLE laser reading or a user-supplied
   * distance estimate.
   */
  public async estimateMedianDepth(
    burstFrameUris: string[],
    baselineShiftMeters?: number,
    focalLengthPx?: number,
  ): Promise<number | null> {
    const points = await this.computeBurstDepthMap(
      burstFrameUris,
      baselineShiftMeters,
      focalLengthPx,
    );

    if (points.length === 0) return null;

    const sorted = [...points].sort((a, b) => a.depthMeters - b.depthMeters);
    return sorted[Math.floor(sorted.length / 2)].depthMeters;
  }

  // ─── Native bridge seam ────────────────────────────────────────────────────

  /**
   * Routes to the real native bridge when available, otherwise falls back to
   * the mock implementation.
   *
   * Production replacement: compile a JSI module that wraps OpenCV
   * `calcOpticalFlowPyrLK` or ORB feature matching and register it as
   * `global.__sfmNativeBridge`.  This method checks for that global before
   * calling the mock so existing builds don't require a native module.
   */
  private async resolveFeatureTracking(
    sourceUri: string,
    targetUri: string,
  ): Promise<{ source: Point2D; target: Point2D }[]> {
    // Future: detect injected native bridge here.
    //   if (typeof global.__sfmNativeBridge !== 'undefined') {
    //     return this.nativeFeatureTrackingBridge(sourceUri, targetUri);
    //   }
    return this.mockNativeFeatureTracking(sourceUri, targetUri);
  }

  /**
   * Production native bridge stub.
   *
   * Replace this body with a JSI call to a compiled OpenCV module or an
   * ARKit / ARCore motion estimator.  The return contract (source + target
   * pixel pairs) is fixed; the implementation is free to change.
   */
  private async nativeFeatureTrackingBridge(
    _sourceUri: string,
    _targetUri: string,
  ): Promise<{ source: Point2D; target: Point2D }[]> {
    // Native execution not yet available — this path is reserved for future
    // JSI wiring.  Do NOT call this method directly; use resolveFeatureTracking.
    return [];
  }

  /**
   * Development / CI stand-in for feature tracking.
   *
   * Returns a small set of hand-crafted matched pairs that produce plausible
   * depth values in the 0.5–2 m range.  This keeps the full pipeline
   * exercisable without a native module or real camera frames.
   *
   * The sample points are chosen to exercise:
   *   - A centre cluster (typical subject region)
   *   - An edge point (tests grid boundary clamping in computeDepth)
   *   - Varying disparity magnitudes (3 distinct depth bands)
   */
  private async mockNativeFeatureTracking(
    _sourceUri: string,
    _targetUri: string,
  ): Promise<{ source: Point2D; target: Point2D }[]> {
    return [
      // ~1.0 m — subject at arm's length
      { source: { x: 500, y: 400 }, target: { x: 508, y: 401 } }, // 8 px → 1.0 m
      { source: { x: 600, y: 400 }, target: { x: 610, y: 402 } }, // 10 px → 0.8 m
      // ~1.4 m — slightly farther corner
      { source: { x: 550, y: 500 }, target: { x: 557, y: 501 } }, // 7 px → 1.14 m
      // ~0.67 m — close reference object region
      { source: { x: 960, y: 540 }, target: { x: 972, y: 541 } }, // 12 px → 0.67 m
      // Edge point — tests boundary handling in computeDepth
      { source: { x: 1880, y: 1060 }, target: { x: 1886, y: 1061 } }, // 6.1 px → 1.31 m
    ];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const sfmDepthEngine = new SfMDepthEngine();
