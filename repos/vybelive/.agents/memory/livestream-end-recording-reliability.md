---
name: Livestream end + recording reliability invariants
description: Rules that keep stream-end and recording-finalize state honest (no stranded live streams, no perpetual "finalizing").
---

# Livestream end + recording reliability

## End-stream client flows must gate on the server, then invalidate caches
Any client "End Stream" path (currently POV screen + recover screen) must:
1. Call the server end mutation FIRST and only tear down local capture + navigate
   away on success. On failure, surface a retryable error and stay — do NOT clear
   local state or navigate.
2. After a successful end, invalidate the streams list, active-stream, and
   recordings-archive query caches.

**Why:** A swallowed end error that still navigated away left the backend stream
`status="live"` with no UI to stop it (stranded live stream). Skipping cache
invalidation left home/live lists and active-stream recovery showing a stale
"live" stream after a clean end.
**How to apply:** When adding/refactoring any end-stream entry point, mirror this
gate-then-invalidate shape. The recover screen is the reference implementation.

## Recording finalize failures must be terminal, never perpetual "pending"
The recording status is derived from stored fields. Precedence:
`recordingUrl` (archived) > `recordingError` (failed) > cloud-recording session
ids present (pending) > none (unavailable).

Every finalize dead-end (stop call throws, zero files returned, no usable
recording URL because storage env is unset) must write a creator-facing
`recordingError` so status becomes `failed`. Clear `recordingError` on a
successful finalize.

**Why:** Previously these branches only logged warnings and left `recordingUrl`
null while the cloud session ids remained, so status stayed `pending` forever —
a silent failure shown to creators as endless "Finalizing".
**How to apply:** Any new recording finalize/archive branch that can fail must set
a terminal `recordingError`, not just log. Keep the derive-status precedence above
intact when extending recording states.

## Live-session wake lock belongs on the never-unmounting provider
The screen wake lock is held in StreamContext keyed on `isLive`, not on the POV
screen. **Why:** It must survive navigation away from the streaming UI and
reconnects (isLive stays true) and release the instant the stream ends.
