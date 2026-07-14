import { Platform } from "react-native";
import { Camera } from "expo-camera";
import { BaseVideoSource } from "./BaseVideoSource";
import type { VideoSourceCapabilities, VideoSourceConfig } from "@/types/videoSource";
import { VideoSourceError } from "@/types/videoSource";

/**
 * Phone Camera — the primary video source.
 * Captures via expo-camera (CameraView) in simulation/Expo Go, and via the
 * Agora SDK (AgoraLocalView) in a development build with react-native-agora.
 *
 * This is the only fully implemented source. All other sources are either
 * functional stubs (ExternalRTMPSource) or roadmap stubs (MetaGlassesSource,
 * GoProSource, USBCameraSource, WebRTCSource).
 */
export class PhoneCameraSource extends BaseVideoSource {
  readonly type = "phone" as const;
  readonly displayName = "Phone Camera";
  readonly description = "Front or rear camera · HD 1080p · built-in mic";
  readonly capabilities: VideoSourceCapabilities = {
    maxResolution: { width: 1920, height: 1080 },
    maxFrameRate: 60,
    hasStabilization: true,
    hasMicrophone: true,
    isWireless: false,
    requiresPairing: false,
    supportsFlip: true,
    mode: "sdk_capture",
  };

  async connect(_config?: VideoSourceConfig): Promise<void> {
    const { status } = this._state;
    if (status === "connected" || status === "streaming") return;

    if (Platform.OS === "web") {
      // Web preview is always available (no native camera API needed).
      this._setState({ status: "connected" });
      return;
    }

    this._setState({ status: "connecting" });

    const existing = await Camera.getCameraPermissionsAsync();
    if (!existing.granted) {
      const result = await Camera.requestCameraPermissionsAsync();
      if (!result.granted) {
        this._setState({
          status: "error",
          error: "Camera permission denied",
          guidance:
            "Go to Settings → Privacy → Camera and enable access for VYBE LIVE.",
        });
        throw new VideoSourceError(
          "PERMISSION_DENIED",
          "Camera access was denied.",
          "Go to Settings → Privacy → Camera and enable access for VYBE LIVE."
        );
      }
    }

    // Microphone is required for Agora to capture and publish live audio.
    // RECORD_AUDIO is a *runtime* (dangerous) permission on Android: even though
    // it is declared in the manifest, if it is never granted at runtime Agora
    // still publishes an audio track but it carries no mic data — so the stream
    // reaches YouTube with video but silent audio. Request it alongside camera.
    const existingMic = await Camera.getMicrophonePermissionsAsync();
    let micGranted = existingMic.granted;
    if (!micGranted) {
      const micResult = await Camera.requestMicrophonePermissionsAsync();
      micGranted = micResult.granted;
    }
    // [TEMP AUDIO DIAGNOSTIC] microphone enabled state
    console.log(
      "[PhoneCameraSource][AUDIO] microphone permission granted:",
      micGranted
    );
    if (!micGranted) {
      // Non-fatal: video still works, but warn loudly that audio will be silent.
      this._setState({
        status: "connected",
        error: undefined,
        guidance:
          "Microphone access is off — your stream will have no audio. Enable it in Settings → Privacy → Microphone for VYBE LIVE.",
      });
      return;
    }

    this._setState({ status: "connected", error: undefined, guidance: undefined });
  }

  async disconnect(): Promise<void> {
    this._setState({ status: "idle", error: undefined, guidance: undefined });
  }
}
