# VYBE LIVE — Platform Integration Audit

_Audit date: June 20, 2026. Scope: existing YouTube integration as the reference implementation, plus what it takes to add Facebook, Instagram, Kick, and TikTok as one-tap livestream destinations._

---

## 1. Reference architecture — how YouTube works today

YouTube is the most complete integration and is the template every other OAuth platform follows.

### Components involved (the "anatomy" of a destination)

| Layer | File | Responsibility |
|-------|------|----------------|
| DB enums | `lib/db/src/schema/index.ts` → `oauthPlatformEnum`, `platformTypeEnum` | Which platforms support OAuth vs. manual RTMP |
| Credential store | `oauth_connections` table | Per-user, per-platform encrypted access + refresh tokens, `tokenExpiresAt`, `status` |
| Destination store | `stream_destinations` table | Per-stream, per-destination RTMP URL, stream key, status, viewer count, reconnect attempts, Agora push task id, platform broadcast id |
| Provider config | `services/oauthProviders.ts` | Auth URL, token URL, scopes, profile fetch, RTMP-credential fetch per platform |
| Redirect helper | `services/oauthRedirects.ts` | Per-platform redirect URI + startup validation |
| OAuth routes | `routes/oauth.ts` | `init` / `confirm` (`OAUTH_PLATFORMS` allow-list) |
| Push / multistream | `routes/push.ts` + `services/agoraPush.ts` | Token refresh → fetch RTMP creds → start Agora Media Push → record destination |
| Preflight | `GET /streams/:id/preflight` | Pre-live validation checklist |
| Reconnect | `POST /streams/:id/push/reconnect` | Per-destination recovery (hard cap 5 attempts/session) |
| Clip publishing | `services/socialPublishing.ts` | Post-stream clip upload (separate from live) |
| Mobile connect UI | `app/settings/platforms.tsx` | `OAUTH_PLATFORMS` vs `MANUAL_PLATFORMS` lists |
| Mobile go-live UI | `app/stream/setup.tsx` | `PLATFORM_META` (brand color/label), destination selection |

### YouTube specifics (the gold standard)

- **OAuth**: Google OAuth 2.0 authorization-code flow. `access_type=offline` + `prompt=consent` to guarantee a **refresh token**. Scopes: `youtube`, `youtube.upload`, `openid`, `email`, `profile`.
- **Token behavior**: access token ~1h; refresh token long-lived. The server **proactively refreshes** if the token is expired or within 5 minutes of expiry before push start.
- **Broadcast creation (required)**: a fresh broadcast is created **every stream** — `liveStreams.insert` (gets RTMP ingest + key) → `liveBroadcasts.insert` (privacy public, `selfDeclaredMadeForKids:false`, auto-start/stop/DVR) → `liveBroadcasts.bind`. Broadcast id is stored for end-of-stream cleanup.
- **Multistream**: Agora Media Push fans one RTC channel out to the YouTube RTMP ingest. Identical mechanism for every RTMP destination.

### Two gaps that affect ALL platforms (not YouTube-specific)

1. **Viewer counts are not live.** `stream_destinations.viewerCount` exists but is always seeded to `0` and never populated from any platform API. Analytics' avg/peak viewers are stream-level, not real per-platform concurrents. Adding real viewer counts is net-new work for **every** platform, YouTube included.
2. **Token refresh assumes an OAuth2 `refresh_token` grant.** That is correct for Google/Twitch/Kick but **not** for Meta (Facebook/Instagram), which uses long-lived-token exchange instead (see below).

---

## 2. Per-platform findings

### Facebook — ✅ already implemented

1. **OAuth**: Facebook Login. Scopes `pages_show_list`, `pages_read_engagement`, `publish_video`, `public_profile`. Comma-separated.
2. **Livestream API**: RTMP ingest via `me/live_videos` or `{page}/live_videos` → `secure_stream_url` (key embedded as last path segment). Broadcast creation **required** (`status: LIVE_NOW`). Destination picker supports personal timeline **and** managed Pages (page access token required per Page).
3. **Architecture reuse**: full reuse of `oauth_connections`, `stream_destinations`, Agora multistream, encrypted credential storage. Adds a **destination picker** (profile vs. page) — a pattern Kick/TikTok do not need.
4. **UX**: connect (Meta login) → select profile/page → go live → disconnect. Preflight re-validates that the selected Page is still accessible and warns before going live.
5. **Token caveat**: Meta does **not** issue standard `refresh_token`s. Short-lived user tokens (~1–2h) must be exchanged for long-lived tokens (~60d) via `fb_exchange_token`. The current generic refresh path does not cover this — **a known limitation** to harden, not a new build.

### Instagram — ✅ implemented, but Meta-gated

1. **OAuth**: same Meta app/login as Facebook. Extra scopes `instagram_basic`, `instagram_content_publish`. Requires an **IG Professional (Business/Creator) account linked to a Facebook Page**.
2. **Livestream API**: `{ig-user-id}/live_videos` → `secure_stream_url`. **Heavily restricted by Meta** — third-party RTMP to IG Live requires elevated/approved API access and may simply return no ingest URL for unapproved apps. The code already handles the "Live API not enabled" case explicitly.
3. **Architecture reuse**: full reuse. No separate picker — the linked IG account **is** the destination.
4. **UX**: connect (Meta) → (implicit destination = linked IG account) → go live → disconnect. Preflight checks the IG account link is intact.
5. **Token behavior**: same Meta long-lived-token model as Facebook.

### Kick — 🟡 buildable (real one-tap), needs credentials + PKCE

1. **OAuth**: Kick ships an **official public API with OAuth 2.1 + PKCE** (`id.kick.com/oauth/authorize`, `id.kick.com/oauth/token`). Likely scopes: `user:read`, `channel:read`, `channel:write`, `streamkey:read`, `events:subscribe`. **Refresh tokens supported.**
   - ⚠️ **New pattern**: Kick **requires PKCE** (`code_challenge`/`code_verifier`). The current codebase uses a plain `client_secret` authorization-code flow with no PKCE. This is the main net-new engineering cost — it touches `buildAuthorizationUrl`, the state store (to persist the verifier), and `exchangeCodeForTokens`.
2. **Livestream API**: Kick uses an **always-on channel** model (like Twitch) — no per-stream broadcast object to create. Fetch the channel's RTMP ingest URL + stream key from the API and push. Viewer count + live status available via the channel/livestream endpoints.
3. **Architecture reuse**: **high.** Reuses `oauth_connections`, `stream_destinations`, Agora multistream, encrypted storage, preflight, and reconnect with no schema changes beyond adding `kick` to `oauthPlatformEnum`. Simpler than Facebook (no destination picker, no per-stream broadcast).
4. **UX**: connect (Kick login) → (single channel destination) → go live → disconnect. Mirrors Twitch exactly.
5. **Blocker**: needs `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` from a Kick developer app (your account). Identical situation to Twitch, which is already coded but unconfigured.

### TikTok — 🔴 not viable as one-tap; keep manual RTMP

1. **OAuth**: TikTok Login Kit (OAuth2) exists, **but it does not grant live-streaming capability.**
2. **Livestream API**: TikTok offers **no public API to provision a live RTMP ingest URL or stream key** for third-party encoders. TikTok LIVE via external software requires the creator to meet eligibility (historically ~1,000+ followers) and is delivered through **TikTok LIVE Studio**, not a developer API. The Content Posting API covers **uploaded** video, not live. There is **no public viewer-count or live-status API** either.
3. **Architecture reuse**: only the **manual `custom_rtmp`/`tiktok` path** applies — the creator pastes an RTMP URL + key that TikTok gives them in-app. This already works today through the existing manual-destination flow.
4. **UX**: connect = N/A (no OAuth value); destination = manual RTMP entry; go live / multistream works because Agora can push to any RTMP target.
5. **Recommendation**: do **not** build TikTok OAuth scaffolding — it cannot function. Instead, polish the **manual TikTok setup** (clear in-app instructions, branding, validation of the pasted key) so creators with LIVE access can multistream reliably.

---

## 3. Destination architecture reuse — summary

| Capability | Reusable as-is? | Notes |
|------------|-----------------|-------|
| Credential storage (`oauth_connections`, encrypted at rest) | ✅ | Add platform to `oauthPlatformEnum` only |
| Destination model (`stream_destinations`) | ✅ | No schema change needed per platform |
| Multistream (Agora Media Push) | ✅ | Platform-agnostic — any RTMP URL+key |
| Connection testing (preflight + reconnect) | ✅ | Add platform to allow-lists; add platform-specific validity check if it has a "destination" concept (FB pages) |
| OAuth flow | ⚠️ | Reusable for Kick **after** adding PKCE support; not applicable to TikTok |
| Per-stream broadcast creation | ⚠️ | Needed for YouTube/FB/IG; **not** for Twitch/Kick (always-on channel) |
| Live viewer counts | ❌ | Not implemented for any platform — net-new for all |

---

## 4. Testing plan (applies to each platform)

There is **no test runner configured today** (no vitest/jest, no `*.test.ts`). Step 0 is standing up Vitest in `artifacts/api-server` with: a test Postgres (or Drizzle mock), `msw` to intercept platform Graph/REST calls, and a fixed `OAUTH_ENCRYPTION_KEY` so encrypt/decrypt works in tests.

Per platform, cover:

1. **OAuth connection** — `init` builds the correct authorize URL (scopes, PKCE challenge for Kick); `confirm` exchanges the code, encrypts and stores tokens, fetches the profile. Assert state is one-time and session-bound.
2. **Destination validation** — preflight returns `pass`/`warn`/`fail` correctly: connected vs. disconnected, expired token (forces refresh), and "destination gone" (FB page removed / IG link broken).
3. **Stream creation** — `push/start` refreshes a near-expiry token, fetches RTMP creds (mock the platform API), creates the `stream_destination`, starts the Agora task, stores the broadcast id.
4. **Stream termination** — end-of-stream tears down the Agora push task and (for YouTube/FB/IG) cleans up the platform broadcast via the stored broadcast id.
5. **Reconnect handling** — failed destination reconnects, increments `reconnectAttempts`, and is blocked at the 5-attempt cap with a clear "reconnect your account" error.
6. **Multistream behavior** — multiple destinations on one stream start/stop independently; one failing destination does not abort the others.

---

## 5. Recommended implementation order

Ranked by **(low technical complexity × high creator demand)**:

1. **Twitch — finish it first (days).** Already fully coded; only needs `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`. Highest ROI by far. _(Not in the four requested, but it's the cheapest win and unblocks the "real one-tap" set.)_
2. **Kick — build next (≈1–1.5 weeks).** Real one-tap integration is viable and high-reuse. The only meaningful new work is **PKCE support** in the OAuth flow; everything else mirrors Twitch. Strong and growing creator demand. Needs Kick developer credentials.
3. **Facebook / Instagram — harden, don't rebuild.** Both already work. Invest in: (a) Meta long-lived-token exchange instead of the generic refresh grant, and (b) confirming Instagram Live API approval status with Meta. Medium effort, removes silent-failure risk.
4. **TikTok — keep manual, polish UX (days).** Do not build OAuth — it cannot provision a stream key. Improve the manual RTMP entry (instructions + validation) so eligible creators can multistream. Low effort, honest scope.
5. **Cross-cutting: live viewer counts (separate initiative).** Wire real per-destination concurrents (YouTube `liveBroadcasts` statistics, FB `live_views`, Twitch/Kick channel endpoints) into the existing `viewerCount` column. Benefits every platform; size it as its own task.

### One-line verdict

Connect Twitch (config-only), build Kick (the one genuinely new integration — budget for PKCE), harden the Meta pair, and keep TikTok manual. Real auto-connect for TikTok is blocked by TikTok's own platform, not by our architecture.
