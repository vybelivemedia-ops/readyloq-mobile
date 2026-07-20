export type { SpeechProvider } from "./providers/SpeechProvider";
export { LocalWhisperProvider } from "./providers/LocalWhisperProvider";
export { OpenAIWhisperProvider } from "./providers/OpenAIWhisperProvider";
export { AppleSpeechProvider } from "./providers/AppleSpeechProvider";

export type { SpeechProviderOptions, SpeechTranscriptionResult, AudioFrame, SpeechProviderName } from "./types/audio.types";
export type { StructuredInspectionEvent, VisionContext } from "./types/intent.types";

export { NoiseSuppression } from "./preprocessing/NoiseSuppression";
export type { AudioPreprocessor } from "./preprocessing/AudioPreprocessor";

export { VoiceActivityDetector } from "./processing/VoiceActivityDetector";
export { WakeWordEngine } from "./processing/WakeWordEngine";
export { AudioConfidence, ConfidenceAction } from "./processing/AudioConfidence";

export { SpeechIntentEngine } from "./intelligence/SpeechIntentEngine";
export { InspectionCommandParser } from "./intelligence/InspectionCommandParser";
export { INSPECTION_DICTIONARY } from "./intelligence/VocabularyRegistry";

export { AudioSessionManager } from "./AudioSessionManager";
export type { SessionStateUpdate } from "./AudioSessionManager";
