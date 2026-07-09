---
name: Clerk Expo SSO redirect in standalone builds
description: Google OAuth in release APKs must use an explicit scheme+path redirect URI, not bare makeRedirectUri()
---

# Clerk Expo SSO redirect (standalone/release builds)

Rule: when calling Clerk `useSSO().startSSOFlow()` in an Expo app that ships as a standalone APK/IPA, always pass `redirectUrl: AuthSession.makeRedirectUri({ scheme: "<app scheme>", path: "sso-callback" })` and add a matching expo-router route (e.g. `app/sso-callback.tsx` with a loader + signed-in redirect).

**Why:** Bare `makeRedirectUri()` works in Expo Go (`exp://...`) but in a release build yields a scheme-only URI with no host/path. Android's intent resolution can hand the malformed redirect to the wrong app — observed symptom: tapping "Continue with Google" opened an email compose window instead of returning to the app. The clerk-auth skill's expo-sdk-oauth reference explicitly says native must pass scheme+path.

**How to apply:** Any Expo SSO/OAuth button headed for an EAS build. Also handle `createdSessionId == null` (Google sign-up can return `signUp.status === "missing_requirements"`, which otherwise silently no-ops). Redirect fixes are native-config-adjacent: they require a full rebuild + reinstall to test — bump `android.versionCode` so the new APK installs over the old one.

Residual suspects if this ever recurs: Clerk-managed native redirect allowlist (needs Auth pane/support, not code).

# Standalone builds targeting the published backend need LIVE Clerk config

Rule: an APK/IPA that points at the published domain must bake the **live** publishable key AND `EXPO_PUBLIC_CLERK_PROXY_URL=https://<domain>/api/__clerk` into its eas.json build profile. The pk_test dev-instance key produces sessions the prod API rejects with 401 on every request ("workspace won't load" after a successful-looking sign-in).

**Why:** Replit-managed Clerk swaps test→live keys at publish time for web apps only; EAS builds run from the dev workspace and can't see live secrets. Publishable keys are public, so the live pk can be extracted from the deployed web bundle (`curl the site's JS, grep pk_live_`). The live FAPI custom domain (e.g. clerk.<domain>) may not resolve directly — the app must go through the site's `/api/__clerk` proxy (verify with `curl <domain>/api/__clerk/v1/environment`).

**How to apply:** Any EAS profile whose EXPO_PUBLIC_DOMAIN is the published domain. Dev/development profiles keep pk_test + the replit.dev domain. Remember: eas.json changes only take effect in a NEW APK build — republishing the web app does nothing for installed APKs. Prod and dev Clerk have separate user stores: users must use their production (website) account in such builds.
