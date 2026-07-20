import type { SpeechProvider } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * Cloud-backed Whisper provider via OpenAI API.
 * Requires a valid OPENAI_API_KEY in the environment.
 * Higher accuracy but requires network; use as fallback or for post-session review.
 */
export class OpenAIWhisperProvider implements SpeechProvider {
  private confidenceScore = 0;
  private listener?: (result: SpeechTranscriptionResult) => void;

  async initialize(_options: SpeechProviderOptions): Promise<void> {
    // No local model to load — API key validation happens at first transcription call.
  }

  async start(): Promise<void> {
    // Audio capture would begin here.
    // In production: open a MediaStream, chunk into 30 s segments, POST to /v1/audio/transcriptions.
  }

  async stop(): Promise<void> {
    // Flush the current audio buffer and await the final transcription response.
  }

  async cancel(): Promise<void> {
    // Abort any in-flight fetch requests.
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.listener = callback;
  }

  getConfidence(): number {
    return this.confidenceScore;
  }
}
