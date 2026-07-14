import { Platform } from "react-native";
import { BaseVideoSource } from "./BaseVideoSource";
import type { VideoSourceCapabilities, VideoSourceConfig } from "@/types/videoSource";
import { VideoSourceError } from "@/types/videoSource";

/**
 * USB Camera — roadmap integration (iOS-first).
 *
 * Integration plan when this ships:
 *  1. Build a native Expo module wrapping AVFoundation's AVCaptureSession
 *     with a USB/UVC device target (iOS 17+ supports UVC natively).
 *  2. Implement connect() to enumerate external capture devices and select
 *     the first UVC-compatible device.
 *  3. Register the capture session's sample buffer output as a custom
 *     Agora external video source via IRtcEngine.setExternalVideoSource().
 *  4. Push CMSampleBuffer frames to Agora.
 *
 * Until that work ships, connect() throws NOT_IMPLEMENTED / NOT_SUPPORTED.
 */
export class USBCameraSource extends BaseVideoSource {
  readonly type = "usb_camera" as const;
  readonly displayName = "USB Camera";
  readonly description = "External USB camera · Lightning or USB-C · up to 4K";
  readonly capabilities: VideoSourceCapabilities = {
    maxResolution: { width: 3840, height: 2160 },
    maxFrameRate: 60,
    hasStabilization: false,
    hasMicrophone: false,
    isWireless: false,
    requiresPairing: false,
    supportsFlip: false,
    mode: "sdk_capture",
  };

  async connect(_config?: VideoSourceConfig): Promise<void> {
    if (Platform.OS === "android") {
      this._setState({
        status: "not_available",
        error: "USB cameras are only supported on iOS.",
        guidance:
          "Connect via a USB-C or Lightning adapter on iOS 17+. " +
          "A development build (not Expo Go) is required.",
      });
      throw new VideoSourceError(
        "NOT_SUPPORTED_ON_PLATFORM",
        "USB cameras are only supported on iOS.",
        "Connect via a USB-C or Lightning adapter on iOS 17+."
      );
    }

    this._setState({
      status: "error",
      error: "USB camera integration is not yet available.",
      guidance:
        "USB camera support is on the VYBE roadmap via a native AVFoundation " +
        "module. A development build (not Expo Go) will be required.",
    });
    throw new VideoSourceError(
      "NOT_IMPLEMENTED",
      "USB camera integration is not yet available.",
      "USB camera support is on the VYBE roadmap via a native AVFoundation module."
    );
  }

  async disconnect(): Promise<void> {
    this._setState({ status: "idle", error: undefined, guidance: undefined });
  }
}
