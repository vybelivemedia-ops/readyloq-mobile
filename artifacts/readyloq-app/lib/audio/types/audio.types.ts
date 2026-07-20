export interface SpeechProviderOptions {
  language?: string;
  sampleRate?: number;
  continuous?: boolean;
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
