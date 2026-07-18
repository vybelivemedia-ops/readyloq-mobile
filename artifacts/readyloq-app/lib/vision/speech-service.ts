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
  private isDownloading = false;

  /**
   * Initialises the Whisper model.
   * Call once during app startup or when a technician opens an inspection.
   * Downloads the ~75 MB tiny model on first run (Wi-Fi recommended).
   */
  async initialize(): Promise<void> {
    if (this.whisperContext) return;

    const fileInfo = await FileSystem.getInfoAsync(MODEL_FILE_PATH);

    if (!fileInfo.exists) {
      if (this.isDownloading) return;
      this.isDownloading = true;
      console.log('[SpeechService] Downloading offline speech model (one-time)…');

      const result = await FileSystem.downloadAsync(MODEL_URL, MODEL_FILE_PATH);
      this.isDownloading = false;

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
    onProgress: (transcript: string) => void,
  ): Promise<() => void> {
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
    await recording.prepareToRecordAsync(RECORDING_OPTIONS);
    await recording.startAsync();
    console.log('[SpeechService] Recording started.');

    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;

      (async () => {
        try {
          await recording.stopAndUnloadAsync();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

          const fileUri = recording.getURI();
          if (!fileUri) {
            console.warn('[SpeechService] No recording file URI after stop.');
            return;
          }

          onProgress('…');

          const ctx = this.whisperContext;
          if (!ctx) return;

          const { promise } = ctx.transcribe(fileUri, {
            language: 'auto',
            initialPrompt: BILINGUAL_PEST_JARGON_PROMPT,
          } as Parameters<typeof ctx.transcribe>[1]);

          const result = await promise;
          const transcript = (result.segments ?? [])
            .map((s: { text: string }) => s.text)
            .join(' ')
            .trim();

          if (transcript.length > 0) {
            onProgress(transcript);
          }

          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (err) {
          console.error('[SpeechService] Transcription error:', err);
        }
      })();
    };

    return stop;
  }
}

export const speechService = new SpeechService();
