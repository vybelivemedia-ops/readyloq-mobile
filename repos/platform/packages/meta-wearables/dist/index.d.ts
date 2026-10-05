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
import type { CaptureCapabilities, CaptureSource } from "@platform/shared-types";
import type { DeviceProvider, DeviceDiscovery } from "@platform/device-core";
import type { ProviderAvailability } from "@platform/camera-core";
export type { DeviceProvider, DeviceCapabilities, DeviceCategory, DeviceTransport, DeviceIdentity, DeviceStatus, DeviceConnectionState, DevicePermissions, DeviceEvent, DeviceEventKind, DeviceDiscovery, } from "@platform/device-core";
/**
 * Extended metadata present on all wearable providers.
 */
export interface WearableProviderMeta {
    /** Human-readable hardware model name, e.g. "Meta Ray-Ban (2nd gen)". */
    hardwareModel: string;
    /** BLE / USB / WiFi identifier. */
    connectionAddress?: string;
    /** Firmware version, if discoverable. */
    firmwareVersion?: string;
    /** Battery level 0–100, if the hardware exposes it. */
    batteryLevel?: number;
}
/**
 * Wearable device provider.
 *
 * Extends DeviceProvider directly — the wearable IS a device and
 * DeviceProvider's connect/disconnect replaces the old hand-rolled versions.
 *
 * categories: ["wearable", "camera"] for smart glasses; ["wearable"] for
 * health-band wearables without a camera.
 *
 * isConnected is a convenience getter derived from:
 *   getStatus().connection.state === "connected"
 * It is retained for backward compat with existing callers.
 */
export interface WearableProvider extends DeviceProvider {
    readonly meta: WearableProviderMeta;
    /**
     * Convenience accessor — true when connection.state === "connected".
     * Prefer getStatus() for full connection detail.
     */
    readonly isConnected: boolean;
    /** Camera-specific capture capabilities, if the wearable has a camera. */
    readonly captureCapabilities?: CaptureCapabilities;
    /** Capture source identifier for camera-bearing wearables. */
    readonly source?: CaptureSource;
}
/**
 * Registry for wearable devices.
 *
 * Extends DeviceDiscovery — WearableRegistry.discover() maps semantically to
 * DeviceDiscovery.scan() over BLE/USB/WiFi transports. The discover() method
 * is preserved as the domain-specific entry point; implementations delegate
 * to scan() internally.
 */
export interface WearableRegistry extends DeviceDiscovery {
    /**
     * Scan for nearby wearable devices (BLE scan, USB enumeration, mDNS).
     * Returns discovered devices that have NOT yet been registered.
     * Internally delegates to DeviceDiscovery.scan() over supported transports.
     */
    discover(timeoutMs?: number): Promise<WearableProvider[]>;
    register(provider: WearableProvider): void;
    unregister(providerId: string): void;
    listRegistered(): WearableProvider[];
}
/**
 * Extended capabilities for smart-glasses providers.
 *
 * Adds two pipeline-binding fields on top of CaptureCapabilities so that the
 * inspection screen knows exactly where to route the two BLE data streams:
 *
 *   audioPipeline    — the BLE audio stream feeds the FAIE (Field AI Inspection
 *                      Engine) voice pipeline for real-time voice-command
 *                      recognition and hands-free evidence dispatch.
 *
 *   snapshotRoutine  — BLE camera frames (async_push) are handed to the
 *                      auto-snapshot routine (rolling frame-buffer in
 *                      new-inspection.tsx) which slots them into `imageUri` on
 *                      the current FAIE voice event.
 */
export interface SmartGlassesCapabilities extends CaptureCapabilities {
    /** Key of the voice pipeline that consumes BLE audio frames. */
    readonly audioPipeline: "faie";
    /** Key of the snapshot routine that consumes BLE camera frames. */
    readonly snapshotRoutine: "auto_snapshot";
}
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
export declare const SMART_GLASSES_CAPABILITIES: SmartGlassesCapabilities;
export declare const SMART_GLASSES_SOURCE: CaptureSource;
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
export declare const USB_CAMERA_CAPABILITIES: CaptureCapabilities;
export declare const USB_CAMERA_SOURCE: CaptureSource;
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
export declare const WIFI_CAMERA_CAPABILITIES: CaptureCapabilities;
export declare const WIFI_CAMERA_SOURCE: CaptureSource;
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
export declare const WEARABLE_CAMERA_CAPABILITIES: CaptureCapabilities;
export declare const WEARABLE_CAMERA_SOURCE: CaptureSource;
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
export declare const META_LIVE_AI_CAPABILITIES: CaptureCapabilities;
export declare const META_LIVE_AI_SOURCE: CaptureSource;
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
export declare class MetaLiveAIProvider {
    readonly meta: WearableProviderMeta;
    readonly captureCapabilities: CaptureCapabilities;
    readonly source: CaptureSource;
    get isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getStatus(): Promise<{
        operational: "unavailable";
        connection: {
            state: "disconnected";
            transport: "wifi";
        };
        lastSeenAt: string;
    }>;
    checkHealth(): Promise<{
        status: "unknown";
        message: string;
        checkedAt: string;
    }>;
    getPermissions(): {
        granted: boolean;
        required: string[];
        request(): Promise<boolean>;
    };
    initialize(): Promise<void>;
    teardown(): Promise<void>;
    on(): () => void;
    emit(): void;
}
/**
 * Registry of all planned wearable providers with their availability status.
 * Mirrors FUTURE_PROVIDER_DEFINITIONS from readyloq-mobile — the UI uses this
 * to render "Coming soon" entries in the device picker.
 *
 * `availability` here is a display label ("future") — distinct from the runtime
 * `ProviderAvailability` object ({ available: false, reason: string }) used in
 * the camera provider's probe() call.
 */
export declare const FUTURE_WEARABLE_PROVIDERS: Array<{
    id: string;
    label: string;
    source: CaptureSource;
    capabilities: CaptureCapabilities;
    /** Runtime probe result — always unavailable for future stubs. */
    availability: ProviderAvailability;
    estimatedRelease?: string;
}>;
//# sourceMappingURL=index.d.ts.map