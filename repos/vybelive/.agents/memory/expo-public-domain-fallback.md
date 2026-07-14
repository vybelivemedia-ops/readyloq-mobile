---
name: EXPO_PUBLIC_DOMAIN native fallback trap
description: Why a standalone Android/iOS build can silently break all API/OAuth calls, and the rule for the mobile API base URL default.
---

# EXPO_PUBLIC_DOMAIN native fallback trap

The mobile app resolves its API base from `process.env.EXPO_PUBLIC_DOMAIN`
(`EXPO_PUBLIC_*` is inlined by Metro at bundle time from the shell env). If that
var is absent when the bundle is built, the base URL must NOT fall back to a
relative path (`"/api"` / `""`). On a native device a relative URL has no origin,
so every fetch (login, token refresh, OAuth init/confirm, streaming) rejects —
and the symptom is "the button does absolutely nothing" (no browser, no spinner,
the thrown network error is swallowed or shows a generic alert).

**Rule:** every place that builds the API base must default to the production
origin `https://getvybe.live`, never a relative path. `_layout.tsx` must call
`setBaseUrl` unconditionally with that same default (so the generated
api-client-react hooks and the hand-written `fetch` calls agree).

**Why:** A standalone APK regressed twice this way. The var was set ONLY in the
`dev` npm script; EAS build profiles and `eas update` do NOT carry shell env, so
cloud builds/OTA bundles shipped with it undefined. EAS build profile `env`
blocks apply to `eas build` only — `eas update` needs the var inlined in the
`update:*` script command itself.

**How to apply:**
- Bake `EXPO_PUBLIC_DOMAIN` into `eas.json` `preview`/`production` `env`, AND
  inline it on the `update:beta`/`update:prod` scripts in `package.json`.
- Keep the source-level prod-domain default as defense-in-depth so a forgotten
  env var degrades to "talks to prod" instead of "dead build".
- Enabling OTA (`expo-updates`, `checkAutomatically: ON_LOAD`) makes this stickier:
  a channel update published without the domain re-breaks an otherwise-good binary
  on next launch.
