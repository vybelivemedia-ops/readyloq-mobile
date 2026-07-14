---
name: Voice & gesture recognition (hands-free markers)
description: How VYBE LIVE's hands-free moment-marking is built — voice is real, gesture detection is deliberately deferred.
---

# Hands-free moment-marking

The marker pipeline (settings → live HUD → persisted `stream_markers`) is wired
end-to-end for BOTH voice and gesture, but only voice actually detects.

## Voice = real
- On-device via `expo-speech-recognition` (SDK 54/56 line). Hook:
  `useVoiceRecognition.ts` with a `.web.ts` stub + `.types.ts`.
- Native-only: guarded by `Constants.appOwnership === "expo"` (Expo Go) and
  `Platform.OS !== "web"`; module is `require()`d dynamically so Expo Go never
  loads it. `isSupported` is false in Expo Go / web.
- Continuous listening: recognizers self-stop on silence, so the hook restarts
  on the `end` event. MUST clear any pending restart timer and hold a
  `starting` guard before calling `start()` again, or repeated end/noise events
  queue overlapping `start()` calls (battery/CPU churn, noisy errors).
- Matching honors sensitivity as a confidence floor + phrase token-overlap
  ratio; fires are debounced ~4s to dedupe interim+final of one utterance.

## Gesture = deferred (intentional)
- `useGestureRecognition.ts` exposes the real interface but returns
  `isSupported=false` and never fires. UI shows "Soon" / a settings note.
- **Why deferred:** Agora owns the device camera; a second capture session
  (react-native-vision-camera + a hand-landmark tflite/MediaPipe model) cannot
  share the same physical camera, and those modules are off the pinned Expo SDK
  line with a track record of breaking the unverifiable EAS Android build.
- **How to finish later:** route one capture into both Agora (custom video
  source) and the detector, then classify frames → map to a configured gesture
  honoring sensitivity → debounce → `onTrigger`. Until then, no simulated
  gesture markers may leak into a real stream.

## Server
- `recognition_settings` is a per-user singleton: GET upserts defaults
  (`DEFAULT_TRIGGER_PHRASES` / `DEFAULT_ENABLED_GESTURES`), PATCH dedupes/trims
  phrases. Markers are nested under `/streams/:id/markers` and ownership-scoped
  via `loadOwnedStream`.
