import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";

import type {
  UseGestureRecognitionOptions,
  UseGestureRecognitionResult,
} from "./useGestureRecognition.types";

// True inside Expo Go (storeClient) — native camera/ML modules are not bundled.
const isExpoGo = Constants.appOwnership === "expo";

/**
 * Hand-gesture recognition.
 *
 * The voice/gesture marker pipeline is wired end-to-end (settings, HUD, marker
 * persistence) so this hook plugs straight into the live screen. On-device hand
 * detection itself is intentionally NOT enabled yet because:
 *
 *  1. Camera ownership — the live publish path (Agora) owns the device camera.
 *     A second frame-processing camera session (e.g. react-native-vision-camera
 *     + a hand-landmark model) cannot share the same physical camera; doing it
 *     properly requires routing one capture into both Agora (custom video
 *     source) and the detector, which is a rewrite of the working stream core.
 *  2. Build risk — the required native modules (vision-camera + a tflite/
 *     MediaPipe hand model) are off the pinned Expo SDK line and have repeatedly
 *     broken the EAS Android (Kotlin) build, which cannot be validated here.
 *
 * When a detection pipeline is added, classify each frame, map the result to a
 * configured gesture honoring `sensitivity` as a confidence floor, debounce,
 * and call `onTrigger`. Until then this reports unsupported and never fires, so
 * no simulated gesture markers leak into a real stream.
 */
export function useGestureRecognition(
  options: UseGestureRecognitionOptions,
): UseGestureRecognitionResult {
  const { enabled, onTrigger } = options;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  // No detection backend is installed yet, so this is unsupported everywhere.
  const isSupported = false;
  const [isWatching] = useState(false);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || isExpoGo) return;
    if (!isSupported || !enabled) return;
    // Detection pipeline goes here once camera-sharing + EAS build are resolved.
    return () => {};
  }, [isSupported, enabled]);

  return { isSupported, isWatching, error };
}
