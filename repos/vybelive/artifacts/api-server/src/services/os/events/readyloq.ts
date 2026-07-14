// ─── OS Event Bus — ReadyLoq Domain Events ────────────────────────────────────
// Events from ReadyLoq wearable device sessions: device connectivity,
// streaming session lifecycle, footage capture, and stream health signals.
// ReadyLoq is the POV capture layer beneath VYBE Live's streaming stack.

export type ReadyLoqDeviceKind = "meta_glasses" | "gopro" | "phone" | "external_rtmp" | "usb_camera";

export interface ReadyLoqDevicePayload {
  /** Stable device identifier (MAC address hash or serial) */
  deviceId: string;
  deviceKind: ReadyLoqDeviceKind;
  /** Friendly label set by the creator */
  label: string;
  /** Internal VYBE user ID of the creator */
  userId: string;
}

export interface ReadyLoqSessionPayload {
  sessionId: string;
  deviceId: string;
  deviceKind: ReadyLoqDeviceKind;
  userId: string;
  /** Estimated stream resolution, e.g. "1080p" */
  resolution: string;
  /** Frames per second */
  fps: number;
  /** Target bitrate in kbps */
  targetBitrateKbps: number;
}

export interface ReadyLoqSessionEndedPayload extends ReadyLoqSessionPayload {
  durationMs: number;
  /** Average actual bitrate achieved during the session */
  avgBitrateKbps: number;
  droppedFrames: number;
}

export interface ReadyLoqStreamHealthPayload {
  sessionId: string;
  deviceId: string;
  userId: string;
  /** "good" | "degraded" | "critical" | "offline" */
  health: "good" | "degraded" | "critical" | "offline";
  /** Signal strength 0-100 */
  signalStrength: number;
  /** Latency to ingest server in ms */
  latencyMs: number;
  /** Packet loss percentage 0-100 */
  packetLossPercent: number;
}

export interface ReadyLoqFootageCapturedPayload {
  sessionId: string;
  deviceId: string;
  userId: string;
  /** Duration of the captured clip in seconds */
  durationSeconds: number;
  /** Storage path (private object storage key) */
  storagePath: string;
  /** Whether the clip was automatically flagged as a highlight */
  autoHighlight: boolean;
  /** Estimated file size in bytes */
  sizeBytes: number;
}

export interface ReadyLoqEventMap {
  "readyloq.device.connected": ReadyLoqDevicePayload;
  "readyloq.device.disconnected": ReadyLoqDevicePayload;
  "readyloq.session.started": ReadyLoqSessionPayload;
  "readyloq.session.ended": ReadyLoqSessionEndedPayload;
  "readyloq.stream.health_changed": ReadyLoqStreamHealthPayload;
  "readyloq.footage.captured": ReadyLoqFootageCapturedPayload;
}
