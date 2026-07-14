/**
 * @platform/shared-types
 *
 * Cross-app primitive types shared across ALL platform packages and consuming
 * applications (readyloq-mobile, vybelive, and any future product).
 *
 * CANONICAL SOURCES (do not duplicate in app repos once migrated):
 *   - EvidenceItem, CaptureMode, CaptureSource, QualityAssessment
 *     ← repos/readyloq-mobile/artifacts/readyloq-app/lib/vision/types.ts
 *   - OSEvent, EventPriority, EventStatus
 *     ← repos/vybelive/artifacts/api-server/src/services/os/EventBus.ts
 *   - AIRequest, AIResponse, AIUsage, AIModelHint
 *     ← repos/vybelive/artifacts/api-server/src/services/ai/AIProvider.ts
 *   - ConfidenceScore — bridging concept (ReadyLoq 0-1 batch confidence +
 *     VYBE's executive recommendation confidence 0-100 normalised to 0-1)
 *
 * MIGRATION NOTE: These types must stay domain-agnostic. No pest-inspection
 * logic, no streaming/social logic. Both products import from here.
 */

// ─── Evidence / Capture (from readyloq-mobile) ────────────────────────────────

/**
 * The three modes in which a camera provider can deliver frames.
 *
 *  request_response — app pulls a single frame on demand (e.g. normal photo).
 *  session_stream   — provider streams frames continuously during an open
 *                     session (e.g. device camera video feed).
 *  async_push       — external device pushes frames autonomously (e.g. BLE
 *                     smart glasses, USB trigger cam, wearable camera).
 */
export type CaptureMode = "request_response" | "session_stream" | "async_push";

/**
 * The physical or logical transport used to receive frames from the provider.
 */
export type CaptureTransport = "device_camera" | "ble" | "usb" | "wifi" | "cloud_api";

/**
 * What a given provider is capable of — used by the CaptureModeRouter to pick
 * the right provider for the current inspection/context.
 */
export interface CaptureCapabilities {
  modes: CaptureMode[];
  transports: CaptureTransport[];
  /** Whether the provider can deliver frames without an active network. */
  offlineCapable: boolean;
  /** Whether the provider supports continuous streaming sessions. */
  streamingCapable: boolean;
}

/**
 * The logical source category of a piece of evidence. Used for UI labelling
 * and provider routing.
 */
export type CaptureSource =
  | "device_camera"
  | "screen_recording"
  | "file_import"
  | "smart_glasses"
  | "wearable_camera"
  | "remote_camera"
  | "unknown";

/**
 * A single captured piece of evidence. The central data atom across both apps.
 *
 * ReadyLoq: one EvidenceItem per photo/video taken during a pest inspection.
 * VYBE:     extended variant represents a stream clip or media attachment.
 */
export interface EvidenceItem {
  id: string;
  /** Storage path on the object storage sidecar (post-upload). */
  storagePath?: string;
  /** Temporary local URI before upload. */
  localUri?: string;
  mimeType: "image/jpeg" | "image/png" | "video/mp4" | "video/quicktime" | string;
  /** Pixels — absent if the file has not been decoded yet. */
  width?: number;
  height?: number;
  /** Raw byte size of the file. */
  fileSize?: number;
  captureSource: CaptureSource;
  capturedAt: string; // ISO-8601
  /** Free-form metadata from the capturing provider (EXIF, frame index, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Advisory quality score emitted by the on-device quality gate.
 * Score 0–100; 100 = perfect, 0 = unusable.
 * NEVER used to discard evidence — only to warn the user.
 */
export interface QualityAssessment {
  score: number;
  /** Human-readable reasons for any penalties applied. */
  reasons: string[];
  /** Whether to surface a "retake" warning to the user. */
  warnUser: boolean;
}

// ─── Confidence (bridging concept) ───────────────────────────────────────────

/**
 * Normalised confidence value in the range [0, 1].
 *
 * ReadyLoq uses this as the raw AI detection confidence returned by the batch
 * analysis pipeline. VYBE's executive recommendation confidence (0–100) is
 * divided by 100 to align with this range.
 */
export type ConfidenceScore = number; // branded types to be added after extraction

// ─── OS Events (from vybelive) ───────────────────────────────────────────────

export type EventPriority = "low" | "normal" | "high" | "critical";
export type EventStatus = "pending" | "processed" | "failed";

/**
 * A typed, namespaced event flowing through the platform EventBus.
 *
 * Convention for `kind`:  "<domain>.<noun>.<verb>"
 *   e.g. "camera.evidence.captured", "stream.session.started",
 *        "ai.analysis.completed", "sync.queue.flushed"
 */
export interface OSEvent<TPayload = Record<string, unknown>> {
  id: string;
  kind: string;
  source: string;
  priority: EventPriority;
  status: EventStatus;
  correlationId?: string;
  payload: TPayload;
  emittedAt: string; // ISO-8601
  processedAt?: string;
  error?: string;
}

// ─── AI (from vybelive AIProvider) ───────────────────────────────────────────

/**
 * Hints passed with an AI request to influence provider + model selection.
 * The factory consults these alongside the persisted aiModelConfigs row.
 */
export type AIModelHint = "fast" | "standard" | "reasoning";

export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  /** Attach base64-encoded images or binary evidence blobs. */
  attachments?: Array<{ mimeType: string; data: string }>;
  modelHint?: AIModelHint;
  /** Logical grouping used for per-objective model overrides. */
  objectiveId?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIUsage {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface AIResponse {
  text: string;
  usage: AIUsage;
}

// ─── Sync (from readyloq-mobile sync engine) ─────────────────────────────────

export type SyncStatus =
  | "idle"
  | "pending"
  | "uploading"
  | "syncing"
  | "complete"
  | "error";

export interface SyncRecord {
  id: string;
  entityType: string;
  entityId: string;
  status: SyncStatus;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
