import type { UseVoiceRecognitionOptions, UseVoiceRecognitionResult } from "./useVoiceRecognition.types";

// Web stub — on-device speech recognition is a native-only capability. The web
// build never loads expo-speech-recognition, so this is a permanent no-op.
export function useVoiceRecognition(_options: UseVoiceRecognitionOptions): UseVoiceRecognitionResult {
  return { isSupported: false, isListening: false, error: null };
}
