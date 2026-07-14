# VYBE LIVE

A mobile-only POV wearable livestreaming platform — stream from phone/GoPro/Meta Glasses/external RTMP, multistream to YouTube/Twitch/Kick/Facebook/Instagram/TikTok, auto-generate AI clips, and manage everything from a dark-mode mobile app.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned by Replit)
- Required env: `SESSION_SECRET` — JWT signing secret (configured as Replit secret)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo / React Native (Expo Router v3, file-based routing)
- API: Express 5 + pino logging
- DB: PostgreSQL (Replit-managed) + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Auth: JWT (access 15m + refresh 30d), bcryptjs hashing
- Build: esbuild (CJS bundle)

## Where things live

- **DB schema** — `lib/db/src/schema/index.ts` (all tables, enums, insert schemas)
- **OpenAPI contract** — `lib/api-spec/openapi.yaml` (source of truth for all endpoints)
- **Generated Zod schemas** — `lib/api-zod/src/generated/api.ts`
- **Generated React Query hooks** — `lib/api-client-react/src/generated/api.ts`
- **API routes** — `artifacts/api-server/src/routes/` (one file per domain)
- **Auth middleware** — `artifacts/api-server/src/middlewares/auth.ts`
- **Mobile screens** — `artifacts/mobile/app/` (Expo Router file-based)
- **Design tokens** — `artifacts/mobile/constants/colors.ts` (dark-only palette)
- **Theme hook** — `artifacts/mobile/hooks/useColors.ts`
- **Mission Control (internal AI HQ)** — `artifacts/mission-control/` (React + Vite web app); routes in `artifacts/api-server/src/routes/missionControl.ts`; swappable AI service in `artifacts/api-server/src/services/aiExecutive.ts`; seed job `artifacts/api-server/src/jobs/seedMissionControl.ts` (`pnpm --filter @workspace/api-server run seed:mission-control`)
- **Portfolio monitoring** — `artifacts/api-server/src/services/portfolioMonitor.ts`; any `portfolio_assets` row with `live_url`/`github_repo` gets automatic external telemetry (SSRF-guarded URL ping + GitHub activity via the Replit connectors proxy); companies are added/configured from the Portfolio page in Mission Control

## Architecture decisions

- **Contract-first API**: OpenAPI spec in `lib/api-spec` drives all Zod schemas and React Query hooks via Orval codegen. Never hand-write client types.
- **JWT dual-token auth**: Short-lived access token (15m) + long-lived refresh token (30d) hashed and stored in DB. Stateless verification via `SESSION_SECRET`.
- **Dark-only theme**: Both `colors.light` and `colors.dark` map to the same dark palette — the app enforces dark UI on all devices regardless of system setting.
- **Express v5 params**: `req.params.X` is `string | string[]` in Express v5; always cast with `String(req.params.X)` before passing to Drizzle `eq()`.
- **Orval schema naming**: Generated Zod schemas are named after their operation (e.g. `RegisterBody`, `CreateStreamBody`, `ConnectPlatformBody`) — NOT after the conceptual type.

## Product

- **Auth**: Email/password register + login, JWT session management
- **POV Streaming**: Camera feed from phone (expo-camera CameraView), RTMP ingest key generation, simulated multistream to YouTube/Twitch/Kick/Facebook/Instagram/TikTok
- **AI Clips**: Create clips from streams (auto-processing simulation), publish to platforms with captions
- **Analytics**: Per-stream and overview analytics (views, watch hours, avg/peak viewers)
- **Subscription plans**: Free / Pro ($29/mo) / Enterprise ($99/mo)
- **Notifications**: In-app notification feed with mark-read
- **Admin dashboard**: User/stream management, platform metrics
- **Creator profiles**: Public profiles, follower counts, stream history

## User preferences

- Apply the PROMPT framework to every request: clarify Purpose, adopt the right expert Role, choose the most effective Output format, use provided Materials (and ask for missing ones), match Parameters (tone/audience/length), and Test the answer for accuracy/clarity before delivering. Ask concise clarifying questions when information is missing, and briefly note any improvements made to the original request. Keep it lightweight for routine engineering work — don't over-format or re-ask things already clear from context.

## Build provenance

- `lib/build-info` + `scripts/src/write-build-info.mjs` inject git provenance (branch/SHA/message/timestamp/tree status) into all six artifacts: `GET /api/version` + pino log fields (api-server), `window.__VYBE_BUILD_INFO__` via Vite define (4 web apps), `extra.buildInfo` in the Expo manifest (mobile). Validation report: `docs/build-provenance-validation.md`.
- Before any direct `eas build`/`eas update` invocation, run `node scripts/src/write-build-info.mjs` (the `build:beta:*` / `update:beta` scripts already do) — EAS servers have no `.git`, so the committed `artifacts/mobile/build-info.json` snapshot is the provenance source there.

## Gotchas

- After changing `lib/db/src/schema/index.ts`, run `pnpm run typecheck:libs` to rebuild composite libs before running `pnpm --filter @workspace/api-server run typecheck`.
- The Expo workflow version warnings (expo-camera, expo-secure-store) are non-blocking — the app runs fine in Expo Go.
- `db.$count()` is NOT a valid Drizzle API for use inside `.set({})`. Use a separate `db.select({ total: count() })` query first.
- `pnpm --filter @workspace/db run push` requires `DATABASE_URL` to be set (auto-available after Replit database provisioning).
- All `expo-*` packages must stay on one SDK line (currently SDK 54, driven by `expo@54.0.34`). The authoritative version for each is in `bundledNativeModules.json` inside the installed `expo` core. Do NOT force-install an `expo-*` package from a newer SDK line onto the SDK-54 core — it triggers EAS Android Kotlin build failures (e.g. "Unresolved reference: OptimizedRecord"). Fix mismatches by aligning versions, not by patching Kotlin.
- Never leave a generated `artifacts/mobile/android/` (or `ios/`) directory around — it's gitignored but EAS builds it bare-workflow, ignoring app.config.ts (version, plugins, everything). Delete before building. Likewise, never create `app.json`/`eas.json` at the workspace root. Root `.easignore` keeps the EAS upload small — keep it.
- `artifacts/mobile/scripts/patch-meta-dat.js` (runs on `postinstall`) is an unrelated patch for the third-party `expo-meta-wearables-dat` package — keep it.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
