---
name: Cold-start stream recovery (reclaim flow)
description: How a crashed/killed live session is recovered on relaunch in the mobile app, and the rules that keep it correct.
---

# Cold-start stream recovery — RECLAIM, not auto-resume

On app launch, if the backend still reports a live stream for the user but the
in-memory `StreamContext` has no session, the app routes to a recovery screen
offering **Rejoin** or **End**. Publishing never resumes automatically.

## The discriminator: in-memory `isLive`
Cold start vs. ordinary in-app navigation is told apart purely by the in-memory
`StreamContext.isLive`. After a crash/kill, memory is wiped (`isLive=false`,
`activeStream=null`) while the backend `streams.status` is still `live`. The
boot redirect runs `useGetActiveStream` **only when `isAuthenticated && !isLive`**;
if it returns a stream → go to the recovery screen, else normal route.
**Why:** there is no separate "did I crash" flag — the wiped context IS the signal.
**How to apply:** any new launch-time live detection must gate on `!isLive` or it
will fire during normal navigation (e.g. returning Home from the live screen).

## Rejoin = rehydrate + let POV publish
Rejoin rebuilds the session from the persisted `Stream` record (deviceType,
title, platforms, same id + `startedAt`) and fetches a **fresh** Agora token,
then navigates to POV. The actual `joinChannel`/publish happens through POV's
existing lifecycle — the recovery screen itself never starts capture.
**Why:** App-Store-safe, avoids surprise camera/mic activation, and reusing the
existing id+startedAt keeps the timer and analytics continuous.

## End must be transactional
"End Live Stream" must stop push destinations AND end the backend session. The
**endStream call is the gating step**: if it fails, do NOT `clearStream()` or
navigate away — keep the user on the recovery screen with a retryable error,
otherwise they see a successful end while the stream stays live on the backend
(orphan session). push/stop is best-effort (destinations drop when the channel
empties).
