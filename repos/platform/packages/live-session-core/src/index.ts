/**
 * @platform/live-session-core
 *
 * Live-session infrastructure extracted from vybelive.
 *
 * CANONICAL SOURCE:
 *   repos/vybelive/artifacts/mobile/lib/
 *   repos/vybelive/artifacts/api-server/src/routes/  (stream routes)
 *   repos/vybelive/artifacts/api-server/src/services/ (stream services)
 *
 * VYBE LIVE mobile app routes observed:
 *   app/(tabs)/          — discover, notifications, recordings, approvals,
 *                          collaborations, conversations
 *   app/stream/          — live stream session (Agora RTC)
 *   app/creator/         — creator dashboard
 *   lib/uploadMedia.ts   — media upload to object storage
 *
 * ReadyLoq has NO streaming — it is a capture/sync/report app. This package
 * is VYBE-owned. ReadyLoq would consume live-session-core only if it adds a
 * "live inspection walkthrough" feature in a future phase.
 *
 * AGORA:
 *   VYBE uses Agora RTC for WebRTC streaming. The AgoraAdapter wraps the
 *   Agora SDK so the rest of the codebase never imports Agora directly — this
 *   makes it possible to swap providers (e.g. LiveKit, 100ms) without
 *   touching stream-session logic.
 *
 * GENERALISATION NEEDED (before extraction):
 *   - Move Agora credentials and channel config to injected options.
 *   - Extract social publishing (YouTube / Instagram Live) as pluggable
 *     SocialPublisher adapters (one per platform).
 *   - Decouple CloudRecording from Agora Cloud Recording API — make it
 *     work with any recording provider.
 *
 * DEPENDENCY GRAPH:
 *   live-session-core → shared-types
 *   live-session-core → storage-core  (recording files → object storage)
 */

import type { EvidenceItem } from "@platform/shared-types";

// ─── Stream session ───────────────────────────────────────────────────────────

export type StreamSessionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "paused"
  | "ending"
  | "ended"
  | "error";

export type StreamVisibility = "public" | "followers" | "private";

export interface StreamSessionOptions {
  title: string;
  description?: string;
  visibility: StreamVisibility;
  /** Enable Agora cloud recording from session start. */
  recordCloud?: boolean;
  /** Enable live AI transcription (delegates to voice-intelligence). */
  transcribeAudio?: boolean;
}

/**
 * A live stream session. Created by StreamPublisher; managed via this handle.
 */
export interface StreamSession {
  readonly id: string;
  readonly channelId: string;
  readonly status: StreamSessionStatus;
  readonly startedAt: string | undefined; // ISO-8601
  readonly viewerCount: number;

  pause(): Promise<void>;
  resume(): Promise<void>;
  end(): Promise<StreamRecording | undefined>;

  onStatusChange(listener: (status: StreamSessionStatus) => void): () => void;
  onViewerCountChange(listener: (count: number) => void): () => void;
}

// ─── Stream publisher ─────────────────────────────────────────────────────────

/**
 * Entry point for starting a live stream. Wraps the Agora adapter and handles
 * channel token acquisition from the API server.
 */
export interface StreamPublisher {
  start(options: StreamSessionOptions): Promise<StreamSession>;
  /** Retrieve an existing session (e.g. on app resume). */
  getSession(sessionId: string): Promise<StreamSession | null>;
}

// ─── Agora adapter ────────────────────────────────────────────────────────────

/**
 * Thin wrapper over the Agora RTC SDK. All Agora-specific types and imports
 * are confined to the adapter implementation file — the rest of the package
 * talks only to this interface.
 */
export interface AgoraAdapter {
  joinChannel(channelId: string, token: string, uid: number): Promise<void>;
  leaveChannel(): Promise<void>;
  muteLocalAudio(muted: boolean): void;
  muteLocalVideo(muted: boolean): void;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  onRemoteUserJoined(listener: (uid: number) => void): () => void;
  onRemoteUserLeft(listener: (uid: number) => void): () => void;
  readonly localUid: number;
}

// ─── Cloud recording ──────────────────────────────────────────────────────────

export interface RecordingOptions {
  /** Storage path prefix in object storage where recording files are written. */
  storagePrefix: string;
  /** Video resolution: "hd" = 1280×720, "sd" = 640×360, "ld" = 320×180. */
  resolution?: "hd" | "sd" | "ld";
  /** Maximum recording duration in seconds before auto-stop. */
  maxDurationSec?: number;
}

export interface StreamRecording {
  id: string;
  sessionId: string;
  /** Object storage key for the recorded file. */
  storageKey: string;
  /** CDN URL for playback. */
  playbackUrl: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string; // ISO-8601
}

/**
 * Controls Agora Cloud Recording for a session. Separate from the stream
 * session to allow recording to start/stop independently.
 */
export interface CloudRecording {
  start(sessionId: string, options: RecordingOptions): Promise<{ recordingId: string }>;
  stop(recordingId: string): Promise<StreamRecording>;
  getStatus(recordingId: string): Promise<{ status: "active" | "stopped" | "error" }>;
}

// ─── Clip processor ───────────────────────────────────────────────────────────

/**
 * Produces shareable clips from a completed recording. Used by VYBE's creator
 * tools to generate highlight clips and social-ready snippets.
 */
export interface ClipOptions {
  startMs: number;
  endMs: number;
  title?: string;
  /** If true, burn captions from the AI transcription into the clip. */
  burnCaptions?: boolean;
}

export interface Clip {
  id: string;
  recordingId: string;
  storageKey: string;
  playbackUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  options: ClipOptions;
  createdAt: string;
}

export interface ClipProcessor {
  createClip(recording: StreamRecording, options: ClipOptions): Promise<Clip>;
  listClips(sessionId: string): Promise<Clip[]>;
  deleteClip(clipId: string): Promise<void>;
}

// ─── Social publisher ─────────────────────────────────────────────────────────

export type SocialPlatform =
  | "youtube"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "twitch"
  | "kick"
  | "custom_rtmp";

export interface SocialPublisherOptions {
  platform: SocialPlatform;
  /** RTMP destination URL (for custom_rtmp or when the adapter resolves it). */
  rtmpUrl?: string;
  /** Platform-specific stream key. */
  streamKey?: string;
  title: string;
  description?: string;
}

/**
 * Simultaneously pushes the stream to a social platform (RTMP re-stream).
 * VYBE supports YouTube Live and Instagram Live.
 */
export interface SocialPublisher {
  startPublishing(session: StreamSession, options: SocialPublisherOptions): Promise<void>;
  stopPublishing(sessionId: string, platform: SocialPlatform): Promise<void>;
  getPublishingStatus(sessionId: string): Promise<
    Array<{ platform: SocialPlatform; status: "active" | "stopped" | "error" }>
  >;
}

// ─── Media upload ─────────────────────────────────────────────────────────────

/**
 * Upload stream-related media (thumbnails, clips, cover images) to object
 * storage. Wraps storage-core for live-session-specific path conventions.
 *
 * Path convention:
 *   streams/{sessionId}/thumbnail.jpg
 *   streams/{sessionId}/clips/{clipId}.mp4
 *   streams/{sessionId}/recording.mp4
 */
export interface StreamMediaUploader {
  uploadThumbnail(sessionId: string, evidence: EvidenceItem): Promise<string>; // → URL
  uploadClip(sessionId: string, clipId: string, localUri: string): Promise<string>;
}
