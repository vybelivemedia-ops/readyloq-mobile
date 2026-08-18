/**
 * @platform/measurement-core
 *
 * Measurement and metrics abstractions — units, conversions, calibration,
 * dimension estimation from images, and physical hardware device contracts.
 *
 * STATUS: New package — interfaces extracted from ReadyLoq measurement roadmap.
 *
 * TWO MEASUREMENT PARADIGMS:
 *   1. Software / AI inference  — MeasurementInferenceProvider (no hardware)
 *      Uses computer vision + monocular depth to estimate dimensions from photos.
 *      ReadyLoq's primary path: photo → reference object detection → scale → estimate.
 *
 *   2. Physical hardware        — MeasurementDeviceProvider (extends DeviceProvider)
 *      Moisture meters, laser distance meters, thermal imagers, environmental
 *      sensors. Plugged in via BLE/USB/wired; readings arrive as structured data.
 *
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   MeasurementDeviceProvider extends DeviceProvider, giving every physical
 *   measurement instrument the full device lifecycle: connect/disconnect,
 *   getStatus, checkHealth, getPermissions, on/emit, initialize/teardown.
 *   MeasurementInferenceProvider stays unchanged — it is software, not hardware.
 *
 * DEPENDENCY GRAPH:
 *   measurement-core → shared-types
 *   measurement-core → device-core → provider-registry → core
 *
 * FUTURE WORK:
 *   - Concrete adapters for Protimeter, Fluke, FLIR (extracted from ReadyLoq)
 *   - Calibration service implementation
 *   - AR anchor calibration path
 */
// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT EVENTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Domain event kinds emitted by the measurement subsystem.
 * All values follow the "measurement.<noun>.<verb>" convention.
 */
export const MEASUREMENT_EVENT_KINDS = {
    INFERENCE_STARTED: "measurement.inference.started",
    INFERENCE_COMPLETED: "measurement.inference.completed",
    INFERENCE_FAILED: "measurement.inference.failed",
    ANNOTATION_CREATED: "measurement.annotation.created",
    ANNOTATION_REVISED: "measurement.annotation.revised",
    CALIBRATION_UPDATED: "measurement.calibration.updated",
    DEVICE_READING_RECEIVED: "measurement.device.reading_received",
    DEVICE_CONNECTED: "measurement.device.connected",
    DEVICE_DISCONNECTED: "measurement.device.disconnected",
    CACHE_HIT: "measurement.cache.hit",
    CACHE_MISS: "measurement.cache.miss",
};
/**
 * Pinhole-camera dimension estimator.
 *
 * Uses the similar-triangles relationship:
 *   realSize (m) = pixelSize × depthMeters / focalLengthPx
 *
 * Width  is derived from the vector between vertices[0] → vertices[1].
 * Height is derived from the vector between vertices[0] → vertices[3]
 * (i.e. assumes an axis-aligned or near-axis-aligned bounding quad).
 *
 * All outputs are in inches (1 m ≈ 39.3701 in).
 *
 * @example
 * const est = new BasicDimensionEstimator(800);
 * const geo = PolygonCalculator.calculateAreaAndPerimeter(vertices, 0.05);
 * const widthIn = est.estimateWidthInches(geo, 1.5);
 */
export class BasicDimensionEstimator {
    focalLengthPx;
    /** @param focalLengthPx Effective focal length in pixels. Defaults to 800 (typical wide-angle phone camera). */
    constructor(focalLengthPx = 800) {
        this.focalLengthPx = focalLengthPx;
    }
    /**
     * Estimate real-world width from the edge between vertices[0] and vertices[1].
     * Returns 0 when the polygon has fewer than 2 vertices.
     */
    estimateWidthInches(polygon, depthMeters) {
        if (polygon.vertices.length < 2)
            return 0;
        const [a, b] = polygon.vertices;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const pixelWidth = Math.sqrt(dx * dx + dy * dy);
        const meters = (pixelWidth * depthMeters) / this.focalLengthPx;
        return meters * 39.3701;
    }
    /**
     * Estimate real-world height from the edge between vertices[0] and vertices[3].
     * Returns 0 when the polygon has fewer than 4 vertices.
     */
    estimateHeightInches(polygon, depthMeters) {
        if (polygon.vertices.length < 4)
            return 0;
        const a = polygon.vertices[0];
        const d = polygon.vertices[3];
        const dx = d.x - a.x;
        const dy = d.y - a.y;
        const pixelHeight = Math.sqrt(dx * dx + dy * dy);
        const meters = (pixelHeight * depthMeters) / this.focalLengthPx;
        return meters * 39.3701;
    }
}
/**
 * Stateless polygon geometry calculator.
 *
 * calculateAreaAndPerimeter uses the Shoelace formula for area and
 * Euclidean distance for perimeter, then applies a uniform scale factor
 * (inches per pixel) to produce real-world measurements.
 *
 * The scale factor should be calibrated against a known reference object
 * or derived from BasicCalibrationProfile.pixelToInchRatio.
 *
 * @example
 * const geo = PolygonCalculator.calculateAreaAndPerimeter(
 *   [{ x:100,y:100 },{ x:300,y:100 },{ x:300,y:400 },{ x:100,y:400 }],
 *   0.05, // inches per pixel at reference depth
 * );
 * // geo.areaSquareInches ≈ 100 sq in  (200×300 px × 0.05²)
 */
export class PolygonCalculator {
    /**
     * Compute area (sq in) and perimeter (in) of a pixel-space polygon.
     *
     * @param vertices         Pixel-space vertices in winding order (CW or CCW).
     * @param scaleInchesPerPixel  Calibrated inches-per-pixel at the subject depth.
     */
    static calculateAreaAndPerimeter(vertices, scaleInchesPerPixel) {
        const n = vertices.length;
        let areaPixels = 0;
        let perimeterPixels = 0;
        for (let i = 0; i < n; i++) {
            const cur = vertices[i];
            const next = vertices[(i + 1) % n];
            // Shoelace accumulator
            areaPixels += cur.x * next.y - next.x * cur.y;
            // Perimeter accumulator
            const dx = next.x - cur.x;
            const dy = next.y - cur.y;
            perimeterPixels += Math.sqrt(dx * dx + dy * dy);
        }
        areaPixels = Math.abs(areaPixels) / 2;
        const sq = scaleInchesPerPixel * scaleInchesPerPixel;
        return {
            vertices,
            areaSquareInches: areaPixels * sq,
            perimeterInches: perimeterPixels * scaleInchesPerPixel,
        };
    }
    /**
     * Sample the average depth under a polygon from a DepthMapData buffer.
     * Uses a simple point-in-polygon bounding-box scan; good enough for
     * convex quads at inspection distances.
     *
     * Returns the mean depth in metres, or `null` if no samples were inside.
     */
    static sampleMeanDepth(vertices, depthMap) {
        if (vertices.length < 3)
            return null;
        const xs = vertices.map((v) => v.x);
        const ys = vertices.map((v) => v.y);
        const xMin = Math.max(0, Math.floor(Math.min(...xs)));
        const xMax = Math.min(depthMap.width - 1, Math.ceil(Math.max(...xs)));
        const yMin = Math.max(0, Math.floor(Math.min(...ys)));
        const yMax = Math.min(depthMap.height - 1, Math.ceil(Math.max(...ys)));
        let sum = 0;
        let count = 0;
        for (let py = yMin; py <= yMax; py++) {
            for (let px = xMin; px <= xMax; px++) {
                if (PolygonCalculator._pointInPolygon({ x: px, y: py }, vertices)) {
                    sum += depthMap.buffer[py * depthMap.width + px];
                    count++;
                }
            }
        }
        return count > 0 ? sum / count : null;
    }
    /** Ray-casting point-in-polygon test. */
    static _pointInPolygon(pt, polygon) {
        let inside = false;
        const n = polygon.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const vi = polygon[i];
            const vj = polygon[j];
            if (vi.y > pt.y !== vj.y > pt.y &&
                pt.x < ((vj.x - vi.x) * (pt.y - vi.y)) / (vj.y - vi.y) + vi.x) {
                inside = !inside;
            }
        }
        return inside;
    }
}
/**
 * Built-in fallback SfM provider.
 *
 * Produces a flat (uniform 0.5) relative depth map — meaning "no structural
 * depth information is available." The pipeline then relies entirely on the
 * reference-object anchor to derive metric depth. Accuracy is equivalent to
 * the single-frame pinhole estimator (`BasicDimensionEstimator`), but the
 * pipeline still applies planar locking for perspective correction.
 *
 * Replace with a native ARKit/ARCore or neural-depth provider for higher
 * accuracy without a reference object.
 */
export class FallbackSfMProvider {
    async computeDepth(frames) {
        // We have no pixel data to analyse — return uniform prior.
        // A single non-zero variance signals to the pipeline that this is a
        // low-confidence map rather than a perfectly flat scene.
        const width = 320; // canonical low-res grid
        const height = 240;
        const data = new Float32Array(width * height).fill(0.5);
        return {
            width,
            height,
            relativeDepth: data,
            scaleVariance: 1.0, // maximum uncertainty
            frameCount: frames.length,
        };
    }
}
/**
 * Minimum reference object pixel width required for a valid scale anchor.
 * Below this threshold, pixelWidth ≈ 0 → referenceDepthMeters → Infinity,
 * which produces stampable-looking Infinity/NaN dimensions downstream.
 * The guard fires early and surfaces a warning instead of letting the
 * divide-by-zero reach the stamping UI.
 */
export const MIN_REFERENCE_PIXEL_WIDTH = 5;
/**
 * Minimum reference object pixel width for a reliable (non-distant) anchor.
 * Between MIN_REFERENCE_PIXEL_WIDTH and this value the math is finite, but the
 * result is likely inaccurate because the reference object is too far away.
 * anchor() emits a user-visible warning so the technician knows to move closer
 * before stamping the measurement into the inspection record.
 */
export const MIN_REFERENCE_RELIABLE_PIXEL_WIDTH = 40;
/**
 * Anchors a relative SfMDepthMap to metric (absolute) scale using a reference
 * object with known physical dimensions.
 *
 * The technician (or auto-detector) supplies the bounding box of a reference
 * object in image space; this class back-solves the depth at that location
 * from the pinhole model and uses it to globally scale the depth map.
 *
 * Formula:
 *   depth_m = focalLengthPx × realWidthMm / (pixelWidth × 1000)
 *   metersPerRelativeUnit = depth_m / relativeDepth_at_centroid
 */
export class ReferenceScaleAnchor {
    focalLengthPx;
    constructor(focalLengthPx = 800) {
        this.focalLengthPx = focalLengthPx;
    }
    /**
     * Compute scale anchoring from a bounding box dragged by the technician.
     *
     * @param box              Normalised bounding box (0–1 coords) of reference object.
     * @param imageWidthPx     Width of the source image in pixels.
     * @param imageHeightPx    Height of the source image in pixels.
     * @param referenceObject  Known-dimension reference (credit card, outlet plate, etc.).
     * @param depthMap         The relative SfM depth map to be scaled.
     */
    anchor(box, imageWidthPx, imageHeightPx, referenceObject, depthMap) {
        // Detect whether the supplied bounding box clips any image edge.
        // Normalised coords must stay within [0, 1] on both axes; anything outside
        // means the reference object is partially out of frame, which understates
        // its pixel width and causes a silent depth-estimation error.
        const clipped = box.x < 0 ||
            box.y < 0 ||
            box.x + box.width > 1 ||
            box.y + box.height > 1;
        // Pixel width of the reference object in the image.
        // Use the raw (possibly clipped) value so callers see how much width was
        // observed; the `clipped` flag tells them not to trust the result.
        const pixelWidth = box.width * imageWidthPx;
        const anchorWarnings = [];
        // Guard: a near-zero reference box (e.g. a single tap) produces a
        // pixelWidth ≈ 0, making referenceDepthMeters → Infinity and every
        // downstream dimension NaN or Infinity.  Catch it here — before the
        // divide — and surface a warning so the pipeline can relay it to the UI
        // instead of propagating an unrepresentable value.
        const tooSmall = pixelWidth < MIN_REFERENCE_PIXEL_WIDTH;
        if (tooSmall) {
            anchorWarnings.push(`Reference box is too small to anchor scale (${pixelWidth.toFixed(1)} px width, ` +
                `minimum is ${MIN_REFERENCE_PIXEL_WIDTH} px) — draw a larger box around the reference object`);
        }
        // Guard: a reference object that is too far away produces a finite but
        // unreliable scale estimate.  The result looks plausible to the UI yet is
        // systematically wrong.  Warn the technician to move closer rather than
        // silently accepting a low-confidence number into the inspection record.
        const tooDistant = !tooSmall && pixelWidth < MIN_REFERENCE_RELIABLE_PIXEL_WIDTH;
        if (tooDistant) {
            anchorWarnings.push(`Reference object too small / too far away — move closer and retry ` +
                `(${pixelWidth.toFixed(1)} px observed, ${MIN_REFERENCE_RELIABLE_PIXEL_WIDTH} px recommended)`);
        }
        // Pinhole depth back-projection (metres).
        // When pixelWidth is below the threshold we clamp to the minimum so that
        // downstream numeric values are finite (confidence will be 0, so the result
        // is discarded, but we avoid propagating Infinity into the pipeline).
        const safePixelWidth = tooSmall ? MIN_REFERENCE_PIXEL_WIDTH : pixelWidth;
        const referenceDepthMeters = (this.focalLengthPx * referenceObject.widthMm) / (safePixelWidth * 1000);
        // Sample relative depth at the bounding box centroid
        const cx = Math.round((box.x + box.width / 2) * depthMap.width);
        const cy = Math.round((box.y + box.height / 2) * depthMap.height);
        const clampedCx = Math.max(0, Math.min(depthMap.width - 1, cx));
        const clampedCy = Math.max(0, Math.min(depthMap.height - 1, cy));
        const relativeAtCentroid = depthMap.relativeDepth[clampedCy * depthMap.width + clampedCx];
        // Avoid division by zero / degenerate maps
        const safeRelative = relativeAtCentroid > 0.001 ? relativeAtCentroid : 0.5;
        const metersPerRelativeUnit = referenceDepthMeters / safeRelative;
        // Confidence: penalise low pixel width (far object = noisy), high variance,
        // and clipping (clipped anchor has systematically wrong scale).
        // A below-threshold box FORCES confidence to exactly 0 — no variance or
        // other factor can rescue an invalid anchor.  The clamped safePixelWidth
        // keeps downstream values finite, but the caller must not stamp the result.
        let confidence;
        if (tooSmall) {
            confidence = 0;
        }
        else {
            const pixelConfidence = Math.min(1, pixelWidth / 80); // 80 px = full conf
            const varianceConfidence = Math.max(0, 1 - depthMap.scaleVariance);
            const clippingPenalty = clipped ? 0.4 : 1.0;
            confidence = (pixelConfidence * 0.7 + varianceConfidence * 0.3) * clippingPenalty;
        }
        return {
            metersPerRelativeUnit,
            referenceDepthMeters,
            referencePixelWidth: pixelWidth,
            referenceRealWidthMm: referenceObject.widthMm,
            confidence: Math.min(1, Math.max(0, confidence)),
            clipped,
            warnings: anchorWarnings,
        };
    }
    /**
     * Convert a normalised image point to a world-space Point3D using the
     * scaled depth map.
     *
     * @param pt     Normalised image point (0–1).
     * @param depthMap  The relative SfM depth map.
     * @param anchor    The scale anchor result from `anchor()`.
     * @param imageWidthPx   Source image width.
     * @param imageHeightPx  Source image height.
     */
    unprojectPoint(pt, depthMap, anchor, imageWidthPx, imageHeightPx) {
        const mx = Math.round(pt.x / imageWidthPx * depthMap.width);
        const my = Math.round(pt.y / imageHeightPx * depthMap.height);
        const cx = Math.max(0, Math.min(depthMap.width - 1, mx));
        const cy = Math.max(0, Math.min(depthMap.height - 1, my));
        const relDepth = depthMap.relativeDepth[cy * depthMap.width + cx];
        const depthMeters = relDepth * anchor.metersPerRelativeUnit;
        // Pinhole un-projection: (px - cx_img) / f * depth, (py - cy_img) / f * depth
        const halfW = imageWidthPx / 2;
        const halfH = imageHeightPx / 2;
        return {
            x: ((pt.x - halfW) / this.focalLengthPx) * depthMeters,
            y: ((pt.y - halfH) / this.focalLengthPx) * depthMeters,
            z: depthMeters,
        };
    }
}
/**
 * Fits a plane to a 3-D point cloud and projects measurements onto it.
 *
 * Algorithm: centred least-squares via 3×3 covariance matrix →
 * power-iteration to find the smallest eigenvector (plane normal).
 * Runs in O(N) time; suitable for real-time use on the JS thread.
 *
 * Pest control measurements almost always land on planar architectural
 * surfaces (walls, baseboards, concrete slabs). Projecting the unprojected
 * point cloud onto the dominant plane before measuring eliminates the
 * perspective foreshortening error that would otherwise scale results by
 * cos(angle_to_camera).
 */
export class PlaneEstimator {
    /**
     * Fit a plane to N world-space points (minimum 3).
     * Returns null when the points are collinear or numerically degenerate.
     */
    static fitPlane(points) {
        const n = points.length;
        if (n < 3)
            return null;
        // Centroid
        let cx = 0, cy = 0, cz = 0;
        for (const p of points) {
            cx += p.x;
            cy += p.y;
            cz += p.z;
        }
        cx /= n;
        cy /= n;
        cz /= n;
        // 3×3 covariance matrix (symmetric, upper triangle)
        let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
        for (const p of points) {
            const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
            c00 += dx * dx;
            c01 += dx * dy;
            c02 += dx * dz;
            c11 += dy * dy;
            c12 += dy * dz;
            c22 += dz * dz;
        }
        c00 /= n;
        c01 /= n;
        c02 /= n;
        c11 /= n;
        c12 /= n;
        c22 /= n;
        // Power iteration for the SMALLEST eigenvector (plane normal).
        // We find the LARGEST eigenvector of (λ_max·I − C) which equals the
        // smallest of C. λ_max ≈ trace(C) / 1 (upper bound).
        const trace = c00 + c11 + c22;
        // Deflect: B = trace*I - C
        const b00 = trace - c00, b01 = -c01, b02 = -c02;
        const b10 = -c01, b11 = trace - c11, b12 = -c12;
        const b20 = -c02, b21 = -c12, b22 = trace - c22;
        let vx = 1, vy = 1, vz = 1; // starting vector
        for (let iter = 0; iter < 64; iter++) {
            const nx = b00 * vx + b01 * vy + b02 * vz;
            const ny = b10 * vx + b11 * vy + b12 * vz;
            const nz = b20 * vx + b21 * vy + b22 * vz;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len < 1e-12)
                return null; // degenerate
            vx = nx / len;
            vy = ny / len;
            vz = nz / len;
        }
        const D = vx * cx + vy * cy + vz * cz;
        // Compute RMS residual
        let sumSq = 0;
        for (const p of points) {
            const dist = vx * p.x + vy * p.y + vz * p.z - D;
            sumSq += dist * dist;
        }
        const fitResidualMeters = Math.sqrt(sumSq / n);
        return { A: vx, B: vy, C: vz, D, fitResidualMeters };
    }
    /**
     * Project a world-space point onto the fitted plane.
     */
    static projectOntoPlane(point, plane) {
        const dist = plane.A * point.x + plane.B * point.y + plane.C * point.z - plane.D;
        return {
            x: point.x - dist * plane.A,
            y: point.y - dist * plane.B,
            z: point.z - dist * plane.C,
        };
    }
    /**
     * Measure the Euclidean distance between two points after projecting both
     * onto the plane. This is the "flat across the surface" distance that
     * eliminates perspective foreshortening.
     */
    static measureOnPlane(p1, p2, plane) {
        const q1 = PlaneEstimator.projectOntoPlane(p1, plane);
        const q2 = PlaneEstimator.projectOntoPlane(p2, plane);
        const dx = q2.x - q1.x, dy = q2.y - q1.y, dz = q2.z - q1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}
/**
 * Orchestrates the three-stage blended measurement pipeline:
 *
 *   1. SfM depth  — call `sfmProvider.computeDepth(frames)`
 *   2. Reference anchor — scale the depth map from a known object
 *   3. Planar lock — unproject polygon vertices → fit plane → measure
 *
 * Usage:
 * ```ts
 * const pipeline = new BurstMeasurementPipeline(new FallbackSfMProvider(), 800);
 * const result = await pipeline.measure(frames, targetVertices, {
 *   box: referenceBox,
 *   object: REFERENCE_OBJECTS.CREDIT_CARD,
 *   imageWidthPx: 1080,
 *   imageHeightPx: 1920,
 * });
 * ```
 */
export class BurstMeasurementPipeline {
    sfmProvider;
    scaleAnchor;
    dimEstimator;
    constructor(sfmProvider, focalLengthPx = 800) {
        this.sfmProvider = sfmProvider;
        this.scaleAnchor = new ReferenceScaleAnchor(focalLengthPx);
        this.dimEstimator = new BasicDimensionEstimator(focalLengthPx);
    }
    /**
     * Run the full blended pipeline.
     *
     * @param frames          Burst frames (1–5). More frames → better SfM quality.
     * @param targetVertices  Pixel-space polygon the technician framed (absolute px).
     * @param reference       Reference object bounding box + descriptor + image dims.
     *                        If omitted, falls back to BasicDimensionEstimator at
     *                        the centroid depth of the fallback SfM map.
     */
    async measure(frames, targetVertices, reference) {
        if (frames.length === 0)
            throw new Error("BurstMeasurementPipeline: at least one frame required");
        // ── Stage 1: SfM depth ───────────────────────────────────────────────────
        const depthMap = await this.sfmProvider.computeDepth(frames);
        // ── Stage 2: Reference anchoring ─────────────────────────────────────────
        let anchorResult = null;
        let imageW = reference?.imageWidthPx ?? 1080;
        let imageH = reference?.imageHeightPx ?? 1920;
        const warnings = [];
        if (reference) {
            anchorResult = this.scaleAnchor.anchor(reference.box, imageW, imageH, reference.object, depthMap);
            if (anchorResult.clipped) {
                warnings.push("Reference object partially out of frame — re-centre and retry");
            }
            // Propagate any anchor-level warnings (e.g. near-zero reference box)
            warnings.push(...anchorResult.warnings);
        }
        // ── Stage 3: Unproject vertices → fit plane → measure ────────────────────
        let widthInches;
        let heightInches;
        let areaSqInches;
        let centroidDepthMeters;
        let plane = null;
        let planeFitScore = 0;
        if (anchorResult) {
            // Full pipeline: unproject all polygon vertices to world space
            const worldPoints = targetVertices.map((v) => this.scaleAnchor.unprojectPoint(v, depthMap, anchorResult, imageW, imageH));
            // Fit plane to the unprojected surface
            plane = PlaneEstimator.fitPlane(worldPoints);
            // Plane-locked Euclidean distances (metres → inches)
            const M2IN = 39.3701;
            if (plane && targetVertices.length >= 2) {
                widthInches = PlaneEstimator.measureOnPlane(worldPoints[0], worldPoints[1], plane) * M2IN;
                heightInches = targetVertices.length >= 4
                    ? PlaneEstimator.measureOnPlane(worldPoints[0], worldPoints[3], plane) * M2IN
                    : 0;
                // Shoelace area in world space (on the plane)
                const proj = worldPoints.map((p) => PlaneEstimator.projectOntoPlane(p, plane));
                let areaSq = 0;
                for (let i = 0; i < proj.length; i++) {
                    const a = proj[i], b = proj[(i + 1) % proj.length];
                    areaSq += a.x * b.y - b.x * a.y;
                    areaSq += a.y * b.z - b.y * a.z; // use XZ plane component too
                }
                areaSqInches = Math.abs(areaSq) / 2 * M2IN * M2IN;
                centroidDepthMeters = anchorResult.referenceDepthMeters;
                // Plane fit quality: residual < 5 mm → full confidence
                planeFitScore = Math.max(0, 1 - plane.fitResidualMeters / 0.005);
            }
            else {
                // Degenerate: fall back to simple anchor-depth estimator
                ({ widthInches, heightInches, areaSqInches, centroidDepthMeters } =
                    this._fallbackEstimate(targetVertices, anchorResult.referenceDepthMeters));
            }
        }
        else {
            // No reference object — BasicDimensionEstimator at unit depth
            centroidDepthMeters = 1.5; // reasonable default
            ({ widthInches, heightInches, areaSqInches } =
                this._fallbackEstimate(targetVertices, centroidDepthMeters));
        }
        // ── Confidence assembly ───────────────────────────────────────────────────
        const sfmVariance = Math.max(0, 1 - depthMap.scaleVariance);
        const anchorQuality = anchorResult?.confidence ?? 0;
        // When the reference box was too small to produce a valid anchor (pixelWidth
        // below the minimum threshold), the anchor confidence is already 0 — but SfM
        // variance and plane-fit quality can still contribute up to 0.5 to the
        // combined score.  That is unsafe: a consumer relying on the combined
        // confidence could accept a measurement derived from an arbitrary clamp.
        // Force the entire pipeline confidence to 0 so the result cannot be stamped.
        const anchorInvalid = anchorResult !== null &&
            anchorResult.referencePixelWidth < MIN_REFERENCE_PIXEL_WIDTH;
        const confidence = anchorInvalid
            ? 0
            : sfmVariance * 0.3 + anchorQuality * 0.5 + planeFitScore * 0.2;
        return {
            widthInches: Math.round(widthInches * 10) / 10,
            heightInches: Math.round(heightInches * 10) / 10,
            areaSqInches: Math.round(areaSqInches * 10) / 10,
            centroidDepthMeters,
            plane,
            confidence: Math.min(1, Math.max(0, confidence)),
            confidenceBreakdown: { sfmVariance, anchorQuality, planeFit: planeFitScore },
            warnings,
            measuredAt: new Date().toISOString(),
        };
    }
    _fallbackEstimate(vertices, depthMeters) {
        // scaleInchesPerPixel at this depth
        const scale = DEFAULT_SCALE_IN_PER_PX * (depthMeters / 1.5);
        const geo = PolygonCalculator.calculateAreaAndPerimeter(vertices, scale);
        return {
            widthInches: this.dimEstimator.estimateWidthInches(geo, depthMeters),
            heightInches: this.dimEstimator.estimateHeightInches(geo, depthMeters),
            areaSqInches: geo.areaSquareInches,
            centroidDepthMeters: depthMeters,
        };
    }
}
/**
 * Ready-to-use catalogue of common reference objects.
 * Keys match ReferenceObjectKind; values are widthMm / heightMm.
 */
export const REFERENCE_OBJECTS = {
    credit_card: { kind: "credit_card", widthMm: 85.6, heightMm: 53.98 },
    us_dollar: { kind: "us_dollar", widthMm: 156.1, heightMm: 66.3 },
    a4_paper: { kind: "a4_paper", widthMm: 210, heightMm: 297 },
    letter_paper: { kind: "letter_paper", widthMm: 215.9, heightMm: 279.4 },
    coin_quarter: { kind: "coin_quarter", widthMm: 24.26, heightMm: 24.26 },
    coin_dime: { kind: "coin_dime", widthMm: 17.91, heightMm: 17.91 },
    coin_nickel: { kind: "coin_nickel", widthMm: 21.21, heightMm: 21.21 },
    coin_penny: { kind: "coin_penny", widthMm: 19.05, heightMm: 19.05 },
};
// Re-export the scale constant so SpatialMeasurementCard can import it directly.
export const DEFAULT_SCALE_IN_PER_PX = 0.05;
