---
name: Android Downloads via Storage Access Framework (Expo)
description: How to save a downloaded file into the Android Downloads folder from an Expo app, and the constraints that shape the approach.
---

Saving an arbitrary file (e.g. a recording) into the user-visible Android
**Downloads** folder requires the Storage Access Framework (SAF), not
MediaLibrary — MediaLibrary only targets media collections (DCIM / Movies /
Pictures), never Downloads.

SAF lives under `FileSystem.StorageAccessFramework` from `expo-file-system/legacy`.
Flow: `getUriForDirectoryInRoot("Download")` → `requestDirectoryPermissionsAsync(initialUri)`
→ `createFileAsync(directoryUri, baseName, "video/mp4")` → write content.

**Why these constraints matter (non-obvious):**
- `createFileAsync` takes the filename **without extension** + a MIME type; SAF
  derives the extension. Passing `name.mp4` produces a double extension.
- SAF has **no streaming write** — you must read the source file as Base64
  (`readAsStringAsync({encoding: Base64})`) and `writeAsStringAsync` it. That loads
  the whole file into a JS string, so large videos can OOM. Gate with a size
  threshold (we use 200MB) and route oversized files to the gallery
  (MediaLibrary, which copies natively) instead.
- `getInfoAsync` in the **legacy** API has no `{ size: true }` option — that throws
  TS2353. `size` is already present on the returned `FileInfo` when `exists` is true.
- The directory picker can be dismissed; treat `!granted` as a fallback path
  (save to gallery) so the download is never silently lost.

**How to apply:** Use SAF for "download to Downloads" on Android; keep
MediaLibrary as the fallback for declined-picker and large-file cases, and as the
primary path on iOS (no user-facing Downloads folder). On-device behavior can't be
verified in the Replit container — it needs a physical device / dev build.
