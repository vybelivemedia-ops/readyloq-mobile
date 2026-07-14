/**
 * @platform/local-intelligence
 *
 * On-device AI runtime for the platform.
 *
 * SCOPE CONSTRAINT (explicit):
 *   This package is domain-agnostic. ZERO domain logic allowed.
 *   - NO pest-inspection logic (stays in readyloq-mobile)
 *   - NO streaming/social/creator logic (stays in vybelive)
 *   - Model lifecycle, on-device inference, hardware awareness, and
 *     hybrid provider selection ONLY.
 *
 * WHY SEPARATE FROM ai-core (see ADR-013):
 *   ai-core manages cloud AI providers — stateless API calls, session
 *   management, and the middleware pipeline. local-intelligence manages the
 *   fundamentally different lifecycle of on-device ML models: download →
 *   storage → load into framework runtime → warm up → infer → unload.
 *   Mixing them would force ai-core to carry mobile-specific framework deps
 *   (TFLite, ONNX, CoreML, NNAPI) even in pure-web/cloud applications.
 *
 * INFERENCE MODES:
 *   local   — on-device model only; works fully offline
 *   cloud   — cloud API (via ai-core AIProviderFactory); requires network
 *   hybrid  — try local first; fall back to cloud on model miss or failure
 *   auto    — ProviderSelector decides based on network/battery/thermal state
 *
 * SUPPORTED RUNTIMES (future implementations, not imported here):
 *   TensorFlow Lite · ONNX Runtime · Apple CoreML · Android NNAPI
 *   MediaPipe · Custom model runners · OpenAI Local · Future providers
 *
 * PLATFORM INTEGRATION:
 *   local-intelligence registers as a plugin in platform-intelligence.
 *   The LocalIntelligencePlugin provides LocalAIProviders to the
 *   ProviderCoordinator. Workflow steps request inference via
 *   platform-intelligence's ProviderCoordinator, not by importing this
 *   package directly.
 *
 * DEPENDENCY GRAPH (Level 3 in the platform DAG):
 *   local-intelligence → shared-types      (EvidenceItem, ConfidenceResult)
 *   local-intelligence → ai-core           (AIProvider, EventBus, StateEngine)
 *   local-intelligence → camera-core       (CaptureFrame input types)
 *   local-intelligence → storage-core      (model file storage)
 *   local-intelligence → evidence-core     (EvidenceItem duplicate detection)
 *
 * WHAT STAYS IN APPLICATIONS:
 *   - Model IDs / filenames specific to domain (pest model, stream caption model)
 *   - Inference prompts and output parsers
 *   - Domain-specific quality thresholds
 *   - Decision logic using inference results
 */

import type { EvidenceItem, ConfidenceResult } from "@platform/shared-types";
import type { AIProvider, AIProviderCapabilities } from "@platform/ai-core";

// ─────────────────────────────────────────────────────────────────────────────
// FRAMEWORK & RUNTIME TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * On-device ML framework. Implementations are confined to adapter files;
 * the rest of the package only sees this enum.
 */
export type MLFramework =
  | "tflite"
  | "onnx"
  | "coreml"
  | "nnapi"
  | "mediapipe"
  | "custom"
  | "unknown";

/** Hardware accelerator available on this device. */
export type HardwareAccelerator =
  | "cpu"
  | "gpu"
  | "npu"      // Neural Processing Unit (e.g. Apple Neural Engine, Qualcomm Hexagon)
  | "nnapi"    // Android NNAPI delegate
  | "coreml"   // Apple CoreML delegate
  | "unknown";

/** How inference is to be sourced. */
export type InferenceMode = "local" | "cloud" | "hybrid" | "auto";

// ─────────────────────────────────────────────────────────────────────────────
// MODEL VERSIONING
// ─────────────────────────────────────────────────────────────────────────────

/** Semantic model version with platform compatibility metadata. */
export interface ModelVersion {
  /** Semver string, e.g. "1.2.0". */
  version: string;
  /** Minimum OS version required (platform-specific string). */
  minOSVersion?: string;
  /** Minimum framework version required. */
  minFrameworkVersion?: string;
  /** ISO-8601 release date. */
  releasedAt: string;
  /** Release notes — human-readable summary of changes. */
  changelog?: string;
  /** Whether this version is deprecated. */
  deprecated?: boolean;
  /** Recommended replacement version if deprecated. */
  supersededBy?: string;
}

/**
 * The task categories a model is trained to perform.
 * Domain-specific tasks (e.g. "pest_detection") are defined by the app,
 * not here.
 */
export type ModelCapability =
  | "vision_detection"
  | "vision_classification"
  | "vision_segmentation"
  | "ocr"
  | "embedding_text"
  | "embedding_image"
  | "image_quality"
  | "blur_detection"
  | "motion_detection"
  | "duplicate_detection"
  | "speech_recognition"
  | "text_generation"
  | "custom";

/** Full descriptor for a registered model. */
export interface ModelInfo {
  /** Stable unique identifier — defined by the application. */
  id: string;
  /** Human-readable name. */
  name: string;
  framework: MLFramework;
  version: ModelVersion;
  capabilities: ModelCapability[];
  /**
   * Input shape as [height, width, channels] for image models,
   * or [sequenceLength, embedding] for text models.
   */
  inputShape?: number[];
  outputShape?: number[];
  /** Compressed model file size in bytes. */
  sizeBytes: number;
  /** Download source URL. Applications provide this. */
  downloadUrl: string;
  /**
   * Storage path where the model file is stored locally.
   * Managed by ModelDownloader; use ModelManager.getModelPath() to read.
   */
  storagePath?: string;
  /** SHA-256 hex hash for integrity verification after download. */
  sha256?: string;
  /** Preferred hardware accelerator. Falls back to CPU if unavailable. */
  preferredAccelerator?: HardwareAccelerator;
  metadata?: Record<string, unknown>;
}

export type ModelStatus =
  | "not_downloaded"
  | "downloading"
  | "downloaded"
  | "loading"
  | "loaded"
  | "error"
  | "unloading";

// ─────────────────────────────────────────────────────────────────────────────
// MODEL REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central registry of all models known to the application.
 * Applications register models at startup with their download URLs and
 * capability declarations. The registry does NOT download or load models —
 * it only tracks what models exist and their current status.
 */
export interface ModelRegistry {
  /** Register a model descriptor. Idempotent — re-registering updates metadata. */
  register(model: ModelInfo): void;
  unregister(modelId: string): void;

  /** Retrieve a model descriptor by ID. */
  get(modelId: string): ModelInfo | undefined;

  /** All registered models. */
  list(): ModelInfo[];

  /** Models with a given capability, optionally filtered by framework. */
  findByCapability(capability: ModelCapability, framework?: MLFramework): ModelInfo[];

  /** Current lifecycle status for a model. */
  getStatus(modelId: string): ModelStatus;

  /** Update the status for a model (called by ModelDownloader + ModelManager). */
  setStatus(modelId: string, status: ModelStatus): void;

  /** Subscribe to status changes for a model. */
  onStatusChange(
    modelId: string,
    listener: (status: ModelStatus) => void,
  ): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL DOWNLOADER
// ─────────────────────────────────────────────────────────────────────────────

export type DownloadStatus =
  | "idle"
  | "queued"
  | "connecting"
  | "downloading"
  | "verifying"
  | "complete"
  | "paused"
  | "cancelled"
  | "error";

export interface ModelDownload {
  modelId: string;
  status: DownloadStatus;
  /** Bytes downloaded so far. */
  bytesDownloaded: number;
  /** Total size in bytes (0 if unknown). */
  totalBytes: number;
  /** Download progress 0–1 (NaN if total unknown). */
  progress: number;
  error?: string;
  startedAt?: string;   // ISO-8601
  completedAt?: string;
}

/**
 * Manages model file downloads with pause/resume support.
 * Stores model files via storage-core using a dedicated namespace.
 *
 * Hash verification: after download completes, compares SHA-256 of the
 * file against ModelInfo.sha256 (if provided). On mismatch, deletes the
 * corrupted file and emits an error status.
 */
export interface ModelDownloader {
  /** Begin downloading a registered model. Idempotent if already downloaded. */
  download(modelId: string): Promise<void>;
  pause(modelId: string): Promise<void>;
  resume(modelId: string): Promise<void>;
  cancel(modelId: string): Promise<void>;
  /** Delete the downloaded model file. */
  delete(modelId: string): Promise<void>;

  /** Current download state for a model. */
  getDownload(modelId: string): ModelDownload | undefined;

  /** Subscribe to download progress updates. */
  onProgress(modelId: string, listener: (download: ModelDownload) => void): () => void;

  /** Subscribe to ALL download events (useful for a download manager UI). */
  onAnyProgress(listener: (download: ModelDownload) => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL MANAGER
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelLoadOptions {
  /** Hardware accelerator to use. Defaults to the model's preferredAccelerator. */
  accelerator?: HardwareAccelerator;
  /** Maximum memory (bytes) to allocate for this model's runtime. */
  memoryLimitBytes?: number;
  /** Number of CPU threads to use (if applicable). */
  numThreads?: number;
  /** Pre-warm the model with a dummy inference call to reduce first-call latency. */
  warmup?: boolean;
}

/**
 * Composite model lifecycle manager: registry + downloader + framework loader.
 *
 * The ModelManager is the main entry point for working with models:
 *   1. ensure() — downloads if needed, then loads into the framework runtime
 *   2. unload() — frees framework memory
 *   3. isReady() — quick check before inference
 *
 * Concrete implementations wrap the specific framework SDK (TFLite interpreter,
 * ONNX session, CoreML model, etc.) behind this interface.
 */
export interface ModelManager {
  readonly registry: ModelRegistry;
  readonly downloader: ModelDownloader;

  /**
   * Ensure a model is downloaded AND loaded into the framework runtime.
   * This is the one-stop-shop call before inference.
   * Resolves when the model is ready for inference.
   */
  ensure(modelId: string, options?: ModelLoadOptions): Promise<void>;

  /** Load a downloaded model into the framework runtime. */
  load(modelId: string, options?: ModelLoadOptions): Promise<void>;

  /** Unload a model from the framework runtime, freeing GPU/CPU memory. */
  unload(modelId: string): Promise<void>;

  /** True when the model is loaded and ready for inference. */
  isReady(modelId: string): boolean;

  /** Storage path of the downloaded model file. Throws if not downloaded. */
  getModelPath(modelId: string): string;

  /** Retrieve the ModelInfo + status + memory footprint. */
  describe(modelId: string): ModelInfo & { status: ModelStatus; loadedBytes?: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOURCE AWARENESS
// ─────────────────────────────────────────────────────────────────────────────

export interface BatteryState {
  /** Normalised battery level 0–1. */
  level: number;
  isCharging: boolean;
  /** True when level < 0.20 (configurable threshold). */
  isLow: boolean;
  /** True when level < 0.10 (configurable threshold). */
  isCritical: boolean;
}

export type ThermalLevel =
  | "nominal"   // Normal operating temperature
  | "fair"      // Slightly elevated; no throttling yet
  | "serious"   // System has begun throttling
  | "critical"; // Severe throttling; inference should be deferred

export interface ThermalState {
  level: ThermalLevel;
  /** True when the system is actively throttling CPU/GPU. */
  throttlingActive: boolean;
  /** True when inference should be stopped entirely. */
  isCritical: boolean;
}

export interface MemoryState {
  /** Available system RAM in bytes. */
  availableBytes: number;
  totalBytes: number;
  /** True when availableBytes < configured minimum threshold. */
  isLow: boolean;
}

export interface ResourceState {
  battery: BatteryState;
  thermal: ThermalState;
  memory: MemoryState;
  /** True when a network connection is available. */
  networkAvailable: boolean;
  /** ISO-8601 timestamp of when this state was sampled. */
  sampledAt: string;
}

/**
 * Provides real-time device resource state and subscribes to change events.
 * Implementations use platform APIs (expo-battery, iOS thermal API, Android
 * ActivityManager) — the platform package only sees this interface.
 */
export interface ResourceMonitor {
  getState(): ResourceState;
  onBatteryChange(listener: (state: BatteryState) => void): () => void;
  onThermalChange(listener: (state: ThermalState) => void): () => void;
  onMemoryChange(listener: (state: MemoryState) => void): () => void;
  onNetworkChange(listener: (available: boolean) => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// INFERENCE THROTTLE POLICY
// ─────────────────────────────────────────────────────────────────────────────

export type ThrottleDecision = "allow" | "defer" | "deny";

/**
 * Policy that evaluates ResourceState and returns an inference decision.
 *
 * Default reference policy (applications may override):
 *   battery.isCritical AND NOT isCharging → defer
 *   thermal.isCritical                    → deny
 *   thermal.level === "serious"           → defer (non-priority tasks)
 *   memory.isLow                          → deny if model > 200 MB
 *   otherwise                             → allow
 */
export interface InferenceThrottlePolicy {
  /**
   * Evaluate whether to allow, defer, or deny inference for a given request.
   * `priority` is caller-provided: "high" (user-facing) vs "low" (background).
   */
  evaluate(
    resources: ResourceState,
    requestPriority: "high" | "normal" | "low",
  ): ThrottleDecision;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extended capability declaration for a local (on-device) AI provider.
 * Extends the ai-core AIProviderCapabilities concept with device-specific fields.
 */
export interface LocalProviderCapabilities extends AIProviderCapabilities {
  /** True for on-device models; false for cloud-routed providers. */
  isOnDevice: boolean;
  /** Supported ML frameworks. */
  supportedFrameworks: MLFramework[];
  /** Supported hardware accelerators on this device. */
  availableAccelerators: HardwareAccelerator[];
  /** Minimum RAM required to load the heaviest registered model (bytes). */
  requiredRAMBytes?: number;
  /** Whether inference can proceed with no network connection. */
  worksOffline: boolean;
}

/**
 * A local AI provider. Implements AIProvider so it can be registered with
 * ai-core's AIProviderFactory as a fallback provider, enabling hybrid mode:
 * the factory tries cloud providers first and falls back to LocalAIProvider
 * when cloud is unavailable.
 */
export interface LocalAIProvider extends AIProvider {
  readonly localCapabilities: LocalProviderCapabilities;
  /** Model IDs this provider can serve. */
  getSupportedModels(): string[];
  /** True if the specified model is downloaded and loaded. */
  isModelReady(modelId: string): boolean;
  /** Ensure the model is ready before the next inference call. */
  prepareModel(modelId: string): Promise<void>;
}

/**
 * Selects the appropriate provider (local vs cloud) for a given inference
 * request based on network, battery, thermal state, and model availability.
 */
export interface ProviderSelector {
  /**
   * Select the best provider for a request.
   * Returns `null` if no provider can satisfy the request
   * (e.g. offline AND no local model downloaded).
   */
  select(
    request: InferenceRequest,
    resources: ResourceState,
    localProvider: LocalAIProvider | undefined,
  ): LocalAIProvider | null;

  /** Explain the selection decision (useful for diagnostics). */
  explain(
    request: InferenceRequest,
    resources: ResourceState,
    localProvider: LocalAIProvider | undefined,
  ): ProviderSelectionReason;
}

export interface ProviderSelectionReason {
  selected: "local" | "cloud" | "none";
  reason: string;
  resourcesAtDecisionTime: ResourceState;
}

// ─────────────────────────────────────────────────────────────────────────────
// INFERENCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw input types for inference.
 * Image: JPEG/PNG bytes or a base64-encoded string.
 * Text: plain UTF-8 string.
 * Tensor: typed number array with a declared shape.
 */
export type InferenceInputKind = "image_bytes" | "image_base64" | "text" | "tensor";

export interface InferenceInput {
  kind: InferenceInputKind;
  /** Binary image data for image_bytes kind. */
  imageBytes?: Uint8Array;
  /** Base64-encoded image for image_base64 kind. */
  imageBase64?: string;
  /** MIME type for image inputs (e.g. "image/jpeg"). */
  imageMimeType?: string;
  text?: string;
  /** Raw tensor values for tensor kind. */
  tensorValues?: number[];
  /** Shape of the tensor (required for tensor kind). */
  tensorShape?: number[];
}

export interface InferenceRequest {
  id: string;
  /** ID of the registered model to use. */
  modelId: string;
  input: InferenceInput;
  mode?: InferenceMode; // defaults to "auto"
  priority?: "high" | "normal" | "low";
  /**
   * Maximum time (ms) to wait for inference before timing out.
   * Defaults to 30 000 ms.
   */
  timeoutMs?: number;
  /**
   * Minimum confidence threshold — results below this are discarded.
   * 0–1. Defaults to 0 (return all results).
   */
  minConfidence?: number;
  /** If true, hit the AI cache before running inference. */
  useCache?: boolean;
  metadata?: Record<string, unknown>;
}

export interface InferenceResult {
  requestId: string;
  modelId: string;
  /** Raw model output tensor values. Use typed engines (VisionEngine, etc.) for parsed results. */
  rawOutput?: number[];
  /** Parsed outputs for well-known model types. */
  detections?: VisionDetection[];
  ocrResult?: OCRResult;
  embedding?: EmbeddingVector;
  qualityScore?: QualityScore;
  /** Whether this result came from the local model or the cloud fallback. */
  source: "local" | "cloud";
  /** Whether this result was served from the inference cache. */
  cached: boolean;
  confidence: ConfidenceResult;
  latencyMs: number;
  /** Hardware accelerator actually used. */
  accelerator?: HardwareAccelerator;
  /** ISO-8601 when inference ran (or when the cache hit was served). */
  inferredAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Core inference executor. Wraps the model framework runtime (TFLite session,
 * ONNX runtime, CoreML pipeline) behind a uniform interface.
 *
 * The InferenceEngine does NOT handle model lifecycle (that is ModelManager)
 * or provider selection (that is ProviderSelector). It only executes inference
 * on a model that is already loaded.
 */
export interface InferenceEngine {
  /** Execute a single inference request. */
  run(request: InferenceRequest): Promise<InferenceResult>;

  /**
   * Execute multiple requests in a single forward pass (batch inference).
   * Batch size is determined by the model's runtime; the engine may split
   * oversized batches automatically.
   */
  runBatch(requests: InferenceRequest[]): Promise<InferenceResult[]>;

  /**
   * Warm up the engine with a dummy inference to reduce first-call latency.
   * No-op if the model is already warmed up.
   */
  warmup(modelId: string): Promise<void>;

  /** Current load on the inference engine (0–1). 0 = idle; 1 = saturated. */
  getLoad(): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// INFERENCE QUEUE
// ─────────────────────────────────────────────────────────────────────────────

export type InferenceTaskStatus =
  | "queued"
  | "throttled"   // Held by InferenceThrottlePolicy — will retry when resources allow
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export interface InferenceTask {
  id: string;
  request: InferenceRequest;
  status: InferenceTaskStatus;
  /** ISO-8601 when the task was enqueued. */
  enqueuedAt: string;
  /** ISO-8601 when execution started. */
  startedAt?: string;
  /** ISO-8601 when the task completed or failed. */
  finishedAt?: string;
  result?: InferenceResult;
  error?: string;
}

/**
 * Priority queue for inference tasks. Applies throttle policy before
 * dispatching to InferenceEngine. Background tasks accumulate here while
 * resources are constrained and drain as conditions improve.
 *
 * Deduplication: if a request for the same modelId + cacheKey is already
 * queued, returns the existing task rather than enqueuing a duplicate.
 */
export interface InferenceQueue {
  /** Enqueue a request. Returns the resulting InferenceTask. */
  enqueue(request: InferenceRequest): InferenceTask;

  /** Cancel a queued or running task. */
  cancel(taskId: string): void;

  /** Boost the priority of a queued task. */
  elevate(taskId: string, to: "high"): void;

  /** Retrieve a task by ID. */
  getTask(taskId: string): InferenceTask | undefined;

  /** Subscribe to task status changes. */
  onTaskUpdate(listener: (task: InferenceTask) => void): () => void;

  /** Current queue depth (queued tasks that haven't started). */
  depth(): number;

  /** Drain all throttled tasks now (e.g. on device plug-in). */
  flushThrottled(): void;

  /** Cancel and discard all queued tasks. */
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND INFERENCE SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedules non-urgent inference tasks to run in the background when
 * resources are optimal (device charging, not thermally throttled, idle).
 *
 * ReadyLoq example: batch-analyse a set of inspection photos in the background
 * while the technician is writing notes or navigating between rooms.
 * VYBE example: generate clip embeddings after a stream ends while on WiFi.
 */
export interface BackgroundInferenceScheduler {
  /**
   * Schedule a request to run when resources permit.
   * `notBefore` is a hint; the scheduler may delay further if needed.
   */
  schedule(request: InferenceRequest, notBefore?: string): InferenceTask;

  /** Cancel a scheduled background task. */
  cancel(taskId: string): void;

  /** List all scheduled background tasks. */
  list(): InferenceTask[];

  /** Subscribe to completions of background tasks. */
  onComplete(listener: (task: InferenceTask) => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface BoundingBox {
  /** All values normalised to 0–1 relative to image dimensions. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A single detected entity in an image.
 * The `label` field is a generic string — domain-specific class names
 * (e.g. pest species) are defined by the application's model and prompt.
 */
export interface VisionDetection {
  id: string;
  label: string;
  confidence: ConfidenceResult;
  boundingBox?: BoundingBox;
  /** Pixel-accurate mask (run-length encoded). Only for segmentation models. */
  mask?: string;
  metadata?: Record<string, unknown>;
}

export interface SceneClassification {
  label: string;
  confidence: ConfidenceResult;
}

export interface VisionRequest {
  input: InferenceInput;
  modelId?: string; // if omitted, ProviderSelector picks the best available
  mode?: InferenceMode;
  /** Minimum confidence for a detection to be included in the result. */
  minConfidence?: number;
  /** Maximum number of detections to return. */
  maxDetections?: number;
  useCache?: boolean;
}

export interface VisionResult {
  detections: VisionDetection[];
  sceneClassifications?: SceneClassification[];
  source: "local" | "cloud";
  cached: boolean;
  latencyMs: number;
  modelId: string;
  inferredAt: string;
}

/**
 * High-level engine for image detection, classification, and segmentation.
 * Wraps InferenceEngine + ModelManager for the vision-specific call pattern.
 */
export interface VisionEngine {
  /** Object detection (YOLO, SSD, EfficientDet-style models). */
  detect(request: VisionRequest): Promise<VisionResult>;
  /** Image-level classification (what is in this image overall?). */
  classify(request: VisionRequest): Promise<VisionResult>;
  /** Instance segmentation (pixel masks per detected object). */
  segment(request: VisionRequest): Promise<VisionResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OCR ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export type OCRMode = "full_page" | "region" | "line" | "word" | "character";

export interface OCRRegion {
  text: string;
  confidence: ConfidenceResult;
  boundingBox?: BoundingBox;
}

export interface OCRRequest {
  input: InferenceInput;
  modelId?: string;
  mode?: OCRMode;
  /** BCP-47 language hints to improve recognition accuracy. */
  languageHints?: string[];
  useCache?: boolean;
}

export interface OCRResult {
  /** Full document text as a single string (newlines preserved). */
  fullText: string;
  /** Individual detected text regions. */
  regions: OCRRegion[];
  /** Detected script/language (BCP-47). */
  detectedLanguage?: string;
  overallConfidence: ConfidenceResult;
  source: "local" | "cloud";
  cached: boolean;
  latencyMs: number;
  modelId: string;
  inferredAt: string;
}

/** High-level engine for text extraction from images. */
export interface OCREngine {
  extract(request: OCRRequest): Promise<OCRResult>;
  /** Extract text from a specific bounding region only. */
  extractRegion(request: OCRRequest, region: BoundingBox): Promise<OCRResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMBEDDING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A dense vector representation of an image or text.
 * Used for semantic similarity, duplicate detection, and retrieval.
 */
export interface EmbeddingVector {
  /** Float32 embedding values. */
  values: number[];
  /** Number of dimensions. */
  dimension: number;
  /** The model that produced this embedding. */
  modelId: string;
  /** "image" or "text". */
  inputKind: "image" | "text";
}

export interface SimilarityScore {
  /** Cosine similarity 0–1 (1 = identical). */
  score: number;
  method: "cosine" | "euclidean" | "dot_product";
}

export interface EmbeddingRequest {
  input: InferenceInput;
  modelId?: string;
  mode?: InferenceMode;
  useCache?: boolean;
}

export interface EmbeddingResult {
  vector: EmbeddingVector;
  source: "local" | "cloud";
  cached: boolean;
  latencyMs: number;
  inferredAt: string;
}

/** High-level engine for semantic embedding of images and text. */
export interface EmbeddingEngine {
  /** Compute a semantic embedding for an image or text. */
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  /** Compute cosine similarity between two embeddings. */
  similarity(a: EmbeddingVector, b: EmbeddingVector): SimilarityScore;
  /** Embed a batch of inputs (returns in same order). */
  embedBatch(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE QUALITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/** Per-dimension image quality assessment. All scores are 0–1 (1 = best). */
export interface QualityScore {
  /** Overall composite quality score. */
  overall: number;
  /** Sharpness (Laplacian variance or model-based). */
  sharpness: number;
  /** Brightness (exposure). */
  brightness: number;
  /** Contrast (RMS contrast). */
  contrast: number;
  /** Estimated noise level (inverse: 1 = low noise). */
  noise: number;
  /** Colour saturation. */
  saturation?: number;
  /** Whether the image is usable for analysis. */
  isAcceptable: boolean;
  /** Reason the image is not acceptable (if isAcceptable is false). */
  rejectionReason?: "too_blurry" | "too_dark" | "too_bright" | "too_noisy" | "other";
}

/** Blur analysis result. */
export interface BlurAssessment {
  /** True if the image is considered too blurry for reliable analysis. */
  isBlurred: boolean;
  /** Blur magnitude 0–1 (0 = sharp, 1 = extremely blurry). */
  score: number;
  method: "laplacian" | "fft" | "model_based";
}

/** Motion/shake analysis result. */
export interface MotionAssessment {
  /** True if significant camera motion is detected. */
  hasMotion: boolean;
  /** Motion magnitude 0–1. */
  magnitude: number;
  /** Dominant motion direction in degrees (0 = right, 90 = up, etc.). */
  direction?: number;
  method: "optical_flow" | "frame_diff" | "model_based";
}

/** Perceptual duplicate detection result. */
export interface DuplicateAssessment {
  /** True if this image is a near-duplicate of the reference. */
  isDuplicate: boolean;
  /** Reference evidence ID it duplicates (if isDuplicate is true). */
  referenceEvidenceId?: string;
  /** Similarity 0–1 (1 = identical). */
  similarity: number;
  method: "phash" | "embedding" | "model_based";
}

export interface QualityRequest {
  input: InferenceInput;
  modelId?: string;
  /** If provided, check for duplicates against this set of evidence items. */
  existingEvidence?: Pick<EvidenceItem, "id" | "localUri">[];
  useCache?: boolean;
}

export interface QualityResult {
  quality: QualityScore;
  blur: BlurAssessment;
  motion: MotionAssessment;
  duplicate?: DuplicateAssessment;
  source: "local" | "cloud";
  cached: boolean;
  latencyMs: number;
  inferredAt: string;
}

/**
 * Composite image quality engine covering sharpness, exposure, noise,
 * motion, and duplicate detection.
 *
 * EXTRACTION NOTE: ReadyLoq's current quality gate (camera-core) computes
 * Laplacian sharpness inline during capture. ImageQualityEngine is the
 * platform-level successor — model-powered, offline-capable, and usable
 * post-capture on stored evidence items.
 */
export interface ImageQualityEngine {
  /** Full quality assessment (quality + blur + motion + optional duplicate). */
  assess(request: QualityRequest): Promise<QualityResult>;
  /** Blur-only fast check (lower latency than full assess). */
  detectBlur(input: InferenceInput, modelId?: string): Promise<BlurAssessment>;
  /** Motion-only fast check. */
  detectMotion(input: InferenceInput, modelId?: string): Promise<MotionAssessment>;
  /**
   * Find near-duplicates of an image within a set of existing evidence items.
   * Uses perceptual hashing or embedding similarity.
   */
  findDuplicates(
    input: InferenceInput,
    candidates: Pick<EvidenceItem, "id" | "localUri">[],
    modelId?: string,
  ): Promise<DuplicateAssessment[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CACHE
// ─────────────────────────────────────────────────────────────────────────────

export type CacheKind =
  | "embedding"
  | "detection"
  | "ocr"
  | "quality_score"
  | "blur_assessment"
  | "motion_assessment"
  | "duplicate_hash"
  | "model_output";

export interface CacheEntry<T> {
  key: string;
  kind: CacheKind;
  value: T;
  modelId: string;
  createdAt: string;   // ISO-8601
  expiresAt: string;   // ISO-8601
  /** Number of times this entry has been retrieved. */
  hits: number;
  /** Approximate serialised size in bytes. */
  sizeBytes?: number;
}

export interface CacheConfig {
  kind: CacheKind;
  /** Time-to-live in seconds. 0 = no expiry. */
  ttlSeconds: number;
  /** Maximum number of entries. Oldest-hit entries are evicted first. */
  maxEntries: number;
  /** Eviction policy. */
  eviction: "lru" | "lfu" | "fifo" | "ttl_only";
}

/**
 * Configurable cache for AI inference results.
 * Keys are deterministic hashes of the input (perceptual hash for images,
 * SHA-256 for text, model ID always included).
 *
 * Per-kind configuration allows embeddings to live longer than OCR results,
 * and quality scores to expire quickly if lighting conditions change.
 *
 * Cache persistence: stored via storage-core so results survive app restarts.
 */
export interface AICache {
  get<T>(key: string, kind: CacheKind): CacheEntry<T> | undefined;
  set<T>(key: string, kind: CacheKind, value: T, modelId: string): void;
  delete(key: string, kind: CacheKind): void;

  /** Invalidate all entries of a given kind. */
  invalidateKind(kind: CacheKind): void;
  /** Invalidate all entries produced by a specific model (e.g. after model update). */
  invalidateModel(modelId: string): void;
  /** Remove all expired entries. */
  pruneExpired(): void;
  /** Clear everything. */
  clear(): void;

  /** Cache hit rate for a given kind (0–1). */
  hitRate(kind: CacheKind): number;

  /** Current number of entries per kind. */
  stats(): Record<CacheKind, { entries: number; hits: number; misses: number; sizeBytes: number }>;

  /** Configure TTL and limits for a cache kind. */
  configure(config: CacheConfig): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL INTELLIGENCE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full local intelligence runtime surface, passed to platform-intelligence
 * as a plugin context. Applications access the individual engines via the
 * ProviderCoordinator registered by LocalIntelligencePlugin.
 *
 * Applications NEVER instantiate this directly — they receive it from the
 * plugin system.
 */
export interface LocalIntelligenceContext {
  models: ModelManager;
  inference: InferenceEngine;
  queue: InferenceQueue;
  scheduler: BackgroundInferenceScheduler;
  vision: VisionEngine;
  ocr: OCREngine;
  embedding: EmbeddingEngine;
  quality: ImageQualityEngine;
  cache: AICache;
  resources: ResourceMonitor;
  providerSelector: ProviderSelector;
  throttlePolicy: InferenceThrottlePolicy;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT KINDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard local-intelligence event kind constants.
 * Emitted via the platform EventBus (registered by LocalIntelligencePlugin).
 * Convention: "local_ai.<noun>.<verb>"
 */
export const LOCAL_AI_EVENT_KINDS = {
  // Model lifecycle
  MODEL_REGISTERED:         "local_ai.model.registered",
  MODEL_DOWNLOAD_STARTED:   "local_ai.model.download_started",
  MODEL_DOWNLOAD_PROGRESS:  "local_ai.model.download_progress",
  MODEL_DOWNLOAD_COMPLETE:  "local_ai.model.download_complete",
  MODEL_DOWNLOAD_FAILED:    "local_ai.model.download_failed",
  MODEL_LOADED:             "local_ai.model.loaded",
  MODEL_UNLOADED:           "local_ai.model.unloaded",

  // Inference
  INFERENCE_QUEUED:         "local_ai.inference.queued",
  INFERENCE_STARTED:        "local_ai.inference.started",
  INFERENCE_COMPLETE:       "local_ai.inference.complete",
  INFERENCE_FAILED:         "local_ai.inference.failed",
  INFERENCE_THROTTLED:      "local_ai.inference.throttled",
  INFERENCE_CACHE_HIT:      "local_ai.inference.cache_hit",

  // Provider selection
  PROVIDER_SELECTED_LOCAL:  "local_ai.provider.selected_local",
  PROVIDER_SELECTED_CLOUD:  "local_ai.provider.selected_cloud",
  PROVIDER_FALLBACK:        "local_ai.provider.fallback",

  // Resources
  BATTERY_LOW:              "local_ai.resource.battery_low",
  BATTERY_CRITICAL:         "local_ai.resource.battery_critical",
  THERMAL_THROTTLING:       "local_ai.resource.thermal_throttling",
  MEMORY_LOW:               "local_ai.resource.memory_low",
  NETWORK_CHANGED:          "local_ai.resource.network_changed",
} as const;

export type LocalAIEventKind = (typeof LOCAL_AI_EVENT_KINDS)[keyof typeof LOCAL_AI_EVENT_KINDS];

// Typed payloads for key events:

export interface ModelDownloadProgressPayload {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  progress: number; // 0–1
}

export interface InferenceCompletePayload {
  requestId: string;
  modelId: string;
  source: "local" | "cloud";
  cached: boolean;
  latencyMs: number;
}

export interface ProviderFallbackPayload {
  requestId: string;
  fromMode: "local" | "cloud";
  toMode: "local" | "cloud";
  reason: string;
}

export interface ResourceChangePayload {
  previous: ResourceState;
  current: ResourceState;
}
