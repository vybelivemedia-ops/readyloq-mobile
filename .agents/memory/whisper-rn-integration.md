---
name: whisper.rn integration
description: Installation and API notes for whisper.rn in the readyloq-app Expo project
---

## whisper.rn@0.6.0 — key facts

### Module resolution
The package `exports` map only has `"./*"` — no `"."` root entry.  
With `moduleResolution: bundler` (Expo default), TypeScript cannot resolve `import ... from 'whisper.rn'`.

**Fix:** add to tsconfig.json `paths`:
```json
"whisper.rn": ["./node_modules/whisper.rn/lib/typescript/index"]
```

### API change from <0.6: transcribeRealtime removed
`WhisperContext.transcribeRealtime(...)` (with `stop`/`subscribe`) no longer exists.  
The library migrated to a `RealtimeTranscriber` class (from `whisper.rn/realtime-transcription`).

**Why it matters:** Code copied from pre-0.6 examples or the whisper.rn README will fail typecheck.

`RealtimeTranscriber` requires an `AudioStreamInterface`. The bundled `AudioPcmStreamAdapter`
depends on `@fugood/react-native-audio-pcm-stream` — NOT installed by default.

### Chosen approach for readyloq-app
Use `expo-av Audio.Recording` + `WhisperContext.transcribe(fileUri)`:
1. `Audio.Recording.prepareToRecordAsync(options)` / `startAsync()`
2. `stopAndUnloadAsync()` → `getURI()` → WAV file path
3. `whisperContext.transcribe(uri, { language: 'auto', initialPrompt })` → `promise` → segments

This avoids the extra native dep, works offline, and is correct for field-note use case.

### expo-file-system v19
`documentDirectory`, `getInfoAsync`, `downloadAsync` moved to legacy API.  
Import from `expo-file-system/legacy` (not `expo-file-system`) to use them.

### Recording options
Whisper is trained on 16 kHz mono audio. Override HIGH_QUALITY preset:
```ts
ios: { extension: '.wav', sampleRate: 16000, numberOfChannels: 1, linearPCMBitDepth: 16 }
android: { extension: '.wav', sampleRate: 16000, numberOfChannels: 1 }
```

### app.json requirements
- `expo-build-properties` ios.deploymentTarget must be ≥ "15.1" (v1.0.10 minimum)
- Add `expo-av` plugin with `microphonePermission`
- Add `android.permission.RECORD_AUDIO` in android.permissions array
- Run `expo prebuild --no-install` (not `--clean` — that triggers git ops blocked in agent)
