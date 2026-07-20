import { Platform } from "react-native";
import type { SpeechProvider } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * On-device Apple Speech Recognition (iOS only).
 * Provides continuous, real-time transcription without a downloaded model.
 * Falls back gracefully on Android — use LocalWhisperProvider there.
 */
export class AppleSpeechProvider implements SpeechProvider {
  private listener?: (result: SpeechTranscriptionResult) => void;
  private lastConfidence = 0;

  async initialize(_options: SpeechProviderOptions): Promise<void> {
    if (Platform.OS !== "ios") return;
    // Request Speech.requestAuthorization() via expo-speech or a native module.
  }

  async start(): Promise<void> {
    if (Platform.OS !== "ios") {
      throw new Error("AppleSpeechProvider is only available on iOS.");
    }
    // SFSpeechRecognizer + AVAudioEngine setup goes here.
  }

  async stop(): Promise<void> {
    // Stop the AVAudioEngine tap and finalize the recognition request.
  }

  async cancel(): Promise<void> {
    // Cancel the recognition task.
    this.listener = undefined;
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.listener = callback;
  }

  getConfidence(): number {
    return this.lastConfidence;
  }
}
