import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE } from "../../api";
import type { SpeechProvider } from "./SpeechProvider";
import type { SpeechProviderOptions, SpeechTranscriptionResult } from "../types/audio.types";

/**
 * Cloud-backed Whisper provider via the ReadyLoq API server.
 * Records AAC/M4A audio on-device with expo-av, then POSTs it to
 * /api/transcribe (which proxies to OpenAI's Whisper model).
 *
 * Higher accuracy for short commands than the tiny local model but requires
 * a network round-trip (~1–3 s on LTE). Used as fallback when the local
 * offline model fails to initialise (no storage, download error, etc.).
 */
// The SDK's supported AAC/MPEG-4 preset already uses .m4a on Android/iOS.
const RECORDING_OPTIONS = Audio.RecordingOptionsPresets.HIGH_QUALITY;

export class OpenAIWhisperProvider implements SpeechProvider {
  private generation = 0;
  private recording?: Audio.Recording;
  private confidenceScore = 0;
  private listener?: (result: SpeechTranscriptionResult) => void;
  private cancelled = false;
  private getToken?: () => Promise<string | null>;
  private request?: AbortController;

  async initialize(options: SpeechProviderOptions): Promise<void> {
    this.getToken = options.getToken;
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      throw new Error("[OpenAIWhisperProvider] Microphone permission not granted.");
    }
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    this.cancelled = false;
    const recording = new Audio.Recording();
    this.recording = recording;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      if (generation !== this.generation) return;
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      if (generation !== this.generation) return;
      await recording.startAsync();
      if (generation !== this.generation) {
        await recording.stopAndUnloadAsync().catch(() => {});
        const uri = recording.getURI();
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        return;
      }
      this.recording = recording;
    } catch (error) {
      await recording.stopAndUnloadAsync().catch(() => {});
      if (this.recording === recording) this.recording = undefined;
      const uri = recording.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      throw error;
    } finally {
      if (generation !== this.generation) {
        await recording.stopAndUnloadAsync().catch(() => {});
        if (this.recording === recording) this.recording = undefined;
        const uri = recording.getURI();
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      }
    }
  }

  async stop(): Promise<void> {
    const generation = this.generation;
    const listener = this.listener;
    const recording = this.recording;
    this.recording = undefined;
    if (!recording) return;

    let uri: string | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const request = new AbortController();
    this.request = request;
    let timedOut = false;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      uri = recording.getURI();
      if (generation !== this.generation || this.cancelled || !listener) return;
      if (!uri) throw new Error("Voice recording did not produce an audio file. Please retry.");
      deadline = setTimeout(() => { timedOut = true; request.abort(); }, 30_000);
      const base64 = await withAbort(FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      }), request.signal);

      const token = await withAbort(this.getToken?.() ?? Promise.resolve(null), request.signal);
      if (!token) throw new Error("Sign in again to use cloud Voice Capture.");
      const res = await withAbort(fetch(`${API_BASE}/api/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ audio: base64, mimeType: "audio/mp4" }),
        signal: request.signal,
      }), request.signal);

      if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
      const { text } = await withAbort(res.json(), request.signal) as { text?: unknown };
      if (typeof text !== "string") throw new Error("Voice transcription returned an invalid response.");
      // Evidence persistence is not subject to the network deadline.
      clearTimeout(deadline);

      if (generation === this.generation && text.trim() && !this.cancelled && listener) {
        this.confidenceScore = 0.88;
        await listener({ text: text.trim(), confidence: this.confidenceScore, isFinal: true });
      }
    } catch (e) {
      if (generation !== this.generation || this.cancelled) return;
      if (timedOut) throw new Error("Voice transcription timed out. Check your connection and retry.");
      throw e;
    } finally {
      if (deadline) clearTimeout(deadline);
      if (this.request === request) this.request = undefined;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      uri ??= recording.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }

  async cancel(): Promise<void> {
    this.generation += 1;
    this.cancelled = true;
    this.request?.abort();
    this.listener = undefined;
    const recording = this.recording;
    this.recording = undefined;
    try {
      if (recording) await recording.stopAndUnloadAsync().catch(() => {});
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      const uri = recording?.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }

  onTranscription(callback: (result: SpeechTranscriptionResult) => void): void {
    this.listener = callback;
  }

  getConfidence(): number {
    return this.confidenceScore;
  }
}

/** Bound native/token/network waits even when a mocked/native promise ignores abort. */
function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("Voice Capture cancelled.")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) {
      // A token/native call may already be underway when backgrounding
      // aborts synchronously. Still consume its eventual rejection.
      void work.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}
