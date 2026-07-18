/**
 * @platform/shared-types
 *
 * Cross-app domain types shared across ALL platform packages and consuming
 * applications (readyloq-mobile, vybelive, and any future product).
 *
 * Depends on @platform/core for programming-model primitives (Result, Brand…).
 * All platform packages that need both domain types and programming-model
 * primitives import from here; they do not need to also import @platform/core
 * directly unless they use a primitive that shared-types does not re-export.
 *
 * CANONICAL SOURCES (do not duplicate in app repos once migrated):
 *   - EvidenceItem, CaptureMode, CaptureSource, QualityAssessment,
 *     CaptureTransport, CaptureCapabilities
 *     ← artifacts/readyloq-app/lib/vision/types.ts
 *   - OSEvent, EventPriority, EventStatus
 *     ← repos/vybelive/artifacts/api-server/src/services/os/EventBus.ts
 *   - AIRequest, AIResponse, AIUsage, AIModelHint
 *     ← repos/vybelive/artifacts/api-server/src/services/ai/AIProvider.ts
 *   - ConfidenceScore — bridging concept (ReadyLoq 0-1 batch confidence +
 *     VYBE's executive recommendation confidence 0-100 normalised to 0-1)
 *
 * MIGRATION NOTE: These types must stay domain-agnostic. No pest-inspection
 * logic, no streaming/social logic. Both products import from here.
 *
 * PHASE 1 MIGRATION: Types extracted from artifacts/readyloq-app/lib/vision/types.ts
 * and promoted to this package. The app now re-exports from here via
 * `export type { ... } from "@platform/shared-types"`.
 */
import type { Result, Brand } from "@platform/core";
export type { Result, AsyncResult, Option, Brand, ID, Timestamp, Version } from "@platform/core";
/**
 * Where a piece of evidence physically came from. Stored on the server row
 * for provenance and per-source analytics.
 *
 * Tier 1 ships `phone_camera` and `media_import`; the rest are reserved so
 * the schema never needs a migration when new providers land.
 */
export type CaptureSource = "phone_camera" | "media_import" | "wifi_stream" | "usb_camera" | "smart_glasses" | "wearable_camera";
/** A single captured/imported piece of evidence, pre-upload. */
export interface EvidenceItem {
    /**
     * Stable identity for this item. Set by the capture provider at acquisition
     * time (e.g. UUID). Used as the key in EvidenceStore, EvidenceAnnotation,
     * and EvidenceQualityRecord.
     */
    id: string;
    /** Local file URI (may live in a cache dir — persist it immediately). */
    uri: string;
    source: CaptureSource;
    /** ISO timestamp of capture/import. */
    capturedAt: string;
    /** Pixel dimensions when the provider knows them. */
    width?: number;
    height?: number;
    /** File size in bytes when the provider knows it. */
    fileSize?: number;
    /**
     * Provider-specific context (EXIF, original filename, device model, GPS,
     * source-side asset id for idempotent re-pulls…). Persisted verbatim to
     * `inspection_media.capture_metadata`.
     */
    metadata?: Record<string, unknown>;
}
/**
 * Advisory quality score emitted by the on-device quality gate.
 * Score 0–100; 100 = perfect, 0 = unusable.
 * NEVER used to discard evidence — only to warn the user.
 */
export interface QualityAssessment {
    /** 0–100. Higher is better. */
    score: number;
    /** False when the evidence is likely too poor for reliable AI analysis. */
    acceptable: boolean;
    /** Human-readable reasons (shown to the technician as a warning). */
    reasons: string[];
}
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
/** Physical transport a source uses — drives availability probing + permissions. */
export type CaptureTransport = "on_device" | "on_device_library" | "usb" | "wifi" | "ble" | "cloud";
/** How the capture screen should render this source's live preview, if any. */
export type PreviewKind = "native_camera" | "stream_url" | "none";
export interface CaptureCapabilities {
    mode: CaptureMode;
    transport: CaptureTransport;
    hasLivePreview: boolean;
    producesVideo: boolean;
    requiresPairing: boolean;
}
/**
 * Normalised confidence value in the range [0, 1].
 *
 * ReadyLoq uses this as the raw AI detection confidence returned by the batch
 * analysis pipeline. VYBE's executive recommendation confidence (0–100) is
 * divided by 100 to align with this range.
 *
 * Branded so that a raw `number` cannot be silently assigned as a confidence
 * value — callers must explicitly cast: `0.87 as ConfidenceScore`.
 */
export type ConfidenceScore = Brand<number, "ConfidenceScore">;
/**
 * Generic AI/ML confidence result. Defined here (not in ai-core) so that
 * packages which intentionally avoid depending on ai-core (e.g. measurement-core)
 * can still use a typed confidence result.
 */
export interface ConfidenceResult {
    /** Normalised confidence 0–1. */
    score: number;
    /** The method or model that produced this result (informational). */
    method: string;
    /** Optional per-signal breakdown used for diagnostics. */
    breakdown?: Record<string, number>;
}
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
    emittedAt: string;
    processedAt?: string;
    error?: string;
}
/**
 * Hints passed with an AI request to influence provider + model selection.
 * The factory consults these alongside the persisted aiModelConfigs row.
 */
export type AIModelHint = "fast" | "standard" | "reasoning";
export interface AIRequest {
    prompt: string;
    systemPrompt?: string;
    /** Attach base64-encoded images or binary evidence blobs. */
    attachments?: Array<{
        mimeType: string;
        data: string;
    }>;
    modelHint?: AIModelHint;
    /** Logical grouping used for per-objective model overrides. */
    objectiveId?: string;
    maxTokens?: number;
    temperature?: number;
    /**
     * Whether the model should return structured JSON or plain text.
     * When "json", callers may attempt to parse AIResponse.content.
     * Canonical source: vybelive AIProvider.ts AIRequest.responseFormat.
     */
    responseFormat?: "json" | "text";
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
    /**
     * Raw string response from the provider.
     * Named "content" to match the vybelive canonical AIProvider.ts.
     * Replaces the earlier "text" field — no consuming apps yet import this.
     */
    content: string;
    /**
     * Parsed JSON object. Present when responseFormat="json" and the provider
     * returned valid JSON. Absent for text responses or on parse failure.
     * Canonical source: vybelive AIProvider.ts AIResponse.parsed.
     */
    parsed?: Record<string, unknown>;
    usage: AIUsage;
}
export type SyncStatus = "idle" | "pending" | "uploading" | "syncing" | "complete" | "error";
/**
 * A typed sync failure, carried inside `Result<void, SyncError>`.
 * `retryable` distinguishes transient failures (network timeout → retry)
 * from permanent ones (server 400 → discard).
 */
export interface SyncError {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
}
export interface SyncRecord {
    id: string;
    entityType: string;
    entityId: string;
    status: SyncStatus;
    attempts: number;
    lastAttemptAt?: string;
    /** Typed result of the last sync attempt. Replaces the string `lastError`. */
    lastResult?: Result<void, SyncError>;
    /** @deprecated Use `lastResult.error.message` instead. Kept for migration. */
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}
//# sourceMappingURL=index.d.ts.map