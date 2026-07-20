import type { SpeechProvider } from "./providers/SpeechProvider";
import type { SessionOptions } from "./types/audio.types";
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
 * Supports an optional getFrame hook so the live camera frame is atomically
 * bundled into every StructuredInspectionEvent at the moment of transcription.
 *
 * @example
 * const manager = new AudioSessionManager(new LocalWhisperProvider());
 * await manager.startSession(
 *   (update) => {
 *     if (update.action === ConfidenceAction.AUTO_COMMIT) saveFinding(update.event);
 *   },
 *   { getFrame: () => cameraRef.current?.takePictureAsync({ quality: 0.1 }) },
 * );
 * await manager.stopSession();
 */
export class AudioSessionManager {
  private readonly preprocessor = new NoiseSuppression();
  private readonly intentEngine = new SpeechIntentEngine();
  private visionContext?: VisionContext;

  constructor(private readonly provider: SpeechProvider) {}

  /**
   * Merges ctx into the current vision context (additive — existing fields are
   * preserved unless explicitly overwritten by the caller).
   */
  setVisionContext(ctx: VisionContext): void {
    this.visionContext = { ...this.visionContext, ...ctx };
  }

  async startSession(
    onStateUpdate: (update: SessionStateUpdate) => void,
    options: SessionOptions = {},
  ): Promise<void> {
    const { getFrame, ...providerOptions } = options;
    await this.provider.initialize(providerOptions);
    await this.provider.start();

    this.provider.onTranscription(async (result) => {
      if (!result.isFinal || !result.text.trim()) return;

      const action = AudioConfidence.evaluate(result.confidence);
      const event = this.intentEngine.parse(
        result.text,
        result.confidence,
        this.visionContext,
      );

      // Capture the live camera frame at the exact moment of this command.
      // Best-effort: a failure here never blocks event dispatch.
      if (getFrame) {
        try {
          const uri = await getFrame();
          if (uri) event.imageUri = uri;
        } catch {
          // intentionally swallowed
        }
      }

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
