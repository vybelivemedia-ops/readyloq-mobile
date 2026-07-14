---
name: stream timer derivation
description: Why live/elapsed timers must derive from a persisted backend timestamp, not a client counter
---

# Live/elapsed timers must derive from a persisted backend timestamp

Compute elapsed time as `now - startedAt` from a backend-persisted absolute
timestamp, recomputed each tick. Never accumulate it with a client-side
`+1`-per-second counter.

**Why:** A local accumulator reset the live timer to 00:00 while the stream was
still LIVE and healthy. Clearing stream state zeroed the counter, JS timers
throttle/pause in the background (drift), and any state/provider reset zeroed it
while the media engine kept pushing frames — so the UI showed a running stream
with a 00:00 timer. An absolute timestamp is immune to all of this because it is
recomputed, never accumulated, so it survives reconnects, backgrounding,
navigation, and component remounts.

**How to apply:** For any duration UI (live-for, recording length, clip offsets)
derive from a persisted timestamp. Recompute immediately on app foreground (the
background interval is throttled). Keep diagnostic logs for the session
lifecycle and any unexpected reset/clock-skew so a 00:00-while-live is never
silent. Known gap: no cold-start rehydration of the active stream from the
backend, so a full app process restart shows 0 until the stream is reloaded.
