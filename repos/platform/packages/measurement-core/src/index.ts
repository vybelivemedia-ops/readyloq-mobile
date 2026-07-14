/**
 * @platform/measurement-core
 *
 * Generic computer vision measurement for the platform.
 *
 * PURPOSE:
 *   Provide every platform application with the ability to estimate
 *   real-world measurements (width, height, depth, area, volume, distance,
 *   angle, slope) from images, video, or depth data.
 *
 * SCOPE CONSTRAINT (explicit):
 *   This package is domain-agnostic. Zero domain logic.
 *   - NO pest inspection logic (gap scoring, rodent-hole classification)
 *   - NO proposal pricing or material estimation rules
 *   - NO streaming / studio / camera-placement logic
 *   "Object to measure", "what the measurement means", and "what to do with it"
 *   are ALL defined by the consuming application.
 *
 * WHY SEPARATE FROM ai-core + local-intelligence (see ADR-014):
 *   ai-core = stateless AI orchestration (providers, sessions, pipelines)
 *   local-intelligence = on-device ML runtime (model lifecycle, inference engine)
 *   measurement-core = DOMAIN of measuring things in images. It coordinates
 *   geometry, optics, calibration, reference objects, depth estimation, and
 *   evidence annotation — concerns that cross-cut every inference engine.
 *   Mixing this into ai-core or local-intelligence would bloat those packages
 *   with geometry and optics knowledge.
 *
 * INFERENCE INTEGRATION:
 *   measurement-core does NOT import ai-core or local-intelligence.
 *   Instead it defines `MeasurementInferenceProvider` — a narrow interface
 *   that `LocalAIProvider` (from local-intelligence) and cloud providers
 *   both satisfy. Applications inject the provider at initialisation.
 *
 *   Recommended injection pattern:
 *     new MeasurementEngine({
 *       inferenceProvider: myLocalAIProvider,  // or cloud provider
 *       calibration: calibrationService,
 *       ...
 *     })
 *
 * APPLICATION INTEGRATION (examples):
 *   ReadyLoq: measure gap widths, rodent hole diameters, pipe diameters,
 *             window gap clearances, door sweep heights.
 *             The MEANING of the measurement (is the gap big enough for a mouse?)
 *             is defined in readyloq-mobile — NOT here.
 *   VYBE:     measure scene dimensions, camera-to-subject distances, studio
 *             layout for optimal camera placement.
 *   Future:   construction, insurance, facilities, security.
 *
 * DEPENDENCY GRAPH (Level 3 in the platform DAG):
 *   measurement-core → shared-types   (ConfidenceResult, EvidenceItem)
 *   measurement-core → camera-core    (CaptureFrame image input types)
 *   measurement-core → storage-core   (CalibrationStore, MeasurementHistoryStore)
 *   measurement-core → evidence-core  (MeasurementAnnotation → EvidenceItem)
 *
 *   Does NOT import: ai-core, local-intelligence, platform-intelligence
 *   (all three are integrated at runtime via injection or plugin registration)
 */

import type { EvidenceItem, ConfidenceResult } from "@platform/shared-types";

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT KINDS & UNITS
// ─────────────────────────────────────────────────────────────────────────────

/** The physical quantity being measured. */
export type MeasurementKind =
  | "width"
  | "height"
  | "depth"
  | "diameter"
  | "circumference"
  | "area"
  | "volume"
  | "distance"
  | "angle"
  | "slope"
  | "perimeter"
  | "thickness";

/** SI and Imperial units, selected by the consuming application. */
export type MeasurementUnit =
  // Length
  | "mm" | "cm" | "m" | "km"
  | "in" | "ft" | "yd" | "mi"
  // Area
  | "mm2" | "cm2" | "m2" | "km2"
  | "in2" | "ft2" | "yd2"
  // Volume
  | "mm3" | "cm3" | "m3"
  | "in3" | "ft3"
  // Angular
  | "deg" | "rad"
  // Ratio (for slope — rise/run)
  | "ratio";

// ─────────────────────────────────────────────────────────────────────────────
// SPATIAL PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A 2D bounding region in a normalised image coordinate space (0–1).
 * Used to scope measurements to a specific part of the image.
 */
export interface BoundingRegion {
  x: number;      // left edge (0–1)
  y: number;      // top edge (0–1)
  width: number;  // (0–1)
  height: number; // (0–1)
}

/** A single point in normalised image coordinates. */
export interface ImagePoint {
  x: number; // 0–1
  y: number; // 0–1
}

/** A polygon defined by a sequence of 2D image points (normalised 0–1). */
export interface ImagePolygon {
  points: ImagePoint[];
  /** True if the last point connects back to the first. */
  isClosed: boolean;
}

/** A 3D point in world coordinates (metres from origin). */
export interface WorldPoint3D {
  x: number;
  y: number;
  z: number;
  unit: MeasurementUnit;
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reference object is any item of known real-world dimensions visible in
 * the frame. The measurement engine uses it to establish a pixel-to-mm scale.
 *
 * Standard objects are pre-populated in `ReferenceObjectService`. Applications
 * can add custom reference objects (e.g. a labelled calibration card, a
 * proprietary inspection target).
 */
export type ReferenceObjectKind =
  | "credit_card"          // ISO/IEC 7810 ID-1: 85.6 × 54.0 mm
  | "us_dollar_bill"       // 156 × 66.3 mm
  | "us_letter_paper"      // 216 × 279 mm
  | "a4_paper"             // 210 × 297 mm
  | "us_electrical_outlet" // standard faceplate: 70 × 114 mm
  | "standard_brick"       // 190 × 57 mm (face)
  | "standard_door"        // 914 × 2032 mm (US interior)
  | "ping_pong_ball"       // Ø 40 mm
  | "golf_ball"            // Ø 42.7 mm
  | "us_quarter_coin"      // Ø 24.26 mm
  | "human_hand"           // average adult hand span ~190 mm (highly variable — low confidence)
  | "custom";              // application-defined

export interface ReferenceObject {
  id: string;
  kind: ReferenceObjectKind;
  name: string;
  /** Known width in the specified unit. */
  knownWidth: number;
  /** Known height in the specified unit. */
  knownHeight: number;
  /** Known depth (thickness) in the specified unit, if applicable. */
  knownDepth?: number;
  unit: MeasurementUnit;
  /**
   * How reliable this reference object is for establishing scale.
   * credit_card = high; human_hand = low.
   */
  reliabilityScore: number; // 0–1
  /** Whether this reference object is built-in (platform) or custom (app). */
  isBuiltIn: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION
// ─────────────────────────────────────────────────────────────────────────────

export type CalibrationStatus =
  | "uncalibrated"       // No calibration data — pure ML estimation only
  | "focal_length_auto"  // Focal length extracted from image EXIF
  | "reference_object"   // Scale established from a reference object in frame
  | "manual"             // Human-entered scale or known focal length
  | "depth_map"          // Depth-assisted: pixel scale derived from depth values
  | "ar_anchored"        // AR world coordinates (sub-cm accuracy)
  | "lidar"              // Future: LiDAR scan data
  | "stereo"             // Future: stereo camera baseline
  | "wearable_sensor";   // Future: wearable distance sensor

/**
 * A calibration profile stores the optical and scale parameters needed to
 * convert pixel measurements to real-world dimensions.
 *
 * Profiles are persisted via storage-core and can be cached per device model
 * or camera session.
 */
export interface CalibrationProfile {
  id: string;
  status: CalibrationStatus;
  /**
   * Effective focal length in mm (from EXIF, device spec, or manual entry).
   * Required for single-image estimation from known camera parameters.
   */
  focalLengthMm?: number;
  /**
   * Physical sensor width in mm.
   * Required for single-image estimation together with focalLengthMm.
   */
  sensorWidthMm?: number;
  /**
   * Image width in pixels (recorded at calibration time).
   * Used to derive pixels-per-mm from focalLengthMm + sensorWidthMm.
   */
  imageWidthPx?: number;
  /**
   * Direct pixel-to-mm scale factor (pixels per millimetre).
   * Derived from reference object or directly from camera spec.
   */
  pixelsPerMm?: number;
  /** Reference object used to establish scale, if any. */
  referenceObject?: ReferenceObject;
  /** Bounding region of the reference object in the calibration image. */
  referenceRegion?: BoundingRegion;
  /**
   * Device model string (e.g. "Apple iPhone 15 Pro").
   * Stored for cache invalidation when the device changes.
   */
  deviceModel?: string;
  /**
   * Confidence in the calibration: 0–1.
   * AR/LiDAR/stereo = 0.95+; focal-length auto = 0.7; uncalibrated = 0.
   */
  calibrationConfidence: number;
  createdAt: string; // ISO-8601
  /** Calibration should be re-validated after this time (ISO-8601). */
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT METHOD
// ─────────────────────────────────────────────────────────────────────────────

export type MeasurementMethod =
  | "single_image_ml"         // ML depth/size estimation from a single photo
  | "single_image_reference"  // Pixel-to-scale ratio using a reference object
  | "single_image_focal"      // Pinhole model: focal length + known object size
  | "multi_image_triangulate" // Structure from motion (2+ photos at known angles)
  | "video_tracking"          // Track object across frames; use motion to infer scale
  | "depth_map_projection"    // Project depth map + image to 3D cloud → measure
  | "ar_world_coordinates"    // AR plane detection + world anchor
  | "lidar_scan"              // Future: LiDAR point cloud
  | "stereo_camera"           // Future: stereo disparity map
  | "wearable_sensor"         // Future: wearable ultrasonic / ToF sensor
  | "manual_annotation"       // Human enters the value
  | "hybrid";                 // Fused from two or more methods

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────

export interface MeasurementConfidence {
  /**
   * Overall confidence in the measurement: 0–1.
   * High (0.9+): AR/LiDAR, high-quality reference object with good lighting.
   * Medium (0.6–0.9): Reference object detected, moderate conditions.
   * Low (<0.6): Pure ML estimation, poor lighting, no reference object.
   */
  score: number;
  /** The method that produced this measurement. */
  method: MeasurementMethod;
  /** What established the scale / depth reference. */
  calibrationStatus: CalibrationStatus;
  /**
   * Human-readable warnings. Applications may surface these to users.
   * Examples: "poor lighting", "partial reference object occlusion",
   *           "image blur may reduce accuracy", "no calibration — ML estimate only"
   */
  warnings: string[];
  /**
   * Uncertainty band: half the 90% confidence interval.
   * E.g. if value=25mm and uncertainty=3mm, the true value is likely 22–28mm.
   * Undefined if the method cannot produce a statistical uncertainty.
   */
  uncertaintyMm?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION ESTIMATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single measured quantity — the core value object of measurement-core.
 * Every measurement that exits the system is a DimensionEstimate.
 */
export interface DimensionEstimate {
  kind: MeasurementKind;
  value: number;
  unit: MeasurementUnit;
  /** Lower bound of the 90% confidence interval (in the same unit). */
  lowerBound?: number;
  /** Upper bound of the 90% confidence interval (in the same unit). */
  upperBound?: number;
  confidence: MeasurementConfidence;
  /**
   * Pixel span (in the source image) that corresponds to this measurement.
   * Useful for drawing measurement overlays at the correct scale.
   */
  pixelSpan?: number;
  /** The image region where the measurement was taken. */
  sourceRegion?: BoundingRegion;
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTED MEASURABLE OBJECT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An object detected in the image that can be measured.
 * The `label` is a generic string — domain-specific naming (e.g. "rodent hole",
 * "pipe", "window") happens in the consuming application.
 */
export interface DetectedMeasurableObject {
  id: string;
  /** Generic label from the detection model (e.g. "circular opening", "gap"). */
  label: string;
  detectionConfidence: ConfidenceResult;
  boundingRegion: BoundingRegion;
  /** Polygon outline (more precise than bounding box). */
  outline?: ImagePolygon;
  /** Preliminary size estimate from the detector alone (low confidence). */
  preliminaryEstimate?: DimensionEstimate;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT INPUT
// ─────────────────────────────────────────────────────────────────────────────

export type MeasurementInputKind =
  | "image_bytes"
  | "image_base64"
  | "video_frames"  // ordered sequence of frames
  | "depth_map"     // aligned depth + RGB
  | "point_cloud";  // 3D point cloud (LiDAR / stereo)

export interface DepthMap {
  /** Float32 depth values in metres, row-major, same size as the RGB image. */
  depthValues: number[];
  width: number;
  height: number;
  /** Minimum valid depth value in metres. */
  minDepthM: number;
  /** Maximum valid depth value in metres. */
  maxDepthM: number;
}

export interface MeasurementInput {
  kind: MeasurementInputKind;
  imageBytes?: Uint8Array;
  imageBase64?: string;
  imageMimeType?: string;
  /** Width of the source image in pixels. */
  imageWidthPx?: number;
  /** Height of the source image in pixels. */
  imageHeightPx?: number;
  /** EXIF data for focal length extraction (JSON-serialised). */
  exifJson?: string;
  /** For video_frames: ordered array of base64-encoded frames. */
  videoFrames?: string[];
  /** Aligned depth map (same resolution as the colour image). */
  depthMap?: DepthMap;
  /** For point_cloud: array of [x, y, z] world-coordinate triples (metres). */
  pointCloud?: number[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// INFERENCE PROVIDER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Narrow AI inference interface injected into MeasurementEngine.
 *
 * measurement-core does NOT import ai-core or local-intelligence directly.
 * Instead, both `LocalAIProvider` (from @platform/local-intelligence) and
 * cloud AIProvider implementations (from @platform/ai-core) satisfy this
 * interface — applications inject whichever they have available.
 *
 * The two operations measurement-core needs:
 *   detectObjects — run a detection model to find measurable objects
 *   estimateDepth — run a monocular depth estimation model
 *
 * Both accept image bytes (base64) and return generic JSON.
 */
export interface MeasurementInferenceProvider {
  /** Whether this provider is available right now (network/model-ready check). */
  isAvailable(): boolean;
  /** True if this provider works without a network connection. */
  worksOffline: boolean;

  /**
   * Run an object detection model on an image.
   * Returns raw model output; MeasurementEngine parses the specific format.
   */
  detectObjects(input: {
    imageBase64: string;
    modelId?: string;
    minConfidence?: number;
  }): Promise<MeasurementDetectionOutput>;

  /**
   * Run a monocular depth estimation model on an image.
   * Returns a depth map aligned to the input image.
   */
  estimateDepth(input: {
    imageBase64: string;
    modelId?: string;
  }): Promise<MeasurementDepthOutput>;
}

/** Raw output from the detection inference call. */
export interface MeasurementDetectionOutput {
  detections: Array<{
    label: string;
    confidence: number; // 0–1
    /** Normalised bounding box [x, y, width, height] (0–1). */
    box: [number, number, number, number];
  }>;
  modelId: string;
  latencyMs: number;
}

/** Raw output from the depth estimation inference call. */
export interface MeasurementDepthOutput {
  /** Float32 relative depth values (not absolute metres — requires calibration). */
  relativeDepthValues: number[];
  width: number;
  height: number;
  modelId: string;
  latencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT REQUEST & RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface MeasurementRequest {
  id: string;
  /** What to measure. Pass multiple kinds to measure in a single pass. */
  kinds: MeasurementKind[];
  input: MeasurementInput;
  /**
   * If provided, the engine uses this reference object to establish pixel scale.
   * Higher priority than the calibration profile's reference object.
   */
  referenceObject?: ReferenceObject;
  /**
   * ID of a previously stored CalibrationProfile to use.
   * If omitted, the engine tries EXIF focal length, then ML estimation.
   */
  calibrationProfileId?: string;
  /**
   * Preferred measurement method. If omitted, the engine picks the best
   * available method based on input type and calibration status.
   */
  preferredMethod?: MeasurementMethod;
  /**
   * Restrict detection and measurement to this region of the image.
   * Useful for focused measurements (e.g. "measure only the gap at the bottom
   * of this door", not the whole door).
   */
  targetRegion?: BoundingRegion;
  /**
   * Target unit for all returned measurements.
   * Defaults to millimetres for length, mm² for area, mm³ for volume.
   */
  outputUnit?: MeasurementUnit;
  useCache?: boolean;
  priority?: "high" | "normal" | "low";
  metadata?: Record<string, unknown>;
}

export interface MeasurementResult {
  requestId: string;
  /** All dimension estimates produced for this request. */
  estimates: DimensionEstimate[];
  /** Objects detected in the image that were used for measurement. */
  detectedObjects: DetectedMeasurableObject[];
  /** The calibration profile used (auto-created if none was provided). */
  calibrationProfile: CalibrationProfile;
  /** The primary method used for this measurement. */
  method: MeasurementMethod;
  /** Whether this result was served from the cache. */
  cached: boolean;
  latencyMs: number;
  measuredAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE ANNOTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches a set of measurements to an EvidenceItem from evidence-core.
 *
 * Multiple annotations may exist per evidence item (e.g. initial auto-estimate,
 * then a corrected manual measurement). The `version` field tracks revisions.
 * Only one annotation is `isActive = true` at any time.
 *
 * EXTRACTION NOTE:
 *   ReadyLoq: MeasurementAnnotation is attached to an inspection photo
 *             (EvidenceItem). The annotation records the gap measurement
 *             or hole diameter that informed the technician's report.
 *   VYBE:     MeasurementAnnotation is attached to a stream screenshot or
 *             venue photo. The annotation records scene or studio dimensions.
 */
export interface MeasurementAnnotation {
  id: string;
  /** The evidence item this annotation belongs to. */
  evidenceItemId: string;
  /**
   * App-defined entity type (e.g. "inspection", "stream_session", "venue").
   * Used for searching and grouping annotations.
   */
  entityType: string;
  entityId: string;
  /** All measurements on this evidence item at this version. */
  estimates: DimensionEstimate[];
  /** The image region these measurements apply to (optional). */
  annotatedRegion?: BoundingRegion;
  /** The request that produced these measurements. */
  requestId: string;
  /** Method used. */
  method: MeasurementMethod;
  /** Calibration profile used. */
  calibrationProfileId?: string;
  /** Version number. Starts at 1; increments on correction. */
  version: number;
  /** True for the most recent, authoritative version. */
  isActive: boolean;
  /** Reason for this version (e.g. "manual correction by technician"). */
  revisionReason?: string;
  /** User ID of the person who created or revised this annotation. */
  authorId?: string;
  notes?: string;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export interface MeasurementHistoryRecord {
  id: string;
  annotation: MeasurementAnnotation;
  /** The evidence item being measured. */
  evidenceItemId: string;
  /** App-defined entity type and ID (for search scoping). */
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface MeasurementHistorySearchFilter {
  entityType?: string;
  entityId?: string;
  evidenceItemId?: string;
  kinds?: MeasurementKind[];
  /** Only return the active annotation per evidence item. */
  activeOnly?: boolean;
  /** ISO-8601 start of date range. */
  after?: string;
  /** ISO-8601 end of date range. */
  before?: string;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts and stores calibration data for a camera or session.
 *
 * Auto-calibration priority order:
 *   1. AR world coordinates (highest accuracy)
 *   2. LiDAR / stereo camera
 *   3. Reference object detected in frame
 *   4. EXIF focal length + sensor width from device spec
 *   5. ML depth estimation (lowest accuracy; no reference)
 *
 * Calibration profiles are stored via storage-core and keyed by device model
 * + camera type so they can be reused across sessions.
 */
export interface CalibrationService {
  /**
   * Attempt to auto-calibrate from the provided image and optional reference
   * object. Returns a CalibrationProfile at whatever accuracy the input allows.
   */
  autoCalibrate(input: {
    image: MeasurementInput;
    referenceObject?: ReferenceObject;
    inferenceProvider?: MeasurementInferenceProvider;
  }): Promise<CalibrationProfile>;

  /**
   * Create a calibration profile from a manually provided reference measurement.
   * E.g. "I know this doorway is 914mm wide; here's where it is in the image."
   */
  calibrateFromManualReference(input: {
    knownDimensionMm: number;
    pixelSpan: number;
    imageWidthPx: number;
    imageHeightPx: number;
  }): CalibrationProfile;

  /** Retrieve a stored calibration profile. */
  get(profileId: string): Promise<CalibrationProfile | null>;

  /** Save or update a calibration profile. */
  save(profile: CalibrationProfile): Promise<CalibrationProfile>;

  /** Delete a calibration profile. */
  delete(profileId: string): Promise<void>;

  /**
   * Find the best available calibration profile for a device model.
   * Returns null if no profile exists (MeasurementEngine falls back to ML).
   */
  findBestForDevice(deviceModel: string): Promise<CalibrationProfile | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE OBJECT SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the library of reference objects and detects them in images.
 *
 * Built-in reference objects are pre-populated. Applications can register
 * custom reference objects (e.g. a branded inspection calibration card with
 * a known size).
 */
export interface ReferenceObjectService {
  /** All built-in reference objects. */
  listBuiltIn(): ReferenceObject[];

  /** Register a custom reference object for the current application context. */
  registerCustom(obj: Omit<ReferenceObject, "id" | "isBuiltIn">): ReferenceObject;

  /** Retrieve a reference object by ID. */
  get(id: string): ReferenceObject | undefined;

  /**
   * Attempt to detect a known reference object in the provided image.
   * The inference provider runs the detection model. Returns the best match
   * and its bounding region in the image, or null if nothing is recognised.
   */
  detectInImage(input: {
    image: MeasurementInput;
    inferenceProvider: MeasurementInferenceProvider;
    candidates?: ReferenceObject[]; // limit search to these objects
  }): Promise<{
    referenceObject: ReferenceObject;
    region: BoundingRegion;
    confidence: number;
  } | null>;

  /**
   * Convert a detected reference object into a CalibrationProfile.
   * pixelsPerMm = detectedWidthPx / referenceObject.knownWidth (converted to mm).
   */
  toCalibrationProfile(
    referenceObject: ReferenceObject,
    detectedRegion: BoundingRegion,
    imageWidthPx: number,
    imageHeightPx: number,
  ): CalibrationProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimates a depth map from a single colour image (monocular depth estimation)
 * or projects an existing depth map to 3D world coordinates.
 *
 * Monocular depth estimation models (e.g. Depth Anything, MiDaS, ZoeDepth)
 * produce relative depth — not absolute metres. The DepthEstimator calibrates
 * relative depth to absolute depth when a calibration profile is available.
 */
export interface DepthEstimator {
  /**
   * Estimate a depth map from a single colour image.
   * Requires an inference provider for the ML model call.
   */
  estimateMonocular(
    image: MeasurementInput,
    inferenceProvider: MeasurementInferenceProvider,
    calibration?: CalibrationProfile,
  ): Promise<DepthMap>;

  /**
   * Convert a relative depth map (0–1 normalised) to absolute depth (metres)
   * using a calibration profile's known scale.
   */
  toAbsoluteDepth(relativeDepth: DepthMap, calibration: CalibrationProfile): DepthMap;

  /**
   * Project a depth map + colour image into a 3D point cloud.
   * Requires calibration for pixel-to-world mapping.
   */
  toPointCloud(depthMap: DepthMap, calibration: CalibrationProfile): WorldPoint3D[];

  /**
   * Sample the depth at a specific image point.
   * Returns metres if the depth map is absolute, or a relative value [0–1].
   */
  sampleDepth(depthMap: DepthMap, point: ImagePoint): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCALE ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Establishes the pixel-to-real-world scale for a given image.
 * The scale (pixelsPerMm) is the fundamental bridge between image measurements
 * and physical measurements.
 *
 * Scale sources (in priority order):
 *   1. AR world coordinates (sub-mm)
 *   2. LiDAR / stereo depth
 *   3. Reference object in frame (mm/px from known size)
 *   4. EXIF focal length + sensor width + assumed distance
 *   5. ML monocular depth estimate (lowest accuracy)
 */
export interface ScaleEstimator {
  /**
   * Estimate the pixel-to-mm scale for the provided image.
   * Returns pixelsPerMm and the calibration status achieved.
   */
  estimate(input: {
    image: MeasurementInput;
    referenceObject?: ReferenceObject;
    referenceRegion?: BoundingRegion;
    depthMap?: DepthMap;
    existingCalibration?: CalibrationProfile;
    inferenceProvider?: MeasurementInferenceProvider;
  }): Promise<{ pixelsPerMm: number; calibration: CalibrationProfile }>;

  /**
   * Convert a pixel distance to millimetres using a known scale.
   * inverse: mmToPixels
   */
  pixelsToMm(pixels: number, pixelsPerMm: number): number;
  mmToPixels(mm: number, pixelsPerMm: number): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts image-space measurements (pixel spans, bounding regions) to
 * real-world DimensionEstimates using a calibration profile.
 */
export interface DimensionEstimator {
  /** Estimate the width of a bounding region in real-world units. */
  estimateWidth(
    region: BoundingRegion,
    imageWidthPx: number,
    calibration: CalibrationProfile,
    outputUnit: MeasurementUnit,
  ): DimensionEstimate;

  /** Estimate the height of a bounding region. */
  estimateHeight(
    region: BoundingRegion,
    imageHeightPx: number,
    calibration: CalibrationProfile,
    outputUnit: MeasurementUnit,
  ): DimensionEstimate;

  /** Estimate the diameter of a circular feature. */
  estimateDiameter(
    region: BoundingRegion,
    imageWidthPx: number,
    imageHeightPx: number,
    calibration: CalibrationProfile,
    outputUnit: MeasurementUnit,
  ): DimensionEstimate;

  /**
   * Estimate depth (distance into the scene) at an image point.
   * Requires a depth map (monocular ML or hardware).
   */
  estimateDepthAtPoint(
    point: ImagePoint,
    depthMap: DepthMap,
    calibration: CalibrationProfile,
    outputUnit: MeasurementUnit,
  ): DimensionEstimate;

  /**
   * Estimate the straight-line distance between two image points.
   * Requires depth information for 3D distance.
   */
  estimateDistance(
    pointA: ImagePoint,
    pointB: ImagePoint,
    calibration: CalibrationProfile,
    outputUnit: MeasurementUnit,
    depthMap?: DepthMap,
  ): DimensionEstimate;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure geometry calculations for measurement post-processing.
 * No inference required — mathematical operations only.
 */
export interface GeometryService {
  /** Compute the area of a polygon defined in image coordinates (normalised). */
  polygonAreaPx(polygon: ImagePolygon, imageWidthPx: number, imageHeightPx: number): number;
  /** Convert pixel area to real-world area using calibration. */
  pixelAreaToRealArea(pixelArea: number, calibration: CalibrationProfile, outputUnit: MeasurementUnit): DimensionEstimate;
  /** Compute perimeter of a polygon in pixels. */
  polygonPerimeterPx(polygon: ImagePolygon, imageWidthPx: number, imageHeightPx: number): number;
  /** Compute the angle between two line segments (degrees). */
  angleBetweenSegments(
    segmentA: [ImagePoint, ImagePoint],
    segmentB: [ImagePoint, ImagePoint],
  ): number;
  /** Estimate volume from cross-section area and depth. */
  estimateVolume(crossSectionAreaMm2: number, depthMm: number, outputUnit: MeasurementUnit): DimensionEstimate;
  /** Convert between measurement units. */
  convert(value: number, from: MeasurementUnit, to: MeasurementUnit): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT CACHE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caches MeasurementResult objects keyed on a content-addressed hash of the
 * input image + request parameters.
 *
 * Cache keys for image inputs use perceptual hash (pHash) so visually-similar
 * frames share a cache entry. Cache invalidation is by TTL or explicit clear.
 */
export interface MeasurementCache {
  get(key: string): MeasurementResult | undefined;
  set(key: string, result: MeasurementResult, ttlSeconds?: number): void;
  delete(key: string): void;
  invalidateForCalibrationProfile(profileId: string): void;
  /** Remove all expired entries. */
  pruneExpired(): void;
  clear(): void;
  hitRate(): number;
  stats(): { entries: number; hits: number; misses: number; sizeBytes?: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT HISTORY (STORE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persists and queries MeasurementAnnotation records.
 * Stored via storage-core; queryable by entity, evidence item, date range, etc.
 */
export interface MeasurementHistory {
  /** Save or update an annotation (creates a new version if it already exists). */
  save(annotation: Omit<MeasurementAnnotation, "id" | "version" | "createdAt" | "updatedAt">): Promise<MeasurementAnnotation>;

  /** Retrieve a specific annotation by ID. */
  get(annotationId: string): Promise<MeasurementAnnotation | null>;

  /**
   * Retrieve the active annotation for an evidence item.
   * Returns null if no measurements exist for this item.
   */
  getActive(evidenceItemId: string): Promise<MeasurementAnnotation | null>;

  /** Retrieve all annotation versions for an evidence item (newest first). */
  getVersionHistory(evidenceItemId: string): Promise<MeasurementAnnotation[]>;

  /** Search measurement history. */
  search(filter: MeasurementHistorySearchFilter): Promise<MeasurementHistoryRecord[]>;

  /** Retire the active annotation (mark isActive=false) without deleting. */
  deactivate(annotationId: string, reason?: string): Promise<void>;

  /** Hard-delete an annotation (use sparingly; prefer deactivate). */
  delete(annotationId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface MeasurementEngineConfig {
  /** Injected inference provider (local or cloud). Optional — falls back to geometry-only estimation. */
  inferenceProvider?: MeasurementInferenceProvider;
  calibration: CalibrationService;
  referenceObjects: ReferenceObjectService;
  depthEstimator: DepthEstimator;
  scaleEstimator: ScaleEstimator;
  dimensionEstimator: DimensionEstimator;
  geometry: GeometryService;
  cache: MeasurementCache;
  history: MeasurementHistory;
  /** Default output unit (defaults to "mm"). */
  defaultUnit?: MeasurementUnit;
  /** Default minimum confidence threshold for detections (0–1). */
  defaultMinConfidence?: number;
}

/**
 * The primary entry point for all measurement operations.
 *
 * Orchestrates: input parsing → calibration → scale estimation → object
 * detection → dimension estimation → annotation → caching.
 *
 * Single-image flow:
 *   1. Extract EXIF focal length (if available)
 *   2. Detect reference object in frame (if inferenceProvider available)
 *   3. Establish pixel-to-mm scale (CalibrationService)
 *   4. Detect measurable objects (VisionEngine via inferenceProvider)
 *   5. Compute DimensionEstimate for each detected object
 *   6. Return MeasurementResult
 *
 * Multi-image flow:
 *   Uses triangulation across frames for better depth accuracy.
 *
 * Video flow:
 *   Tracks objects across frames; uses frame-to-frame motion for scale.
 */
export interface MeasurementEngine {
  readonly config: MeasurementEngineConfig;

  /**
   * Measure from a single image.
   * This is the primary call for photo-based workflows.
   */
  measure(request: MeasurementRequest): Promise<MeasurementResult>;

  /**
   * Measure from multiple images of the same scene (different viewpoints).
   * Uses triangulation for improved accuracy. Minimum 2 images; maximum 10.
   */
  measureMultiImage(
    requests: MeasurementRequest[],
    method?: "triangulation" | "sfm",
  ): Promise<MeasurementResult>;

  /**
   * Measure from a sequence of video frames.
   * Tracks objects across frames and uses optical flow for scale estimation.
   */
  measureFromVideo(
    frames: MeasurementInput[],
    kinds: MeasurementKind[],
    options?: { calibrationProfileId?: string; referenceObject?: ReferenceObject },
  ): Promise<MeasurementResult>;

  /**
   * Attach a MeasurementResult to an EvidenceItem, creating a
   * MeasurementAnnotation. Updates the history store.
   */
  annotateEvidence(
    evidenceItemId: string,
    entityType: string,
    entityId: string,
    result: MeasurementResult,
    notes?: string,
  ): Promise<MeasurementAnnotation>;

  /**
   * Manually revise an existing annotation with corrected measurements.
   * Creates a new version; previous version is deactivated.
   */
  reviseAnnotation(
    annotationId: string,
    correctedEstimates: DimensionEstimate[],
    revisionReason: string,
    authorId?: string,
  ): Promise<MeasurementAnnotation>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT PROVIDER (for platform-intelligence plugin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-level provider interface used by platform-intelligence's ProviderCoordinator.
 * Workflow steps request measurements via this interface without knowing the
 * underlying engine configuration.
 *
 * Applications register a MeasurementProvider as a plugin with platform-intelligence.
 * The plugin wraps a fully-configured MeasurementEngine.
 */
export interface MeasurementProvider {
  /** Provider identifier for the ProviderCoordinator. */
  readonly providerId: string;
  /** Whether this provider can handle the given request right now. */
  canHandle(request: MeasurementRequest): boolean;
  /** Execute the measurement. */
  execute(request: MeasurementRequest): Promise<MeasurementResult>;
  /** Whether the provider works without a network connection. */
  worksOffline: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete measurement runtime surface. Passed to applications via the
 * platform-intelligence plugin context. Applications should not instantiate
 * this directly — it is assembled by the MeasurementPlugin at app bootstrap.
 */
export interface MeasurementContext {
  engine: MeasurementEngine;
  calibration: CalibrationService;
  referenceObjects: ReferenceObjectService;
  depthEstimator: DepthEstimator;
  scaleEstimator: ScaleEstimator;
  dimensionEstimator: DimensionEstimator;
  geometry: GeometryService;
  cache: MeasurementCache;
  history: MeasurementHistory;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT KINDS
// ─────────────────────────────────────────────────────────────────────────────

export const MEASUREMENT_EVENT_KINDS = {
  MEASUREMENT_STARTED:            "measurement.session.started",
  MEASUREMENT_COMPLETE:           "measurement.session.complete",
  MEASUREMENT_FAILED:             "measurement.session.failed",
  CALIBRATION_COMPLETE:           "measurement.calibration.complete",
  CALIBRATION_FAILED:             "measurement.calibration.failed",
  REFERENCE_OBJECT_DETECTED:      "measurement.reference_object.detected",
  REFERENCE_OBJECT_NOT_FOUND:     "measurement.reference_object.not_found",
  ANNOTATION_CREATED:             "measurement.annotation.created",
  ANNOTATION_REVISED:             "measurement.annotation.revised",
  DEPTH_ESTIMATION_COMPLETE:      "measurement.depth.estimated",
  LOW_CONFIDENCE_WARNING:         "measurement.confidence.low",
} as const;

export type MeasurementEventKind = (typeof MEASUREMENT_EVENT_KINDS)[keyof typeof MEASUREMENT_EVENT_KINDS];

// Typed event payloads:

export interface MeasurementCompletePayload {
  requestId: string;
  estimateCount: number;
  method: MeasurementMethod;
  topConfidence: number;
  cached: boolean;
  latencyMs: number;
}

export interface CalibrationCompletePayload {
  profileId: string;
  status: CalibrationStatus;
  calibrationConfidence: number;
  deviceModel?: string;
}

export interface AnnotationCreatedPayload {
  annotationId: string;
  evidenceItemId: string;
  entityType: string;
  entityId: string;
  estimateCount: number;
  version: number;
}

export interface LowConfidenceWarningPayload {
  requestId: string;
  confidenceScore: number;
  warnings: string[];
}
