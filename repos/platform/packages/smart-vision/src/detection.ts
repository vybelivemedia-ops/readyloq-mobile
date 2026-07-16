/**
 * @platform/smart-vision — AI detection engine contracts.
 *
 * The detection engine is a pure interface. Applications plug in their own
 * model implementations (pest detection, person tracking, product recognition,
 * sports tracking, structural analysis, etc.). The platform orchestrates
 * inference timing and result routing without knowing what the model detects.
 *
 * GOVERNANCE:
 *   classId values are application-defined integers. The platform NEVER assigns
 *   meaning to them. ClassMapping (classId → label) is always injected from the
 *   application layer. No domain strings appear in this file.
 *   See repos/platform/GOVERNANCE.md.
 */

import type { BoundingBox, TrackId } from "./tracking";
import type { FrameIndex, FrameTimestamp, VideoFrame } from "./frame";

// ─── Branded primitives ───────────────────────────────────────────────────────

export type DetectionModelId = string & { readonly __brand: "DetectionModelId" };
export type DetectionId = string & { readonly __brand: "DetectionId" };

// ─── Detected object ──────────────────────────────────────────────────────────

/**
 * A single object detected within a frame.
 *
 * `classId` is an application-defined integer index into the model's class
 * vocabulary. The platform stores and routes it; only the application can
 * interpret what classId 7 means in its model.
 *
 * Applications provide a ClassMapping to resolve classIds to display labels
 * for UI rendering — the mapping stays in the application layer.
 */
export interface DetectedObject {
  /** Stable identifier for this detection within its result set. */
  readonly id: DetectionId;
  /** Application-defined class index. Not interpreted by the platform. */
  classId: number;
  /** Bounding box in normalised frame coordinates [0, 1]. */
  box: BoundingBox;
  /** Detection confidence: 0–1. */
  confidence: number;
  /**
   * Tracker ID when this detection has been associated with an ongoing track.
   * Set by the ObjectTracker after association; absent on raw detection output.
   */
  trackId?: TrackId;
  /**
   * Full softmax output when the model produces per-class scores.
   * Index = classId, value = probability. Present only when the model
   * exposes this data; omit otherwise to save memory.
   */
  classScores?: readonly number[];
  /**
   * Estimated distance from the camera to this object (meters).
   * Present only when a depth sensor or stereo camera provides depth data.
   */
  depthMeters?: number;
  /**
   * Mask pixels — true when a pixel within `box` belongs to this object.
   * Length = box.width × box.height in model-resolution pixels (not full-frame).
   * Present only when the model produces instance segmentation masks.
   */
  mask?: Uint8Array;
}

// ─── Detection result ─────────────────────────────────────────────────────────

/**
 * Output of one inference pass over a single video frame.
 *
 * `objects` contains all detections that survived NMS and confidence filtering.
 * The order is descending by confidence.
 */
export interface DetectionResult {
  frameIndex: FrameIndex;
  timestamp: FrameTimestamp;
  /** All surviving detections, ordered by descending confidence. */
  objects: readonly DetectedObject[];
  /** Wall-clock inference time in milliseconds. */
  inferenceMs: number;
  modelId: DetectionModelId;
  /** Whether inference ran on-device or via a remote call. */
  origin: "on_device" | "remote";
}

// ─── Detection model descriptor ───────────────────────────────────────────────

/**
 * Static metadata describing a detection model.
 * Produced by the model implementor; consumed by the SmartVisionEngine to
 * schedule preprocessing (resize, format conversion) correctly.
 */
export interface DetectionModel {
  readonly id: DetectionModelId;
  /** Human-readable name for diagnostics (e.g. "MobileNetV3-SSD-256"). */
  name: string;
  version: string;
  /** Pixel format the model's input tensor expects. */
  inputFormat: "rgba8" | "rgb8" | "gray8" | "yuv420p";
  /** Input tensor spatial dimensions. Frames are resized to fit. */
  inputWidth: number;
  inputHeight: number;
  /** Number of distinct classes this model can output. */
  classCount: number;
  /** Where this model can execute. */
  runLocation: "on_device" | "remote" | "either";
  /**
   * Whether the model produces instance segmentation masks in addition to
   * bounding boxes. If true, DetectedObject.mask may be populated.
   */
  hasMasks: boolean;
}

// ─── Detection configuration ──────────────────────────────────────────────────

export interface DetectionConfig {
  /** Discard detections below this confidence threshold: 0–1. Default: 0.5. */
  confidenceThreshold: number;
  /**
   * Non-maximum suppression IoU threshold: 0–1.
   * Higher = more overlapping boxes retained; lower = more aggressive merge.
   * Default: 0.45.
   */
  nmsThreshold: number;
  /**
   * Maximum detections returned per frame. 0 = no limit (use model maximum).
   * Default: 20.
   */
  maxDetections: number;
  /**
   * Restrict inference to these classIds. Empty = detect all classes.
   * Applications use this to skip classes irrelevant to the current workflow.
   */
  classFilter: readonly number[];
}

// ─── Class mapping ────────────────────────────────────────────────────────────

/**
 * Application-provided mapping from classId integers to display strings.
 *
 * The detection engine stores and echoes this map; it never reads or
 * interprets the string values. Label text is always the application's domain.
 */
export type ClassMapping = Readonly<Record<number, string>>;

// ─── Detection capability ─────────────────────────────────────────────────────

export interface DetectionCapability {
  available: boolean;
  supportedModels: readonly DetectionModel[];
  /** Whether the host device has a neural engine, GPU, or NPU available. */
  hasAccelerator: boolean;
  /**
   * Estimated sustainable inference frames per second on the current device
   * for a model of average size. Absent if no benchmark has been run.
   */
  estimatedFps?: number;
  /**
   * Whether the device can run models offline (on-device) or requires network.
   * Affects CapturePolicy behaviour in offline mode.
   */
  supportsOfflineInference: boolean;
}

// ─── Detection engine ─────────────────────────────────────────────────────────

/**
 * Core AI detection engine interface.
 *
 * Applications provide an implementation backed by the appropriate ML runtime
 * (CoreML, TFLite, ONNX Runtime, remote inference API, etc.). The
 * SmartVisionEngine calls `detect` once per frame (or at a scheduled cadence
 * based on the frame scheduler).
 *
 * The engine is completely model-agnostic. It does not know whether the
 * model detects pests, people, products, sports players, or structural defects.
 */
export interface DetectionEngine {
  readonly model: DetectionModel;
  readonly config: DetectionConfig;
  readonly capability: DetectionCapability;
  /**
   * Run inference on a single frame.
   * Implementations must complete within the session's frame deadline.
   * If inference exceeds the deadline, the SmartVisionEngine will reduce
   * detection frequency automatically.
   */
  detect(frame: VideoFrame): Promise<DetectionResult>;
  /**
   * Warm up the model — load weights, allocate GPU buffers, JIT-compile.
   * Call during session startup before the first `detect`. No-op if warm.
   */
  warmup(): Promise<void>;
  /**
   * Release model resources — unload weights, free GPU/NPU memory.
   * Call on session teardown or when switching models.
   */
  teardown(): void;
}

// ─── Detection confidence summary ────────────────────────────────────────────

/**
 * Rolling window statistics for a specific classId.
 *
 * The SmartVisionEngine maintains one summary per active classId across the
 * last N frames. The CapturePolicy uses this to distinguish a stable, reliable
 * detection from a flickering single-frame hit.
 */
export interface DetectionConfidenceSummary {
  classId: number;
  /** Mean confidence over the rolling window: 0–1. */
  meanConfidence: number;
  /** Number of frames within the window in which this class was detected. */
  detectedFrames: number;
  /** Total frames in the rolling window. */
  windowFrames: number;
  /**
   * True when `meanConfidence` consistently exceeds the detection threshold
   * and the class appears in at least half the window frames.
   */
  stable: boolean;
}
