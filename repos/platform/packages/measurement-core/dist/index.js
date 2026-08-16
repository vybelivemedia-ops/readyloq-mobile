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
