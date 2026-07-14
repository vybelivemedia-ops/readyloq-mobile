import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";

import type {
  UseVoiceRecognitionOptions,
  UseVoiceRecognitionResult,
} from "./useVoiceRecognition.types";

// True inside Expo Go (storeClient). The native speech module is not bundled
// there, so we must never require() it — recognition only runs in a dev build.
const isExpoGo = Constants.appOwnership === "expo";

// Suppress repeat fires from the same utterance (interim + final + echoes).
const DEBOUNCE_MS = 4000;
// After the recognizer ends (silence/timeout) restart it while still enabled.
const RESTART_DELAY_MS = 400;

// How strict phrase matching is. Higher sensitivity = easier to trigger
// (accepts interim transcripts and partial token overlap); lower sensitivity
// requires a final transcript containing the full phrase with good confidence.
function matchConfig(sensitivity: UseVoiceRecognitionOptions["sensitivity"]) {
  switch (sensitivity) {
    case "high":
      return { minTokenRatio: 0.6, minConfidence: 0, requireFinal: false };
    case "low":
      return { minTokenRatio: 1, minConfidence: 0.6, requireFinal: true };
    case "medium":
    default:
      return { minTokenRatio: 1, minConfidence: 0.4, requireFinal: false };
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns the first configured phrase the transcript satisfies, or null.
function findMatch(
  transcript: string,
  phrases: string[],
  minTokenRatio: number,
): string | null {
  const normTranscript = normalize(transcript);
  if (!normTranscript) return null;
  const transcriptTokens = new Set(normTranscript.split(" "));

  for (const phrase of phrases) {
    const normPhrase = normalize(phrase);
    if (!normPhrase) continue;
    // Exact substring is always a match.
    if (normTranscript.includes(normPhrase)) return phrase;
    if (minTokenRatio >= 1) continue;
    // Fuzzy: enough of the phrase's tokens appear in the transcript.
    const phraseTokens = normPhrase.split(" ");
    const hits = phraseTokens.filter((t) => transcriptTokens.has(t)).length;
    if (hits / phraseTokens.length >= minTokenRatio) return phrase;
  }
  return null;
}

type SpeechModule = {
  start: (opts: Record<string, unknown>) => void;
  stop: () => void;
  abort?: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  addListener: (event: string, cb: (payload: unknown) => void) => { remove: () => void };
};

function loadModule(): SpeechModule | null {
  try {
    const mod = require("expo-speech-recognition") as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    return mod.ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}

interface ResultPayload {
  isFinal?: boolean;
  results?: Array<{ transcript?: string; confidence?: number }>;
}

export function useVoiceRecognition(
  options: UseVoiceRecognitionOptions,
): UseVoiceRecognitionResult {
  const { enabled, phrases, sensitivity, onTrigger } = options;

  const isSupported = Platform.OS !== "web" && !isExpoGo;
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest config/callback in refs so the recognizer effect does not
  // resubscribe (and restart the mic) on every phrase/sensitivity change.
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;
  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  const lastFireRef = useRef(0);

  useEffect(() => {
    if (!isSupported || !enabled) return;

    const speech = loadModule();
    if (!speech) {
      setError("Speech recognition module unavailable");
      return;
    }

    let cancelled = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    // Guards against overlapping start() calls — repeated "end" events (silence,
    // device noise) must not queue multiple restarts onto the same session.
    let starting = false;
    const subscriptions: Array<{ remove: () => void }> = [];

    const scheduleRestart = () => {
      if (cancelled) return;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(startRecognizer, RESTART_DELAY_MS);
    };

    function startRecognizer() {
      if (cancelled || starting || !speech) return;
      starting = true;
      try {
        speech.start({
          lang: "en-US",
          interimResults: true,
          continuous: true,
          // Prefer on-device when available; falls back to network if not.
          requiresOnDeviceRecognition: false,
          addsPunctuation: false,
          // Bias the recognizer toward the configured trigger phrases.
          contextualStrings: phrasesRef.current,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start recognizer");
      }
    };

    const handleResult = (payload: unknown) => {
      const p = payload as ResultPayload;
      const best = p.results?.[0];
      const transcript = best?.transcript ?? "";
      if (!transcript) return;

      const cfg = matchConfig(sensitivityRef.current);
      if (cfg.requireFinal && !p.isFinal) return;

      const confidence = best?.confidence ?? 0;
      // Confidence gating only applies to final results (interim confidence
      // is typically 0 and not meaningful).
      if (p.isFinal && confidence > 0 && confidence < cfg.minConfidence) return;

      const matched = findMatch(transcript, phrasesRef.current, cfg.minTokenRatio);
      if (!matched) return;

      const now = Date.now();
      if (now - lastFireRef.current < DEBOUNCE_MS) return;
      lastFireRef.current = now;

      onTriggerRef.current({ phrase: matched, transcript, confidence });
    };

    subscriptions.push(
      speech.addListener("start", () => {
        starting = false;
        setIsListening(true);
      }),
    );
    subscriptions.push(speech.addListener("result", handleResult));
    subscriptions.push(
      speech.addListener("error", (payload: unknown) => {
        starting = false;
        const msg =
          (payload as { error?: string; message?: string })?.message ??
          (payload as { error?: string })?.error ??
          "Recognition error";
        // "no-speech"/"client" errors are routine on silence — just restart.
        setError(msg);
      }),
    );
    subscriptions.push(
      speech.addListener("end", () => {
        starting = false;
        setIsListening(false);
        // Recognizers stop themselves after silence; keep listening while enabled.
        scheduleRestart();
      }),
    );

    (async () => {
      try {
        const perm = await speech.requestPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) {
          setError("Microphone / speech permission denied");
          return;
        }
        startRecognizer();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Permission request failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (restartTimer) clearTimeout(restartTimer);
      try {
        speech.abort?.();
        speech.stop();
      } catch {
        /* ignore */
      }
      subscriptions.forEach((s) => s.remove());
      setIsListening(false);
    };
  }, [isSupported, enabled]);

  return { isSupported, isListening, error };
}
