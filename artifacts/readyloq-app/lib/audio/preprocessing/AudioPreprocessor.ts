export interface AudioPreprocessor {
  process(rawAudioBuffer: ArrayBuffer): Promise<ArrayBuffer>;
}
