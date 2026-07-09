---
name: Clerk Expo SSO redirect in standalone builds
description: Google OAuth in release APKs must use an explicit scheme+path redirect URI, not bare makeRedirectUri()
---

# Clerk Expo SSO redirect (standalone/release builds)

Rule: when calling Clerk `useSSO().startSSOFlow()` in an Expo app that ships as a standalone APK/IPA, always pass `redirectUrl: AuthSession.makeRedirectUri({ scheme: "<app scheme>", path: "sso-callback" })` and add a matching expo-router route (e.g. `app/sso-callback.tsx` with a loader + signed-in redirect).

**Why:** Bare `makeRedirectUri()` works in Expo Go (`exp://...`) but in a release build yields a scheme-only URI with no host/path. Android's intent resolution can hand the malformed redirect to the wrong app — observed symptom: tapping "Continue with Google" opened an email compose window instead of returning to the app. The clerk-auth skill's expo-sdk-oauth reference explicitly says native must pass scheme+path.

**How to apply:** Any Expo SSO/OAuth button headed for an EAS build. Also handle `createdSessionId == null` (Google sign-up can return `signUp.status === "missing_requirements"`, which otherwise silently no-ops). Redirect fixes are native-config-adjacent: they require a full rebuild + reinstall to test — bump `android.versionCode` so the new APK installs over the old one.

Residual suspects if this ever recurs: Clerk-managed native redirect allowlist (needs Auth pane/support, not code). Note: all eas.json profiles (incl. production) bake the pk_test dev-instance Clerk key — a Play Store build would auth against the dev user store.
