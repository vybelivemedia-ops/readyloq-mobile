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
  /** Frame-only follow-up; consumers must not apply the inspection action twice. */
  contextOnly?: boolean;
};

// Preserve synchronous callback compatibility (including Array.push returns),
// while awaiting a Promise returned by an asynchronous evidence consumer.
type SessionConsumer = (update: SessionStateUpdate) => unknown;

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

  /**
   * Stored references so stopSession's force-flush can dispatch properly.
   * Cleared on cancelSession so a stale callback never fires after the screen unmounts.
   */
  private _onStateUpdate?: SessionConsumer;
  private _getFrame?: () => Promise<string | null | undefined>;
  private _sessionGeneration = 0;
  private pendingDispatches = new Set<Promise<void>>();
  private dispatchError: unknown;
  private stopping?: Promise<void>;
  private photoDispatchedGeneration?: number;

  constructor(private readonly provider: SpeechProvider) {}

  /**
   * Merges ctx into the current vision context (additive — existing fields are
   * preserved unless explicitly overwritten by the caller).
   */
  setVisionContext(ctx: VisionContext): void {
    this.visionContext = { ...this.visionContext, ...ctx };
  }

  async startSession(
    onStateUpdate: SessionConsumer,
    options: SessionOptions = {},
  ): Promise<void> {
    const { getFrame, ...providerOptions } = options;
    // Store for use by stopSession's force-flush path.
    this._onStateUpdate = onStateUpdate;
    this._getFrame = getFrame;
    this.dispatchError = undefined;
    const sessionGeneration = ++this._sessionGeneration;
    await this.provider.initialize(providerOptions);
    if (sessionGeneration !== this._sessionGeneration) return;
    /** Shared dispatch path for both isFinal and force-flush results. */
    const processText = async (
      text: string,
      confidence: number,
      forceFlushed: boolean,
    ): Promise<void> => {
      if (sessionGeneration !== this._sessionGeneration) return;
      if (!text.trim()) return;

      // Force-flushed partials may be incomplete — cap confidence so they
      // surface as CONFIRM rather than AUTO_COMMIT.
      const effectiveConfidence = forceFlushed
        ? Math.min(confidence, FORCE_FLUSH_CONFIDENCE_CAP)
        : confidence;

      const action = AudioConfidence.evaluate(effectiveConfidence);
      const event = this.intentEngine.parse(text, effectiveConfidence, this.visionContext);
      if (!this.claimPhoto(event, action, sessionGeneration)) return;

      // Apply the command immediately. Camera context is a best-effort follow-up
      // and must never delay field updates, notes, or a voice-triggered shutter.
      if (sessionGeneration !== this._sessionGeneration) return;
      const applied = onStateUpdate({ event, action, forceFlushed });
      this._attachFrameAsync(
        event,
        action,
        forceFlushed,
        onStateUpdate,
        getFrame,
        sessionGeneration,
      );
      await applied;
    };

    this.provider.onTranscription(async (result) => {
      if (sessionGeneration !== this._sessionGeneration) return;
      if (!result.text.trim()) return;

      if (result.isFinal) {
        // Final result arrived — cancel the watchdog and process cleanly.
        this._clearFlushTimer();
        this.pendingPartial = undefined;
        await this.trackDispatch(processText(result.text, result.confidence, false), sessionGeneration);
      } else {
        // Partial result — save it and restart the force-flush watchdog.
        // Each new partial resets the clock so we only flush after true silence.
        this.pendingPartial = { text: result.text, confidence: result.confidence };
        this._clearFlushTimer();
        this.flushTimer = setTimeout(async () => {
          if (sessionGeneration !== this._sessionGeneration) return;
          const partial = this.pendingPartial;
          this.pendingPartial = undefined;
          if (partial) {
            await this.trackDispatch(processText(partial.text, partial.confidence, true), sessionGeneration);
          }
        }, PARTIAL_FLUSH_TIMEOUT_MS);
      }
    });
    // Install the listener BEFORE native recording can deliver callbacks.
    await this.provider.start();
    if (sessionGeneration !== this._sessionGeneration && !this._onStateUpdate) {
      await this.provider.cancel();
    }
  }

  private claimPhoto(event: StructuredInspectionEvent, action: ConfidenceAction, generation: number): boolean {
    if (!event.capturePhoto || action === ConfidenceAction.ASK_AGAIN) return true;
    if (this.photoDispatchedGeneration === generation) return false;
    this.photoDispatchedGeneration = generation;
    return true;
  }

  stopSession(): Promise<void> {
    if (this.stopping) return this.stopping;
    const generation = this._sessionGeneration;
    this.stopping = this.finishSession(generation).finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  private async finishSession(generation: number): Promise<void> {
    this._clearFlushTimer();
    try {
      // Batch providers emit their final transcript DURING stop(). Keep this
      // generation valid until transcription and durable command work finish.
      await this.provider.stop();
      if (generation !== this._sessionGeneration) return;
      this._clearFlushTimer();
      if (this.pendingPartial) {
        const { text, confidence } = this.pendingPartial;
        this.pendingPartial = undefined;
        await this.trackDispatch(this._dispatchImmediate(text, confidence), generation);
      }
      while (this.pendingDispatches.size && generation === this._sessionGeneration) {
        await Promise.all([...this.pendingDispatches]);
      }
      if (generation === this._sessionGeneration && this.dispatchError !== undefined) {
        throw this.dispatchError;
      }
    } finally {
      if (generation === this._sessionGeneration) {
        this._sessionGeneration += 1;
        this._clearFlushTimer();
        this.pendingPartial = undefined;
        this._onStateUpdate = undefined;
        this._getFrame = undefined;
      }
    }
  }

  private trackDispatch(work: Promise<void>, generation: number): Promise<void> {
    const tracked = work.catch((error: unknown) => {
      if (generation === this._sessionGeneration) this.dispatchError = error;
    }).finally(() => this.pendingDispatches.delete(tracked));
    this.pendingDispatches.add(tracked);
    return tracked;
  }

  async cancelSession(): Promise<void> {
    this._sessionGeneration += 1;
    this._clearFlushTimer();
    this.pendingPartial = undefined;
    // Clear stored callbacks so a stale reference never fires after unmount.
    this._onStateUpdate = undefined;
    this._getFrame = undefined;
    try {
      await this.provider.cancel();
    } finally {
      // Do not let a restarted session reuse a provider whose old stop still
      // owns native recording/transcription work.
      await this.stopping?.catch(() => {});
    }
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
   * Used by stopSession to flush the last partial.  Dispatches properly via
   * the stored _onStateUpdate and _getFrame so the final utterance is never
   * silently lost and still gets a room-frame attachment if the buffer has one.
   */
  private async _dispatchImmediate(text: string, confidence: number): Promise<void> {
    if (!this._onStateUpdate) return;
    const sessionGeneration = this._sessionGeneration;
    const effectiveConfidence = Math.min(confidence, FORCE_FLUSH_CONFIDENCE_CAP);
    const action = AudioConfidence.evaluate(effectiveConfidence);
    const event = this.intentEngine.parse(text, effectiveConfidence, this.visionContext);
    if (!this.claimPhoto(event, action, sessionGeneration)) return;
    const applied = this._onStateUpdate({ event, action, forceFlushed: true });
    this._attachFrameAsync(
      event,
      action,
      true,
      this._onStateUpdate,
      this._getFrame,
      sessionGeneration,
    );
    await applied;
  }

  private _attachFrameAsync(
    event: StructuredInspectionEvent,
    action: ConfidenceAction,
    forceFlushed: boolean,
    onStateUpdate: SessionConsumer,
    getFrame?: () => Promise<string | null | undefined>,
    sessionGeneration?: number,
  ): void {
    if (!getFrame) return;
    void getFrame()
      .then((uri) => {
        // cancelSession clears the active callback. Do not update an unmounted
        // screen or a newer session after a delayed frame resolves.
        if (
          !uri ||
          this._onStateUpdate !== onStateUpdate ||
          sessionGeneration !== this._sessionGeneration
        ) return;
        return onStateUpdate({
          event: { ...event, imageUri: uri },
          action,
          forceFlushed,
          contextOnly: true,
        });
      })
      .catch(() => {
        // Best-effort context only; command dispatch already succeeded.
      });
  }
}
