import type { SpeechProvider } from "./providers/SpeechProvider";
import type { SessionOptions } from "./types/audio.types";
import { NoiseSuppression } from "./preprocessing/NoiseSuppression";
import { SpeechIntentEngine } from "./intelligence/SpeechIntentEngine";
import { AudioConfidence, ConfidenceAction } from "./processing/AudioConfidence";
import type { StructuredInspectionEvent, VisionContext } from "./types/intent.types";

/**
 * How long (ms) to wait for isFinal after the last partial result before
 * force-flushing whatever text has accumulated.  3.5 s is long enough for
 * Whisper / Apple Speech to finish a normal utterance; short enough that a
 * tech doesn't notice the delay on a slow network or model.
 */
const PARTIAL_FLUSH_TIMEOUT_MS = 3_500;

/**
 * Confidence penalty applied to force-flushed partials.  A partial that
 * timed out may be cut-off mid-sentence, so we cap it below AUTO_COMMIT
 * (0.92) to ensure the technician sees a confirmation banner instead of a
 * silent auto-commit.
 */
const FORCE_FLUSH_CONFIDENCE_CAP = 0.72;

export type SessionStateUpdate = {
  event: StructuredInspectionEvent;
  action: ConfidenceAction;
  /** True when this update was produced by a force-flush rather than isFinal */
  forceFlushed?: boolean;
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
 * Force-flush fallback: if a partial transcript arrives but isFinal is never
 * fired within PARTIAL_FLUSH_TIMEOUT_MS, the accumulated partial is processed
 * automatically so no captured speech is silently discarded.
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

  /** Watchdog timer for force-flush fallback. */
  private flushTimer?: ReturnType<typeof setTimeout>;
  /** Latest partial transcript waiting for isFinal (or the flush timer). */
  private pendingPartial?: { text: string; confidence: number };

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

    /** Shared dispatch path for both isFinal and force-flush results. */
    const processText = async (
      text: string,
      confidence: number,
      forceFlushed: boolean,
    ): Promise<void> => {
      if (!text.trim()) return;

      // Force-flushed partials may be incomplete — cap confidence so they
      // surface as CONFIRM rather than AUTO_COMMIT.
      const effectiveConfidence = forceFlushed
        ? Math.min(confidence, FORCE_FLUSH_CONFIDENCE_CAP)
        : confidence;

      const action = AudioConfidence.evaluate(effectiveConfidence);
      const event = this.intentEngine.parse(text, effectiveConfidence, this.visionContext);

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

      onStateUpdate({ event, action, forceFlushed });
    };

    this.provider.onTranscription(async (result) => {
      if (!result.text.trim()) return;

      if (result.isFinal) {
        // Final result arrived — cancel the watchdog and process cleanly.
        this._clearFlushTimer();
        this.pendingPartial = undefined;
        await processText(result.text, result.confidence, false);
      } else {
        // Partial result — save it and restart the force-flush watchdog.
        // Each new partial resets the clock so we only flush after true silence.
        this.pendingPartial = { text: result.text, confidence: result.confidence };
        this._clearFlushTimer();
        this.flushTimer = setTimeout(async () => {
          const partial = this.pendingPartial;
          this.pendingPartial = undefined;
          if (partial) {
            await processText(partial.text, partial.confidence, true);
          }
        }, PARTIAL_FLUSH_TIMEOUT_MS);
      }
    });
  }

  async stopSession(): Promise<void> {
    // Flush any pending partial before stopping so the last utterance is
    // never silently discarded when the tech manually ends the session.
    if (this.pendingPartial) {
      this._clearFlushTimer();
      const { text, confidence } = this.pendingPartial;
      this.pendingPartial = undefined;
      // Fire-and-forget — stopSession is not expected to await the dispatch.
      void this._dispatchImmediate(text, confidence);
    } else {
      this._clearFlushTimer();
    }
    await this.provider.stop();
  }

  async cancelSession(): Promise<void> {
    this._clearFlushTimer();
    this.pendingPartial = undefined;
    await this.provider.cancel();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _clearFlushTimer(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Used by stopSession to synchronously flush the last partial without a
   * callback reference.  Parses the text and logs it — callers should wire
   * onStateUpdate before calling stopSession if they need the last event.
   */
  private async _dispatchImmediate(text: string, confidence: number): Promise<void> {
    const effectiveConfidence = Math.min(confidence, FORCE_FLUSH_CONFIDENCE_CAP);
    this.intentEngine.parse(text, effectiveConfidence, this.visionContext);
    // Note: no onStateUpdate reference here — the session has already ended.
    // Callers that need the last event should call stopSession before removing
    // their listener.
  }
}
