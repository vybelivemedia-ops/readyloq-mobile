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
export {};
