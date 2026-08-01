---
name: Clerk Expo SSO redirect
description: Why Google OAuth "goes to email" on Android and the two-part fix required.
---

## Rule
Standalone Expo APKs need **both** of the following or Google OAuth returns to the email client instead of the app:

1. `AuthSession.makeRedirectUri({ scheme: "readyloq-app", path: "sso-callback" })` — NOT `Linking.createURL(...)`. The `expo-auth-session` helper generates a URI that coordinates with Android's intent system. `Linking.createURL` produces a subtly different format (`readyloq-app:///sso-callback` with leading slash, or `readyloq-app://sso-callback` without) that Android misroutes on some devices.

2. Explicit `intentFilters` in `app.json` under `android`:
```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": false,
    "data": [{ "scheme": "readyloq-app" }],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```
Without this, the Expo-generated filter may not catch the callback URL in all Android versions.

**Why:** Android's Custom Tab sends the OAuth redirect to the OS intent system. The OS matches it against the APK's registered intent filters. If there's no explicit filter or the URI format doesn't match, Android falls through to another handler (often the email client).

**How to apply:** Any time Google (or other OAuth) sign-in is added to an Expo standalone build, apply both fixes in `GoogleAuthButton.tsx` + `app.json` and submit a new EAS build.

## Clerk allowlist
The API server (`lib/clerk-redirect-urls.ts`) registers redirect URLs with Clerk at startup. Both forms are now registered:
- `readyloq-app://sso-callback`
- `readyloq-app:///sso-callback`

This is server-side and takes effect without a rebuild, but it's the Clerk acceptance side — the Android routing side still requires the fixes above + a new build.

## maybeCompleteAuthSession placement
`WebBrowser.maybeCompleteAuthSession()` is called at module scope in both `GoogleAuthButton.tsx` (imported by the sign-in screen) and `app/sso-callback.tsx`. This is correct. For native custom-scheme redirects, Android routes the deep link back to the app via intents — `maybeCompleteAuthSession` is mainly relevant for web/HTTPS redirect flows.
