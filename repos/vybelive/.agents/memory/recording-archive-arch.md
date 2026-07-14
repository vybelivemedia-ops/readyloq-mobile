---
name: Recording & Archive architecture
description: How creator-facing recording archive (list/play/rename/delete) is modeled in VYBE LIVE.
---

# Recording & Archive architecture

The archive surface (browse past recordings, play, rename, delete) is built on
**dedicated endpoints that read from the existing `streamsTable`**, NOT a new
recordings table and NOT new columns on the live-stream path.

- Recording status is **derived**, never stored: `recordingUrl` set → `archived`;
  no url but `cloudRecordingResourceId` && `cloudRecordingSid` present → `pending`
  (still finalizing); otherwise `unavailable`. Keep this derivation in one helper
  so all archive responses agree.
- Archive list returns a `RecordingSummary` projection (not the full `Stream`) so
  sensitive fields (stream keys, RTMP ingest URLs) never leak through the list.
- Playback uses a short-lived **signed** URL minted server-side via the storage
  sidecar; external (non-app-storage `https://`) recordingUrls are passed through
  as-is. Never return raw private object paths to the client.
- Rename reuses the existing `updateStream` (PATCH) — title lives on the stream.

**Why:** avoids blast radius on the live-streaming hot path and keeps a single
source of truth. Task #50 (AI highlights) builds on this same archive surface.

**How to apply:** when extending archive features, add to the dedicated
recordings endpoints and the derived-status helper; do not add recording columns
to the live-stream create/start/end flow.

## Delete semantics (important)
Deleting a stream/recording must remove: associated clip rows, the stream row,
the recording object, and clip media objects. Split this into two phases:
1. **DB mutations in a single `db.transaction`** (clip rows + stream row) so a
   mid-sequence failure never leaves orphaned clip rows or a half-deleted entry.
2. **Storage cleanup is best-effort AFTER the transaction** — capture clip ids +
   recordingUrl first, then delete objects; a failed object delete is logged
   (`req.log.warn`) but must NOT fail the request (only an orphaned file remains).

**Why:** a creator must always be able to delete; storage flakiness should never
block removal, but DB state must stay consistent.

## Poster thumbnails (T52)
Recording poster frames are generated best-effort with FFmpeg (`-ss 1 -i src
-frames:v 1`), uploaded PUBLIC, and stored on `thumbnailUrl`. Generation is
fired-and-forgotten AFTER `res.json(...)` in both end-stream and finalize with a
call-site `.catch(()=>{})` — never in the response path. Upload/delete share
`recordingThumbnailObjectPath(streamId)` so deletion never orphans the object.
The archive list projection is centralized in `buildRecordingSummary` (pure,
unit-tested) which whitelists only public fields — never streamKey /
rtmpIngestUrl / raw recordingUrl / cloud recording ids.

**Why:** thumbnails are public by convention (matches clip thumbnails) to avoid
per-request signing; end-stream reliability must never be gated on FFmpeg or
storage; a single projection helper stops future route edits from leaking
sensitive columns.
