/**
 * @platform/meta-wearables
 *
 * Wearable device provider stubs — smart glasses, BLE cameras, USB cameras,
 * WiFi cameras. Implements DeviceProvider as its device foundation.
 *
 * CANONICAL SOURCE:
 *   repos/readyloq-mobile/artifacts/readyloq-app/lib/vision/provider-registry.ts
 *     FUTURE_PROVIDER_DEFINITIONS — stubs for smart-glasses (async_push/BLE),
 *     usb-camera, wifi-camera, wearable-camera
 *
 * CURRENT STATUS:
 *   Meta AI glasses: Android Device Access Toolkit integration (DAT).
 *   Pipeline bindings declared in SmartGlassesCapabilities:
 *     audioPipeline: "faie"        → FAIE voice inspection pipeline
 *     snapshotRoutine: "auto_snapshot" → rolling frame-buffer auto-capture
 *
 *   All other providers in this package are STUBS — they appear in the
 *   ReadyLoq provider registry as "future" availability. None are connected
 *   to real hardware SDKs yet. The stubs exist to validate the provider
 *   interface and to let the UI list upcoming supported devices.
 *
 *   VYBE LIVE has no wearables code at all — it uses Agora for streaming
 *   which runs on the device camera. Meta wearables could eventually be used
 *   by VYBE creators to stream from a first-person perspective.
 *
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   WearableProvider now extends DeviceProvider directly, gaining the full
 *   device lifecycle: connect/disconnect, getStatus, checkHealth, getPermissions,
 *   on/emit, initialize/teardown. The hand-rolled connect/disconnect/isConnected
 *   fields are superseded by DeviceProvider's contract; isConnected is kept as
 *   a convenience getter. WearableRegistry extends DeviceDiscovery, mapping
 *   discover() to scan() semantics.
 *
 * INTEGRATION ROADMAP (from ReadyLoq roadmap comments):
 *   Phase Next:
 *     - ReadyLoq-compatible custom smart glasses → BLE notify stream
 *     - USB camera trigger (USB-OTG) → react-native-usb adapter
 *     - WiFi IP camera → WebSocket / RTSP bridge
 *   Phase Future:
 *     - Generic wearable camera (heart-rate + video, e.g. Polar Verity)
 *
 * DEPENDENCY GRAPH:
 *   meta-wearables → device-core → provider-registry → core
 *   meta-wearables → camera-core → shared-types
 */
/**
 * This is the ReadyLoq custom GATT / Nordic UART device path. It is NOT
 * consumer Meta AI glasses; those use META_LIVE_AI_CAPABILITIES below and the
 * official Android Device Access Toolkit.
 *
 * Target SDK: react-native-ble-plx
 * Transport:  BLE notify characteristic → JPEG frame chunks reassembled on RN
 * Mode:       async_push — glasses trigger a photo on hardware button press;
 *             the phone receives the frame via BLE notification.
 *
 * Canonical: future-source-providers.ts "smart-glasses" entry
 *
 * DeviceCapabilities: categories: ["wearable", "camera"], transports: ["ble"]
 */
export const SMART_GLASSES_CAPABILITIES = {
    mode: "async_push",
    transport: "ble",
    hasLivePreview: false,
    producesVideo: true,
    requiresPairing: true,
    /** Routes BLE audio to the FAIE voice inspection pipeline. */
    audioPipeline: "faie",
    /** Routes BLE camera frames to the inspection auto-snapshot routine. */
    snapshotRoutine: "auto_snapshot",
};
export const SMART_GLASSES_SOURCE = "smart_glasses";
// Concrete class to be implemented during extraction:
// export class SmartGlassesProvider implements WearableProvider { … }
// ─── USB Camera — session_stream ─────────────────────────────────────────────
/**
 * STUB — not yet connected to real hardware.
 *
 * Target SDK: react-native-usb (USB-OTG on Android)
 * Transport:  USB bulk transfer
 * Mode:       session_stream (MJPEG live feed; grab stills on demand)
 *
 * Canonical: future-source-providers.ts "usb-camera" entry
 *
 * DeviceCapabilities: categories: ["camera"], transports: ["usb"]
 */
export const USB_CAMERA_CAPABILITIES = {
    mode: "session_stream",
    transport: "usb",
    hasLivePreview: true,
    producesVideo: true,
    requiresPairing: false,
};
export const USB_CAMERA_SOURCE = "usb_camera";
// ─── WiFi IP Camera — session_stream ─────────────────────────────────────────
/**
 * STUB — not yet connected to real hardware.
 *
 * Target SDK: WebSocket / RTSP bridge or vendor SDK
 * Transport:  WiFi (local network)
 * Mode:       session_stream (MJPEG or H.264 over WebSocket)
 *
 * Canonical: future-source-providers.ts "wifi-camera" entry (source: "wifi_stream")
 *
 * DeviceCapabilities: categories: ["camera"], transports: ["wifi"]
 */
export const WIFI_CAMERA_CAPABILITIES = {
    mode: "session_stream",
    transport: "wifi",
    hasLivePreview: true,
    producesVideo: true,
    requiresPairing: false,
};
export const WIFI_CAMERA_SOURCE = "wifi_stream";
// ─── Wearable Camera (generic health-band camera) ────────────────────────────
/**
 * STUB — Phase Future.
 *
 * Target: Polar Verity / Garmin VIRB or similar device.
 * Transport: BLE (primary — async_push; frames push in as recorded).
 *
 * Canonical: future-source-providers.ts "wearable-camera" entry
 *
 * DeviceCapabilities: categories: ["wearable", "camera"], transports: ["ble"]
 */
export const WEARABLE_CAMERA_CAPABILITIES = {
    mode: "async_push",
    transport: "ble",
    hasLivePreview: false,
    producesVideo: true,
    requiresPairing: true,
};
export const WEARABLE_CAMERA_SOURCE = "wearable_camera";
// ─── Meta Live AI — webhook transport ────────────────────────────────────────
/**
 * Meta Live AI provider — server-side webhook transport.
 *
 * Unlike the BLE smart-glasses entry above (which streams raw camera frames
 * via react-native-ble-plx), this provider routes through Meta's Live AI
 * infrastructure: the glasses transcribe speech on-device, then POST the
 * text and an optional camera JPEG to the ReadyLoq webhook endpoint.
 *
 * Transport: "wifi" (webhook over cellular/WiFi internet — closest DeviceTransport
 * analog; no local BLE involved).
 * Mode: async_push — the glasses push events when the tech speaks or taps.
 *
 * Session pairing:
 *   1. Mobile app calls POST /api/meta-glasses/session → { sessionId, code }
 *   2. Tech enters the 6-char code in the Meta Glasses companion app.
 *   3. Glasses POST to https://<domain>/api/meta-glasses/webhook?session=<id>
 *   4. Mobile polls GET /api/meta-glasses/events/:sessionId for findings.
 *
 * Canonical: artifacts/api-server/src/routes/meta-glasses.ts
 *            artifacts/readyloq-app/hooks/useMetaGlassesSession.ts
 */
export const META_LIVE_AI_CAPABILITIES = {
    mode: "async_push",
    transport: "wifi", // webhook over internet; no local BLE
    hasLivePreview: false,
    producesVideo: false, // stills only (JPEG frames from glasses camera)
    requiresPairing: true, // 6-char code session pairing required
};
export const META_LIVE_AI_SOURCE = "smart_glasses";
/**
 * MetaLiveAIProvider — stub implementing WearableProvider for the webhook
 * transport path.  The concrete implementation lives in
 * `useMetaGlassesSession` (mobile hook) and `meta-glasses.ts` (API route).
 * This class exists to satisfy the WearableRegistry type contract and to
 * document the provider interface for future native-SDK migration.
 */
/**
 * NOTE: Stub — does not formally `implements WearableProvider` to avoid
 * requiring all DeviceProvider abstract method signatures in a stub.
 * Cast to WearableProvider where registry compliance is needed.
 */
export class MetaLiveAIProvider {
    meta = {
        hardwareModel: "Meta AI glasses (cloud/webhook fallback)",
        firmwareVersion: undefined,
        batteryLevel: undefined,
        connectionAddress: undefined,
    };
    captureCapabilities = META_LIVE_AI_CAPABILITIES;
    source = META_LIVE_AI_SOURCE;
    get isConnected() {
        // Connection state is managed by the mobile hook (session polling).
        return false;
    }
    // DeviceProvider contract — minimal stubs for registry compliance.
    // The concrete lifecycle is managed by useMetaGlassesSession (mobile hook).
    async connect() { }
    async disconnect() { }
    async getStatus() {
        return {
            operational: "unavailable",
            connection: {
                state: "disconnected",
                transport: "wifi",
            },
            lastSeenAt: new Date(0).toISOString(),
        };
    }
    async checkHealth() {
        return {
            status: "unknown",
            message: "MetaLiveAIProvider — lifecycle managed by useMetaGlassesSession hook",
            checkedAt: new Date().toISOString(),
        };
    }
    getPermissions() {
        return {
            granted: true,
            required: [],
            async request() { return true; },
        };
    }
    async initialize() { }
    async teardown() { }
    on() { return () => { }; }
    emit() { }
}
// ─── Future provider definitions map ────────────────────────────────────────
/**
 * Registry of all planned wearable providers with their availability status.
 * Mirrors FUTURE_PROVIDER_DEFINITIONS from readyloq-mobile — the UI uses this
 * to render "Coming soon" entries in the device picker.
 *
 * `availability` here is a display label ("future") — distinct from the runtime
 * `ProviderAvailability` object ({ available: false, reason: string }) used in
 * the camera provider's probe() call.
 */
export const FUTURE_WEARABLE_PROVIDERS = [
    {
        id: "smart-glasses",
        label: "ReadyLoq-compatible smart glasses (custom BLE)",
        source: "smart_glasses",
        capabilities: SMART_GLASSES_CAPABILITIES,
        availability: { available: true },
    },
    {
        id: "usb-camera",
        label: "USB Camera",
        source: "usb_camera",
        capabilities: USB_CAMERA_CAPABILITIES,
        availability: { available: false, reason: "Hardware support is planned — no driver yet." },
        estimatedRelease: "Q4 2025",
    },
    {
        id: "wifi-camera",
        label: "WiFi IP Camera",
        source: "wifi_stream",
        capabilities: WIFI_CAMERA_CAPABILITIES,
        availability: { available: false, reason: "Hardware support is planned — no driver yet." },
        estimatedRelease: "Q4 2025",
    },
    {
        id: "wearable-camera",
        label: "Wearable Camera",
        source: "wearable_camera",
        capabilities: WEARABLE_CAMERA_CAPABILITIES,
        availability: { available: false, reason: "Hardware support is planned — no driver yet." },
        estimatedRelease: "2026",
    },
];
