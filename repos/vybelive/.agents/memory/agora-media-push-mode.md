---
name: Agora Media Push raw vs transcoding mode
description: Which Media Push REST mode to use for a single-publisher POV stream and the UID-collision constraint.
---

# Agora Media Push — raw (non-transcoding) mode for single-publisher streams

For a single-publisher POV stream (one host forwarded to RTMP/CDN), use the
**raw / non-transcoding** converter mode, NOT transcoding.

- Raw body: `converter.rawOptions = { rtcChannel, rtcStreamUid, token }` plus a
  single `rtmpUrl` (string) and `idleTimeout`. No `videoOptions`, `canvas`,
  `transcodeOptions`, or `rtmpUrls[]`.
- Transcoding mode requires layout/canvas/codec fields and is only needed when
  compositing multiple hosts. Using it for one publisher caused YouTube push to
  fail (malformed `videoOptions.canvas`).

**Why:** transcoding adds a compositor that needs a full canvas/layout spec;
for one source it is both unnecessary and error-prone. Raw forwards the named
host's track straight through.

## UID-collision constraint (critical)

The converter joins the channel as its own subscriber under the UID baked into
its **token**. That converter UID MUST differ from `rtcStreamUid` (the host it
forwards). A duplicate UID evicts the colliding client → the stream drops.

- `rtcStreamUid` = the creator's actual publishing UID. Persist the UID at
  RTC-token generation time (only for the PUBLISHER role) onto the stream row,
  so Media Push forwards exactly that host.
- converter UID = a dedicated constant above the creator UID range (e.g.
  999999), non-zero (UID 0 blocks CDN push), used only to build the push token.

## REST URL is region-scoped

Base URL is `https://api.agora.io/<region>/v1/projects/<appId>/rtmp-converters`
(region lowercase, e.g. `na`). Centralize it so start/stop/status all agree.

## Logging

Never log stream keys in any form — not even a prefix. The threat model treats
RTMP stream keys as sensitive creator credentials. Log `hasStreamKey: boolean`
to distinguish empty-key cases without exposing the value.
