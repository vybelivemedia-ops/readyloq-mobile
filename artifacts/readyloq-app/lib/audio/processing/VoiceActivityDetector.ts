import type { AudioFrame } from "../types/audio.types";

/**
 * Distinguishes human speech from background machinery noise.
 * Prevents false-positive transcription triggers from HVAC, boilers, or impacts.
 */
export class VoiceActivityDetector {
  private readonly silenceThresholdMs: number;
  private readonly minSpeechDurationMs: number;
  private silenceAccumulatedMs = 0;
  private speechAccumulatedMs = 0;

  constructor(options: { silenceThresholdMs?: number; minSpeechDurationMs?: number } = {}) {
    this.silenceThresholdMs = options.silenceThresholdMs ?? 1500;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 300;
  }

  evaluateFrame(frame: AudioFrame): boolean {
    const isSpeech = frame.energyLevel > 0.15;

    if (isSpeech) {
      this.speechAccumulatedMs += frame.durationMs;
      this.silenceAccumulatedMs = 0;
    } else {
      this.silenceAccumulatedMs += frame.durationMs;
    }

    return isSpeech && this.speechAccumulatedMs >= this.minSpeechDurationMs;
  }

  isSilent(): boolean {
    return this.silenceAccumulatedMs >= this.silenceThresholdMs;
  }

  reset(): void {
    this.silenceAccumulatedMs = 0;
    this.speechAccumulatedMs = 0;
  }
}
