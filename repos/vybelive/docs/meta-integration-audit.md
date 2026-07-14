# VYBE LIVE — Meta Integration Audit

**Scope:** Read-only audit of all existing Meta-related functionality in the VYBE LIVE codebase (pnpm monorepo: Expo mobile app + Express API).
**Rule applied:** Only code that actually exists is reported. No speculation. ReadyLoq does not exist in this repository, so section 8–10 classify VYBE's code for reuse and propose a migration path — they do not describe ReadyLoq internals.

There are **two entirely separate "Meta" concerns** in this codebase. Keeping them distinct is essential:

| Concern | What it is | Where it lives |
|---|---|---|
| **Meta Wearables (hardware)** | Ray-Ban / Oakley Meta smart glasses POV video via Meta's Device Access Toolkit (DAT) SDK | Mobile app only (`artifacts/mobile`) |
| **Meta OAuth (social)** | Facebook + Instagram OAuth for account linking, multistream destinations, unified inbox, clip publishing | API server (`artifacts/api-server`) + mobile settings UI |

There is **no Meta Quest code anywhere in the repository.** Quest is not referenced in any source file.

---

## 1. Authentication

### 1a. Meta OAuth (Facebook / Instagram) — EXISTS, full implementation

- **`artifacts/api-server/src/services/oauthProviders.ts`** — provider config + all Graph API calls.
  - `facebook` and `instagram` both use `META_APP_ID` / `META_APP_SECRET` (Replit secrets, present).
  - Auth URL: `https://www.facebook.com/v20.0/dialog/oauth`; token URL: `https://graph.facebook.com/v20.0/oauth/access_token`.
  - **Facebook scopes:** `pages_show_list`, `pages_read_engagement`, `pages_manage_engagement`, `publish_video`, `public_profile`.
  - **Instagram scopes:** `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `publish_video`, `public_profile`.
  - Functions: `buildAuthorizationUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, `fetchPlatformProfile` (Graph `/me`), `fetchFacebookTargets` (lists managed Pages), `fetchFacebookRtmpCredentials` (creates `live_videos`), `fetchInstagramAccount` (resolves linked IG Professional account), `fetchInstagramRtmpCredentials` (creates IG Live broadcast).
  - Meta does **not** use PKCE here (only Kick does); Meta is a plain OAuth 2.0 code flow.
- **`artifacts/api-server/src/routes/oauth.ts`** — endpoints:
  - `GET /oauth/:platform/init` — builds authorization URL with a signed state token.
  - `GET /oauth/:platform/callback` — handles Meta's redirect. Two-phase for mobile (anti confused-deputy), direct commit for the Mission Control web console.
  - `POST /oauth/:platform/confirm` — commits encrypted tokens after verifying the mobile user's session.
- **`artifacts/api-server/src/services/oauthRedirects.ts`** — redirect-URI generation, distinguishing mobile deep links (`mobile://`) from web Mission Control redirects.
- **`artifacts/mobile/app/settings/connected-accounts.tsx`** — UI to connect/manage Facebook & Instagram (and other platforms).

### 1b. Token management — EXISTS

- **`artifacts/api-server/src/lib/crypto.ts`** — AES-256-GCM encryption at rest for all OAuth tokens. Requires `OAUTH_ENCRYPTION_KEY` (64 hex chars). Wire format base64 `[12B IV][16B tag][ciphertext]`. Exports `encryptToken`, `decryptToken`, `isEncryptionConfigured`.
- **`lib/db/src/schema/index.ts` → `oauthConnectionsTable`** — stores `encryptedAccessToken`, `encryptedRefreshToken`, `tokenExpiresAt`, `scopes`, `status` (enum: connected/refresh_needed/expired/error/disconnected), plus Facebook target fields (`targetType`, `targetId`, `targetName`, `encryptedTargetToken`).
- Token refresh: `refreshAccessToken` in `oauthProviders.ts`; consumed by `socialPublishing.ts`, `socialInsights.ts`, `accountLifecycle.ts`, `push.ts`.

### 1c. "Meta login" as an app sign-in method — DOES NOT EXIST

VYBE's own user auth is **email/password + JWT** (see `threat_model.md`, `routes/auth.ts`). There is **no "Sign in with Facebook/Meta"** for VYBE account creation. Meta OAuth is exclusively for *linking* social publishing destinations to an already-authenticated VYBE user.

---

## 2. Device Support

### 2a. Meta Ray-Ban / Oakley Smart Glasses — EXISTS (mobile only)

- **SDK:** `expo-meta-wearables-dat` v1.3.0 (MIT), Meta Wearables Device Access Toolkit, **Developer Preview, iOS-first**. Declared in `artifacts/mobile/package.json`.
- **`artifacts/mobile/contexts/MetaWearablesContext.tsx`** — the core wrapper/provider. Handles registration, discovery, Mock Device Kit, and session-based streaming.
- **Device types recognized** (`deviceTypeLabel`): `rayBanMeta`, `oakleyMetaHSTN`, `oakleyMetaVanguard`, `metaRayBanDisplay`, `rayBanMetaOptics`.
- **`artifacts/mobile/app/settings/meta-glasses.tsx`** — settings UI: Mock Device Kit toggle, registration, device status (battery/link state), test-stream preview, stream-quality specs.

### 2b. Meta Quest — DOES NOT EXIST

No Quest / VR / headset code anywhere.

### 2c. Bluetooth — EXISTS (declarative only)

- Bluetooth is the DAT transport (glasses ↔ phone), **managed entirely inside the Meta SDK**. VYBE contains **no direct BLE stack** (no `react-native-ble-plx` etc.).
- Permissions declared: iOS `NSBluetoothAlwaysUsageDescription` and Android `android.permission.BLUETOOTH` in `app.config.ts`.
- UI copy in `meta-glasses.tsx` states "Connection: Bluetooth (BLE)" and notes bandwidth is shared between device control and video.

### 2d. Wi-Fi connectivity — EXISTS only for non-Meta sources

- Wi-Fi is used by RTMP ingest sources (`ExternalRTMPSource`, `GoProSource`) and network-quality measurement (`NSLocalNetworkUsageDescription`), **not** by the Meta glasses path (glasses are Bluetooth). No Wi-Fi Direct / device-discovery-over-Wi-Fi code exists.

### 2e. Device discovery & pairing — EXISTS (delegated to Meta SDK)

- Discovery is reactive via the DAT SDK `onDevicesChange` listener surfaced in `MetaWearablesContext`. VYBE does not scan/enumerate hardware itself.
- **Pairing is delegated:** real glasses are paired in the **Meta AI app**; VYBE only *registers* with the Meta AI app via deep link (`startRegistration` → `vybelive://` callback handled by `handleUrl`). `requiresPairing: true` is declared on `MetaGlassesSource`.
- **Mock Device Kit** (`enableMockKit`): pairs a virtual device fed by the phone's back camera — the supported hardware-free dev path.

---

## 3. Camera Integration

- **Phone camera:** `expo-camera` `CameraView` (`expo-camera` ~17.0.10). Used by `PhoneCameraSource`, and as the visual stand-in for glasses in Expo Go / simulation (`GlassesStreamView`, `VideoSourcePreview`).
- **Glasses camera:** rendered by the native **`EMWDATStreamView`** from `expo-meta-wearables-dat`, wrapped by **`artifacts/mobile/components/stream/GlassesStreamView.tsx`**. Frames are pulled natively by the SDK — no session-id prop, just `isActive`.
- **Photo capture:** `captureGlassesPhoto()` in `MetaWearablesContext` → SDK `capturePhoto("jpeg")`; wired into `pov.tsx`.
- **Video capture / recording:** server-side via Agora Cloud Recording (`agoraCloudRecording.ts`) + FFmpeg (`clipProcessor.ts`); playback/download in `artifacts/mobile/app/recordings.tsx`.
- **External camera providers (video-source registry, `artifacts/mobile/sources/`):** `PhoneCameraSource`, `MetaGlassesSource`, `GoProSource`, `ExternalRTMPSource`, `USBCameraSource` (roadmap, `available:false`), `WebRTCSource` (roadmap, `available:false`). All extend `BaseVideoSource` and are created via `createVideoSource()` in `sources/index.ts`.
- **Media ingestion:** `artifacts/mobile/lib/uploadMedia.ts` (multipart upload to Replit Object Storage).

---

## 4. Streaming

**Key architectural fact:** Meta Glasses do **NOT** flow video through Agora. The glasses feed is rendered by the native DAT view (`EMWDATStreamView`); its `MetaGlassesSource.mode = "sdk_capture"` only so the **audio** pipeline still applies. All other sdk_capture sources (phone) push video through Agora.

- **Agora RTC (mobile):** `artifacts/mobile/hooks/useAgoraRTC.ts` (`react-native-agora` ^4.5.4) — channel join, local video/audio publish, network quality, token renewal. Local view: `artifacts/mobile/components/stream/AgoraLocalView.tsx`.
- **Agora Media Push (RTMP converter, server):** `artifacts/api-server/src/services/agoraPush.ts` — `startPushTask`/`stopPushTask`/`getPushTaskStatus`. Converts the RTC stream to RTMP for simultaneous distribution to YouTube/Twitch/Facebook/Instagram. Uses raw (non-transcoding) mode for single-publisher POV.
- **Agora Cloud Recording (server):** `artifacts/api-server/src/services/agoraCloudRecording.ts` — `acquireResourceId`/`startRecording`/`stopRecording`, output to object storage.
- **RTMP:** ingest via `ExternalRTMPSource` / `GoProSource`; egress via Agora Media Push + platform `live_videos` (Facebook/Instagram) and YouTube liveStreams.
- **RTSP:** DOES NOT EXIST (no RTSP code).
- **WebRTC:** `WebRTCSource` exists but is **roadmap only** (`available:false`); no live WebRTC transport implemented.
- **Live video pipeline entry point:** `artifacts/mobile/app/stream/pov.tsx` orchestrates the source, Agora, and (when source is `meta_glasses`) the DAT session lifecycle.

---

## 5. Audio

- **Microphone / audio streaming:** driven by Agora in `useAgoraRTC.ts` (`enableAudio`, `adjustRecordingSignalVolume`). Glasses audio is captured via the glasses' Bluetooth mic profile — `MetaGlassesSource.capabilities.hasMicrophone = true`; because the glasses source keeps `mode:"sdk_capture"`, the Agora audio pipeline still carries the mic.
- **Voice capture / speech processing:** `artifacts/mobile/hooks/useVoiceRecognition.ts` (`expo-speech-recognition` ^3.1.3) — hands-free trigger-phrase detection ("clip that") with fuzzy matching + confidence gating. Configured in `app.config.ts` (`expo-speech-recognition` plugin).
- **Server-side audio:** `clipProcessor.ts` extracts/transcribes audio (FFmpeg + Whisper) for AI clips.
- Not Meta-specific: none of the audio stack is tied to the Meta glasses beyond the shared Agora pipeline.

---

## 6. Complete Inventory of Meta-Related Building Blocks

### Meta Wearables (hardware — mobile)
| Kind | Name | File |
|---|---|---|
| SDK | `expo-meta-wearables-dat` v1.3.0 | `artifacts/mobile/package.json` |
| Context/Provider | `MetaWearablesProvider`, `useMetaWearablesContext` | `contexts/MetaWearablesContext.tsx` |
| Hook (real) | `useMetaWearables` (from SDK) | consumed in `MetaWearablesContext.tsx` |
| Hook (fallback) | `useSimulatedMetaWearables` (JS sim) | `contexts/MetaWearablesContext.tsx` |
| Utility | `handleUrl` (deep-link reg callback), `deviceTypeLabel` | `contexts/MetaWearablesContext.tsx` |
| Video source | `MetaGlassesSource` (extends `BaseVideoSource`) | `sources/MetaGlassesSource.ts` |
| Registry | `createVideoSource`, `VIDEO_SOURCE_CATALOG` | `sources/index.ts` |
| Component | `GlassesStreamView` (wraps `EMWDATStreamView`) | `components/stream/GlassesStreamView.tsx` |
| Component | `VideoSourcePreview` (branches on `meta_glasses`) | `components/stream/VideoSourcePreview.tsx` |
| Screen | `MetaGlassesSettingsScreen` | `app/settings/meta-glasses.tsx` |
| Screen (consumer) | POV streaming orchestration | `app/stream/pov.tsx` |
| Screen (consumer) | source picker | `app/stream/setup.tsx` |
| Provider mount | `MetaWearablesProvider` in tree | `app/_layout.tsx` |
| Config plugin | `withMetaDATAndroidDisabled` + Bluetooth perms | `app.config.ts` |
| Build patch | post-install native-module patch | `scripts/patch-meta-dat.js` |

### Meta OAuth (social — API + mobile UI)
| Kind | Name | File |
|---|---|---|
| Service | provider config + Graph calls | `api-server/src/services/oauthProviders.ts` |
| Route | init/callback/confirm | `api-server/src/routes/oauth.ts` |
| Service | redirect URI builder | `api-server/src/services/oauthRedirects.ts` |
| Service | token encryption | `api-server/src/lib/crypto.ts` |
| Service | multistream publish | `api-server/src/services/socialPublishing.ts` |
| Service | analytics | `api-server/src/services/socialInsights.ts` |
| Service | unified inbox replies | `api-server/src/services/inboxReply.ts` |
| Service | scheduled posts | `api-server/src/services/scheduledPostPublisher.ts` |
| Service | account status/lifecycle | `api-server/src/services/accountLifecycle.ts` |
| Service | clip publishing to Meta | `api-server/src/services/clipProcessor.ts` |
| Service | Agora→RTMP push to Meta | `api-server/src/services/agoraPush.ts` |
| Route | platform destinations | `api-server/src/routes/platforms.ts` |
| Route | push control | `api-server/src/routes/push.ts` |
| DB table | `oauthConnectionsTable` | `lib/db/src/schema/index.ts` |
| Screen | connect/manage accounts | `mobile/app/settings/connected-accounts.tsx`, `settings/platforms.tsx` |

---

## 7. Architecture

**Where the integration begins.**
- *Wearables:* `app/_layout.tsx` mounts `MetaWearablesProvider` app-wide. The provider decides at module init whether to load the real SDK (`require("expo-meta-wearables-dat")`, guarded by `Constants.appOwnership !== "expo"`) or the JS simulation hook.
- *OAuth:* begins on the server at `GET /oauth/:platform/init`, triggered from the mobile Connected Accounts screen.

**How authentication works (social).** Signed-state OAuth 2.0 code flow → callback → (mobile: two-phase confirm binding tokens to the VYBE session) → tokens AES-256-GCM encrypted and stored in `oauthConnectionsTable`. Refresh via `refreshAccessToken`; status tracked by enum. This is *linking only* — VYBE app login is separate (JWT email/password).

**How streaming works.**
1. User picks a source in `stream/setup.tsx`; `createVideoSource()` instantiates it.
2. `pov.tsx` goes live. For phone/USB the frames publish through **Agora RTC** → server **Agora Media Push** converts to RTMP → fans out to platform ingest URLs (Meta `live_videos`, YouTube, Twitch, Kick).
3. For **Meta Glasses**, `pov.tsx` calls `metaWearables.startGlassesStream()` (createSession → startSession → addStreamToSession `{resolution:"medium",frameRate:30}`). Video renders through the **native DAT view**, bypassing Agora video; audio still rides the Agora pipeline.

**How media flows.** Live RTC/DAT feed → (server) Agora Cloud Recording → object storage → `clipProcessor` (FFmpeg + Whisper) generates clips → published to platforms (incl. Meta) via `socialPublishing`/`clipProcessor`. Recordings browsable/downloadable in `app/recordings.tsx`.

**How devices are managed.** Registration (deep link to Meta AI app) and pairing (inside Meta AI app) are delegated to Meta; VYBE observes `devices`, derives `connectedDevice`/`batteryLevel`, and drives session lifecycle. Mock Device Kit substitutes the phone camera for hardware-free testing.

**How lifecycle events are handled.**
- `useEffect` in `pov.tsx` starts the glasses session when `isLive && deviceType==="meta_glasses"` and stops it on teardown / end-stream; errors surface via `MetaGlassesSource.markStreamError`.
- Deep-link `url` events routed to the SDK's `handleUrl` for registration callbacks.
- `sessionIdRef` mirrors `sessionId` so cleanup callbacks stay stable and never leak a session.
- Expo Go / missing-native-module falls back to simulation identically at every layer (context, stream view, preview).

---

## 8. Reusability Classification for ReadyLoq

Assumes ReadyLoq is a separate Expo/React Native mobile app that wants POV glasses streaming and/or social multistream. Classification is based only on VYBE code as it exists.

### Directly reusable (drop-in, VYBE-agnostic)
- **`contexts/MetaWearablesContext.tsx`** — self-contained SDK wrapper + Expo Go simulation; no VYBE-specific imports. *Why:* pure DAT lifecycle + normalized device model.
- **`components/stream/GlassesStreamView.tsx`** — native view wrapper with camera/web fallbacks; only depends on `expo-camera` + the SDK. *Why:* zero app coupling.
- **`sources/MetaGlassesSource.ts` + `sources/BaseVideoSource.ts` + `types/videoSource.ts`** — the source abstraction is app-neutral. *Why:* capability/state model, no VYBE domain types.
- **`lib/crypto.ts`** (AES-256-GCM token encryption) — generic, only needs `OAUTH_ENCRYPTION_KEY`.
- **`app.config.ts` plugin `withMetaDATAndroidDisabled` + `scripts/patch-meta-dat.js`** — required to build the SDK at all; reuse verbatim.

### Reusable with modification
- **`oauthProviders.ts`** — provider configs/Graph calls are reusable, but scopes are tuned to VYBE's feature set (inbox, live publishing). *Why:* trim scopes to ReadyLoq's needs; keep the fetch helpers.
- **`routes/oauth.ts` + `oauthRedirects.ts`** — flow is solid but hardcodes VYBE deep-link schemes (`mobile://`, Mission Control) and session semantics. *Why:* swap schemes/redirects and the session-binding to ReadyLoq's auth.
- **`useAgoraRTC.ts` + `AgoraLocalView.tsx` + server Agora services** — reusable streaming spine, but wired to VYBE's stream/token endpoints and DB. *Why:* re-point to ReadyLoq's API + credentials.
- **`app/settings/meta-glasses.tsx`** — UI logic reusable; styling/tokens (`useColors`, dark palette, copy) are VYBE brand. *Why:* restyle, keep the state machine.
- **`VideoSourcePreview.tsx` + `sources/index.ts` registry** — reusable pattern; prune to the sources ReadyLoq actually ships.
- **`useVoiceRecognition.ts`** — reusable hook; trigger phrases/actions are VYBE-specific.

### Not reusable (VYBE-specific)
- **`oauthConnectionsTable`** and other `lib/db` schema — coupled to VYBE users/streams/Postgres. *Why:* ReadyLoq owns its own schema; use as a reference model only.
- **`socialPublishing.ts`, `socialInsights.ts`, `inboxReply.ts`, `scheduledPostPublisher.ts`, `clipProcessor.ts`, `accountLifecycle.ts`** — encode VYBE's clip/inbox/analytics product logic.
- **`app/stream/pov.tsx`, `stream/setup.tsx`** — VYBE UX orchestration and layout.
- **Mission Control / seed / roadmap references to "meta"** — internal VYBE tooling, irrelevant to ReadyLoq.

---

## 9. Dependency Diagram

```
                       ┌───────────────────────────── MOBILE (artifacts/mobile) ─────────────────────────────┐
                       │                                                                                       │
  app/_layout.tsx ─── mounts ──▶ MetaWearablesProvider (contexts/MetaWearablesContext.tsx)                    │
                       │              │  loads (guarded require)                                               │
                       │              ├── real:  expo-meta-wearables-dat  (useMetaWearables, EMWDATStreamView, │
                       │              │                                     handleUrl)  ── Bluetooth ─▶ Meta AI│
                       │              └── fallback: useSimulatedMetaWearables (JS)         app ─▶ Ray-Ban/Oakley
                       │                                                                              glasses  │
                       │                                                                                       │
  app/stream/setup.tsx ─ picks ─▶ sources/index.ts (createVideoSource, CATALOG)                               │
                       │                     │                                                                 │
                       │        ┌────────────┼───────────────┬───────────────┬───────────────┐               │
                       │   PhoneCamera   MetaGlasses(*)     GoPro         ExternalRTMP     USB/WebRTC(roadmap) │
                       │     Source        Source           Source          Source                            │
                       │                     │  (state proxy; mode=sdk_capture for audio)                      │
                       │                                                                                       │
  app/stream/pov.tsx ──┤── if meta_glasses ─▶ MetaWearablesContext.startGlassesStream()/stop/capturePhoto     │
                       │── else (phone/usb) ─▶ useAgoraRTC.ts ─▶ react-native-agora ── RTC ─┐                  │
                       │                                                                     │                 │
  VideoSourcePreview ──┤── meta_glasses ─▶ GlassesStreamView ─▶ EMWDATStreamView (native)   │                 │
                       │── sdk_capture  ─▶ AgoraLocalView / expo-camera CameraView           │                 │
                       │                                                                     │                 │
  useVoiceRecognition ─┴─ expo-speech-recognition (hands-free "clip that")                  │                 │
                       │                                                                     │                 │
  app.config.ts: withMetaDATAndroidDisabled + Bluetooth perms   scripts/patch-meta-dat.js   │                 │
                       └─────────────────────────────────────────────────────────────────── │ ────────────────┘
                                                                                             │ RTC uplink
                       ┌───────────────────────────── API (artifacts/api-server) ────────── ▼ ────────────────┐
                       │  services/agoraPush.ts (RTC▶RTMP converter, raw mode)                                 │
                       │        │ fans out RTMP to platform ingest URLs                                        │
                       │        ├─▶ Facebook/Instagram live_videos ◀─ oauthProviders.ts (fetch*RtmpCredentials)│
                       │        ├─▶ YouTube / Twitch / Kick                                                    │
                       │  services/agoraCloudRecording.ts ─▶ object storage ─▶ clipProcessor.ts (FFmpeg/Whisper)
                       │                                                                                       │
                       │  OAUTH:  routes/oauth.ts (init/callback/confirm) ─▶ oauthProviders.ts + oauthRedirects│
                       │             │ tokens ─▶ lib/crypto.ts (AES-256-GCM) ─▶ oauthConnectionsTable (DB)     │
                       │             └─ consumed by socialPublishing / socialInsights / inboxReply / push      │
                       │  META_APP_ID / META_APP_SECRET (env)  ──feeds──▶ facebook + instagram configs         │
                       └───────────────────────────────────────────────────────────────────────────────────────┘
  (*) Meta Glasses video bypasses Agora; only its audio uses the Agora pipeline (mode=sdk_capture).
```

---

## 10. Migration Plan — Sharing with the ReadyLoq Mobile App

The cleanest path in this monorepo is to **extract the reusable, app-neutral pieces into shared `lib/*` packages**, leaving VYBE- and ReadyLoq-specific product code in each app. Ordered by dependency safety:

**Phase 0 — Prerequisites (both apps)**
- Add `expo-meta-wearables-dat`, `expo-camera`, `react-native-agora` to ReadyLoq with the **same SDK-aligned versions** (respect the SDK-line rule in `replit.md` — do not mix SDK lines).
- Copy `app.config.ts`'s `withMetaDATAndroidDisabled` plugin + `scripts/patch-meta-dat.js` into ReadyLoq (mandatory or the Android EAS build fails on GitHub-gated Maven artifacts).
- Add Bluetooth/camera/mic permission strings to ReadyLoq's `app.config.ts`.

**Phase 1 — Extract `@workspace/meta-wearables` (highest value, lowest risk)**
- Move `MetaWearablesContext.tsx`, `GlassesStreamView.tsx`, `MetaGlassesSource.ts`, `BaseVideoSource.ts`, `types/videoSource.ts` into a new composite lib.
- These have no VYBE domain coupling → both apps import the provider + components directly.
- Register the lib in root `tsconfig.json` references (per `pnpm-workspace` skill). Keep `react`/`react-native` as peer deps.

**Phase 2 — Extract `@workspace/streaming-core` (optional)**
- Move `useAgoraRTC.ts`, `AgoraLocalView.tsx`, and the source registry pattern.
- Parameterize the token/credential fetch so each app injects its own API base + auth (VYBE and ReadyLoq have separate backends/DBs).

**Phase 3 — OAuth (only if ReadyLoq needs Meta social)**
- Extract `oauthProviders.ts` + `crypto.ts` into `@workspace/oauth`. Keep them provider-generic; trim scopes per app.
- Do **not** share `routes/oauth.ts`/`oauthRedirects.ts` verbatim — they bind to VYBE deep-link schemes and session semantics. Fork per app or parameterize scheme + session-verification callbacks.
- ReadyLoq owns its own `oauth_connections` table (schema is a reference, not shared).

**What is NOT migrated:** `pov.tsx`, `stream/setup.tsx`, `socialPublishing`/`socialInsights`/`inboxReply`/`scheduledPostPublisher`/`clipProcessor`/`accountLifecycle`, `oauthConnectionsTable`, and all Mission Control/seed references — these are VYBE product logic.

**Validation after each phase:** `pnpm run typecheck:libs` then `pnpm run typecheck`; verify both apps build (`pnpm --filter <app> run typecheck`) and the glasses flow works in Expo Go (simulation) + an EAS dev build (real SDK / Mock Device Kit).

---

### Confidence & gaps
- Every file and symbol above was read or grep-confirmed to exist. No Meta Quest, RTSP, or "Sign in with Meta" code exists — those are explicit absences, not omissions.
- `expo-meta-wearables-dat` is declared in `package.json` but was not present in `node_modules` at audit time (install/prebuild-dependent); this does not affect the source-level integration described here.
