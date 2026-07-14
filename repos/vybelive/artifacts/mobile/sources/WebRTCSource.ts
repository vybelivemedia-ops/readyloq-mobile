import { Platform } from "react-native";
import { BaseVideoSource } from "./BaseVideoSource";
import type { VideoSourceCapabilities, VideoSourceConfig } from "@/types/videoSource";
import { VideoSourceError } from "@/types/videoSource";

/**
 * WebRTC Source — roadmap integration (web-first).
 *
 * Integration plan when this ships:
 *  1. On web: use the browser's getUserMedia() + MediaRecorder to capture
 *     the local video stream and chunk it to an RTMP re-encoder service.
 *  2. The re-encoder (server-side FFmpeg or a WebRTC → RTMP bridge) pushes
 *     to the Agora cloud ingest URL.
 *  3. The mobile app shows the ingest URL and monitors push health.
 *
 * Until that work ships, connect() throws NOT_IMPLEMENTED.
 */
export class WebRTCSource extends BaseVideoSource {
  readonly type = "webrtc" as const;
  readonly displayName = "WebRTC";
  readonly description = "Browser-based capture · desktop or mobile web";
  readonly capabilities: VideoSourceCapabilities = {
    maxResolution: { width: 1920, height: 1080 },
    maxFrameRate: 30,
    hasStabilization: false,
    hasMicrophone: true,
    isWireless: true,
    requiresPairing: false,
    supportsFlip: false,
    mode: "rtmp_ingest",
  };

  async connect(_config?: VideoSourceConfig): Promise<void> {
    if (Platform.OS !== "web") {
      this._setState({
        status: "not_available",
        error: "WebRTC capture is only available on the web platform.",
        guidance: "Use a phone camera or RTMP source for mobile streaming.",
      });
      throw new VideoSourceError(
        "NOT_SUPPORTED_ON_PLATFORM",
        "WebRTC capture is only available on the web platform.",
        "Use a phone camera or RTMP source for mobile streaming."
      );
    }

    this._setState({
      status: "error",
      error: "WebRTC source integration is not yet available.",
      guidance:
        "WebRTC ingest is on the VYBE roadmap. It will allow browser-based " +
        "streaming from desktop or mobile web.",
    });
    throw new VideoSourceError(
      "NOT_IMPLEMENTED",
      "WebRTC source integration is not yet available.",
      "WebRTC ingest is on the VYBE roadmap and will allow browser-based streaming."
    );
  }

  async disconnect(): Promise<void> {
    this._setState({ status: "idle", error: undefined, guidance: undefined });
  }
}
