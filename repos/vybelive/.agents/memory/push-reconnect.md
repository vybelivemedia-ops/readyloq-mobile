---
name: Push reconnect + auto-reconnect design
description: Non-obvious design decisions for Agora Cloud Push reconnect flow, mobile trigger logic, token refresh strategy, and preflight network check.
---

## The rule
`POST /streams/:streamId/push/reconnect` is capped at 5 attempts per destination per stream session. Beyond that, users must re-authenticate the OAuth platform.

**Why:** Prevents infinite retry loops when a platform has a persistent auth failure or RTMP rejection. 5 attempts covers transient network blips without creating runaway costs.

**How to apply:** Always check `dest.reconnectAttempts >= 5` before starting a new task. Return `max_attempts` status and surface a "reconnect OAuth" prompt on the mobile side when this is hit.

## Mobile trigger (pov.tsx)
Auto-reconnect fires after exactly **2 consecutive failed** poll results for a platform (not 1, to avoid flapping). Counts reset immediately when reconnect is fired to prevent rapid-fire calls. The poll interval is 10s so 2 failures = ~20s before auto-reconnect.

## Token refresh on reconnect
Always proactively refresh if `tokenExpiresAt < now + 5min`, not just when expired. This prevents the race where a token expires during the Agora task setup.

## Network check in preflight
Server pings `https://api.agora.io` with a 3s timeout using `AbortController`. Returns `warn` (not `fail`) on timeout — network issues shouldn't block a stream attempt if everything else passes. Warn is non-blocking in `canGoLive` computation.

## push/start call from mobile
`POST /push/start` is fired **fire-and-forget from setup.tsx** after `startStream` and `getAgoraToken` succeed. Never awaited — push failure must never block the user from entering the live screen. Simulation mode handles the case where push isn't configured.

## Instagram: always skipped
`fetchRtmpCredentials("instagram", ...)` returns null by design — no public 3rd-party RTMP API exists. The reconnect endpoint returns `status: "skipped"` for Instagram, which is correct and expected.
