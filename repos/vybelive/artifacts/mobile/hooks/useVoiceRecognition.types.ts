import type { RecognitionSensitivity } from "@workspace/api-client-react";

export interface VoiceTrigger {
  phrase: string;
  transcript: string;
  confidence: number;
}

export interface UseVoiceRecognitionOptions {
  // Master gate — recognition only runs while true (e.g. live + opted-in +
  // settings.voiceEnabled). Toggling to false fully stops the recognizer.
  enabled: boolean;
  // Trigger phrases the creator configured. Matching is case-insensitive.
  phrases: string[];
  sensitivity: RecognitionSensitivity;
  // Fired (debounced) when a configured phrase is detected in the transcript.
  onTrigger: (trigger: VoiceTrigger) => void;
}

export interface UseVoiceRecognitionResult {
  // True only on a native dev build where the speech module is registered.
  isSupported: boolean;
  // True while the recognizer is actively listening.
  isListening: boolean;
  error: string | null;
}
