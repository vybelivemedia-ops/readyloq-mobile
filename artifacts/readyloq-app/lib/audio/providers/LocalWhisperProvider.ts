import { speechService } from "../../vision/speech-service";
import type { SpeechProvider, } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * Wraps the existing offline whisper.rn SpeechService as a SpeechProvider.
 * Default provider — works without internet, ~75 MB model downloaded on first use.
 */
export class LocalWhisperProvider implements SpeechProvider {
  private generation = 0;
  private listener?: (result: SpeechTranscriptionResult) => void;
  private stopFn?: (options?: { cancel?: boolean }) => Promise<void>;
  private lastConfidence = 0;

  async initialize(_options: SpeechProviderOptions): Promise<void> {
    await speechService.initialize();
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    const stop = await speechService.startDictation(async (transcript) => {
      if (generation !== this.generation || !this.listener) return;
      if (transcript === "…") {
        this.listener({ text: "", confidence: 0, isFinal: false });
        return;
      }
      this.lastConfidence = 0.85;
      await this.listener({ text: transcript, confidence: this.lastConfidence, isFinal: true });
    }, { throwOnError: true });
    if (generation !== this.generation) {
      await stop({ cancel: true });
      return;
    }
    this.stopFn = stop;
  }

  async stop(): Promise<void> {
    const stop = this.stopFn;
    try { await stop?.(); }
    finally { if (this.stopFn === stop) this.stopFn = undefined; }
  }

  async cancel(): Promise<void> {
    this.generation += 1;
    const stop = this.stopFn;
    this.stopFn = undefined;
    this.listener = undefined;
    await stop?.({ cancel: true });
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.listener = callback;
  }

  getConfidence(): number {
    return this.lastConfidence;
  }
}
