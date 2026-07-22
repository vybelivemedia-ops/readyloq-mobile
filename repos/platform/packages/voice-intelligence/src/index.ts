/**
 * @platform/voice-intelligence
 *
 * Voice capture, transcription, and command routing.
 *
 * STATUS: New package — no existing code to extract from either repo.
 *
 * PLANNED IN BOTH APPS:
 *   ReadyLoq (from roadmap comments in provider-registry.ts):
 *     "Phase Next: voice memo capture during inspections"
 *     — technician dictates findings hands-free while photographing.
 *   VYBE LIVE (from OS types and mission-control UI):
 *     — voice commands for stream control ("go live", "end stream")
 *     — AI transcription of stream audio for auto-captioning
 *
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   MicrophoneDeviceProvider extends DeviceProvider, giving microphone hardware
 *   the full device lifecycle: connect/disconnect, status, health checks,
 *   permissions, and events. VoiceRecorder extends MicrophoneDeviceProvider so
 *   the microphone hardware interface participates in the device registry.
 *
 * DEPENDENCY GRAPH:
 *   voice-intelligence → shared-types
 *   voice-intelligence → device-core → provider-registry → core
 *   voice-intelligence → ai-core  (transcription uses AIProvider)
 *   camera-core does NOT depend on voice-intelligence — they are parallel
 *   capture channels that both produce EvidenceItem-like artefacts.
 *
 * IMPLEMENTATION NOTES:
 *   - Mobile: expo-speech / expo-av for recording, Whisper API for STT.
 *   - Web: MediaRecorder API + WebAudio for recording.
 *   - The VoiceRecorder produces a VoiceCapture (analogous to EvidenceItem).
 *   - TranscriptionService wraps an AIProvider to call the Whisper-compatible
 *     endpoint; provider selection goes through AIProviderFactory.
 *   - VoiceCommandRouter maps recognised phrases to typed Commands (app-defined
 *     in the consuming app, not in this package).
 */

import type { DeviceProvider } from "@platform/device-core";

// ─── Re-export device-core types needed by voice consumers ───────────────────
export type {
  DeviceProvider,
  DeviceCapabilities,
  DeviceCategory,
  DeviceTransport,
  DeviceIdentity,
  DeviceStatus,
  DevicePermissions,
  DeviceEvent,
  DeviceEventKind,
  DeviceEventListener,
} from "@platform/device-core";

// ─── Voice capture ────────────────────────────────────────────────────────────

export type VoiceCaptureMode = "push_to_talk" | "always_on" | "voice_activity_detection";
export type VoiceCaptureStatus = "idle" | "recording" | "processing" | "error";

/**
 * A recorded audio clip — analogous to EvidenceItem for voice data.
 */
export interface VoiceCapture {
  id: string;
  /** Temporary local URI (file:///…) before upload. */
  localUri: string;
  /** Uploaded storage path (post-upload), if persisted. */
  storagePath?: string;
  mimeType: "audio/m4a" | "audio/wav" | "audio/webm" | string;
  durationMs: number;
  capturedAt: string; // ISO-8601
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Byte size. */
  fileSize: number;
}

// ─── MicrophoneDeviceProvider — DeviceProvider foundation for microphones ────

/**
 * Device provider interface for physical microphone hardware.
 *
 * Extends DeviceProvider giving every microphone provider the full device
 * lifecycle: connect/disconnect, getStatus, checkHealth, getPermissions,
 * on/emit, initialize/teardown. Registered in the DeviceRegistry under
 * categories: ["microphone"].
 *
 * Implementations include:
 *   - Built-in phone microphone (transport: "internal")
 *   - BLE headset microphone (transport: "ble")
 *   - USB microphone (transport: "usb")
 *   - WiFi broadcast microphone (transport: "wifi")
 */
export interface MicrophoneDeviceProvider extends DeviceProvider {
  /**
   * Microphone-specific capabilities.
   * DeviceCapabilities.categories must include "microphone".
   * DeviceCapabilities.producesMedia must be true.
   */
  readonly microphoneCapabilities: MicrophoneCapabilities;
}

/**
 * Microphone-specific capability metadata.
 */
export interface MicrophoneCapabilities {
  /** Maximum supported sample rate in Hz. */
  maxSampleRateHz: number;
  /** Supported audio MIME types. */
  supportedMimeTypes: string[];
  /** Whether the device supports always-on voice activity detection. */
  supportsVoiceActivityDetection: boolean;
  /** Whether the device supports noise cancellation. */
  supportsNoiseCancellation: boolean;
  /** Number of audio channels supported. */
  channelCount: number;
}

// ─── Recorder interface ───────────────────────────────────────────────────────

/**
 * Voice recorder hardware interface.
 *
 * Extends MicrophoneDeviceProvider so implementations participate in the
 * full device lifecycle (connect/disconnect, health checks, permissions,
 * events) while also exposing the voice-capture-specific API:
 * requestPermission, start, stop, cancel, onStatusChange.
 */
export interface VoiceRecorder extends MicrophoneDeviceProvider {
  readonly status: VoiceCaptureStatus;
  /** Request microphone permission. */
  requestPermission(): Promise<boolean>;
  /** Start recording. */
  start(mode: VoiceCaptureMode): Promise<void>;
  /** Stop and return the captured audio. */
  stop(): Promise<VoiceCapture>;
  /** Cancel without returning audio. */
  cancel(): Promise<void>;
  /** Subscribe to status changes. */
  onStatusChange(listener: (status: VoiceCaptureStatus) => void): () => void;
}

// ─── Transcription ────────────────────────────────────────────────────────────

export interface TranscriptionOptions {
  language?: string; // ISO 639-1 e.g. "en", "es"
  /** Hint the domain vocabulary for improved accuracy. */
  prompt?: string;
}

export interface TranscriptionResult {
  text: string;
  /**
   * Detected or forced language (ISO 639-1). Optional because VYBE's current
   * transcribeAudio() hardcodes "en" on the request side but does not return
   * a detected language — callers should not require this field.
   */
  language?: string;
  /**
   * Confidence 0–1 from the STT provider. Optional because VYBE's canonical
   * transcribeAudio() returns string | null (plain text only, no score).
   * Implementations that use Whisper verbose_json mode may populate this.
   */
  confidence?: number;
  /** Word-level timestamps, if the provider returns them. */
  words?: Array<{ word: string; startMs: number; endMs: number }>;
}

/**
 * Wraps an AIProvider to perform speech-to-text transcription.
 * The implementation builds an AIRequest with the audio attachment and calls
 * AIProviderFactory.complete() — provider selection is handled by ai-core.
 */
export interface TranscriptionService {
  transcribe(capture: VoiceCapture, options?: TranscriptionOptions): Promise<TranscriptionResult>;
}

// ─── Voice command routing ────────────────────────────────────────────────────

/**
 * A recognised voice command. The `action` string is domain-defined by the
 * consuming app (e.g. "START_STREAM", "TAKE_PHOTO", "ADD_FINDING").
 */
export interface VoiceCommand<TAction extends string = string> {
  action: TAction;
  /** Raw recognised text that triggered this command. */
  utterance: string;
  confidence: number;
  /** Extracted parameters from the utterance (e.g. { severity: "high" }). */
  parameters: Record<string, string>;
}

/**
 * Composite voice capability provider registered with the ProviderCoordinator
 * in platform-intelligence.
 *
 * A VoicePlugin assembles a VoiceProvider from a concrete VoiceRecorder and
 * TranscriptionService implementation and registers it with the coordinator.
 * WorkflowSteps access voice capabilities through the coordinator, not directly.
 */
export interface VoiceProvider {
  readonly recorder: VoiceRecorder;
  readonly transcription: TranscriptionService;
}

/**
 * Maps utterances to typed Commands.
 * The consuming app registers its own grammar; this interface stays generic.
 */
export interface VoiceCommandRouter<TAction extends string = string> {
  /**
   * Register a command pattern.
   * @param pattern  Glob-like phrase pattern, e.g. "take * photo"
   * @param action   The action to emit when the pattern matches.
   */
  register(pattern: string, action: TAction): void;

  /**
   * Attempt to route a transcription to a registered command.
   * Returns null when no pattern matches.
   */
  route(transcription: TranscriptionResult): VoiceCommand<TAction> | null;
}
