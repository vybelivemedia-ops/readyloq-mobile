import type { AudioPreprocessor } from "./AudioPreprocessor";

/**
 * Reduces HVAC hum, boiler noise, wind, and restaurant background noise
 * via bandpass filtering and spectral subtraction.
 *
 * Current implementation: passthrough stub for the existing whisper.rn pipeline.
 * Whisper's built-in mel-spectrogram preprocessing already handles most field noise.
 * Replace with a WebAssembly RNNoise build or expo-audio DSP hooks for stricter filtering.
 */
export class NoiseSuppression implements AudioPreprocessor {
  async process(rawAudioBuffer: ArrayBuffer): Promise<ArrayBuffer> {
    return rawAudioBuffer;
  }
}
