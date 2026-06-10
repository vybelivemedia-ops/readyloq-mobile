import { useState, useRef, useCallback } from "react";

type RecognitionState = "idle" | "listening" | "processing" | "done" | "unsupported";

interface UseVoiceRecognitionOptions {
  lang?: string;
  onFinalResult?: (transcript: string) => void;
  onInterimResult?: (transcript: string) => void;
}

export function useVoiceRecognition({
  lang = "en-US",
  onFinalResult,
  onInterimResult,
}: UseVoiceRecognitionOptions = {}) {
  const [state, setState] = useState<RecognitionState>("idle");
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<any>(null);

  const isSupported = typeof window !== "undefined" &&
    !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = useCallback(() => {
    if (!isSupported) {
      setState("unsupported");
      return;
    }
    const SR = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState("listening");
      setInterim("");
    };

    recognition.onresult = (event: any) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (interimText) {
        setInterim(interimText);
        onInterimResult?.(interimText);
      }
      if (finalText) {
        setInterim(finalText);
        setState("processing");
        onFinalResult?.(finalText.trim());
      }
    };

    recognition.onerror = () => setState("idle");
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        setState(s => s === "listening" ? "idle" : s);
      }
    };

    try {
      recognition.start();
    } catch {
      setState("idle");
    }
  }, [lang, isSupported, onFinalResult, onInterimResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setState("idle");
    setInterim("");
  }, []);

  const reset = useCallback(() => {
    recognitionRef.current?.abort();
    setState("idle");
    setInterim("");
  }, []);

  return { state, interim, isSupported, start, stop, reset };
}
