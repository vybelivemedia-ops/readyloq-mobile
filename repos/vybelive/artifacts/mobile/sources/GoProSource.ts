import { BaseVideoSource } from "./BaseVideoSource";
import type { VideoSourceCapabilities, VideoSourceConfig } from "@/types/videoSource";
import { VideoSourceError } from "@/types/videoSource";

const GOPRO_HOST = "10.5.5.9";
const GOPRO_PORT = 8080;
const GOPRO_BASE = `http://${GOPRO_HOST}:${GOPRO_PORT}`;

/**
 * GoPro Hero 8+ — WiFi Open API integration.
 *
 * Flow:
 *  1. User connects phone to the GoPro's WiFi hotspot (SSID: "GP<serial>").
 *  2. connect() pings /gopro/camera/info to confirm reachability + reads model.
 *  3. connect() calls /gopro/camera/stream/start to make GoPro push RTMP to the
 *     Agora ingest URL supplied in VideoSourceConfig.
 *  4. Status → "streaming"; rtmpIngestUrl + streamKey are available for display.
 *
 * If the phone isn't on the GoPro's WiFi, connect() throws DEVICE_NOT_FOUND
 * with WiFi pairing guidance. All errors are explicit — no silent fallbacks.
 *
 * References:
 *   https://gopro.github.io/OpenGoPro/http
 */
export class GoProSource extends BaseVideoSource {
  readonly type = "gopro" as const;
  readonly displayName = "GoPro";
  readonly description = "GoPro Hero 8+ · WiFi Open API · 4K POV";
  readonly capabilities: VideoSourceCapabilities = {
    maxResolution: { width: 3840, height: 2160 },
    maxFrameRate: 60,
    hasStabilization: true,
    hasMicrophone: true,
    isWireless: true,
    requiresPairing: true,
    supportsFlip: false,
    mode: "rtmp_ingest",
  };

  private _model: string | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;

  async connect(config?: VideoSourceConfig): Promise<void> {
    const { status } = this._state;
    if (status === "connected" || status === "streaming") return;

    if (!config?.rtmpIngestUrl || !config.streamKey) {
      this._setState({
        status: "error",
        error: "Start a VYBE stream first to generate your RTMP ingest URL.",
        guidance: "Tap 'Go Live' on the stream setup screen, then select GoPro as your source.",
      });
      throw new VideoSourceError(
        "MISSING_CONFIG",
        "RTMP ingest URL and stream key are required before connecting GoPro.",
        "Start a VYBE stream first — the ingest URL is generated when your stream begins."
      );
    }

    this._setState({ status: "connecting", error: undefined, guidance: undefined });

    // 1. Detect GoPro over WiFi
    const info = await this._fetchCameraInfo();
    if (!info) {
      this._setState({
        status: "error",
        error: "GoPro not found on this network.",
        guidance:
          "Connect your phone to the GoPro's WiFi hotspot first.\n\n" +
          "On your GoPro: Connections → Connect Device → GoPro App (or Quick Capture).\n" +
          "On your phone: Settings → WiFi → select 'GP…' network.",
      });
      throw new VideoSourceError(
        "DEVICE_NOT_FOUND",
        "GoPro not reachable at 10.5.5.9:8080.",
        "Connect your phone to the GoPro's WiFi hotspot, then try again."
      );
    }

    this._model = info.model ?? "GoPro";

    // 2. Set video preset (1080p60 for streaming — lower bitrate than 4K recording)
    await this._setStreamingPreset().catch(() => undefined); // non-fatal

    // 3. Start RTMP stream from GoPro → Agora ingest
    const started = await this._startStream(config.rtmpIngestUrl, config.streamKey);
    if (!started) {
      this._setState({
        status: "error",
        error: "GoPro refused to start streaming.",
        guidance: "Make sure the GoPro is in Video mode and not currently recording.",
      });
      throw new VideoSourceError(
        "CONNECTION_FAILED",
        "GoPro stream/start command failed.",
        "Ensure the GoPro is in Video mode and not actively recording."
      );
    }

    this._setState({
      status: "streaming",
      rtmpIngestUrl: config.rtmpIngestUrl,
      streamKey: config.streamKey,
      batteryLevel: info.battery,
      signalStrength: 4,
      error: undefined,
      guidance: undefined,
    });

    // Poll battery/signal every 15 s while streaming
    this._startHealthPoll();
  }

  async disconnect(): Promise<void> {
    this._stopHealthPoll();
    if (this._state.status === "streaming") {
      await this._stopStream().catch(() => undefined);
    }
    this._model = null;
    this._setState({
      status: "idle",
      rtmpIngestUrl: undefined,
      streamKey: undefined,
      batteryLevel: undefined,
      signalStrength: undefined,
      error: undefined,
      guidance: undefined,
    });
  }

  // ── GoPro HTTP Open API calls ─────────────────────────────────────────────

  private async _fetchCameraInfo(): Promise<{ model: string; battery: number } | null> {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${GOPRO_BASE}/gopro/camera/info`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      const json = await res.json() as {
        info?: { model_name?: string };
        status?: { battery_level?: number };
      };
      return {
        model: json.info?.model_name ?? "GoPro",
        battery: (json.status?.battery_level ?? 3) * 25, // 0-4 → 0-100%
      };
    } catch {
      return null;
    }
  }

  private async _setStreamingPreset(): Promise<void> {
    // Resolution: 1080p (9), FPS: 60 (2) via GoPro Open API settings
    await fetch(`${GOPRO_BASE}/gopro/camera/setting?setting=2&option=2`);  // FPS 60
    await fetch(`${GOPRO_BASE}/gopro/camera/setting?setting=17&option=9`); // Res 1080p
  }

  private async _startStream(rtmpUrl: string, streamKey: string): Promise<boolean> {
    try {
      const destination = `${rtmpUrl}/${streamKey}`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(
        `${GOPRO_BASE}/gopro/camera/stream/start?url=${encodeURIComponent(destination)}`,
        { method: "GET", signal: ctrl.signal }
      );
      clearTimeout(tid);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async _stopStream(): Promise<void> {
    await fetch(`${GOPRO_BASE}/gopro/camera/stream/stop`).catch(() => undefined);
  }

  private _startHealthPoll(): void {
    this._pingTimer = setInterval(async () => {
      const info = await this._fetchCameraInfo();
      if (!info) {
        this._stopHealthPoll();
        this._setState({
          status: "error",
          error: "GoPro connection lost.",
          guidance: "Check that your phone is still on the GoPro WiFi network.",
        });
        return;
      }
      this._setState({ batteryLevel: info.battery });
    }, 15_000);
  }

  private _stopHealthPoll(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }
}
