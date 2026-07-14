# Shared-Library Extraction Analysis
**Status: ANALYSIS ONLY — No code has been moved. Awaiting approval before extraction begins.**

**Scope:** Identify every application-agnostic subsystem between VYBE LIVE and a future ReadyLoq mobile app, classify each for shared-package placement, map coupling, estimate effort, and propose a final monorepo structure.

**ReadyLoq assumptions (inferred from the task, not from existing code):** A separate Expo/React Native mobile app with its own Express API backend, targeting the same POV wearables/streaming use case, running in this same pnpm monorepo.

---

## 1. Subsystem Inventory

All subsystems are grouped by location and evaluated on two dimensions:

- **App-agnostic?** — Does the code import VYBE branding, VYBE DB types, VYBE API hooks, or VYBE config values?
- **ReadyLoq likely to need it?** — Would a second POV-streaming wearables app plausibly consume this?

### 1a. Mobile subsystems

| # | Subsystem | Files | App-agnostic? | ReadyLoq needs it? | Verdict |
|---|---|---|---|---|---|
| M1 | Video source type system | `types/videoSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M2 | BaseVideoSource (abstract) | `sources/BaseVideoSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M3 | useVideoSource hook | `hooks/useVideoSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M4 | PhoneCameraSource | `sources/PhoneCameraSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M5 | MetaGlassesSource | `sources/MetaGlassesSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M6 | GoProSource | `sources/GoProSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M7 | ExternalRTMPSource | `sources/ExternalRTMPSource.ts` | ✅ Yes | ✅ Yes | **Extract** |
| M8 | USBCameraSource (stub) | `sources/USBCameraSource.ts` | ✅ Yes | ✅ Maybe | **Extract** |
| M9 | WebRTCSource (stub) | `sources/WebRTCSource.ts` | ✅ Yes | ✅ Maybe | **Extract** |
| M10 | Source factory + catalog | `sources/index.ts` | ⚠️ Near-miss | ✅ Yes | **Extract w/ minor change** |
| M11 | MetaWearablesContext | `contexts/MetaWearablesContext.tsx` | ⚠️ Near-miss | ✅ Yes | **Extract w/ minor change** |
| M12 | GlassesStreamView | `components/stream/GlassesStreamView.tsx` | ⚠️ Near-miss | ✅ Yes | **Extract w/ minor change** |
| M13 | AgoraLocalView | `components/stream/AgoraLocalView.tsx` + `.web.tsx` | ✅ Yes | ✅ Yes | **Extract** |
| M14 | useAgoraRTC | `hooks/useAgoraRTC.ts` + `.web.ts` | ❌ Coupled | ✅ Yes | **Extract after decoupling** |
| M15 | useVoiceRecognition | `hooks/useVoiceRecognition.ts` + `.types.ts` + `.web.ts` | ⚠️ Near-miss | ✅ Yes | **Extract w/ minor change** |
| M16 | useGestureRecognition | `hooks/useGestureRecognition.ts` + `.types.ts` + `.web.ts` | ⚠️ Near-miss | ✅ Maybe | **Extract w/ minor change** |
| M17 | uploadMedia (pick portion) | `lib/uploadMedia.ts` | ❌ Coupled | ⚠️ Partially | **Extract partial** |
| M18 | AuthContext | `contexts/AuthContext.tsx` | ❌ Coupled | ✅ Yes | **Do not extract yet** |
| M19 | StreamContext | `contexts/StreamContext.tsx` | ❌ Coupled | ⚠️ Partially | **Do not extract** |
| M20 | useColors / constants/colors | `hooks/useColors.ts`, `constants/colors.ts` | ❌ VYBE brand | ❌ No | **Do not extract** |
| M21 | useVersionCheck | `hooks/useVersionCheck.ts` | ❌ URL-coupled | ❌ No | **Do not extract** |
| M22 | app.config.ts plugin | `withMetaDATAndroidDisabled` in `app.config.ts` | ✅ Yes | ✅ Yes | **Extract** (with M11) |
| M23 | patch-meta-dat.js | `scripts/patch-meta-dat.js` | ✅ Yes | ✅ Yes | **Extract** (with M11) |

### 1b. API server subsystems

| # | Subsystem | Files | App-agnostic? | ReadyLoq needs it? | Verdict |
|---|---|---|---|---|---|
| A1 | AES-256-GCM token encryption | `lib/crypto.ts` | ✅ Yes | ✅ Yes | **Extract** |
| A2 | OAuth provider configs + Graph calls | `services/oauthProviders.ts` | ⚠️ Near-miss | ✅ Yes | **Extract w/ minor change** |
| A3 | OAuth redirect URI builder | `services/oauthRedirects.ts` | ❌ Coupled | ✅ Yes | **Extract after decoupling** |
| A4 | pino logger factory | `lib/logger.ts` | ✅ Yes | ✅ Yes | **Extract** |
| A5 | SMTP email sender | `services/email.ts` | ⚠️ Near-miss | ✅ Yes | **Extract w/ minor change** |
| A6 | Replit object storage client | `lib/objectStorage.ts` + `objectAcl.ts` | ✅ Yes | ✅ Yes (same infra) | **Extract** |
| A7 | Upload rate limiter | `lib/uploadRateLimit.ts` | ✅ Yes | ✅ Yes | **Extract** |
| A8 | Stripe singleton | `lib/stripe.ts` | ✅ Yes | ✅ Maybe | **Extract** |
| A9 | JWT auth middleware | `middlewares/auth.ts` | ❌ Coupled | ✅ Yes | **Extract after decoupling** |
| A10 | Entitlements / plan limits | `lib/entitlements.ts` | ❌ VYBE-specific | ❌ No | **Do not extract** |
| A11 | Typing signals | `lib/typingSignals.ts` | ✅ Yes | ❌ Probably not | **Do not extract (VYBE feature)** |
| A12 | All AI/executive/MC services | `services/ai*`, `services/executive*`, `services/chief*`, etc. | ❌ VYBE-specific | ❌ No | **Do not extract** |
| A13 | All route handlers | `routes/*` | ❌ VYBE API | ❌ No | **Do not extract** |

### 1c. Already-shared libs (keep in lib/, no changes needed)

| Package | Notes |
|---|---|
| `@workspace/build-info` | Already consumed by all artifacts — multi-app by design |
| `@workspace/db` | VYBE-specific schema; ReadyLoq owns its own DB |
| `@workspace/api-spec` | VYBE OpenAPI contract — ReadyLoq defines its own |
| `@workspace/api-zod` | Generated from VYBE spec — not portable |
| `@workspace/api-client-react` | VYBE React Query hooks — not portable |

---

## 2. Coupling Detail — What Exactly Needs to Change

### M10 — Source factory/catalog (`sources/index.ts`)
One near-miss: `VideoSourceType` is documented as a mirror of `DB deviceTypeEnum`. When this moves to a shared package, the DB schema and the type will be in separate packages. The type already lives in `types/videoSource.ts` (not imported from `@workspace/db`), so **no code change is required** — just a documentation update.

### M11 — MetaWearablesContext
- **Coupling 1:** Deep-link scheme `vybelive://` is hardcoded on line ~310: `if (url.startsWith("vybelive://") && _realHandleUrl)`. Fix: accept a `registrationScheme` prop/config on the provider (`"vybelive"` by default, `"readyloq"` for ReadyLoq).
- **Coupling 2:** None other — registration, discovery, session, and simulation logic are SDK-driven.

### M12 — GlassesStreamView
- **Coupling 1:** Inline StyleSheet has `backgroundColor: "#09090F"` (VYBE dark background). The component already accepts a `style` prop — StyleSheet background just needs to be removed or made transparent so the parent controls it.
- No other coupling.

### M14 — useAgoraRTC (**Medium effort**)
- **Coupling 1:** `import { useStream } from "@/contexts/StreamContext"` → reads `isLive`, `agoraCredentials`, `activeStream.id`, `networkQuality`.
- **Coupling 2:** `import { useGetAgoraToken } from "@workspace/api-client-react"` → makes a VYBE API call to generate a channel token.
- **Fix:** The hook's signature currently takes `streamId`, `credentials`, `enabled` as parameters but then *also* reads from StreamContext internally. The context dependency must be fully extracted so the hook is a pure, injectable function:
  - Remove the StreamContext import entirely.
  - Accept `networkQuality` callback as an optional `onNetworkQuality` prop.
  - Remove `useGetAgoraToken` from inside the hook; callers pass pre-fetched credentials.

### M15/M16 — useVoiceRecognition / useGestureRecognition
- **Coupling:** `.types.ts` files import `RecognitionSensitivity` from `@workspace/api-client-react`. This generated type (`"low" | "medium" | "high"`) must be either inlined into the shared package or moved to a shared types package.
- Fix: Inline the three-value union (`"low" | "medium" | "high"`) directly in the types file and remove the `@workspace/api-client-react` import.

### M17 — uploadMedia (partial extraction)
- `pickMedia()` is fully generic (expo-image-picker only) — extractable.
- `uploadPickedMedia()` calls `requestUploadUrl` from `@workspace/api-client-react` — VYBE-specific. Fix: accept a `requestUploadUrl` function as a parameter (dependency injection), so each app supplies its own upload endpoint.

### M18 — AuthContext (do not extract yet)
- Storage keys `vybe_access_token`, `vybe_refresh_token`, `vybe_user` are hardcoded.
- `setAuthTokenGetter` + `User` type both come from `@workspace/api-client-react`.
- Fix path would be: parameterize key names; accept a generic `User` shape; inject the token getter. This is medium complexity and AuthContext isn't in the first wave of ReadyLoq needs (ReadyLoq will write its own auth against its own API). Defer.

### A2 — oauthProviders.ts
- **Coupling:** Scopes are opinionated for VYBE's feature set (inbox scopes: `pages_manage_metadata`, `instagram_manage_messages`; live broadcast scopes: `publish_video`). ReadyLoq may want a subset.
- Fix: Scopes for each platform become a required parameter to `getProviderConfig` or a configuration object, not hardcoded. The HTTP helper functions (`buildAuthorizationUrl`, `exchangeCodeForTokens`, `fetchPlatformProfile`, etc.) are pure and require no changes.

### A3 — oauthRedirects.ts
- **Coupling:** Hardcodes `mobile://` (VYBE's Expo scheme) and Mission Control web redirect paths.
- Fix: Accept `mobileScheme` and `webRedirectBase` as parameters.

### A5 — email.ts
- **Coupling:** `BETA_FROM_EMAIL` fallback includes `"VYBE LIVE"` name.
- Fix: Accept `appName` / `fromEmail` as configuration, not hardcoded.

### A9 — JWT auth middleware (**Medium effort**)
- **Coupling 1:** Token labels `"vybe:access-token:v1"` and `"vybe:refresh-token:v1"` are hardcoded — both apps must use different labels to prevent token replay across apps.
- **Coupling 2:** `import { db, usersTable } from "@workspace/db"` — ReadyLoq has its own DB/users table.
- Fix: Accept label strings and a DB-agnostic user-lookup function as parameters. The JWT sign/verify logic and the HMAC key derivation pattern are fully generic.

---

## 3. Dependency Graph

```
                     ┌─────────────────────────────────────────────────────────┐
                     │                  packages/ (NEW)                        │
                     │                                                         │
  ┌──────────────────┤  @workspace/video-source                                │
  │ types/videoSource│    IVideoSource, BaseVideoSource, VideoSourceError       │
  │ sources/*        │    useVideoSource hook                                   │
  │ hooks/useVideo   │    createVideoSource factory, VIDEO_SOURCE_CATALOG       │
  │   Source         │    Concrete sources: Phone, Glasses, GoPro, RTMP, USB   │
  └──────────────────┤    Peer deps: react, react-native, expo-camera          │
                     │                    │                                     │
                     │                    ▼                                     │
  ┌──────────────────┤  @workspace/meta-wearables                              │
  │ contexts/Meta    │    MetaWearablesProvider, useMetaWearablesContext         │
  │   WearablesCtx   │    GlassesStreamView (native DAT + fallbacks)            │
  │ components/      │    withMetaDATAndroidDisabled config plugin               │
  │   GlassesStream  │    patch-meta-dat.js                                     │
  │ app.config plugin│    Peer deps: expo-meta-wearables-dat, expo-camera,      │
  └──────────────────┤               expo-constants, react-native               │
                     │              ▲ (depends on video-source)                 │
                     │                                                         │
  ┌──────────────────┤  @workspace/agora-rn                                    │
  │ hooks/useAgora   │    useAgoraRTC hook (decoupled from StreamContext)        │
  │   RTC            │    AgoraLocalView component                              │
  │ components/Agora │    Platform stubs (.web.ts)                              │
  │   LocalView      │    Peer deps: react-native-agora, expo-constants,        │
  └──────────────────┤               react, react-native                       │
                     │                                                         │
  ┌──────────────────┤  @workspace/recognition-rn                              │
  │ hooks/useVoice   │    useVoiceRecognition (hands-free triggers)             │
  │   Recognition    │    useGestureRecognition (stub, future ML)               │
  │ hooks/useGesture │    RecognitionSensitivity type (moved here)              │
  │   Recognition    │    Peer deps: expo-speech-recognition, expo-constants    │
  └──────────────────┤                                                         │
                     │                                                         │
  ┌──────────────────┤  @workspace/oauth-server  [Node.js only]                │
  │ lib/crypto.ts    │    encryptToken / decryptToken (AES-256-GCM)             │
  │ services/oauth   │    getProviderConfig (scopes configurable)               │
  │   Providers.ts   │    buildAuthorizationUrl, exchangeCodeForTokens,         │
  │ services/oauth   │    fetchPlatformProfile, fetchFacebookTargets,           │
  │   Redirects.ts   │    fetchFacebookRtmpCredentials, fetchInstagramRtmpCreds  │
  └──────────────────┤    No workspace deps                                    │
                     │                                                         │
  ┌──────────────────┤  @workspace/pino-logger  [Node.js only]                 │
  │ lib/logger.ts    │    createLogger() factory                                │
  └──────────────────┤    Depends on: @workspace/build-info                    │
                     │                                                         │
  ┌──────────────────┤  @workspace/object-storage-server  [Node.js only]       │
  │ lib/objectStorage│    Replit sidecar Storage client, signed URL helpers     │
  │ lib/objectAcl    │    ObjectAclPolicy, canAccessObject, setObjectAclPolicy  │
  │ lib/uploadRate   │    Sliding-window rate limiter                           │
  │   Limit          │    Peer deps: @google-cloud/storage                     │
  └──────────────────┤                                                         │
                     │                                                         │
  ┌──────────────────┤  @workspace/stripe-client  [Node.js only]               │
  │ lib/stripe.ts    │    getStripe() singleton, isStripeConfigured()           │
  └──────────────────┤    Peer deps: stripe                                    │
                     │                                                         │
                     └─────────────────────────────────────────────────────────┘
                                       │
              ┌────────────────────────┼──────────────────────────┐
              │                        │                          │
   artifacts/mobile (VYBE)   artifacts/readyloq-mobile   artifacts/readyloq-api
   artifacts/api-server       (new)                       (new)
```

**Shared package internal dependency order (no circular refs):**
```
@workspace/build-info          (no workspace deps)
  └── @workspace/pino-logger

@workspace/video-source        (no workspace deps)
  └── @workspace/meta-wearables

@workspace/agora-rn            (no workspace deps)

@workspace/recognition-rn      (no workspace deps)

@workspace/oauth-server        (no workspace deps)
@workspace/object-storage-server (no workspace deps)
@workspace/stripe-client       (no workspace deps)
```

No circular dependencies. All packages are acyclic.

---

## 4. Effort Estimates

| Package | Decoupling needed | Effort | Risk |
|---|---|---|---|
| `@workspace/video-source` | Remove `@/` path alias → relative imports | **XS** (<2 h) | Low |
| `@workspace/meta-wearables` | Parameterize `vybelive://` scheme; remove hardcoded background color | **S** (half-day) | Low |
| `@workspace/agora-rn` | Remove StreamContext dependency; inject credentials via props | **M** (1–2 days) | Medium — pov.tsx must be updated too |
| `@workspace/recognition-rn` | Inline `RecognitionSensitivity` type; remove api-client-react import | **S** (half-day) | Low |
| `@workspace/oauth-server` | Make scopes configurable; parameterize redirect schemes | **M** (1–2 days) | Medium — routes/oauth.ts must update call sites |
| `@workspace/pino-logger` | None | **XS** (<1 h) | Low |
| `@workspace/object-storage-server` | None | **S** (2–3 h) | Low |
| `@workspace/stripe-client` | None | **XS** (<1 h) | Low |
| Workspace plumbing (pnpm-workspace.yaml, tsconfig, catalog pins) | Add `packages/*` glob; add references | **XS** (<1 h) | Low |
| **Total** | | **~5–8 dev-days** | |

---

## 5. Proposed Final Monorepo Structure

```
workspace/
│
├── artifacts/                        ← Deployable apps (unchanged structure)
│   ├── api-server/                   ← VYBE API  (@workspace/api-server)
│   ├── mobile/                       ← VYBE mobile (@workspace/mobile)
│   ├── mission-control/              ← Internal AI HQ (@workspace/mission-control)
│   ├── website/                      ← Marketing site (@workspace/website)
│   ├── marketing/                    ← @workspace/marketing
│   ├── mockup-sandbox/               ← Dev-only (@workspace/mockup-sandbox)
│   │
│   ├── readyloq-api/                 ← NEW: ReadyLoq API server
│   └── readyloq-mobile/              ← NEW: ReadyLoq Expo app
│
├── packages/                         ← NEW: Cross-app shared code (multi-product)
│   │                                     Added to pnpm-workspace.yaml packages:
│   │                                     Added to root tsconfig.json references:
│   │
│   ├── video-source/                 ← @workspace/video-source
│   │   ├── src/
│   │   │   ├── types.ts              (IVideoSource, VideoSourceCapabilities, etc.)
│   │   │   ├── BaseVideoSource.ts
│   │   │   ├── useVideoSource.ts
│   │   │   ├── sources/
│   │   │   │   ├── PhoneCameraSource.ts
│   │   │   │   ├── MetaGlassesSource.ts
│   │   │   │   ├── GoProSource.ts
│   │   │   │   ├── ExternalRTMPSource.ts
│   │   │   │   ├── USBCameraSource.ts
│   │   │   │   └── WebRTCSource.ts
│   │   │   └── index.ts             (factory + catalog)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── meta-wearables/               ← @workspace/meta-wearables
│   │   ├── src/
│   │   │   ├── MetaWearablesContext.tsx
│   │   │   ├── GlassesStreamView.tsx
│   │   │   └── index.ts
│   │   ├── config/
│   │   │   ├── withMetaDATAndroidDisabled.ts  (config plugin)
│   │   │   └── patch-meta-dat.js
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── agora-rn/                     ← @workspace/agora-rn
│   │   ├── src/
│   │   │   ├── useAgoraRTC.ts
│   │   │   ├── useAgoraRTC.web.ts
│   │   │   ├── AgoraLocalView.tsx
│   │   │   ├── AgoraLocalView.web.tsx
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── recognition-rn/               ← @workspace/recognition-rn
│   │   ├── src/
│   │   │   ├── types.ts              (RecognitionSensitivity, trigger types)
│   │   │   ├── useVoiceRecognition.ts + .types.ts + .web.ts
│   │   │   ├── useGestureRecognition.ts + .types.ts + .web.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── oauth-server/                 ← @workspace/oauth-server  [Node.js]
│   │   ├── src/
│   │   │   ├── crypto.ts             (AES-256-GCM encrypt/decrypt)
│   │   │   ├── providers.ts          (getProviderConfig, build/exchange/refresh)
│   │   │   ├── redirects.ts          (buildRedirectUri — parameterized)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── pino-logger/                  ← @workspace/pino-logger  [Node.js]
│   │   ├── src/
│   │   │   └── index.ts              (createLogger factory)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── object-storage-server/        ← @workspace/object-storage-server  [Node.js]
│   │   ├── src/
│   │   │   ├── client.ts             (Replit sidecar Storage client)
│   │   │   ├── acl.ts                (ObjectAclPolicy, canAccessObject)
│   │   │   ├── uploadRateLimit.ts    (sliding-window limiter)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── stripe-client/                ← @workspace/stripe-client  [Node.js]
│       ├── src/
│       │   └── index.ts              (getStripe, isStripeConfigured)
│       ├── package.json
│       └── tsconfig.json
│
├── lib/                              ← VYBE-internal generated/contract libs (unchanged)
│   ├── api-spec/                     ← VYBE OpenAPI spec + Orval codegen
│   ├── api-zod/                      ← Generated Zod schemas
│   ├── api-client-react/             ← Generated React Query hooks
│   ├── db/                           ← Drizzle schema + PG client (VYBE DB)
│   └── build-info/                   ← Build provenance (already multi-app)
│
├── scripts/                          ← Workspace utility scripts (unchanged)
├── pnpm-workspace.yaml               ← Add: packages/*
├── tsconfig.json                     ← Add packages/* to references (composite libs only)
└── tsconfig.base.json                ← Unchanged
```

---

## 6. pnpm-workspace.yaml Delta

```yaml
# Current:
packages:
  - artifacts/*
  - lib/*
  - lib/integrations/*
  - scripts

# After extraction:
packages:
  - artifacts/*
  - lib/*
  - lib/integrations/*
  - packages/*          # ← add this line
  - scripts
```

---

## 7. What Does NOT Move

| Code | Reason |
|---|---|
| `@workspace/db` schema | VYBE user/stream/clip/OAuth tables — ReadyLoq owns its own schema and its own Postgres DB |
| `@workspace/api-spec` / `api-zod` / `api-client-react` | VYBE API contract — ReadyLoq defines its own spec and generates its own hooks from it |
| `services/socialPublishing`, `socialInsights`, `inboxReply`, `scheduledPostPublisher`, `clipProcessor`, `accountLifecycle` | VYBE product logic (unified inbox, AI clips, scheduled publishing) |
| All Mission Control / AI executive stack | VYBE-only internal tooling |
| `StreamContext` | Encodes VYBE stream domain: `DeviceType`, `activeStream`, per-stream credentials, wake lock tied to VYBE session |
| `AuthContext` | Tied to VYBE token key names + VYBE User type — defer extraction until ReadyLoq auth contract is defined |
| `useColors` / `constants/colors` | VYBE dark brand palette |
| `useVersionCheck` | Hardcoded to getvybe.live domain |
| `lib/entitlements.ts` | VYBE plan limits (free/pro/enterprise) |
| `lib/typingSignals.ts` | VYBE conversations feature only |
| All route handlers (`routes/*`) | VYBE API surface |
| All AI services (`services/ai`, `executiveCapabilities`, etc.) | VYBE-only |

---

## 8. Sequencing Recommendation

If approved, the extraction should proceed in this order to minimize broken builds at each step:

**Wave 1 — Pure lifts, zero coupling to break (XS/S):**
1. `@workspace/video-source` — no imports to fix; just move + update path aliases
2. `@workspace/pino-logger` — 30-line move
3. `@workspace/object-storage-server` — no coupling; lift 3 files
4. `@workspace/stripe-client` — 25-line move

**Wave 2 — Minor parameterization (S):**
5. `@workspace/meta-wearables` — fix `vybelive://` scheme + GlassesStreamView color
6. `@workspace/recognition-rn` — inline `RecognitionSensitivity` type

**Wave 3 — Meaningful decoupling (M):**
7. `@workspace/agora-rn` — remove StreamContext dependency; update pov.tsx call sites
8. `@workspace/oauth-server` — make scopes configurable; parameterize redirect scheme

**Wave 4 — ReadyLoq bootstrapping (external):**
9. Create `artifacts/readyloq-mobile` and `artifacts/readyloq-api` consuming the new packages
10. Define ReadyLoq's own `lib/readyloq-api-spec` + codegen + `lib/readyloq-db`

---

## 9. Summary Table

| Package | Wave | Effort | Dependencies | Node/RN/Both |
|---|---|---|---|---|
| `@workspace/video-source` | 1 | XS | none | React Native |
| `@workspace/pino-logger` | 1 | XS | @workspace/build-info | Node.js |
| `@workspace/object-storage-server` | 1 | S | @google-cloud/storage | Node.js |
| `@workspace/stripe-client` | 1 | XS | stripe | Node.js |
| `@workspace/meta-wearables` | 2 | S | @workspace/video-source | React Native |
| `@workspace/recognition-rn` | 2 | S | expo-speech-recognition | React Native |
| `@workspace/agora-rn` | 3 | M | react-native-agora | React Native |
| `@workspace/oauth-server` | 3 | M | none | Node.js |
