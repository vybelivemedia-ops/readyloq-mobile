---
name: FFmpeg Recording Download — Streaming to Disk
description: Recordings must be streamed to disk, never loaded into memory. Also handles HTTPS URLs.
---

## Rule
Always use `downloadToFile(path, destPath)` which streams the recording. Never use a buffer approach for video files.

## Why
Stream recordings can be multiple GB. Loading the entire file into a `Buffer` before writing it to disk doubles the peak memory usage and OOMs the server on any meaningful recording. The `downloadToBuffer()` function was removed — it was the original broken implementation.

## How to apply
`storageService.downloadToFile(objectPathOrUrl, destPath)` handles both formats:

- **GCS object path** (e.g. `"recordings/userId/streamId/source.mp4"`) — uses `bucket.file(path).createReadStream()` piped to a file write stream via `stream/promises.pipeline()`
- **HTTPS URL** (e.g. `"https://storage.googleapis.com/bucket/path.mp4"`) — uses `fetch()` with a 5-minute timeout, converts the web `ReadableStream` to a Node.js `Readable` via `Readable.fromWeb()`, then pipes to file

In `clipProcessor.ts`, the download step is:
```typescript
await downloadToFile(recordingObjectPath, inputPath);  // streams to temp file
```

The `recordingObjectPath` in `streamsTable.recordingUrl` can be either format — `downloadToFile` detects by `startsWith("https://")`.
