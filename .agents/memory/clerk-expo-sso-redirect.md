---
name: Clerk Expo SSO redirect in standalone builds
description: Google OAuth in release APKs must use an explicit scheme+path redirect URI, not bare makeRedirectUri()
---

# Clerk Expo SSO redirect (standalone/release builds)

Rule: when calling Clerk `useSSO().startSSOFlow()` in an Expo app that ships as a standalone APK/IPA, always pass `redirectUrl: AuthSession.makeRedirectUri({ scheme: "<app scheme>", path: "sso-callback" })` and add a matching expo-router route (e.g. `app/sso-callback.tsx` with a loader + signed-in redirect).

**Why:** Bare `makeRedirectUri()` works in Expo Go (`exp://...`) but in a release build yields a scheme-only URI with no host/path. Android's intent resolution can hand the malformed redirect to the wrong app — observed symptom: tapping "Continue with Google" opened an email compose window instead of returning to the app. The clerk-auth skill's expo-sdk-oauth reference explicitly says native must pass scheme+path.

**How to apply:** Any Expo SSO/OAuth button headed for an EAS build. Also handle `createdSessionId == null` (Google sign-up can return `signUp.status === "missing_requirements"`, which otherwise silently no-ops). Redirect fixes are native-config-adjacent: they require a full rebuild + reinstall to test — bump `android.versionCode` so the new APK installs over the old one.

# Live Clerk enforces a native redirect allowlist — server self-registers it

Rule: live (pk_live) Clerk instances reject native OAuth with 400 "Redirect url mismatch" (code resource_missmatch) unless the app scheme URL (e.g. `readyloq-app://sso-callback`) is on the instance's authorized redirect list. Dev instances allow everything, so this only surfaces in production APKs.

**Why:** Replit-managed Clerk has no dashboard, and the live secret key exists only inside the production deployment — so the API server registers the URL itself at startup (fire-and-forget, idempotent list-then-POST against `api.clerk.com/v1/redirect_urls` with its own CLERK_SECRET_KEY). Requires a republish to take effect; no new APK.

**How to apply:** Adding any new native OAuth redirect scheme/path → add it to the server's native-redirect list module. Verify after republish without the APK: `curl -X POST 'https://<domain>/api/__clerk/v1/client/sign_ins?_is_native=1' -d 'strategy=oauth_google&redirect_url=<scheme>://<path>'` — mismatch gone = fixed. Also: live login strategies can differ from dev (e.g. password disabled on live, Google+email_code only); check `GET <domain>/api/__clerk/v1/environment` user_settings before assuming the mobile sign-in form matches. Password enablement for Production = user action in Auth pane (Configure → SSO providers → Production).

Residual suspects if OAuth ever regresses again: Google-side credentials (unlikely — website Google sign-in shares them).

# Standalone builds targeting the published backend need LIVE Clerk config

Rule: an APK/IPA that points at the published domain must bake the **live** publishable key AND `EXPO_PUBLIC_CLERK_PROXY_URL=https://<domain>/api/__clerk` into its eas.json build profile. The pk_test dev-instance key produces sessions the prod API rejects with 401 on every request ("workspace won't load" after a successful-looking sign-in).

**Why:** Replit-managed Clerk swaps test→live keys at publish time for web apps only; EAS builds run from the dev workspace and can't see live secrets. Publishable keys are public, so the live pk can be extracted from the deployed web bundle (`curl the site's JS, grep pk_live_`). The live FAPI custom domain (e.g. clerk.<domain>) may not resolve directly — the app must go through the site's `/api/__clerk` proxy (verify with `curl <domain>/api/__clerk/v1/environment`).

**How to apply:** Any EAS profile whose EXPO_PUBLIC_DOMAIN is the published domain. Dev/development profiles keep pk_test + the replit.dev domain. Remember: eas.json changes only take effect in a NEW APK build — republishing the web app does nothing for installed APKs. Prod and dev Clerk have separate user stores: users must use their production (website) account in such builds.
