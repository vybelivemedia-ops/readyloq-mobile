---
name: OAuth + Multistream architecture
description: Key decisions for OAuth token storage, Agora Cloud Push integration, and API/mobile wiring in VYBE LIVE
---

## OAuth token storage
- Tokens encrypted at rest with AES-256-GCM (random IV per write) via `artifacts/api-server/src/lib/crypto.ts`
- Key in `OAUTH_ENCRYPTION_KEY` env secret (32-byte hex); if missing, `/oauth/:platform/init` returns 503
- One row per user+platform in `oauthConnectionsTable` — upserted on reconnect
- Status lifecycle: `connected → expired → refresh_needed → disconnected`

**Why:** Tokens are long-lived credentials for creator streaming accounts — treat like passwords.

## OAuth state parameter
- Format: `base64urlPayload.HMAC-SHA256`; payload contains `{ userId, platform, nonce, ts }`
- 10-minute expiry checked on callback; signed with `SESSION_SECRET`
- Needed because the browser-based OAuth flow has no auth header — state binds it back to the authenticated user

## Agora Cloud Push pattern
- Push routes in `artifacts/api-server/src/routes/push.ts`
- `POST /streams/:id/push/start` — fetches RTMP creds from each platform API using decrypted token, starts Agora push task per destination
- Platform health stored in `streamDestinationsTable` with `agoraPushTaskId`
- Mobile polls `GET /streams/:id/push/status` every 10s while live and Agora is joined
- All four OAuth platforms (youtube, facebook, twitch, instagram) are push-capable via `OAUTH_PUSH_PLATFORMS` in push.ts; `fetchRtmpCredentials` returns creds for each
- Instagram Live RTMP: only works for IG **Professional** (Business/Creator) accounts linked to a Facebook Page. Resolve the IG user id via `GET /me?fields=instagram_business_account` (same lookup clip-publishing uses), then `POST /{ig-user-id}/live_videos` with the Meta user token; response `secure_stream_url` embeds the stream key as its last path segment (split like Facebook). Requires `publish_video` + `pages_*` scopes on the IG connection. NOTE: the `/{ig-user-id}/live_videos` write edge is sparsely documented by Meta and gated behind app review — calls fail gracefully per-destination if the account/app lacks access.

## Mobile OAuth flow
- `expo-web-browser` `openAuthSessionAsync` with `mobile://oauth-complete` as the redirect scheme
- Deep link result parsed from the URL query params (`?success=true&platform=X&accountName=Y`)
- `API_BASE` built from `EXPO_PUBLIC_DOMAIN` env var (set to Replit domain in EAS/workflow)

## Two flows share ONE callback, branched by signed state `origin`
- `signState(...)` embeds an optional signed `origin` field ("mc" for the web console); mobile omits it.
- `peekStateOrigin(state)` decodes the origin UNVERIFIED — use ONLY to pick the browser-return destination (mobile deep link vs MC page) on early/error paths. Trust decisions use `verifyState(...).origin`.
- `commitOAuthConnection(record)` is the shared insert/update helper used by BOTH the mobile `POST /oauth/:platform/confirm` route and the MC direct-commit branch — don't re-inline the upsert.
- The callback's token-exchange catch MUST call the origin-aware `fail()` closure, not a hardcoded `mobile://` redirect, or MC-origin exchange failures vanish to a dead deep link.

## Mission Control web connect flow (no bearer token / no deep link)
- `GET /api/mission-control/social/oauth/:platform/init` resolves the founder server-side (`resolveFounderUser`), builds a signed one-time state stamped origin="mc" via `buildOAuthInitUrl`, 302s to the provider.
- Callback: when VERIFIED `origin==="mc"`, commit directly (skip the mobile two-phase confirm — there's no device/bearer to bind to), then redirect to `/mission-control/social?connected=<p>&account=<name>`; errors → `?connect_error=<msg>&platform=<p>`.
- **Why direct-commit is acceptable here:** the whole MC router is unauthenticated + founder-scoped by convention with network-level access as the compensating control (see mission-control-no-auth.md). The mobile two-phase confirm binds tokens to an authenticated device session; MC has no such session by design, so it adds no value there. Adding an auth gate would break the MC convention and was explicitly forbidden by the request. A code review will flag this as "broken access control" — it's the documented, accepted MC tradeoff, not a regression.
- Frontend `Social.tsx`: Connect/Reconnect `<a href>` to the init URL (root-relative `/api/...`, web `_baseUrl` is null so proxy handles it); ConnectionsTab reads `?connected`/`?connect_error` query params → banner + refetch + `history.replaceState` to clean URL; the page also defaults the active tab to "connections" when those params are present.

## Preflight gate
- `GET /streams/:id/preflight` — server-side checklist run after stream creation, before `startStream`
- Returns `{ canGoLive, checks[], platformSummary }` where checks have statuses: `pass | fail | warn | client_check`
- Camera/mic are `client_check` (can't verify server-side)
- If `canGoLive: false`, mobile shows alert and aborts launch

## Codegen collision fix
- `/oauth/:platform/callback` was removed from OpenAPI spec — it's a browser redirect, not a client SDK endpoint
- Keeping it caused Orval to generate `OauthCallbackParams` in both `api-client-react` and `api-zod`, causing TS2308

## Facebook Live destination (profile vs Page)
- `oauthConnectionsTable` carries per-connection target columns: `targetType` ("profile"|"page"), `targetId`, `targetName`, `encryptedTargetToken`. All nullable; null `targetType` ⇒ treat as "profile" (back-compat).
- A **Page** stream needs the *page* access token (from `/me/accounts`), NOT the user token, and posts to `/{pageId}/live_videos`. Profile streams use the user token + `/me/live_videos`.
- Page token is encrypted at rest in `encryptedTargetToken`; `buildFetchOptions(conn)` in push.ts decrypts it and feeds `fetchRtmpCredentials` only when platform=facebook & targetType=page.
- `POST /oauth/facebook/target` re-validates the chosen target against the live `/me/accounts` list before storing — never trust a client-supplied page id/token.
- `GET /oauth/facebook/targets` must strip page tokens from the response; tokens stay server-side only.

**Why:** Facebook rejects a Page live video created with the bare user token; and exposing page tokens to the client would leak streaming credentials.

## Kick (OAuth 2.1 PKCE + manual-RTMP fallback)
- Kick is the only provider needing PKCE — gated by `requiresPkce(platform)`; PKCE params (`code_challenge`/`code_challenge_method=S256` on authorize, `code_verifier` on token exchange) are attached ONLY when `requiresPkce && value present`, so other providers are untouched.
- OAuth host `id.kick.com` is separate from REST host `api.kick.com`; stream-key auto-provision via `GET /public/v1/channels/stream-key` (scope `streamkey:read`).
- **Auto-provision can legitimately fail** (account/scope can't mint creds). `fetchKickRtmpCredentials` throws the sentinel `KickAutoProvisionUnavailableError` (NOT a generic Error) so callers fall back to manual Custom RTMP instead of failing the whole stream.
- **`streamDestinationStatusEnum` has NO fallback state** — push start/reconnect persist a `failed` DB row but surface a distinct `manual_fallback_required` status in the API response only. Classification lives in pure `classifyPushDestinationError(err)` (services/destinationValidation.ts), reused by both loops.

**Why:** keeps one broken/blocked destination from aborting the others, and lets the client guide the user to manual setup without polluting the DB enum.

## Pure preflight/destination-validation helpers
- `services/destinationValidation.ts` holds side-effect-free helpers (`summarizeConnections`, `evaluatePlatformConnectedCheck`, `evaluateTokenValidityCheck`, `validateManualDestination`, `buildManualDestinationChecks`, `classifyPushDestinationError`) so the `/preflight` route stays a thin data-fetching shell and the logic is unit-testable.
- Preflight now also validates active **manual** destinations from `platformsTable`, filtered to `type in ('tiktok','custom_rtmp')` — OAuth/legacy rows in that table must NOT drive manual-destination checks.
- Tests: vitest in api-server (`pnpm --filter @workspace/api-server run test`), `src/**/*.test.ts`. Provider tests mock `globalThis.fetch`; set `KICK_CLIENT_ID`/`TWITCH_CLIENT_ID` etc. in `beforeAll` since `getProviderConfig` reads env at call-time.

## Required secrets (not yet added for beta)
`OAUTH_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `AGORA_CUSTOMER_ID`, `AGORA_CUSTOMER_SECRET`
