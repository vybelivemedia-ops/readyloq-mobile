import type { SpeechProvider } from "./providers/SpeechProvider";
import type { SpeechProviderOptions } from "./types/audio.types";
import { NoiseSuppression } from "./preprocessing/NoiseSuppression";
import { SpeechIntentEngine } from "./intelligence/SpeechIntentEngine";
import { AudioConfidence, ConfidenceAction } from "./processing/AudioConfidence";
import type { StructuredInspectionEvent, VisionContext } from "./types/intent.types";

export type SessionStateUpdate = {
  event: StructuredInspectionEvent;
  action: ConfidenceAction;
};

/**
 * Orchestrates an audio capture session:
 *   start → transcription → intent → confidence → callback
 *
 * Supports an optional visionContext so co-pilot commands like
 * "another one here" or "seal this" resolve against what the camera sees.
 *
 * @example
 * const manager = new AudioSessionManager(new LocalWhisperProvider());
 * await manager.startSession((update) => {
 *   if (update.action === ConfidenceAction.AUTO_COMMIT) saveFindig(update.event);
 * });
 * await manager.stopSession();
 */
export class AudioSessionManager {
  private readonly preprocessor = new NoiseSuppression();
  private readonly intentEngine = new SpeechIntentEngine();
  private visionContext?: VisionContext;

  constructor(private readonly provider: SpeechProvider) {}

  setVisionContext(ctx: VisionContext): void {
    this.visionContext = ctx;
  }

  async startSession(
    onStateUpdate: (update: SessionStateUpdate) => void,
    options: SpeechProviderOptions = {},
  ): Promise<void> {
    await this.provider.initialize(options);
    await this.provider.start();

    this.provider.onTranscription(async (result) => {
      if (!result.isFinal || !result.text.trim()) return;

      const action = AudioConfidence.evaluate(result.confidence);
      const event = this.intentEngine.parse(
        result.text,
        result.confidence,
        this.visionContext,
      );

      onStateUpdate({ event, action });
    });
  }

  async stopSession(): Promise<void> {
    await this.provider.stop();
  }

  async cancelSession(): Promise<void> {
    await this.provider.cancel();
  }
}
