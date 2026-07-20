import { speechService } from "../../vision/speech-service";
import type { SpeechProvider, } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * Wraps the existing offline whisper.rn SpeechService as a SpeechProvider.
 * Default provider — works without internet, ~75 MB model downloaded on first use.
 */
export class LocalWhisperProvider implements SpeechProvider {
  private listener?: (result: SpeechTranscriptionResult) => void;
  private stopFn?: () => void;
  private lastConfidence = 0;

  async initialize(_options: SpeechProviderOptions): Promise<void> {
    await speechService.initialize();
  }

  async start(): Promise<void> {
    this.stopFn = await speechService.startDictation((transcript) => {
      if (!this.listener) return;
      if (transcript === "…") {
        this.listener({ text: "", confidence: 0, isFinal: false });
        return;
      }
      this.lastConfidence = 0.85;
      this.listener({ text: transcript, confidence: this.lastConfidence, isFinal: true });
    });
  }

  async stop(): Promise<void> {
    this.stopFn?.();
    this.stopFn = undefined;
  }

  async cancel(): Promise<void> {
    this.stopFn?.();
    this.stopFn = undefined;
    this.listener = undefined;
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.listener = callback;
  }

  getConfidence(): number {
    return this.lastConfidence;
  }
}
