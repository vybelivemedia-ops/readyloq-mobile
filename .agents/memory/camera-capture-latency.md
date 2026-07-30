---
name: Camera capture latency fix
description: Root causes and fixes for 5–10s shutter lag in the inspection camera
---

## Root causes

1. **`takePictureAsync` without `skipProcessing: true`** — `quality: 0.6` triggers software JPEG compression of the full-resolution sensor image. On a 12–48MP camera this takes 3–8s on the JS thread. The FAIE frame buffer already used `{ quality: 0.1, skipProcessing: true }` and was fast; the main shutter path didn't have `skipProcessing: true`.

2. **Camera lock spans entire pipeline** — `setCapturing(false)` was deferred until after both `FileSystem.copyAsync` (persistPhoto) and `AsyncStorage.setItem` (updateLocalInspection) completed, locking the shutter for the full 5–10s.

3. **No optimistic thumbnail** — photo only appeared after all I/O finished.

4. **Haptic fired after await** — user felt no feedback during the multi-second wait.

## Fixes applied

### `lib/vision/native-camera-provider.ts`
Changed `takePictureAsync({ quality: 0.6 })` → `takePictureAsync({ skipProcessing: true })`. The hardware encoder is used directly (~150–300ms vs 3–8s).

**Why:** `skipProcessing: true` returns the camera hardware's own JPEG. The `quality` param has no effect when `skipProcessing: true` and is omitted.

### `app/(app)/new-inspection.tsx` — `takePhoto`
- Fire `Haptics.impactAsync` before the async pipeline (instant tactile feedback on press)
- Release `setCapturing(false)` immediately after `cameraProvider.capture()` returns
- Run `ingestEvidence` as a background void (camera ready for next shot in ~200ms)

### `app/(app)/new-inspection.tsx` — `ingestEvidence`
Three-step optimistic pipeline:
1. `setPhotos(prev => [...prev, { uri: cacheUri }])` — instant thumbnail, no I/O
2. `persistPhoto` → `setPhotos(prev => prev.map(p => p.uri === cacheUri ? { uri: durableUri } : p))` — targeted URI swap, safe for concurrent rapid-fire captures
3. `updateLocalInspection` — AsyncStorage write only updates `recordRef`, does NOT call `setPhotos` (prevents clobbering other in-flight optimistic entries)

## Key constraint

Do NOT do a full `setPhotos(updated.photos.map(...))` rebuild in the middle of `ingestEvidence` — it will drop optimistic cache-URI entries from concurrent captures that are still in-flight. Always use targeted functional updaters.
