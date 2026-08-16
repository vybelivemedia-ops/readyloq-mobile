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
import type { DeviceProvider } from "@platform/device-core";
export type { DeviceProvider, DeviceCapabilities, DeviceCategory, DeviceTransport, DeviceIdentity, DeviceStatus, DevicePermissions, DeviceEvent, DeviceEventKind, DeviceEventListener, } from "@platform/device-core";
export type MeasurementKind = "width" | "height" | "depth" | "diameter" | "radius" | "length" | "perimeter" | "area" | "volume" | "angle" | "distance" | "thickness" | "temperature" | "humidity" | "co2" | "pressure" | "acoustic";
export type MeasurementUnit = "mm" | "cm" | "m" | "in" | "ft" | "yd" | "mm2" | "cm2" | "m2" | "in2" | "ft2" | "mm3" | "cm3" | "m3" | "in3" | "ft3" | "deg" | "c" | "f" | "pct" | "ppm" | "ppb" | "pa" | "level";
export type MeasurementMethod = "single_image_reference" | "stereo_depth" | "monocular_depth" | "ar_anchored" | "hardware_sensor" | "manual";
export type CalibrationStatus = "uncalibrated" | "focal_length_auto" | "reference_object" | "ar_anchored" | "hardware_calibrated" | "manual";
/**
 * Camera calibration profile used to convert pixel distances to real-world
 * measurements. Derived from EXIF data, reference objects, or AR anchors.
 */
export interface CalibrationProfile {
    id: string;
    status: CalibrationStatus;
    /** Focal length in millimetres (from EXIF or manufacturer spec). */
    focalLengthMm?: number;
    /** Physical sensor width in millimetres. */
    sensorWidthMm?: number;
    /** Image width in pixels at the time of calibration. */
    imageWidthPx: number;
    /**
     * Derived scale factor: pixels per real-world millimetre.
     * The core quantity used in all dimension calculations.
     */
    pixelsPerMm?: number;
    /** Confidence in this calibration profile (0–1). */
    calibrationConfidence: number;
    /** ISO-8601 creation timestamp. */
    createdAt: string;
    /** Raw EXIF JSON from the reference capture, if available. */
    exifJson?: string;
}
export type ReferenceObjectKind = "credit_card" | "us_dollar" | "a4_paper" | "letter_paper" | "coin_quarter" | "coin_dime" | "coin_nickel" | "coin_penny" | "custom";
/**
 * A known-dimension object used as a scale reference in images.
 * Detection of these objects enables reference_object calibration.
 */
export interface ReferenceObject {
    kind: ReferenceObjectKind;
    /** Real-world width in millimetres. */
    widthMm: number;
    /** Real-world height in millimetres. */
    heightMm: number;
    /** Where the object was detected in the image (normalised 0–1 coords). */
    boundingRegion?: BoundingRegion;
    /** Confidence score for the detection (0–1). */
    detectionConfidence?: number;
}
/** Normalised image coordinates (0–1 relative to image dimensions). */
export interface ImagePoint {
    x: number;
    y: number;
}
/** A closed or open polygon defined by normalised image coordinates. */
export interface ImagePolygon {
    points: ImagePoint[];
    isClosed: boolean;
}
/**
 * A normalised axis-aligned bounding box.
 * All values 0–1 relative to image dimensions.
 */
export interface BoundingRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface MeasurementConfidence {
    /** Overall confidence score (0–1). */
    score: number;
    /** Method used to derive this estimate. */
    method: MeasurementMethod;
    /** Calibration quality underlying this estimate. */
    calibrationStatus: CalibrationStatus;
    /** Human-readable warnings (e.g. "No reference object detected"). */
    warnings: string[];
    /** Estimated measurement uncertainty in millimetres. */
    uncertaintyMm: number;
}
/**
 * A single dimensional measurement estimate.
 * Always advisory — never the sole basis for a safety-critical decision.
 */
export interface DimensionEstimate {
    kind: MeasurementKind;
    value: number;
    unit: MeasurementUnit;
    /** Lower bound of the confidence interval (same unit as value). */
    lowerBound?: number;
    /** Upper bound of the confidence interval (same unit as value). */
    upperBound?: number;
    confidence: MeasurementConfidence;
}
export type MeasurementInput = {
    kind: "image_base64";
    imageBase64: string;
    imageMimeType: string;
    imageWidthPx: number;
    imageHeightPx: number;
    exifJson?: string;
} | {
    kind: "image_uri";
    imageUri: string;
    imageWidthPx?: number;
    imageHeightPx?: number;
    exifJson?: string;
} | {
    kind: "depth_map";
    depthMap: DepthMap;
    referenceImageUri?: string;
} | {
    kind: "hardware_reading";
    /** Raw reading from a physical measurement device. */
    rawValue: number;
    unit: MeasurementUnit;
    deviceId: string;
};
export interface MeasurementRequest {
    id: string;
    kinds: MeasurementKind[];
    input: MeasurementInput;
    /** Reference object to use for scale calibration. */
    referenceObject?: ReferenceObject;
    /** Calibration profile to apply. Omit to auto-detect from EXIF. */
    calibrationProfileId?: string;
    useCache: boolean;
    priority: "low" | "normal" | "high";
}
export interface MeasurementResult {
    requestId: string;
    estimates: DimensionEstimate[];
    /** Reference objects detected during inference (for calibration feedback). */
    detectedObjects: ReferenceObject[];
    calibrationProfile: CalibrationProfile;
    method: MeasurementMethod;
    /** True when result was served from cache. */
    cached: boolean;
    latencyMs: number;
    measuredAt: string;
}
/**
 * A measurement annotation attached to a specific evidence item.
 * Supports versioning: each revision creates a new version; only the
 * highest isActive version is considered current.
 */
export interface MeasurementAnnotation {
    id: string;
    evidenceItemId: string;
    result: MeasurementResult;
    /** Monotonically increasing version counter. Starts at 1. */
    version: number;
    /** True for the current (highest) version; false for superseded versions. */
    isActive: boolean;
    createdAt: string;
    createdBy?: string;
    notes?: string;
}
export interface MeasurementHistoryRecord {
    id: string;
    evidenceItemId: string;
    annotation: MeasurementAnnotation;
    revisedAt?: string;
}
export interface MeasurementHistorySearchFilter {
    evidenceItemId?: string;
    inspectionId?: string;
    zoneId?: string;
    method?: MeasurementMethod;
    minConfidence?: number;
    since?: string;
    until?: string;
    includeSuperseded?: boolean;
}
/**
 * Monocular depth estimation output.
 * Values are relative depth (not absolute distance) unless calibrated.
 */
export interface DepthMap {
    /** Width of the depth map in pixels. */
    width: number;
    /** Height of the depth map in pixels. */
    height: number;
    /**
     * Row-major depth values. Length = width * height.
     * Values are relative (0 = near, 1 = far) unless absoluteScaleMm is set.
     */
    data: Float32Array;
    /** If known, the scale factor to convert relative depth to millimetres. */
    absoluteScaleMm?: number;
    /** Which depth model produced this map. */
    modelId?: string;
}
/**
 * Output from an object detection pass (reference objects found in image).
 */
export interface MeasurementDetectionOutput {
    detectedObjects: ReferenceObject[];
    /** Inference latency in milliseconds. */
    latencyMs: number;
    modelId: string;
    imageWidthPx: number;
    imageHeightPx: number;
}
/**
 * Output from a monocular depth estimation pass.
 */
export interface MeasurementDepthOutput {
    depthMap: DepthMap;
    latencyMs: number;
    modelId: string;
}
/**
 * Geometric computation utilities for measurement inference.
 * Stateless — all methods are pure functions.
 */
export interface GeometryService {
    /**
     * Compute the area of a polygon in square pixels.
     * @param polygon  Normalised polygon (coords 0–1).
     * @param imageWidthPx   Image width in pixels.
     * @param imageHeightPx  Image height in pixels.
     */
    polygonAreaPx(polygon: ImagePolygon, imageWidthPx: number, imageHeightPx: number): number;
    /**
     * Convert a pixel area to a real-world DimensionEstimate using calibration.
     */
    pixelAreaToRealArea(pixelArea: number, calibration: CalibrationProfile, outputUnit: MeasurementUnit): DimensionEstimate;
    /**
     * Compute the perimeter of a polygon in pixels.
     */
    polygonPerimeterPx(polygon: ImagePolygon, imageWidthPx: number, imageHeightPx: number): number;
    /**
     * Compute the angle (degrees) between two line segments.
     */
    angleBetweenSegments(segA: [ImagePoint, ImagePoint], segB: [ImagePoint, ImagePoint]): number;
    /**
     * Estimate volume from a cross-sectional area and depth.
     */
    estimateVolume(crossSectionAreaMm2: number, depthMm: number, outputUnit: MeasurementUnit): DimensionEstimate;
    /**
     * Convert a value between measurement units.
     */
    convert(value: number, from: MeasurementUnit, to: MeasurementUnit): number;
}
/**
 * Derives a pixel-per-mm scale from image data.
 * Uses reference objects, EXIF focal length, or AR anchors as the calibration
 * source; returns a CalibrationProfile.
 */
export interface ScaleEstimator {
    /**
     * Attempt to derive scale from detected reference objects.
     * Returns a "reference_object" calibration profile when a reference is found.
     */
    fromReferenceObject(detection: MeasurementDetectionOutput, imageWidthPx: number, imageHeightPx: number): Promise<CalibrationProfile>;
    /**
     * Derive scale from EXIF focal length and sensor data.
     * Returns a "focal_length_auto" calibration profile.
     */
    fromExif(exifJson: string, imageWidthPx: number): Promise<CalibrationProfile>;
    /**
     * Fallback — returns an "uncalibrated" profile with low confidence.
     */
    uncalibrated(imageWidthPx: number): CalibrationProfile;
}
/**
 * Computes DimensionEstimates from image geometry and a calibration profile.
 */
export interface DimensionEstimator {
    /**
     * Estimate the real-world dimensions of a bounding region.
     */
    fromBoundingRegion(region: BoundingRegion, kinds: MeasurementKind[], calibration: CalibrationProfile, imageWidthPx: number, imageHeightPx: number): DimensionEstimate[];
    /**
     * Estimate dimensions from a polygon (perimeter, area, bounding box).
     */
    fromPolygon(polygon: ImagePolygon, kinds: MeasurementKind[], calibration: CalibrationProfile, imageWidthPx: number, imageHeightPx: number): DimensionEstimate[];
    /**
     * Estimate depth/distance from a depth map at a specific image point.
     */
    fromDepthMap(depthMap: DepthMap, point: ImagePoint, calibration: CalibrationProfile): DimensionEstimate;
}
/**
 * Content-addressed cache for MeasurementResult.
 * Keys are derived from image content (perceptual hash) + request parameters.
 */
export interface MeasurementCache {
    get(key: string): MeasurementResult | undefined;
    set(key: string, result: MeasurementResult, ttlSeconds?: number): void;
    delete(key: string): void;
    /** Evict all entries derived from a given calibration profile. */
    invalidateForCalibrationProfile(profileId: string): void;
    /** Remove entries past their TTL. */
    pruneExpired(): void;
    clear(): void;
    hitRate(): number;
    stats(): {
        entries: number;
        hits: number;
        misses: number;
    };
}
/**
 * AI/algorithm-based measurement inference provider.
 *
 * Software-only — no physical hardware involved. Uses computer vision to
 * estimate dimensions from image data. Does NOT extend DeviceProvider.
 *
 * Compare with MeasurementDeviceProvider, which represents physical meters,
 * sensors, and instruments that connect via BLE/USB/wired.
 */
export interface MeasurementInferenceProvider {
    readonly id: string;
    readonly name: string;
    /**
     * Run measurement inference on a request.
     * Returns a MeasurementResult with one or more DimensionEstimates.
     */
    measure(request: MeasurementRequest): Promise<MeasurementResult>;
    /**
     * Run object detection to find reference objects in an image.
     */
    detectReferenceObjects(input: MeasurementInput): Promise<MeasurementDetectionOutput>;
    /**
     * Run monocular depth estimation on an image.
     */
    estimateDepth(input: MeasurementInput): Promise<MeasurementDepthOutput>;
    /**
     * Annotate an evidence item with a measurement result.
     */
    annotateEvidence(evidenceItemId: string, result: MeasurementResult): Promise<MeasurementAnnotation>;
}
/**
 * Physical measurement hardware provider.
 *
 * Represents instruments that a technician carries to a job site and connects
 * via BLE, USB, or wired cable:
 *   - Moisture meters (Protimeter, Delmhorst, General Tools)
 *   - Laser distance meters (Bosch, Leica, Hilti)
 *   - Thermal imagers (FLIR, Seek, Testo)
 *   - Environmental sensors (temperature, humidity, CO2, VOC)
 *   - Smart bait trap monitors
 *
 * Extends DeviceProvider, giving physical meters the full device lifecycle:
 * connect/disconnect, getStatus, checkHealth, getPermissions, on/emit.
 *
 * DeviceCapabilities guidance:
 *   categories: ["sensor"] for environmental/moisture/laser meters
 *   categories: ["sensor", "diagnostic"] for multi-function instruments
 *   categories: ["camera", "sensor"] for thermal imagers
 *   transports: ["ble"] for most modern wireless meters
 *   transports: ["usb", "wired"] for older or professional instruments
 */
export interface MeasurementDeviceProvider extends DeviceProvider {
    /**
     * Device-specific measurement capabilities.
     * Defines which measurement kinds the instrument can produce and
     * the units it natively reports.
     */
    readonly measurementCapabilities: MeasurementDeviceCapabilities;
    /**
     * Take a single reading from the instrument.
     * Resolves with a structured measurement reading.
     */
    read(): Promise<MeasurementReading>;
    /**
     * Subscribe to a continuous stream of readings.
     * Returns an unsubscribe function.
     */
    subscribe(listener: (reading: MeasurementReading) => void, intervalMs?: number): () => void;
}
/**
 * Describes what a physical measurement device can measure.
 */
export interface MeasurementDeviceCapabilities {
    /** Measurement kinds this instrument produces (e.g. ["depth"] for laser distance). */
    supportedKinds: MeasurementKind[];
    /** Native unit(s) the instrument reports. */
    nativeUnits: MeasurementUnit[];
    /** Measurement range minimum (in the first nativeUnit). */
    rangeMin?: number;
    /** Measurement range maximum (in the first nativeUnit). */
    rangeMax?: number;
    /** Instrument accuracy (±value in the first nativeUnit). */
    accuracy?: number;
    /** Whether the instrument supports continuous streaming (vs. single shot). */
    supportsStreaming: boolean;
    /** Whether the instrument supports self-calibration. */
    supportsSelfCalibration: boolean;
}
/**
 * A single reading from a physical measurement device.
 */
export interface MeasurementReading {
    deviceId: string;
    kind: MeasurementKind;
    value: number;
    unit: MeasurementUnit;
    /** Raw value from the device before unit conversion. */
    rawValue?: number;
    /** Raw unit from the device. */
    rawUnit?: MeasurementUnit;
    /** Signal quality / confidence from the device (0–1), if reported. */
    signalQuality?: number;
    capturedAt: string;
    /** Provider-specific secondary readings and annotations (e.g. humidity alongside temperature). */
    metadata?: Record<string, unknown>;
}
/**
 * Domain event kinds emitted by the measurement subsystem.
 * All values follow the "measurement.<noun>.<verb>" convention.
 */
export declare const MEASUREMENT_EVENT_KINDS: {
    readonly INFERENCE_STARTED: "measurement.inference.started";
    readonly INFERENCE_COMPLETED: "measurement.inference.completed";
    readonly INFERENCE_FAILED: "measurement.inference.failed";
    readonly ANNOTATION_CREATED: "measurement.annotation.created";
    readonly ANNOTATION_REVISED: "measurement.annotation.revised";
    readonly CALIBRATION_UPDATED: "measurement.calibration.updated";
    readonly DEVICE_READING_RECEIVED: "measurement.device.reading_received";
    readonly DEVICE_CONNECTED: "measurement.device.connected";
    readonly DEVICE_DISCONNECTED: "measurement.device.disconnected";
    readonly CACHE_HIT: "measurement.cache.hit";
    readonly CACHE_MISS: "measurement.cache.miss";
};
export type MeasurementEventKind = (typeof MEASUREMENT_EVENT_KINDS)[keyof typeof MEASUREMENT_EVENT_KINDS];
/** Pixel-space 2-D point (absolute or normalised coords). */
export interface Point2D {
    x: number;
    y: number;
}
/** World-space 3-D point (metres). */
export interface Point3D {
    x: number;
    y: number;
    z: number;
}
/**
 * The output of PolygonCalculator.calculateAreaAndPerimeter.
 * Carries the original vertices alongside the real-world area and perimeter
 * derived from a pixel-to-inch scale factor.
 */
export interface PolygonGeometry {
    vertices: Point2D[];
    /** Real-world area in square inches. */
    areaSquareInches: number;
    /** Real-world perimeter in inches. */
    perimeterInches: number;
}
/**
 * Simplified calibration snapshot used by BasicDimensionEstimator.
 * For the full calibration contract (EXIF-derived, AR-anchored, etc.) see
 * CalibrationProfile above.
 */
export interface BasicCalibrationProfile {
    /** Opaque device or session identifier. */
    deviceId: string;
    /** Effective focal length in pixels (derived from focalLengthMm × imageWidthPx / sensorWidthMm). */
    focalLengthPx: number;
    /** Inches per pixel at the reference/calibration depth. */
    pixelToInchRatio: number;
    /** Unix timestamp (ms) when the profile was captured. */
    calibratedAt: number;
}
/**
 * Raw depth-map buffer as produced by a monocular depth model or hardware
 * depth sensor. Use DepthMap (above) for the full contract including
 * relative-depth semantics; DepthMapData is the concrete transfer object.
 */
export interface DepthMapData {
    width: number;
    height: number;
    /** Row-major absolute depth values in metres. Length = width × height. */
    buffer: Float32Array;
    minDepthMeters: number;
    maxDepthMeters: number;
}
interface _BasicDimensionEstimatorContract {
    estimateWidthInches(polygon: PolygonGeometry, depthMeters: number): number;
    estimateHeightInches(polygon: PolygonGeometry, depthMeters: number): number;
}
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
export declare class BasicDimensionEstimator implements _BasicDimensionEstimatorContract {
    private readonly focalLengthPx;
    /** @param focalLengthPx Effective focal length in pixels. Defaults to 800 (typical wide-angle phone camera). */
    constructor(focalLengthPx?: number);
    /**
     * Estimate real-world width from the edge between vertices[0] and vertices[1].
     * Returns 0 when the polygon has fewer than 2 vertices.
     */
    estimateWidthInches(polygon: PolygonGeometry, depthMeters: number): number;
    /**
     * Estimate real-world height from the edge between vertices[0] and vertices[3].
     * Returns 0 when the polygon has fewer than 4 vertices.
     */
    estimateHeightInches(polygon: PolygonGeometry, depthMeters: number): number;
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
export declare class PolygonCalculator {
    /**
     * Compute area (sq in) and perimeter (in) of a pixel-space polygon.
     *
     * @param vertices         Pixel-space vertices in winding order (CW or CCW).
     * @param scaleInchesPerPixel  Calibrated inches-per-pixel at the subject depth.
     */
    static calculateAreaAndPerimeter(vertices: Point2D[], scaleInchesPerPixel: number): PolygonGeometry;
    /**
     * Sample the average depth under a polygon from a DepthMapData buffer.
     * Uses a simple point-in-polygon bounding-box scan; good enough for
     * convex quads at inspection distances.
     *
     * Returns the mean depth in metres, or `null` if no samples were inside.
     */
    static sampleMeanDepth(vertices: Point2D[], depthMap: DepthMapData): number | null;
    /** Ray-casting point-in-polygon test. */
    private static _pointInPolygon;
}
/**
 * One frame captured during a burst measurement trigger.
 * The caller supplies the local URI; optional IMU data improves SfM accuracy.
 */
export interface BurstFrame {
    /** Local file URI (expo-camera output or expo-image-picker). */
    uri: string;
    /** Unix timestamp in milliseconds at shutter release. */
    capturedAt: number;
    /** Device orientation at capture time, if available from expo-sensors. */
    imuHint?: {
        pitchDeg: number;
        rollDeg: number;
        yawDeg: number;
    };
}
/**
 * Relative depth map produced by a Structure-from-Motion or monocular depth
 * engine. Values are normalised 0 (near) → 1 (far); not yet metric.
 */
export interface SfMDepthMap {
    width: number;
    height: number;
    /** Row-major relative depth values. Length = width × height. */
    relativeDepth: Float32Array;
    /**
     * Estimated scale variance (lower = more internally consistent).
     * Computed as normalised variance across per-pixel depth values.
     */
    scaleVariance: number;
    /** Number of frames that contributed to this map. */
    frameCount: number;
}
/**
 * Contract for any SfM / depth estimation back-end.
 *
 * @see FallbackSfMProvider — ships with measurement-core; no native modules.
 *
 * Production implementations:
 *   - ARKit depth (LiDAR iPhone)    — inject via DeviceProvider
 *   - ARCore depth (Android)        — inject via DeviceProvider
 *   - Neural monocular depth model  — inject via MeasurementInferenceProvider
 */
export interface SfMProvider {
    /**
     * Compute a relative depth map from one or more burst frames.
     * Single-frame input must still be accepted and should return the provider's
     * best single-frame estimate.
     */
    computeDepth(frames: BurstFrame[]): Promise<SfMDepthMap>;
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
export declare class FallbackSfMProvider implements SfMProvider {
    computeDepth(frames: BurstFrame[]): Promise<SfMDepthMap>;
}
/**
 * Result of a scale anchoring operation.
 * `metersPerRelativeUnit` converts any relative depth value to an absolute
 * depth in metres by simple multiplication.
 */
export interface ScaleAnchorResult {
    /** Multiply by a relative depth value to get metres. */
    metersPerRelativeUnit: number;
    /**
     * The estimated absolute depth (metres) at the reference object's centroid.
     * Used as the single reference depth when the depth map is uniform (fallback
     * SfM provider).
     */
    referenceDepthMeters: number;
    /** Pixel width of the reference object as measured in the image. */
    referencePixelWidth: number;
    /** Real-world width of the reference object in mm. */
    referenceRealWidthMm: number;
    /** Calibration confidence (0–1). */
    confidence: number;
    /**
     * True when the supplied bounding box extends past one or more edges of the
     * image (i.e. normalised coords fall outside the [0, 1] range on any axis).
     * A clipped box underestimates pixel width, which causes the depth
     * back-projection to overestimate distance and produce a silent scale error.
     * Callers should surface this to the technician and request a re-frame.
     */
    clipped: boolean;
    /**
     * Human-readable warnings generated during anchoring.
     * Non-empty when the result is unreliable — e.g. reference box is too small
     * to produce a valid scale (pixelWidth below the minimum threshold).
     * BurstMeasurementPipeline propagates these into its own warnings array.
     */
    warnings: string[];
}
/**
 * Minimum reference object pixel width required for a valid scale anchor.
 * Below this threshold, pixelWidth ≈ 0 → referenceDepthMeters → Infinity,
 * which produces stampable-looking Infinity/NaN dimensions downstream.
 * The guard fires early and surfaces a warning instead of letting the
 * divide-by-zero reach the stamping UI.
 */
export declare const MIN_REFERENCE_PIXEL_WIDTH = 5;
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
export declare class ReferenceScaleAnchor {
    private readonly focalLengthPx;
    constructor(focalLengthPx?: number);
    /**
     * Compute scale anchoring from a bounding box dragged by the technician.
     *
     * @param box              Normalised bounding box (0–1 coords) of reference object.
     * @param imageWidthPx     Width of the source image in pixels.
     * @param imageHeightPx    Height of the source image in pixels.
     * @param referenceObject  Known-dimension reference (credit card, outlet plate, etc.).
     * @param depthMap         The relative SfM depth map to be scaled.
     */
    anchor(box: BoundingRegion, imageWidthPx: number, imageHeightPx: number, referenceObject: ReferenceObject, depthMap: SfMDepthMap): ScaleAnchorResult;
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
    unprojectPoint(pt: Point2D, depthMap: SfMDepthMap, anchor: ScaleAnchorResult, imageWidthPx: number, imageHeightPx: number): Point3D;
}
/** Plane equation: Ax + By + Cz = D.  Normal vector is (A, B, C). */
export interface PlaneEquation {
    /** X component of the unit normal vector. */
    A: number;
    /** Y component of the unit normal vector. */
    B: number;
    /** Z component of the unit normal vector. */
    C: number;
    /** Scalar offset: D = dot(normal, centroid). */
    D: number;
    /** RMS distance of input points from the fitted plane (metres). */
    fitResidualMeters: number;
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
export declare class PlaneEstimator {
    /**
     * Fit a plane to N world-space points (minimum 3).
     * Returns null when the points are collinear or numerically degenerate.
     */
    static fitPlane(points: Point3D[]): PlaneEquation | null;
    /**
     * Project a world-space point onto the fitted plane.
     */
    static projectOntoPlane(point: Point3D, plane: PlaneEquation): Point3D;
    /**
     * Measure the Euclidean distance between two points after projecting both
     * onto the plane. This is the "flat across the surface" distance that
     * eliminates perspective foreshortening.
     */
    static measureOnPlane(p1: Point3D, p2: Point3D, plane: PlaneEquation): number;
}
/** Final output from BurstMeasurementPipeline.measure(). */
export interface BurstMeasurementResult {
    /** Estimated width in inches (plane-locked). */
    widthInches: number;
    /** Estimated height in inches (plane-locked). */
    heightInches: number;
    /** Estimated area in square inches (plane-locked Shoelace). */
    areaSqInches: number;
    /** Depth at the polygon centroid in metres. */
    centroidDepthMeters: number;
    /** The fitted surface plane (useful for debug overlays). */
    plane: PlaneEquation | null;
    /** Composite confidence score (0–1). */
    confidence: number;
    /** Breakdown of where confidence was gained or lost. */
    confidenceBreakdown: {
        sfmVariance: number;
        anchorQuality: number;
        planeFit: number;
    };
    /**
     * Human-readable warnings produced during this pipeline run.
     * Non-empty when the estimate may be unreliable (e.g. reference object
     * partially out of frame). Display each warning to the technician before
     * allowing them to stamp the result.
     */
    warnings: string[];
    /** ISO-8601 timestamp. */
    measuredAt: string;
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
export declare class BurstMeasurementPipeline {
    private readonly sfmProvider;
    private readonly scaleAnchor;
    private readonly dimEstimator;
    constructor(sfmProvider: SfMProvider, focalLengthPx?: number);
    /**
     * Run the full blended pipeline.
     *
     * @param frames          Burst frames (1–5). More frames → better SfM quality.
     * @param targetVertices  Pixel-space polygon the technician framed (absolute px).
     * @param reference       Reference object bounding box + descriptor + image dims.
     *                        If omitted, falls back to BasicDimensionEstimator at
     *                        the centroid depth of the fallback SfM map.
     */
    measure(frames: BurstFrame[], targetVertices: Point2D[], reference?: {
        box: BoundingRegion;
        object: ReferenceObject;
        imageWidthPx: number;
        imageHeightPx: number;
    }): Promise<BurstMeasurementResult>;
    private _fallbackEstimate;
}
/**
 * Ready-to-use catalogue of common reference objects.
 * Keys match ReferenceObjectKind; values are widthMm / heightMm.
 */
export declare const REFERENCE_OBJECTS: Record<string, ReferenceObject>;
export declare const DEFAULT_SCALE_IN_PER_PX = 0.05;
//# sourceMappingURL=index.d.ts.map