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

// ─────────────────────────────────────────────────────────────────────────────
// BLENDED "BURST & REFERENCE" MEASUREMENT PIPELINE
//
// High-accuracy on-device dimension estimation without a physical laser meter.
// Three stages: multi-frame SfM depth  →  reference-object scale anchoring
//               →  planar locking & final dimension output.
//
// All classes are pure math / pure TypeScript — no native modules, no ML
// inference calls. The SfMProvider interface is the single seam for a native
// ARKit / ARCore back-end; the built-in FallbackSfMProvider runs without one.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Stage 0: Burst frame descriptor ─────────────────────────────────────────

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

// ─── Stage 1: SfM depth output ───────────────────────────────────────────────

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
export class FallbackSfMProvider implements SfMProvider {
  async computeDepth(frames: BurstFrame[]): Promise<SfMDepthMap> {
    // We have no pixel data to analyse — return uniform prior.
    // A single non-zero variance signals to the pipeline that this is a
    // low-confidence map rather than a perfectly flat scene.
    const width  = 320; // canonical low-res grid
    const height = 240;
    const data   = new Float32Array(width * height).fill(0.5);
    return {
      width,
      height,
      relativeDepth: data,
      scaleVariance: 1.0, // maximum uncertainty
      frameCount:    frames.length,
    };
  }
}

// ─── Stage 2: Reference-object scale anchoring ────────────────────────────────

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
export const MIN_REFERENCE_PIXEL_WIDTH = 5;

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
  private readonly focalLengthPx: number;

  constructor(focalLengthPx: number = 800) {
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
  public anchor(
    box: BoundingRegion,
    imageWidthPx: number,
    imageHeightPx: number,
    referenceObject: ReferenceObject,
    depthMap: SfMDepthMap,
  ): ScaleAnchorResult {
    // Detect whether the supplied bounding box clips any image edge.
    // Normalised coords must stay within [0, 1] on both axes; anything outside
    // means the reference object is partially out of frame, which understates
    // its pixel width and causes a silent depth-estimation error.
    const clipped =
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width  > 1 ||
      box.y + box.height > 1;

    // Pixel width of the reference object in the image.
    // Use the raw (possibly clipped) value so callers see how much width was
    // observed; the `clipped` flag tells them not to trust the result.
    const pixelWidth = box.width * imageWidthPx;

    const anchorWarnings: string[] = [];

    // Guard: a near-zero reference box (e.g. a single tap) produces a
    // pixelWidth ≈ 0, making referenceDepthMeters → Infinity and every
    // downstream dimension NaN or Infinity.  Catch it here — before the
    // divide — and surface a warning so the pipeline can relay it to the UI
    // instead of propagating an unrepresentable value.
    const tooSmall = pixelWidth < MIN_REFERENCE_PIXEL_WIDTH;
    if (tooSmall) {
      anchorWarnings.push(
        `Reference box is too small to anchor scale (${pixelWidth.toFixed(1)} px width, ` +
        `minimum is ${MIN_REFERENCE_PIXEL_WIDTH} px) — draw a larger box around the reference object`,
      );
    }

    // Pinhole depth back-projection (metres).
    // When pixelWidth is below the threshold we clamp to the minimum so that
    // downstream numeric values are finite (confidence will be 0, so the result
    // is discarded, but we avoid propagating Infinity into the pipeline).
    const safePixelWidth = tooSmall ? MIN_REFERENCE_PIXEL_WIDTH : pixelWidth;
    const referenceDepthMeters =
      (this.focalLengthPx * referenceObject.widthMm) / (safePixelWidth * 1000);

    // Sample relative depth at the bounding box centroid
    const cx = Math.round((box.x + box.width  / 2) * depthMap.width);
    const cy = Math.round((box.y + box.height / 2) * depthMap.height);
    const clampedCx = Math.max(0, Math.min(depthMap.width  - 1, cx));
    const clampedCy = Math.max(0, Math.min(depthMap.height - 1, cy));
    const relativeAtCentroid =
      depthMap.relativeDepth[clampedCy * depthMap.width + clampedCx];

    // Avoid division by zero / degenerate maps
    const safeRelative = relativeAtCentroid > 0.001 ? relativeAtCentroid : 0.5;
    const metersPerRelativeUnit = referenceDepthMeters / safeRelative;

    // Confidence: penalise low pixel width (far object = noisy), high variance,
    // and clipping (clipped anchor has systematically wrong scale).
    // A below-threshold box FORCES confidence to exactly 0 — no variance or
    // other factor can rescue an invalid anchor.  The clamped safePixelWidth
    // keeps downstream values finite, but the caller must not stamp the result.
    let confidence: number;
    if (tooSmall) {
      confidence = 0;
    } else {
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
  public unprojectPoint(
    pt: Point2D,
    depthMap: SfMDepthMap,
    anchor: ScaleAnchorResult,
    imageWidthPx: number,
    imageHeightPx: number,
  ): Point3D {
    const mx = Math.round(pt.x / imageWidthPx  * depthMap.width);
    const my = Math.round(pt.y / imageHeightPx * depthMap.height);
    const cx = Math.max(0, Math.min(depthMap.width  - 1, mx));
    const cy = Math.max(0, Math.min(depthMap.height - 1, my));

    const relDepth   = depthMap.relativeDepth[cy * depthMap.width + cx];
    const depthMeters = relDepth * anchor.metersPerRelativeUnit;

    // Pinhole un-projection: (px - cx_img) / f * depth, (py - cy_img) / f * depth
    const halfW = imageWidthPx  / 2;
    const halfH = imageHeightPx / 2;
    return {
      x: ((pt.x - halfW) / this.focalLengthPx) * depthMeters,
      y: ((pt.y - halfH) / this.focalLengthPx) * depthMeters,
      z: depthMeters,
    };
  }
}

// ─── Stage 3: Planar locking ──────────────────────────────────────────────────

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
export class PlaneEstimator {
  /**
   * Fit a plane to N world-space points (minimum 3).
   * Returns null when the points are collinear or numerically degenerate.
   */
  public static fitPlane(points: Point3D[]): PlaneEquation | null {
    const n = points.length;
    if (n < 3) return null;

    // Centroid
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
    cx /= n; cy /= n; cz /= n;

    // 3×3 covariance matrix (symmetric, upper triangle)
    let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
    for (const p of points) {
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      c00 += dx * dx; c01 += dx * dy; c02 += dx * dz;
                      c11 += dy * dy; c12 += dy * dz;
                                      c22 += dz * dz;
    }
    c00 /= n; c01 /= n; c02 /= n; c11 /= n; c12 /= n; c22 /= n;

    // Power iteration for the SMALLEST eigenvector (plane normal).
    // We find the LARGEST eigenvector of (λ_max·I − C) which equals the
    // smallest of C. λ_max ≈ trace(C) / 1 (upper bound).
    const trace = c00 + c11 + c22;
    // Deflect: B = trace*I - C
    const b00 = trace - c00, b01 = -c01,        b02 = -c02;
    const b10 = -c01,        b11 = trace - c11, b12 = -c12;
    const b20 = -c02,        b21 = -c12,        b22 = trace - c22;

    let vx = 1, vy = 1, vz = 1; // starting vector
    for (let iter = 0; iter < 64; iter++) {
      const nx = b00 * vx + b01 * vy + b02 * vz;
      const ny = b10 * vx + b11 * vy + b12 * vz;
      const nz = b20 * vx + b21 * vy + b22 * vz;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-12) return null; // degenerate
      vx = nx / len; vy = ny / len; vz = nz / len;
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
  public static projectOntoPlane(point: Point3D, plane: PlaneEquation): Point3D {
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
  public static measureOnPlane(p1: Point3D, p2: Point3D, plane: PlaneEquation): number {
    const q1 = PlaneEstimator.projectOntoPlane(p1, plane);
    const q2 = PlaneEstimator.projectOntoPlane(p2, plane);
    const dx = q2.x - q1.x, dy = q2.y - q1.y, dz = q2.z - q1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

// ─── Pipeline orchestrator ────────────────────────────────────────────────────

/** Final output from BurstMeasurementPipeline.measure(). */
export interface BurstMeasurementResult {
  /** Estimated width in inches (plane-locked). */
  widthInches:  number;
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
    sfmVariance: number;   // 0–1: 1 = good SfM, 0 = fallback flat map
    anchorQuality: number; // 0–1: 1 = wide reference object in frame
    planeFit: number;      // 0–1: 1 = tight planar residual
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
export class BurstMeasurementPipeline {
  private readonly sfmProvider:  SfMProvider;
  private readonly scaleAnchor:  ReferenceScaleAnchor;
  private readonly dimEstimator: BasicDimensionEstimator;

  constructor(sfmProvider: SfMProvider, focalLengthPx: number = 800) {
    this.sfmProvider  = sfmProvider;
    this.scaleAnchor  = new ReferenceScaleAnchor(focalLengthPx);
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
  public async measure(
    frames: BurstFrame[],
    targetVertices: Point2D[],
    reference?: {
      box: BoundingRegion;
      object: ReferenceObject;
      imageWidthPx: number;
      imageHeightPx: number;
    },
  ): Promise<BurstMeasurementResult> {
    if (frames.length === 0) throw new Error("BurstMeasurementPipeline: at least one frame required");

    // ── Stage 1: SfM depth ───────────────────────────────────────────────────
    const depthMap = await this.sfmProvider.computeDepth(frames);

    // ── Stage 2: Reference anchoring ─────────────────────────────────────────
    let anchorResult: ScaleAnchorResult | null = null;
    let imageW = reference?.imageWidthPx ?? 1080;
    let imageH = reference?.imageHeightPx ?? 1920;

    const warnings: string[] = [];

    if (reference) {
      anchorResult = this.scaleAnchor.anchor(
        reference.box,
        imageW,
        imageH,
        reference.object,
        depthMap,
      );
      if (anchorResult.clipped) {
        warnings.push(
          "Reference object partially out of frame — re-centre and retry",
        );
      }
      // Propagate any anchor-level warnings (e.g. near-zero reference box)
      warnings.push(...anchorResult.warnings);
    }

    // ── Stage 3: Unproject vertices → fit plane → measure ────────────────────
    let widthInches: number;
    let heightInches: number;
    let areaSqInches: number;
    let centroidDepthMeters: number;
    let plane: PlaneEquation | null = null;
    let planeFitScore = 0;

    if (anchorResult) {
      // Full pipeline: unproject all polygon vertices to world space
      const worldPoints: Point3D[] = targetVertices.map((v) =>
        this.scaleAnchor.unprojectPoint(v, depthMap, anchorResult!, imageW, imageH),
      );

      // Fit plane to the unprojected surface
      plane = PlaneEstimator.fitPlane(worldPoints);

      // Plane-locked Euclidean distances (metres → inches)
      const M2IN = 39.3701;
      if (plane && targetVertices.length >= 2) {
        widthInches  = PlaneEstimator.measureOnPlane(worldPoints[0], worldPoints[1], plane) * M2IN;
        heightInches = targetVertices.length >= 4
          ? PlaneEstimator.measureOnPlane(worldPoints[0], worldPoints[3], plane) * M2IN
          : 0;

        // Shoelace area in world space (on the plane)
        const proj = worldPoints.map((p) => PlaneEstimator.projectOntoPlane(p, plane!));
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
      } else {
        // Degenerate: fall back to simple anchor-depth estimator
        ({ widthInches, heightInches, areaSqInches, centroidDepthMeters } =
          this._fallbackEstimate(targetVertices, anchorResult.referenceDepthMeters));
      }
    } else {
      // No reference object — BasicDimensionEstimator at unit depth
      centroidDepthMeters = 1.5; // reasonable default
      ({ widthInches, heightInches, areaSqInches } =
        this._fallbackEstimate(targetVertices, centroidDepthMeters));
    }

    // ── Confidence assembly ───────────────────────────────────────────────────
    const sfmVariance    = Math.max(0, 1 - depthMap.scaleVariance);
    const anchorQuality  = anchorResult?.confidence ?? 0;

    // When the reference box was too small to produce a valid anchor (pixelWidth
    // below the minimum threshold), the anchor confidence is already 0 — but SfM
    // variance and plane-fit quality can still contribute up to 0.5 to the
    // combined score.  That is unsafe: a consumer relying on the combined
    // confidence could accept a measurement derived from an arbitrary clamp.
    // Force the entire pipeline confidence to 0 so the result cannot be stamped.
    const anchorInvalid =
      anchorResult !== null &&
      anchorResult.referencePixelWidth < MIN_REFERENCE_PIXEL_WIDTH;
    const confidence = anchorInvalid
      ? 0
      : sfmVariance * 0.3 + anchorQuality * 0.5 + planeFitScore * 0.2;

    return {
      widthInches:  Math.round(widthInches  * 10) / 10,
      heightInches: Math.round(heightInches * 10) / 10,
      areaSqInches: Math.round(areaSqInches * 10) / 10,
      centroidDepthMeters,
      plane,
      confidence:   Math.min(1, Math.max(0, confidence)),
      confidenceBreakdown: { sfmVariance, anchorQuality, planeFit: planeFitScore },
      warnings,
      measuredAt: new Date().toISOString(),
    };
  }

  private _fallbackEstimate(
    vertices: Point2D[],
    depthMeters: number,
  ): { widthInches: number; heightInches: number; areaSqInches: number; centroidDepthMeters: number } {
    // scaleInchesPerPixel at this depth
    const scale = DEFAULT_SCALE_IN_PER_PX * (depthMeters / 1.5);
    const geo = PolygonCalculator.calculateAreaAndPerimeter(vertices, scale);
    return {
      widthInches:         this.dimEstimator.estimateWidthInches(geo, depthMeters),
      heightInches:        this.dimEstimator.estimateHeightInches(geo, depthMeters),
      areaSqInches:        geo.areaSquareInches,
      centroidDepthMeters: depthMeters,
    };
  }
}

/**
 * Ready-to-use catalogue of common reference objects.
 * Keys match ReferenceObjectKind; values are widthMm / heightMm.
 */
export const REFERENCE_OBJECTS: Record<string, ReferenceObject> = {
  credit_card:   { kind: "credit_card",   widthMm: 85.6,  heightMm: 53.98 },
  us_dollar:     { kind: "us_dollar",     widthMm: 156.1, heightMm: 66.3  },
  a4_paper:      { kind: "a4_paper",      widthMm: 210,   heightMm: 297   },
  letter_paper:  { kind: "letter_paper",  widthMm: 215.9, heightMm: 279.4 },
  coin_quarter:  { kind: "coin_quarter",  widthMm: 24.26, heightMm: 24.26 },
  coin_dime:     { kind: "coin_dime",     widthMm: 17.91, heightMm: 17.91 },
  coin_nickel:   { kind: "coin_nickel",   widthMm: 21.21, heightMm: 21.21 },
  coin_penny:    { kind: "coin_penny",    widthMm: 19.05, heightMm: 19.05 },
};

// Re-export the scale constant so SpatialMeasurementCard can import it directly.
export const DEFAULT_SCALE_IN_PER_PX = 0.05;
