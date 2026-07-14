import { BaseVideoSource } from "./BaseVideoSource";
import type { VideoSourceCapabilities, VideoSourceConfig } from "@/types/videoSource";

/**
 * Meta Glasses — Device Access Toolkit (DAT)
 *
 * Streams live POV video from Ray-Ban Meta glasses via Meta's Wearables Device
 * Access Toolkit SDK (Developer Preview, December 2025).
 *
 * Architecture:
 *   - This source class is a state proxy only. The actual session lifecycle
 *     (createSession → startSession → addStreamToSession → stopSession) is
 *     managed by MetaWearablesContext, which wraps `expo-meta-wearables-dat`.
 *   - connect() signals intent. MetaWearablesContext.startGlassesStream() is
 *     called by pov.tsx when the stream goes live and drives the real SDK work.
 *   - Video is rendered by EMWDATStreamView (native DAT view), not Agora.
 *     VideoSourcePreview branches on source.type === "meta_glasses" to render
 *     the appropriate component.
 *
 * Prerequisites for real streaming:
 *   1. EAS dev build (expo-meta-wearables-dat requires native modules).
 *   2. META_APP_ID + META_APP_SECRET configured (or omit for Developer Mode).
 *   3. User must complete registration (Settings → Meta Glasses) once.
 *   4. Meta AI app must be installed on the same iPhone.
 *   5. Ray-Ban Meta glasses must be paired in the Meta AI app.
 *
 * Simulation mode (Expo Go / dev build without credentials):
 *   MetaWearablesContext uses a mock implementation. The phone camera acts as
 *   a visual stand-in in VideoSourcePreview for development testing. The Mock
 *   Device Kit in the real SDK can also simulate glasses in a dev build.
 *
 * SDK: https://github.com/facebook/meta-wearables-dat-ios
 * Package: expo-meta-wearables-dat v1.3.0 (MIT)
 * Stream limits: 720p @ 30fps maximum (Bluetooth-constrained)
 */
export class MetaGlassesSource extends BaseVideoSource {
  readonly type = "meta_glasses" as const;
  readonly displayName = "Meta Glasses";
  readonly description = "Ray-Ban Meta · Device Access Toolkit · 720p/30fps";

  readonly capabilities: VideoSourceCapabilities = {
    maxResolution: { width: 1280, height: 720 }, // DAT SDK maximum
    maxFrameRate: 30,                             // Bluetooth-constrained
    hasStabilization: false,                      // glasses have no OIS
    hasMicrophone: true,                          // glasses mic via BT profile
    isWireless: true,
    requiresPairing: true,
    supportsFlip: false,                          // single fixed glasses camera
    // Video rendered via EMWDATStreamView (native DAT view).
    // VideoSourcePreview reads source.type to branch; mode stays sdk_capture
    // so the existing Agora audio pipeline still applies.
    mode: "sdk_capture",
  };

  async connect(_config?: VideoSourceConfig): Promise<void> {
    const { status } = this._state;
    if (status === "connected" || status === "streaming") return;
    this._setState({ status: "connecting", error: undefined, guidance: undefined });
    // Instant "connected" transition — MetaWearablesContext drives the real
    // SDK session once pov.tsx calls startGlassesStream() on isLive.
    this._setState({
      status: "connected",
      batteryLevel: undefined,   // populated by DAT SDK events
      signalStrength: undefined, // populated by DAT SDK events
      error: undefined,
      guidance: undefined,
    });
  }

  async disconnect(): Promise<void> {
    // pov.tsx calls stopGlassesStream() before disconnect().
    this._setState({
      status: "idle",
      batteryLevel: undefined,
      signalStrength: undefined,
      error: undefined,
      guidance: undefined,
    });
  }

  /**
   * Surface a DAT session failure to the UI. The real session lifecycle lives
   * in MetaWearablesContext; pov.tsx calls this when startGlassesStream() throws
   * so the preview shows an actionable error instead of a stuck "starting" state.
   */
  markStreamError(message: string): void {
    this._setState({
      status: "error",
      error: message,
      guidance: "Ensure your glasses are paired in the Meta AI app, then try going live again.",
    });
  }
}
