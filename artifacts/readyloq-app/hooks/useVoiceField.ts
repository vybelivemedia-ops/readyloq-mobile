import { Alert } from "react-native";
import { useState, useRef, useCallback, useEffect } from "react";
import { speechService } from "@/lib/vision";

interface UseVoiceFieldOptions {
  /** Called with the final transcript once the technician stops speaking. */
  onTranscript: (text: string) => void;
}

interface UseVoiceFieldResult {
  /** True while the microphone is actively recording. */
  isDictating: boolean;
  /** True while Whisper is processing the recorded audio (between stop and result). */
  isTranscribing: boolean;
  /** Toggle recording on/off. Handles start, stop, cleanup, and error alerting. */
  toggle: () => Promise<void>;
}

/**
 * Reusable per-field dictation hook.
 * Wraps SpeechService.startDictation so any text field can be voice-enabled
 * with a single hook call and a <VoiceMicButton> in the UI.
 *
 * @example
 * const voice = useVoiceField({ onTranscript: (t) => setSiteAddress(t) });
 * <VoiceMicButton {...voice} onPress={() => void voice.toggle()} />
 */
export function useVoiceField({ onTranscript }: UseVoiceFieldOptions): UseVoiceFieldResult {
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  const toggle = useCallback(async () => {
    if (isDictating) {
      stopRef.current?.();
      stopRef.current = null;
      setIsDictating(false);
      return;
    }

    try {
      const stop = await speechService.startDictation((transcript) => {
        if (transcript === "…") {
          setIsTranscribing(true);
          return;
        }
        setIsTranscribing(false);
        setIsDictating(false);
        stopRef.current = null;
        onTranscript(transcript);
      });
      stopRef.current = stop;
      setIsDictating(true);
    } catch (e) {
      Alert.alert(
        "Dictation unavailable",
        e instanceof Error ? e.message : "Could not start dictation.",
      );
    }
  }, [isDictating, onTranscript]);

  return { isDictating, isTranscribing, toggle };
}
