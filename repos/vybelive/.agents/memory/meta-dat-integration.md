---
name: Meta DAT integration
description: Real expo-meta-wearables-dat v1.3.0 API surface, Expo Go guard, Mock Device Kit flow, session-rollback rule, and credential/url-scheme decisions for VYBE LIVE.
---

# Meta Wearables DAT Integration

## Package
`expo-meta-wearables-dat` v1.3.0 (MIT). Wraps `facebook/meta-wearables-dat-ios`. Developer Preview. Max stream 720p/30fps (Bluetooth-constrained). iOS 17.0+, EAS dev build required (native module — never loads in Expo Go).

## Real API surface (verify against installed types, do NOT guess)
`useMetaWearables()` returns: `isConfigured, registrationState, permissionStatus, devices, streamState, startRegistration, startUnregistration, requestPermission, refreshDevices, createSession(deviceId?), startSession(id), stopSession(id), addStreamToSession(id, Partial<StreamSessionConfig>), capturePhoto(format?), enableMockDeviceKit(config?), disableMockDeviceKit, isMockDeviceKitEnabled, pairMockDevice, unpairMockDevice, mockDeviceSetCameraFeedFromCamera(id, facing)`.
- `RegistrationState` = `unavailable | available | registering | registered`.
- `StreamSessionState` = `stopping | stopped | waitingForDevice | starting | streaming | paused` — **there is no `error` state**; failures surface only as thrown promises, not via streamState.
- `Device` = `{ identifier, name, linkState, deviceType, compatibility }` — **no battery field** on the SDK type. Battery is only shown in mock/simulation for UI demo.
- `EMWDATStreamView` props = `{ isActive?, resizeMode?, style? }` — **no `sessionId` prop**. It renders whatever the active DAT session produces, gated by `isActive`.
- **Why:** a prior implementation guessed all of these wrong (e.g. `sessionId` prop, an `error` stream state, a battery field). Always read the package's `.d.ts` before coding against it.

## Session-start rollback rule (important)
`startGlassesStream()` must set the local `sessionId` **only after** `startSession` + `addStreamToSession` both succeed, and must `stopSession()` + clear `sessionId` in a catch before rethrowing.
- **Why:** an early-set `sessionId` guarded by `if (sessionId) return` permanently blocks retries if a later call throws, leaving the feature stuck until app restart.
- **How to apply:** treat session startup as transactional; failures propagate to the caller (pov.tsx) which calls `MetaGlassesSource.markStreamError()` so the preview shows an actionable error instead of a stuck "starting".

## Mock Device Kit (real SDK feature, dev/debug build only)
Enable flow: `enableMockDeviceKit({ initiallyRegistered, initialPermissionsGranted })` → `pairMockDevice()` → `mockDeviceSetCameraFeedFromCamera(id, "back")` (phone camera becomes the glasses feed). This is the official way to test the full flow without hardware. In Expo Go it cannot run, so a JS simulation hook substitutes.

## Expo Go guard (same pattern as react-native-agora)
Static import crashes Expo Go at module-load. Guard with `Constants.appOwnership === "expo"` before `require()`. Use `import type` for all SDK types (fully erased, safe in Expo Go). Loaded once at module init into a stable hook reference; falls back to a JS simulation hook in Expo Go. Same guard in `GlassesStreamView` for `EMWDATStreamView`.

## Architecture (why)
`useMetaWearables` is a React hook, so it cannot live in a class method (`BaseVideoSource.connect()`). `MetaWearablesContext` owns the hook + session state; `MetaGlassesSource` is a state proxy only. Keep callbacks stable by reading the hook value through a `datRef` (the simulation hook returns a fresh object each render).

## Stable session callbacks (effect-cleanup correctness)
`startGlassesStream`/`stopGlassesStream` must NOT depend on `sessionId` state in their useCallback deps. Mirror sessionId in a `sessionIdRef` and have the callbacks read/write through a stable `setSession(id)` helper (deps `[setSession]`).
- **Why:** consumers (pov.tsx) start/stop the session in a `useEffect`; if `stopGlassesStream` changes identity when the session is created, the effect's cleanup captures the pre-session (`sessionId=null`) version and no-ops, leaking the DAT session on unmount/source-change/live-toggle.
- **How to apply:** any session-lifecycle method consumed inside an effect cleanup must be referentially stable and read live state from a ref, not from a closed-over state value.

## captureGlassesPhoto error propagation
`captureGlassesPhoto()` must rethrow (not swallow) `capturePhoto` failures so the POV capture button can show real success vs error feedback (haptics + icon). Swallowing makes every tap look successful and hides operational failures.

## Credentials & URL scheme
- `META_APP_ID` / `META_APP_SECRET` injected via the Expo config plugin in `app.config.ts` (dynamic env access; `app.config.ts` replaces `app.json`). Omit for Developer Mode — Mock Device Kit still works.
- Registration callback uses `urlScheme: "vybelive"` (separate from the Expo Router scheme `"mobile"`). The context's Linking listener forwards `vybelive://` URLs to the SDK's `handleUrl`.
