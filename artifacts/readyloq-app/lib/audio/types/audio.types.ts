export interface SpeechProviderOptions {
  language?: string;
  sampleRate?: number;
  continuous?: boolean;
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
