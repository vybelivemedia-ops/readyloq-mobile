/**
 * @platform/camera-core
 *
 * Universal camera abstraction — provider contracts extracted from ReadyLoq.
 *
 * CANONICAL SOURCE: readyloq-mobile artifacts/readyloq-app/lib/vision/types.ts
 *
 * WHY READYLOQ IS CANONICAL:
 *   VYBE LIVE has no camera abstraction — it uses Agora's SDK directly for
 *   live streaming and does not produce EvidenceItem captures.
 *   ReadyLoq's abstraction is superior: a 3-mode capability model
 *   (pull / session_stream / async_push), typed discriminated-union providers,
 *   an extensible slot for smart-glasses / BLE / USB / WiFi, and an advisory
 *   quality gate that never discards evidence.
 *
 * PLATFORM MIGRATION (Phase 2 — @platform/camera-core):
 *   ProviderAvailability, ProviderStatus, EvidenceIntake, CaptureProviderBase,
 *   RequestCaptureProvider, SessionCaptureProvider, PushCaptureProvider,
 *   CaptureProvider, VisionProvider are now canonical here.
 *   ReadyLoq's lib/vision/types.ts re-exports them so all existing callers
 *   continue to work without change.
 *
 * DEPENDENCY GRAPH:
 *   camera-core → shared-types → core
 *   meta-wearables → camera-core   (wearable providers implement CaptureProvider)
 *
 * FUTURE WORK (not yet migrated):
 *   - ProviderRegistry implementation (provider-registry.ts) → Phase 3
 *   - QualityGate with injectable thresholds (quality-gate.ts) → Phase 3
 *   - KVAdapter decoupling from AsyncStorage → Phase 3
 */
import type { CaptureCapabilities, CaptureMode, CaptureSource, EvidenceItem, PreviewKind, QualityAssessment } from "@platform/shared-types";
export type { CaptureCapabilities, CaptureMode, CaptureSource, EvidenceItem, PreviewKind, QualityAssessment, } from "@platform/shared-types";
/** Whether a source is usable on THIS device right now. */
export type ProviderAvailability = {
    available: true;
} | {
    available: false;
    reason: string;
};
/**
 * Live connection state for session/push providers.
 *
 * State machine:
 *   unavailable → (device appears) → disconnected
 *   disconnected → (connect called) → connecting → ready
 *   ready → (capture/stream starts) → capturing
 *   any → (error) → error
 */
export type ProviderStatus = "unavailable" | "disconnected" | "connecting" | "ready" | "capturing" | "error";
/** Per-provider observable state, suitable for registry queries and UI display. */
export type ProviderState = {
    availability: ProviderAvailability;
    status: ProviderStatus;
    error?: string;
};
/**
 * The single sink every source feeds.
 *
 * Request/response callers pass the result of `capture()` here; session/push
 * providers call it whenever frames arrive — even asynchronously. This decouples
 * "evidence arrived" from "the user pressed a button" (required for glasses /
 * drone). The implementation (persist → dedupe → quality-gate → sync) lives
 * in the application and needs no change when a new source is added.
 */
export type EvidenceIntake = (items: EvidenceItem[], ctx: {
    providerId: string;
    source: CaptureSource;
}) => Promise<void>;
/** Common fields shared by every capture provider. */
export type CaptureProviderBase = {
    id: string;
    source: CaptureSource;
    label: string;
    capabilities: CaptureCapabilities;
};
/**
 * Pull model: phone camera, library import, USB/Wi-Fi still-grab.
 * The provider is stateless between captures.
 */
export type RequestCaptureProvider = CaptureProviderBase & {
    /**
     * Resolves with zero or more evidence items — zero when the user cancels,
     * several for multi-select imports. MUST throw on real failures (never
     * swallow) so callers can surface errors.
     */
    capture: () => Promise<EvidenceItem[]>;
};
/** An open connection to a streaming source. */
export type CaptureSession = {
    /** Grab a still / frame from the live feed on demand. */
    grab: () => Promise<EvidenceItem[]>;
    disconnect: () => Promise<void>;
};
/**
 * Session model: connection-oriented live streams (USB scope, Wi-Fi/drone).
 * The provider maintains a persistent connection for the session lifetime.
 */
export type SessionCaptureProvider = CaptureProviderBase & {
    previewKind: PreviewKind;
    /** Open the connection; frames grabbed later flow through `intake`. */
    connect: (intake: EvidenceIntake) => Promise<CaptureSession>;
};
/** A live push session that delivers evidence until ended. */
export type PushCaptureSession = {
    end: () => Promise<void>;
};
/**
 * Push model: the device initiates capture (glasses, wearables, BLE sensors).
 * Evidence arrives asynchronously through `intake` as the device captures.
 */
export type PushCaptureProvider = CaptureProviderBase & {
    /** Start listening; the device pushes evidence through `intake` as it arrives. */
    startSession: (intake: EvidenceIntake) => Promise<PushCaptureSession>;
};
/** Discriminated union of all capture provider shapes. */
export type CaptureProvider = RequestCaptureProvider | SessionCaptureProvider | PushCaptureProvider;
/**
 * @deprecated Use `RequestCaptureProvider`. Retained as a structural alias so
 * existing imports keep compiling; the two are structurally identical.
 */
export type VisionProvider = RequestCaptureProvider;
/**
 * Central registry of all known CaptureProvider implementations.
 *
 * The concrete implementation lives in the application layer (provider-registry.ts)
 * because it couples to AsyncStorage/KV and app-specific future-provider stubs.
 * This interface is the platform-level contract.
 *
 * FUTURE: support dynamic plugin registration so apps can add providers at
 * runtime without forking the package. (Phase 3)
 */
export interface ProviderRegistry {
    register(provider: CaptureProvider): void;
    unregister(providerId: string): void;
    get(providerId: string): CaptureProvider | undefined;
    listAll(): CaptureProvider[];
    selectForMode(mode: CaptureMode): CaptureProvider | undefined;
    getState(providerId: string): ProviderState;
}
/**
 * Assess an EvidenceItem using metadata heuristics (dimensions + file size).
 * An optional pixel-level sharpness score (Laplacian variance) folds in when
 * a decoded bitmap is supplied — the pixel decode is always deferred off the
 * capture hot path.
 *
 * Advisory only — never discard evidence based on this score.
 *
 * The concrete implementation (assessEvidence) lives in quality-gate.ts.
 * This type is the platform-level contract. (Phase 3 will migrate injectable
 * threshold configuration.)
 */
export type AssessEvidence = (item: EvidenceItem, pixels?: {
    data: Uint8Array;
    width: number;
    height: number;
}) => QualityAssessment;
/**
 * Selects the best provider for the requested capture mode, initialises it if
 * needed, and wraps the capture call in quality assessment.
 *
 * The concrete implementation is application-layer; this is the platform contract.
 */
export interface CaptureModeRouter {
    captureOne(mode: CaptureMode): Promise<{
        item: EvidenceItem;
        quality: QualityAssessment;
    }>;
    startSession(mode: "session_stream" | "async_push", onFrame: (item: EvidenceItem, quality: QualityAssessment) => void): Promise<() => void>;
}
//# sourceMappingURL=index.d.ts.map