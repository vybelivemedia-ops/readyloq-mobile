import { initWhisper, WhisperContext } from 'whisper.rn';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { BILINGUAL_PEST_JARGON_PROMPT } from './pest-jargon';

const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const MODEL_FILE_PATH = `${FileSystem.documentDirectory}ggml-tiny.bin`;

/**
 * Whisper tiny model — multilingual (~75 MB), good enough for field notes.
 * Optimal recording: 16 kHz, mono, WAV (matches the model's training data).
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

class SpeechService {
  private whisperContext: WhisperContext | null = null;
  private initializing?: Promise<void>;

  /**
   * Initialises the Whisper model.
   * Call once during app startup or when a technician opens an inspection.
   * Downloads the ~75 MB tiny model on first run (Wi-Fi recommended).
   */
  initialize(): Promise<void> {
    if (this.whisperContext) return Promise.resolve();
    if (!this.initializing) {
      this.initializing = this.loadModel().finally(() => { this.initializing = undefined; });
    }
    return this.initializing;
  }

  private async loadModel(): Promise<void> {
    const fileInfo = await FileSystem.getInfoAsync(MODEL_FILE_PATH);

    if (!fileInfo.exists) {
      console.log('[SpeechService] Downloading offline speech model (one-time)…');

      const result = await FileSystem.downloadAsync(MODEL_URL, MODEL_FILE_PATH);

      if (result.status !== 200) {
        throw new Error(
          `[SpeechService] Model download failed (HTTP ${result.status})`
        );
      }
      console.log('[SpeechService] Model downloaded.');
    }

    console.log('[SpeechService] Initialising Whisper context…');
    this.whisperContext = await initWhisper({ filePath: MODEL_FILE_PATH });
    console.log('[SpeechService] Ready.');
  }

  /** Whether the model is loaded and ready. */
  get isReady(): boolean {
    return this.whisperContext !== null;
  }

  /**
   * Starts a dictation session. The technician speaks; the note is transcribed
   * when they tap Stop.  Works offline, English and Spanish.
   *
   * @param onProgress  Called with the transcript once processing is complete.
   *                    Also called with `'…'` while processing so the UI can show a spinner.
   * @returns           A stop function — call it when the tech taps Stop.
   *
   * @example
   * const stop = await speechService.startDictation((text) => setNote(text));
   * // technician speaks…
   * stop();
   */
  async startDictation(
    onProgress: (transcript: string) => void | Promise<void>,
    options: { throwOnError?: boolean } = {},
  ): Promise<(options?: { cancel?: boolean }) => Promise<void>> {
    if (!this.whisperContext) {
      throw new Error('[SpeechService] Not initialised — call initialize() first.');
    }

    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('[SpeechService] Microphone permission not granted.');
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const recording = new Audio.Recording();
    try {
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
    } catch (error) {
      await recording.stopAndUnloadAsync().catch(() => {});
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      const uri = recording.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw error;
    }
    console.log('[SpeechService] Recording started.');

    let stopPromise: Promise<void> | undefined;
    let cancelled = false;
    let stopTranscription: (() => Promise<void>) | undefined;

    const stop = (stopOptions?: { cancel?: boolean }) => {
      if (stopOptions?.cancel) {
        cancelled = true;
        void stopTranscription?.().catch(() => {});
      }
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        let fileUri: string | null = null;
        try {
          await recording.stopAndUnloadAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

          fileUri = recording.getURI();
          if (cancelled) return;
          if (!fileUri) {
            throw new Error("Voice recording did not produce an audio file.");
          }

          await onProgress('…');

          const ctx = this.whisperContext;
          if (!ctx) throw new Error("Local voice model is unavailable.");

          const task = ctx.transcribe(fileUri, {
            language: 'auto',
            translate: false,
            initialPrompt: `Multilingual pest-control inspection; preserve the spoken languages and code-switching. ${BILINGUAL_PEST_JARGON_PROMPT}`,
          } as Parameters<typeof ctx.transcribe>[1]);

          stopTranscription = task.stop;
          if (cancelled) await task.stop();
          const result = await task.promise;
          const transcript = result.result?.trim() || (result.segments ?? [])
            .map((s: { text: string }) => s.text)
            .join(' ')
            .trim();

          if (!cancelled && transcript.length > 0) {
            await onProgress(transcript);
          }

        } catch (err) {
          if (!cancelled) {
            console.error('[SpeechService] Transcription error:', err);
            if (options.throwOnError) throw err;
          }
        } finally {
          stopTranscription = undefined;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
          fileUri ??= recording.getURI();
          if (fileUri) await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
        }
      })();
      return stopPromise;
    };

    return stop;
  }
}

export const speechService = new SpeechService();
