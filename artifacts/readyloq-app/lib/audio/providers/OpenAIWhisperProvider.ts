import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE } from "../../api";
import type { SpeechProvider } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * Cloud-backed Whisper provider via the ReadyLoq API server.
 * Records audio on-device with expo-av, then POSTs the WAV to
 * /api/transcribe (which proxies to OpenAI's Whisper model).
 *
 * Higher accuracy for short commands than the tiny local model but requires
 * a network round-trip (~1–3 s on LTE). Used as fallback when the local
 * offline model fails to initialise (no storage, download error, etc.).
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    extension: ".wav",
    sampleRate: 16000,
    numberOfChannels: 1,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    extension: ".wav",
    sampleRate: 16000,
    numberOfChannels: 1,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export class OpenAIWhisperProvider implements SpeechProvider {
  private recording?: Audio.Recording;
  private confidenceScore = 0;
  private listener?: (result: SpeechTranscriptionResult) => void;
  private cancelled = false;
  private getToken?: () => Promise<string | null>;

  async initialize(options: SpeechProviderOptions): Promise<void> {
    this.getToken = options.getToken;
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      throw new Error("[OpenAIWhisperProvider] Microphone permission not granted.");
    }
  }

  async start(): Promise<void> {
    this.cancelled = false;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
    this.recording = recording;
  }

  async stop(): Promise<void> {
    const recording = this.recording;
    this.recording = undefined;
    if (!recording) return;

    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});

    if (this.cancelled || !this.listener) return;

    const uri = recording.getURI();
    if (!uri) return;

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const token = await this.getToken?.();
      const res = await fetch(`${API_BASE}/api/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ audio: base64, mimeType: "audio/wav" }),
      });

      if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
      const { text } = (await res.json()) as { text: string };

      if (text.trim() && !this.cancelled) {
        this.confidenceScore = 0.88;
        this.listener({ text: text.trim(), confidence: this.confidenceScore, isFinal: true });
      }
    } catch (e) {
      console.warn("[OpenAIWhisperProvider] Transcription error:", e);
    } finally {
      // Clean up the temp recording file
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    const recording = this.recording;
    this.recording = undefined;
    if (recording) {
      await recording.stopAndUnloadAsync().catch(() => {});
    }
    this.listener = undefined;
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.listener = callback;
  }

  getConfidence(): number {
    return this.confidenceScore;
  }
}
