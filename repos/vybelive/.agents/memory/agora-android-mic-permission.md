---
name: Agora Android mic permission (silent audio)
description: Why an Agora livestream reaches the CDN with video but no audio, and how to avoid it.
---

# Agora publishes a silent audio track without runtime RECORD_AUDIO

**Symptom:** Video reaches YouTube/RTMP fine but there is no audio.

**Cause:** On Android, `RECORD_AUDIO` is a *runtime* (dangerous) permission. Declaring it
in the manifest/app.config is NOT enough. If it was never granted at runtime, Agora's
`enableAudio()` + `publishMicrophoneTrack: true` still publishes an audio track — but it
carries silence. Media Push (raw/non-transcoding mode) faithfully forwards that silent
track, so the CDN gets video + empty audio.

**Why it was missed:** `expo-camera`'s `requestCameraPermissionsAsync()` only covers the
camera. Microphone is a *separate* permission: `requestMicrophonePermissionsAsync()` /
`getMicrophonePermissionsAsync()`. A source that only requests camera permission will
stream silently.

## How to apply
- Any Agora (or video-recording-with-audio) source must request the microphone permission
  explicitly, not just camera.
- Gate the Agora `joinChannel()` on the source being fully connected (mic prompt answered)
  — joining before the permission resolves publishes the mic track silently on first run.
  In this repo, `useAgoraRTC(..., enabled)` is gated on `sourceState.status` being
  `connected`/`streaming` in `pov.tsx`.

## Media Push audio (raw mode)
Agora RTMP-converter raw mode forwards the host's audio+video as-is and transcodes RTC
Opus → AAC with defaults. There is no per-stream audio toggle or codec field to set, so
audio presence depends entirely on the host actually publishing a non-silent mic track.
**Why:** rules out "Media Push dropped the audio" — if video arrives, the converter is
forwarding the host; silent audio is a publisher-side (mic capture/permission) problem.
