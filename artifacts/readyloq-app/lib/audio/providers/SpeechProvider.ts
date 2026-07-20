import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

export interface SpeechProvider {
  initialize(options: SpeechProviderOptions): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void;
  getConfidence(): number;
}
