import type { RecognitionSensitivity } from "@workspace/api-client-react";

export interface GestureTrigger {
  gesture: string;
  confidence: number;
}

export interface UseGestureRecognitionOptions {
  // Master gate — recognition only runs while true (live + opted-in +
  // settings.gestureEnabled).
  enabled: boolean;
  // Gesture names the creator enabled (e.g. "thumbs_up", "peace").
  gestures: string[];
  sensitivity: RecognitionSensitivity;
  onTrigger: (trigger: GestureTrigger) => void;
}

export interface UseGestureRecognitionResult {
  // True only on a native dev build where a gesture-detection pipeline is
  // registered. Currently false everywhere — see useGestureRecognition.ts.
  isSupported: boolean;
  // True while the camera frame processor is actively analyzing frames.
  isWatching: boolean;
  error: string | null;
}
