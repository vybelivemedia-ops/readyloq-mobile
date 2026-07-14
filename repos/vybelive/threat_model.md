# Threat Model

## Project Overview

VYBE LIVE is a mobile-first livestreaming platform with an Expo client and a publicly deployed Express API backed by PostgreSQL via Drizzle. Users register with email/password, receive JWT access and refresh tokens, manage stream destinations and clips, and access analytics; a smaller admin surface exposes platform-wide metrics and user listings.

## Assets

- **User accounts and sessions** — email addresses, password hashes, JWT access tokens, and refresh tokens. Compromise enables account takeover and potential admin impersonation.
- **Mobile device session material** — access tokens, refresh tokens, cached user state, and any other secrets persisted on-device. These must be treated as sensitive even though they reside on the client because theft can be escalated into server-side session abuse.
- **Sensitive creator infrastructure data** — RTMP ingest URLs, stream keys, connected platform RTMP destinations, and platform stream keys. Exposure enables unauthorized streaming to creator channels.
- **Private recordings and object storage contents** — uploaded recordings, private object paths, generated clip inputs, and any other data kept in the app storage bucket. Exposure or cross-tenant access can leak creator content and backend-managed assets.
- **User profile and operational data** — creator profiles, notifications, stream history, clips, analytics, reports, and subscription state. Exposure affects privacy and business integrity.
- **Application secrets** — `SESSION_SECRET`, database credentials, and any future third-party streaming/payment credentials. Compromise breaks trust in authentication and backend integrity.
- **Admin visibility** — platform-wide user listings, metrics, and stream inventory. This data is higher sensitivity than normal creator data and must stay behind a server-enforced admin boundary.

## Trust Boundaries

- **Mobile client to API** — all request bodies, query params, path params, and headers crossing into the API are untrusted.
- **Mobile app runtime to device storage** — anything the app persists locally may be recoverable through malware, backups, rooted-device access, or physical compromise unless it is stored in an OS-backed secure keystore.
- **API to PostgreSQL** — the API has broad read/write access to the database; flaws at the API layer can directly expose or modify stored data.
- **API to object storage and recording fetch sources** — the API can mint signed upload URLs, read private bucket objects, and fetch externally hosted recordings during clip generation. Caller-supplied object paths or URLs must be bound to the owning user and approved storage locations before the backend reads them.
- **Public to authenticated boundary** — `/api/auth/*`, `/api/healthz`, and public creator profiles are reachable without auth, while most creator surfaces require a valid bearer token.
- **Authenticated creator to admin boundary** — `/api/admin/*` must only be reachable with a verified admin role from a trusted server-issued token.
- **Production to dev-only boundary** — `artifacts/api-server`, shared libraries under `lib/`, and the mobile app are production-relevant; `artifacts/mockup-sandbox` is development-only under current assumptions and should normally be ignored.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*.ts`
- **Highest-risk code areas**: `artifacts/api-server/src/middlewares/auth.ts`, `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/src/routes/admin.ts`, `artifacts/api-server/src/routes/storage.ts`, `artifacts/api-server/src/routes/streams.ts`, `artifacts/api-server/src/routes/clips.ts`, and response paths returning platform, storage, or stream credentials
- **Mobile auth storage anchor**: `artifacts/mobile/contexts/AuthContext.tsx`
- **Public surfaces**: `/api/healthz`, `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/users/:userId`
- **Authenticated surfaces**: streams, platforms, clips, analytics, notifications, reports, subscriptions, `/api/auth/me`, `/api/users/me*`
- **Admin surfaces**: `/api/admin/*`
- **Dev-only surfaces usually out of scope**: `artifacts/mockup-sandbox/**`

## Threat Categories

### Spoofing

Authentication depends entirely on JWTs signed with `SESSION_SECRET`. The system must never fall back to a predictable default signing key in production, and every protected route must verify a bearer token signed with the real server secret. Refresh-token based session renewal must prove the presented token is the currently issued session for that user, not merely a structurally valid JWT.

Browser-based OAuth account-linking flows are part of the same identity boundary. OAuth `state` must be one-time and bound to the initiating authenticated user/session, not just signed and timestamped, so that attacker-generated authorization URLs cannot attach a victim's third-party account to the wrong VYBE user.

Account-recovery flows are part of the same identity boundary. Password-reset secrets must only be delivered over a trusted out-of-band channel to the account owner and must never be exposed back through a public API response.

### Tampering

The client can send profile edits, stream metadata, destination settings, clip publication requests, and subscription selections. The API must validate all inputs with the generated Zod schemas and must derive ownership and privileged fields server-side rather than trusting client-provided identifiers or roles.

Subscription and plan changes are entitlement changes, not ordinary profile edits. Any upgrade to paid service tiers must be backed by a trusted server-side billing event or other privileged control, rather than directly accepting a client-selected plan as authoritative.

Recording finalization is part of the same integrity boundary. The backend must only accept recording locations that were server-issued for the authenticated user and current stream, and it must reject arbitrary bucket paths or external URLs before clip generation consumes them.

### Information Disclosure

The API stores and returns sensitive operational values such as RTMP ingest URLs, stream keys, and connected platform credentials. These values must only be disclosed to the owning authenticated user when strictly necessary, must never appear in public profile or admin responses unless intended, and must never leak through logs or broad list endpoints.

Private object-storage contents and recording paths are also sensitive. Routes that serve from private storage must enforce authentication and object-level authorization, and public endpoints must not expose internal account metadata beyond the documented public profile fields.

The mobile client also crosses a disclosure boundary when it persists session material locally. Long-lived refresh tokens and other reusable credentials must use OS-provided secure storage rather than general-purpose app storage.

### Denial of Service

Public auth endpoints can be targeted for credential stuffing or brute-force attempts, while authenticated endpoints can trigger repeated database work or paid third-party jobs. The production deployment should avoid unauthenticated expensive operations and should enforce reasonable request validation, rate controls, quotas, and idempotency on auth-sensitive routes and cost-amplifying media/integration endpoints.

### Elevation of Privilege

The admin surface is small but high impact. The application must enforce the creator/admin boundary on the server for every `/api/admin/*` route, and any weakness in JWT issuance, verification, or refresh handling must be treated as a privilege-escalation risk because forged or replayed tokens can expose admin-only data.
