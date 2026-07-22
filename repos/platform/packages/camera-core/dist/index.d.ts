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
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   CaptureDeviceProvider enriches the camera provider contract with the
 *   full DeviceProvider lifecycle: connect/disconnect, getStatus, checkHealth,
 *   getPermissions, on/emit, initialize/teardown. All lifecycle methods are
 *   optional so that existing plain-object providers (ReadyLoq's phone camera,
 *   media import, WiFi grab) continue to compile without modification.
 *   Implementations that connect to real hardware SHOULD implement them.
 *
 *   `captureCapabilities` is added alongside `capabilities` as the explicit
 *   new name for camera-specific capabilities. `capabilities` (CaptureCapabilities)
 *   is kept as-is for backward compat — ReadyLoq reads capabilities.mode,
 *   capabilities.transport, etc.
 *
 *   CaptureProviderBase is retained as a backward-compat type alias.
 *   RequestCaptureProvider, SessionCaptureProvider, PushCaptureProvider
 *   are updated to extend CaptureDeviceProvider.
 *
 * DEPENDENCY GRAPH:
 *   camera-core → shared-types → core
 *   camera-core → device-core → provider-registry → core
 *   meta-wearables → camera-core   (wearable providers implement CaptureProvider)
 *
 * FUTURE WORK (not yet migrated):
 *   - ProviderRegistry implementation (provider-registry.ts) → Phase 3
 *   - QualityGate with injectable thresholds (quality-gate.ts) → Phase 3
 *   - KVAdapter decoupling from AsyncStorage → Phase 3
 */
import type { CaptureCapabilities, CaptureMode, CaptureSource, EvidenceItem, PreviewKind, QualityAssessment } from "@platform/shared-types";
import type { DeviceProvider } from "@platform/device-core";
export type { CaptureCapabilities, CaptureMode, CaptureSource, EvidenceItem, PreviewKind, QualityAssessment, } from "@platform/shared-types";
export type { DeviceProvider, DeviceCapabilities, DeviceCategory, DeviceTransport, DeviceIdentity, DeviceStatus, DeviceConnection, DeviceConnectionState, DeviceOperationalStatus, DeviceBattery, DeviceThermal, DevicePermissions, DeviceFirmware, DeviceDiagnostics, DeviceEvent, DeviceEventKind, DeviceEventListener, } from "@platform/device-core";
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
/**
 * The device-grounded base type for all camera providers.
 *
 * Derived from DeviceProvider via `Partial<Omit<DeviceProvider, ...>>` so that
 * ALL DeviceProvider lifecycle members — including checkHealth() — are declared
 * on this type while remaining optional. This preserves full backward compat:
 *
 *   1. Existing plain-object providers (ReadyLoq's phone camera, media import,
 *      WiFi grab) only supply `id`, `source`, `label`, `capabilities` and
 *      continue to compile without any modification.
 *   2. New real-hardware implementations (BLE glasses, USB scope, WiFi IP camera)
 *      SHOULD implement the full lifecycle for proper DeviceRegistry integration.
 *
 * Required camera fields (backward compat from CaptureProviderBase):
 *   id, source, label, capabilities (CaptureCapabilities)
 *
 * Camera-specific overrides vs. DeviceProvider:
 *   capabilities → CaptureCapabilities (not DeviceCapabilities) so that callers
 *     reading capabilities.mode / capabilities.transport still compile.
 *   id, name are excluded from the Partial base and re-declared here so they
 *     carry the correct optionality (id: required; name: optional).
 *
 * Optional device lifecycle declared (implement for hardware providers):
 *   connect, disconnect, getStatus, checkHealth, getPermissions,
 *   getFirmware, getDiagnostics, on, emit, initialize, teardown,
 *   identity, priority.
 */
export type CaptureDeviceProvider = Partial<Omit<DeviceProvider, "id" | "name" | "capabilities">> & {
    readonly id: string;
    readonly source: CaptureSource;
    /** Human-readable display label. */
    readonly label: string;
    /**
     * Camera-specific capabilities (CaptureCapabilities, not DeviceCapabilities).
     * Retained under the existing key for full backward compat with callers
     * that read `capabilities.mode`, `capabilities.transport`, etc.
     */
    readonly capabilities: CaptureCapabilities;
    /**
     * Camera-specific capabilities under the explicit new name.
     * Same data as `capabilities`; present on providers that adopt
     * CaptureDeviceProvider. Optional so plain-object providers compile.
     */
    readonly captureCapabilities?: CaptureCapabilities;
    /** DeviceProvider: human-readable display name (alias of label). */
    readonly name?: string;
};
/**
 * Backward-compat alias — identical to CaptureDeviceProvider.
 *
 * All pre-existing imports of `CaptureProviderBase` continue to compile.
 * @see CaptureDeviceProvider
 */
export type CaptureProviderBase = CaptureDeviceProvider;
/**
 * Pull model: phone camera, library import, USB/Wi-Fi still-grab.
 * The provider is stateless between captures.
 */
export type RequestCaptureProvider = CaptureDeviceProvider & {
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
export type SessionCaptureProvider = CaptureDeviceProvider & {
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
export type PushCaptureProvider = CaptureDeviceProvider & {
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