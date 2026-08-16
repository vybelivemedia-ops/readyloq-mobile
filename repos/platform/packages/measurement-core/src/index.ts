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

// ─── Re-export device-core types needed by measurement consumers ──────────────
export type {
  DeviceProvider,
  DeviceCapabilities,
  DeviceCategory,
  DeviceTransport,
  DeviceIdentity,
  DeviceStatus,
  DevicePermissions,
  DeviceEvent,
  DeviceEventKind,
  DeviceEventListener,
} from "@platform/device-core";

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT TAXONOMY
// ─────────────────────────────────────────────────────────────────────────────

export type MeasurementKind =
  | "width"
  | "height"
  | "depth"
  | "diameter"
  | "radius"
  | "length"
  | "perimeter"
  | "area"
  | "volume"
  | "angle"
  | "distance"
  | "thickness"
  // Environmental / sensor kinds
  | "temperature"
  | "humidity"
  | "co2"
  | "pressure"
  | "acoustic";

export type MeasurementUnit =
  | "mm"
  | "cm"
  | "m"
  | "in"
  | "ft"
  | "yd"
  | "mm2"
  | "cm2"
  | "m2"
  | "in2"
  | "ft2"
  | "mm3"
  | "cm3"
  | "m3"
  | "in3"
  | "ft3"
  | "deg"
  // Environmental / sensor units
  | "c"
  | "f"
  | "pct"
  | "ppm"
  | "ppb"
  | "pa"
  | "level";

export type MeasurementMethod =
  | "single_image_reference"
  | "stereo_depth"
  | "monocular_depth"
  | "ar_anchored"
  | "hardware_sensor"
  | "manual";

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION
// ─────────────────────────────────────────────────────────────────────────────

export type CalibrationStatus =
  | "uncalibrated"
  | "focal_length_auto"
  | "reference_object"
  | "ar_anchored"
  | "hardware_calibrated"
  | "manual";

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

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

export type ReferenceObjectKind =
  | "credit_card"
  | "us_dollar"
  | "a4_paper"
  | "letter_paper"
  | "coin_quarter"
  | "coin_dime"
  | "coin_nickel"
  | "coin_penny"
  | "custom";

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

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE GEOMETRY PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION ESTIMATE
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT INPUT
// ─────────────────────────────────────────────────────────────────────────────

export type MeasurementInput =
  | {
      kind: "image_base64";
      imageBase64: string;
      imageMimeType: string;
      imageWidthPx: number;
      imageHeightPx: number;
      exifJson?: string;
    }
  | {
      kind: "image_uri";
      imageUri: string;
      imageWidthPx?: number;
      imageHeightPx?: number;
      exifJson?: string;
    }
  | {
      kind: "depth_map";
      depthMap: DepthMap;
      referenceImageUri?: string;
    }
  | {
      kind: "hardware_reading";
      /** Raw reading from a physical measurement device. */
      rawValue: number;
      unit: MeasurementUnit;
      deviceId: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT REQUEST / RESULT
// ─────────────────────────────────────────────────────────────────────────────

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
  measuredAt: string; // ISO-8601
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

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
  createdAt: string; // ISO-8601
  createdBy?: string; // user/system identifier
  notes?: string;
}

export interface MeasurementHistoryRecord {
  id: string;
  evidenceItemId: string;
  annotation: MeasurementAnnotation;
  revisedAt?: string; // ISO-8601
}

export interface MeasurementHistorySearchFilter {
  evidenceItemId?: string;
  inspectionId?: string;
  zoneId?: string;
  method?: MeasurementMethod;
  minConfidence?: number;
  since?: string; // ISO-8601
  until?: string; // ISO-8601
  includeSuperseded?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH MAP
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// AI INFERENCE OUTPUTS
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY SERVICE
// ─────────────────────────────────────────────────────────────────────────────

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
  pixelAreaToRealArea(
    pixelArea: number,
    calibration: CalibrationProfile,
    outputUnit: MeasurementUnit,
  ): DimensionEstimate;

  /**
   * Compute the perimeter of a polygon in pixels.
   */
  polygonPerimeterPx(polygon: ImagePolygon, imageWidthPx: number, imageHeightPx: number): number;

  /**
   * Compute the angle (degrees) between two line segments.
   */
  angleBetweenSegments(
    segA: [ImagePoint, ImagePoint],
    segB: [ImagePoint, ImagePoint],
  ): number;

  /**
   * Estimate volume from a cross-sectional area and depth.
   */
  estimateVolume(
    crossSectionAreaMm2: number,
    depthMm: number,
    outputUnit: MeasurementUnit,
  ): DimensionEstimate;

  /**
   * Convert a value between measurement units.
   */
  convert(value: number, from: MeasurementUnit, to: MeasurementUnit): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCALE ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────

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
  fromReferenceObject(
    detection: MeasurementDetectionOutput,
    imageWidthPx: number,
    imageHeightPx: number,
  ): Promise<CalibrationProfile>;

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

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes DimensionEstimates from image geometry and a calibration profile.
 */
export interface DimensionEstimator {
  /**
   * Estimate the real-world dimensions of a bounding region.
   */
  fromBoundingRegion(
    region: BoundingRegion,
    kinds: MeasurementKind[],
    calibration: CalibrationProfile,
    imageWidthPx: number,
    imageHeightPx: number,
  ): DimensionEstimate[];

  /**
   * Estimate dimensions from a polygon (perimeter, area, bounding box).
   */
  fromPolygon(
    polygon: ImagePolygon,
    kinds: MeasurementKind[],
    calibration: CalibrationProfile,
    imageWidthPx: number,
    imageHeightPx: number,
  ): DimensionEstimate[];

  /**
   * Estimate depth/distance from a depth map at a specific image point.
   */
  fromDepthMap(
    depthMap: DepthMap,
    point: ImagePoint,
    calibration: CalibrationProfile,
  ): DimensionEstimate;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT CACHE
// ─────────────────────────────────────────────────────────────────────────────

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
  stats(): { entries: number; hits: number; misses: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT INFERENCE PROVIDER (software — no hardware)
// ─────────────────────────────────────────────────────────────────────────────

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
  annotateEvidence(
    evidenceItemId: string,
    result: MeasurementResult,
  ): Promise<MeasurementAnnotation>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT DEVICE PROVIDER (physical hardware — extends DeviceProvider)
// ─────────────────────────────────────────────────────────────────────────────

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
  subscribe(
    listener: (reading: MeasurementReading) => void,
    intervalMs?: number,
  ): () => void;
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
  capturedAt: string; // ISO-8601
  /** Provider-specific secondary readings and annotations (e.g. humidity alongside temperature). */
  metadata?: Record<string, unknown>;
}

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
} as const;

export type MeasurementEventKind =
  (typeof MEASUREMENT_EVENT_KINDS)[keyof typeof MEASUREMENT_EVENT_KINDS];

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE MATH ENGINE
// Pixel-space geometry helpers + pinhole-camera dimension estimator.
// These are device-local, synchronous, and have zero external dependencies —
// safe to run on the React Native JS thread during a live inspection.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── Private interface for BasicDimensionEstimator ────────────────────────────
// (Not exported — the full DimensionEstimator contract above is the public API.)

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
export class BasicDimensionEstimator implements _BasicDimensionEstimatorContract {
  private readonly focalLengthPx: number;

  /** @param focalLengthPx Effective focal length in pixels. Defaults to 800 (typical wide-angle phone camera). */
  constructor(focalLengthPx: number = 800) {
    this.focalLengthPx = focalLengthPx;
  }

  /**
   * Estimate real-world width from the edge between vertices[0] and vertices[1].
   * Returns 0 when the polygon has fewer than 2 vertices.
   */
  public estimateWidthInches(polygon: PolygonGeometry, depthMeters: number): number {
    if (polygon.vertices.length < 2) return 0;
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
  public estimateHeightInches(polygon: PolygonGeometry, depthMeters: number): number {
    if (polygon.vertices.length < 4) return 0;
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
  public static calculateAreaAndPerimeter(
    vertices: Point2D[],
    scaleInchesPerPixel: number,
  ): PolygonGeometry {
    const n = vertices.length;
    let areaPixels = 0;
    let perimeterPixels = 0;

    for (let i = 0; i < n; i++) {
      const cur  = vertices[i];
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
      perimeterInches:  perimeterPixels * scaleInchesPerPixel,
    };
  }

  /**
   * Sample the average depth under a polygon from a DepthMapData buffer.
   * Uses a simple point-in-polygon bounding-box scan; good enough for
   * convex quads at inspection distances.
   *
   * Returns the mean depth in metres, or `null` if no samples were inside.
   */
  public static sampleMeanDepth(
    vertices: Point2D[],
    depthMap: DepthMapData,
  ): number | null {
    if (vertices.length < 3) return null;

    const xs = vertices.map((v) => v.x);
    const ys = vertices.map((v) => v.y);
    const xMin = Math.max(0, Math.floor(Math.min(...xs)));
    const xMax = Math.min(depthMap.width  - 1, Math.ceil(Math.max(...xs)));
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
  private static _pointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = polygon[i];
      const vj = polygon[j];
      if (
        vi.y > pt.y !== vj.y > pt.y &&
        pt.x < ((vj.x - vi.x) * (pt.y - vi.y)) / (vj.y - vi.y) + vi.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }
}
