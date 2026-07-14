import { BaseVideoSource } from "./BaseVideoSource";
import type { VideoSourceCapabilities, VideoSourceConfig } from "@/types/videoSource";
import { VideoSourceError } from "@/types/videoSource";

/**
 * External RTMP Source — fully functional.
 *
 * Used when streaming from OBS, Wirecast, BMDCC, or any other external
 * encoder that can push RTMP. The phone shows the ingest URL and stream key;
 * the encoder is responsible for pushing video.
 *
 * connect() requires rtmpIngestUrl and streamKey in config. Both are
 * available on the activeStream object once the stream is started.
 */
export class ExternalRTMPSource extends BaseVideoSource {
  readonly type = "external_rtmp" as const;
  readonly displayName = "RTMP Source";
  readonly description = "OBS, Wirecast, BMDCC, custom encoder · any resolution";
  readonly capabilities: VideoSourceCapabilities = {
    maxResolution: { width: 3840, height: 2160 },
    maxFrameRate: 60,
    hasStabilization: false,
    hasMicrophone: true,
    isWireless: false,
    requiresPairing: false,
    supportsFlip: false,
    mode: "rtmp_ingest",
  };

  async connect(config?: VideoSourceConfig): Promise<void> {
    if (this._state.status === "streaming") return;

    if (!config?.rtmpIngestUrl || !config.streamKey) {
      this._setState({
        status: "error",
        error: "RTMP ingest URL and stream key are required.",
        guidance:
          "Start your stream first to generate a stream key, then point your " +
          "encoder at the ingest URL shown on this screen.",
      });
      throw new VideoSourceError(
        "MISSING_CONFIG",
        "RTMP ingest URL and stream key are required.",
        "Start your stream first to generate a stream key, then point your " +
          "encoder at the ingest URL shown on this screen."
      );
    }

    this._setState({
      status: "streaming",
      rtmpIngestUrl: config.rtmpIngestUrl,
      streamKey: config.streamKey,
      error: undefined,
      guidance: undefined,
    });
  }

  async disconnect(): Promise<void> {
    this._setState({
      status: "idle",
      rtmpIngestUrl: undefined,
      streamKey: undefined,
      error: undefined,
      guidance: undefined,
    });
  }
}
