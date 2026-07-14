---
name: OAuth deep-link scheme in Expo Go (iOS)
description: Why a hardcoded custom-scheme OAuth return URL is brittle under Expo Go, especially iOS.
---

# Custom-scheme OAuth return URLs under Expo Go

The OAuth flow uses a hardcoded return URL `mobile://oauth-complete` (app scheme `"mobile"` in app.json) and does NOT use `AuthSession.makeRedirectUri()` or `Linking.createURL()`. There are two independent capture paths for the final deep link from the server callback, and they behave very differently in Expo Go:

1. `WebBrowser.openAuthSessionAsync(authUrl, "mobile://oauth-complete")` → on iOS this sets `ASWebAuthenticationSession.callbackURLScheme = "mobile"`. ASWebAuthenticationSession intercepts redirects matching that scheme **without OS scheme registration**, so this path CAN capture `mobile://...` even in Expo Go iOS.
2. A `Linking.addEventListener("url")` listener filtering `url.startsWith("mobile://oauth-complete")` as a fallback. This NEVER fires in Expo Go, because Expo Go only registers the `exp://` scheme for OS deep links — `Linking.createURL('oauth-complete')` returns an `exp://…/--/oauth-complete` URL, not `mobile://`.

**Why this matters:** in Expo Go iOS the app relies SOLELY on path #1; the Linking fallback (#2) is inert. If `openAuthSessionAsync` resolves `dismiss`/non-success for any reason, there is no recovery and the post-OAuth `POST /oauth/:platform/confirm` is never sent (the mobile code logs "redirectUrl is null — confirm will NOT be called"). On Android Expo Go it is worse: Chrome Custom Tabs has no callbackURLScheme interception, so `mobile://` cannot reach the app at all (scheme unregistered) — both paths fail.

**How to apply:** distinguish the two redirect URIs — the HTTPS provider `redirect_uri` (server callback, e.g. `https://<domain>/api/oauth/youtube/callback`) is correct and unrelated; the suspect is always the app return deep link. An Expo-Go-safe flow would derive the return URL via `makeRedirectUri()`/`Linking.createURL()` so it emits `exp://` in Expo Go and `mobile://` in a dev/standalone build. A dev-client or standalone build that registers the `mobile` scheme makes `mobile://` work on both platforms.
