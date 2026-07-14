# AI Clips Setup Guide

VYBE LIVE uses a real FFmpeg pipeline for clip extraction. No mocks. Missing infrastructure surfaces as explicit 422/503 errors with a `blocker` field — never a silent fallback.

## Prerequisites

### 1. FFmpeg (required for any clip extraction)

FFmpeg 6.1.2 is pre-installed in the Replit environment at the default PATH.

Verify: `ffmpeg -version`

### 2. Replit App Storage (required for recording upload + clip storage)

Object storage is already provisioned. The bucket ID is stored in `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.

Additionally, GCS credentials are needed for presigned PUT URLs (recording upload from mobile):

```
GOOGLE_SERVICE_ACCOUNT_KEY_JSON=<base64 of your GCS service account JSON>
```

Or use `@google-cloud/storage` Application Default Credentials (ADC) if running on GCP infrastructure.

**Without this:** `POST /streams/:streamId/recording/upload-url` returns `503 STORAGE_NOT_CONFIGURED`.

### 3. OpenAI (required for AI titles and captions)

Set via the Replit AI Integrations proxy. The integration is enabled via the Replit Integrations panel.

Required env vars (set automatically by the integration, or manually):
```
AI_INTEGRATIONS_API_KEY=<your key>
AI_INTEGRATIONS_BASE_URL=https://...
```

**Without this:** Clips are still extracted by FFmpeg, but `aiTitle`, `aiCaptionYoutube`, `aiCaptionInstagram`, and `aiCaptionFacebook` will be null. The `/clips/:clipId/captions` endpoint returns `503 AI_NOT_CONFIGURED`.

## The Recording Flow

```
Mobile streams locally
    │
    ▼
POST /api/streams/:streamId/recording/upload-url
    │  Returns { uploadUrl, objectPath }
    ▼
PUT <uploadUrl>   (direct browser/mobile → GCS upload)
    │  video/mp4 body, up to ~10 GB
    ▼
POST /api/streams/:streamId/recording/finalize
    │  Body: { objectPath }
    │  Sets stream.recordingUrl → enables clip generation
    ▼
POST /api/streams/:streamId/clips/generate
    │  Body: { maxClips: 3, clipDurationSeconds: 30 }  (optional)
    │  Returns ClipJob { id, status: "pending" }
    ▼
GET /api/clips/jobs/:jobId   (poll every 2–3 s)
    │  status: pending → running → completed | failed
    ▼
GET /api/clips   (list new clips once job completes)
```

## What the Pipeline Does

1. **Download recording** — fetches from GCS (or Agora Cloud Recording URL) to a temp file
2. **ffprobe** — reads duration and video metadata
3. **FFmpeg extraction** — cuts N clips at random seek points (real transcoding, H.264/AAC, 9:16 crop)
4. **Thumbnail extraction** — single JPEG frame per clip
5. **GCS upload** — publishes each clip+thumbnail to `clips/{streamId}/{clipId}/video.mp4`
6. **DB insert** — creates Clip rows with `videoUrl`, `thumbnailUrl`, `startTimeMs`, `endTimeMs`
7. **OpenAI captions** — generates `aiTitle`, `aiHashtags`, `aiCaptionYoutube`, `aiCaptionInstagram`, `aiCaptionFacebook` via the AI integrations proxy

## Agora Cloud Recording (optional)

If `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_CUSTOMER_KEY`, and `AGORA_CUSTOMER_SECRET` are set, Agora Cloud Recording starts automatically when a stream goes live and stops when it ends. The recording URL is stored on the stream directly — no manual upload required.

**Without Agora:** Mobile app must upload the local recording manually via the upload-url + finalize flow described above.

## Error Codes

| Blocker | HTTP | Meaning |
|---------|------|---------|
| `NO_RECORDING` | 422 | Stream has no `recordingUrl`. Upload one first. |
| `AI_NOT_CONFIGURED` | 503 | OpenAI env vars not set. Clip extraction still works; captions won't be generated. |
| `STORAGE_NOT_CONFIGURED` | 503 | GCS/object storage not configured. Can't generate presigned upload URLs. |
| `STREAM_NOT_ENDED` | 422 | Can't upload a recording while the stream is still live. |
| `STREAM_NOT_FOUND` | 404 | Invalid streamId or wrong user. |

## Clip Storage Paths (GCS)

```
clips/{streamId}/{clipId}/video.mp4       — public clip video
clips/{streamId}/{clipId}/thumbnail.jpg   — clip thumbnail
recordings/{userId}/{streamId}/source.mp4 — original recording (presigned upload target)
```
