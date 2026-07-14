/**
 * @platform/camera-core
 *
 * Universal camera abstraction extracted from readyloq-mobile.
 *
 * CANONICAL SOURCE:
 *   repos/readyloq-mobile/artifacts/readyloq-app/lib/vision/
 *     types.ts            — EvidenceItem, CaptureMode, CaptureCapabilities
 *     provider-registry.ts — ProviderRegistry, provider lookup
 *     quality-gate.ts     — on-device advisory quality scoring
 *     pixels.ts           — Laplacian sharpness (pixel decode, deferred)
 *     future-source-providers.ts — FUTURE_PROVIDER_DEFINITIONS stubs
 *
 * WHY THIS IS THE CANONICAL IMPLEMENTATION:
 *   VYBE LIVE has no camera abstraction — it uses Agora's SDK directly for
 *   live streaming and does not produce EvidenceItem captures.
 *   ReadyLoq's abstraction is superior: 3-mode capability model
 *   (request_response / session_stream / async_push), a typed provider
 *   registry, an extensible slot for smart-glasses / BLE / USB / WiFi, and
 *   an advisory quality gate that never discards evidence.
 *
 * GENERALISATION NEEDED (before extraction):
 *   - Remove pest-inspection-specific field names from provider configs.
 *   - Make QualityGate thresholds injectable (not hardcoded constants).
 *   - Decouple ProviderRegistry from AsyncStorage — use a generic KV adapter
 *     so web apps can supply localStorage and mobile apps can supply
 *     AsyncStorage.
 *
 * DEPENDENCY GRAPH:
 *   camera-core → shared-types
 *   meta-wearables → camera-core   (wearable providers implement CameraProvider)
 */

import type {
  CaptureCapabilities,
  CaptureMode,
  CaptureSource,
  EvidenceItem,
  QualityAssessment,
} from "@platform/shared-types";

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Every camera provider (device camera, smart glasses, remote camera, …) must
 * implement this interface. The CaptureModeRouter selects among registered
 * providers based on capabilities and current app context.
 */
export interface CameraProvider {
  readonly id: string;
  readonly label: string;
  readonly source: CaptureSource;
  readonly capabilities: CaptureCapabilities;

  /** One-time setup (permissions, BLE pairing, USB handshake, …). */
  initialize(): Promise<void>;

  /** True when the provider is physically reachable and ready to capture. */
  isAvailable(): Promise<boolean>;

  // ── request_response ──────────────────────────────────────────────────────
  /**
   * Pull a single frame from the provider.
   * Only callable when `capabilities.modes` includes "request_response".
   */
  capture?(): Promise<EvidenceItem>;

  // ── session_stream ────────────────────────────────────────────────────────
  /**
   * Open a continuous stream; the callback receives each frame.
   * Only callable when `capabilities.modes` includes "session_stream".
   */
  startStream?(onFrame: (item: EvidenceItem) => void): Promise<void>;
  stopStream?(): Promise<void>;

  // ── async_push ────────────────────────────────────────────────────────────
  /**
   * Register a listener that will be called whenever the external device
   * pushes a frame (BLE notify, USB interrupt, WiFi packet).
   * Only callable when `capabilities.modes` includes "async_push".
   */
  onPush?(listener: (item: EvidenceItem) => void): () => void; // returns unsubscribe
}

// ─── Provider availability ────────────────────────────────────────────────────

export type ProviderAvailability = "available" | "unavailable" | "requires_permission" | "future";
export type ProviderStatus = "idle" | "streaming" | "capturing" | "error";

export interface ProviderState {
  availability: ProviderAvailability;
  status: ProviderStatus;
  error?: string;
}

// ─── Provider registry ────────────────────────────────────────────────────────

/**
 * Central registry of all known CameraProvider implementations.
 *
 * EXTRACTION NOTE: The current implementation in readyloq-mobile couples
 * registration to a static FUTURE_PROVIDER_DEFINITIONS list. Post-extraction,
 * this should support dynamic plugin registration so apps can add providers
 * at runtime without forking the package.
 *
 * Pattern:
 *   const registry = new ProviderRegistry();
 *   registry.register(new DeviceCameraProvider());
 *   registry.register(new SmartGlassesProvider());
 *   const best = registry.selectForMode("session_stream");
 */
export interface ProviderRegistry {
  register(provider: CameraProvider): void;
  unregister(providerId: string): void;
  get(providerId: string): CameraProvider | undefined;
  listAll(): CameraProvider[];
  selectForMode(mode: CaptureMode): CameraProvider | undefined;
  getState(providerId: string): ProviderState;
}

// ─── Quality gate ─────────────────────────────────────────────────────────────

/**
 * Assess an EvidenceItem using metadata heuristics (dimensions + file size).
 * An optional pixel-level sharpness score (Laplacian variance) folds in when
 * a decoded bitmap is supplied — the pixel decode is always deferred off the
 * capture hot path.
 *
 * Advisory only — never discard evidence based on this score.
 */
export type AssessEvidence = (
  item: EvidenceItem,
  /** Grayscale pixel bitmap from `pixels.ts`, or undefined for instant check. */
  pixels?: { data: Uint8Array; width: number; height: number },
) => QualityAssessment;

// ─── Capture mode router ──────────────────────────────────────────────────────

/**
 * Selects the best provider for the requested capture mode, initialises it if
 * needed, and wraps the capture call in quality assessment.
 */
export interface CaptureModeRouter {
  captureOne(mode: CaptureMode): Promise<{ item: EvidenceItem; quality: QualityAssessment }>;
  startSession(
    mode: "session_stream" | "async_push",
    onFrame: (item: EvidenceItem, quality: QualityAssessment) => void,
  ): Promise<() => void>; // returns stop()
}
