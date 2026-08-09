import { LocalWhisperProvider } from "./LocalWhisperProvider";
import { OpenAIWhisperProvider } from "./OpenAIWhisperProvider";
import type { SpeechProvider } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * Composite provider that tries the offline LocalWhisperProvider first.
 * If the local model fails to initialise (storage full, download error,
 * corrupted cache), it falls back to OpenAIWhisperProvider which records
 * audio on-device and transcribes via the ReadyLoq API server.
 *
 * Fallback is determined once at initialise() time and stays fixed for
 * the lifetime of the session — no mid-session provider switching.
 *
 * Usage:
 *   const manager = new AudioSessionManager(new FallbackSpeechProvider());
 *   await manager.startSession(handler, { getToken: () => getToken() });
 */
export class FallbackSpeechProvider implements SpeechProvider {
  private active?: SpeechProvider;
  private readonly local = new LocalWhisperProvider();
  private readonly cloud = new OpenAIWhisperProvider();
  private usingFallback = false;

  async initialize(options: SpeechProviderOptions): Promise<void> {
    try {
      await this.local.initialize(options);
      this.active = this.local;
      this.usingFallback = false;
      console.log("[FallbackSpeechProvider] Using local Whisper model.");
    } catch (localErr) {
      console.warn(
        "[FallbackSpeechProvider] Local model unavailable — falling back to cloud:",
        localErr,
      );
      await this.cloud.initialize(options);
      this.active = this.cloud;
      this.usingFallback = true;
      console.log("[FallbackSpeechProvider] Using OpenAI cloud transcription.");
    }
  }

  async start(): Promise<void> {
    return this.active?.start();
  }

  async stop(): Promise<void> {
    return this.active?.stop();
  }

  async cancel(): Promise<void> {
    return this.active?.cancel();
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.active?.onTranscription(callback);
  }

  getConfidence(): number {
    return this.active?.getConfidence() ?? 0;
  }

  /** True if the local model was unavailable and cloud fallback is active. */
  get isUsingFallback(): boolean {
    return this.usingFallback;
  }
}
