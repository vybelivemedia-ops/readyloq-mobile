export interface SpeechProviderOptions {
  language?: string;
  sampleRate?: number;
  continuous?: boolean;
  /**
   * Called by cloud-backed providers (e.g. OpenAIWhisperProvider) to attach
   * a Clerk bearer token to transcription requests. Pass via SessionOptions
   * so it flows through AudioSessionManager → provider.initialize().
   */
  getToken?: () => Promise<string | null>;
}

/**
 * Options for a full AudioSessionManager session.
 * Extends SpeechProviderOptions with session-level hooks.
 */
export interface SessionOptions extends SpeechProviderOptions {
  /**
   * Called at the moment of each final transcription to capture a reference frame.
   * The returned URI is merged into the StructuredInspectionEvent as imageUri.
   * Return null / undefined to skip frame attachment for this event.
   * Never throws — failures are silently swallowed so event dispatch is never blocked.
   */
  getFrame?: () => Promise<string | null | undefined>;
  /**
   * Token getter passed through to cloud-backed providers (e.g. OpenAIWhisperProvider).
   * Mirrors the SpeechProviderOptions field so callers can set it at the session level.
   */
  getToken?: () => Promise<string | null>;
}

export interface SpeechTranscriptionResult {
  text: string;
  confidence: number;
  isFinal: boolean;
}

export interface AudioFrame {
  energyLevel: number;
  durationMs: number;
  sampleRate: number;
}

export type SpeechProviderName = "local-whisper" | "openai-whisper" | "apple-speech";
