const DEFAULT_WAKE_WORDS = ["ready", "log it", "record", "note that", "add finding"];

/**
 * Detects configurable wake words / trigger phrases in a transcription stream.
 * Allows hands-free session activation without tapping the screen.
 */
export class WakeWordEngine {
  private readonly phrases: string[];

  constructor(phrases: string[] = DEFAULT_WAKE_WORDS) {
    this.phrases = phrases.map((p) => p.toLowerCase());
  }

  detect(transcript: string): { detected: boolean; phrase?: string } {
    const lower = transcript.toLowerCase();
    for (const phrase of this.phrases) {
      if (lower.includes(phrase)) {
        return { detected: true, phrase };
      }
    }
    return { detected: false };
  }

  stripWakeWord(transcript: string): string {
    let result = transcript.toLowerCase();
    for (const phrase of this.phrases) {
      result = result.replace(phrase, "").trim();
    }
    return result;
  }
}
