import type { AudioSessionManager, SessionStateUpdate } from "./AudioSessionManager";
import type { SessionOptions } from "./types/audio.types";
import type { FrameBuffer } from "../voice-context/frame-buffer";

export type VoiceCapturePhase = "idle" | "starting" | "recording" | "processing";

/**
 * startSession means "microphone ready", not "recording ended".
 * Temporary context belongs to this recording and is released only after its
 * final transcript/command consumer finishes. No context frame is evidence.
 */
export class VoiceCaptureSession {
  phase: VoiceCapturePhase = "idle";
  private generation = 0;
  private starting?: Promise<void>;
  private cancellation?: Promise<void>;

  get generationId(): number { return this.generation; }

  constructor(
    private readonly manager: AudioSessionManager,
    private readonly frames: FrameBuffer,
    private readonly onPhase: (phase: VoiceCapturePhase) => void,
  ) {}

  private setPhase(phase: VoiceCapturePhase): void {
    this.phase = phase;
    this.onPhase(phase);
  }

  async start(
    consumer: (update: SessionStateUpdate) => void | Promise<void>,
    options: SessionOptions,
  ): Promise<void> {
    if (this.phase !== "idle") return;
    const generation = ++this.generation;
    this.setPhase("starting");
    try {
      // A rapid return to capture must not start a second native recorder while
      // the cancelled one is still starting/stopping.
      await this.cancellation;
      if (generation !== this.generation) return;
      const starting = this.manager.startSession(
        (update) => generation === this.generation ? consumer(update) : undefined,
        options,
      );
      this.starting = starting;
      await starting;
      if (this.starting === starting) this.starting = undefined;
      if (generation !== this.generation) return;
      this.frames.start();
      this.setPhase("recording");
    } catch (error) {
      if (generation !== this.generation) return;
      if (generation === this.generation) {
        this.frames.stop();
        try { await this.manager.cancelSession(); }
        finally { this.setPhase("idle"); }
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.phase !== "recording") return;
    const generation = this.generation;
    this.setPhase("processing");
    this.frames.pause?.();
    try {
      await this.manager.stopSession();
    } finally {
      if (generation === this.generation) {
        this.frames.stop();
        this.setPhase("idle");
      }
    }
  }

  cancel(): Promise<void> {
    this.generation += 1;
    this.frames.stop();
    this.setPhase("idle");
    const starting = this.starting;
    const cancelled = this.manager.cancelSession().finally(async () => {
      await starting?.catch(() => {});
    });
    // A future start waits for cleanup, but does not inherit its error.
    this.cancellation = cancelled.catch(() => {});
    return cancelled;
  }
}
