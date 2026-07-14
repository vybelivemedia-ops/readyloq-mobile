import type {
  UseGestureRecognitionOptions,
  UseGestureRecognitionResult,
} from "./useGestureRecognition.types";

// Web stub — hand-gesture recognition is a native-only camera capability.
export function useGestureRecognition(
  _options: UseGestureRecognitionOptions,
): UseGestureRecognitionResult {
  return { isSupported: false, isWatching: false, error: null };
}
