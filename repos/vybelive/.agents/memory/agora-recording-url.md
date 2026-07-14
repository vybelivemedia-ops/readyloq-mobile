---
name: Agora Cloud Recording — Recording URL Construction
description: stopRecording() returns bare filenames, not usable URLs or GCS object paths. Must reconstruct.
---

## Rule
Never store `files[0]` from `agoraCloudRecording.stopRecording()` directly as `recordingUrl`. Always construct a usable path first.

## Why
The Agora Cloud Recording REST API `stop` response returns `serverResponse.fileList[].fileName` — these are bare filenames like `"channelName_0_timestamp_av.mp4"`, relative to whatever storage bucket Agora was configured with in Agora Console. They are not GCS object paths, not HTTPS URLs, and not directly downloadable by the clip pipeline.

## How to apply
Two helpers exist in `agoraCloudRecording.ts`:

1. **`buildRecordingObjectPath(filename)`** — prepends `AGORA_RECORDING_FILE_PREFIX` env var. Returns `null` if not set. Use when Agora writes to the same Replit App Storage bucket (Path A).
2. **`buildRecordingExternalUrl(filename)`** — prepends `AGORA_RECORDING_EXTERNAL_BASE_URL` env var. Returns `null` if not set. Use when Agora writes to a separate bucket accessible over HTTPS (Path B).

In `streams.ts` stop handler:
```typescript
const objectPath = agoraCloudRecording.buildRecordingObjectPath(agoraFile);
const externalUrl = agoraCloudRecording.buildRecordingExternalUrl(agoraFile);
const recordingUrl = objectPath ?? externalUrl;
if (!recordingUrl) { /* warn, don't fail the stream end */ }
```

Without either env var, `recordingUrl` is not set and users must manually upload via `/recording/upload-url` + `/recording/finalize`.

## Agora storageConfig in startRecording
When `AGORA_STORAGE_GCS_SERVICE_ACCOUNT_EMAIL` + `AGORA_STORAGE_GCS_PRIVATE_KEY` are set, `startRecording()` passes a `storageConfig` block (vendor=6 GCS) so Agora writes directly to our bucket. The private key must be base64-encoded PEM.
