---
name: Android OAuth openAuthSessionAsync dismiss race
description: Why Android OAuth completion drops the redirect and how to settle it correctly
---

# Android OAuth completion race (openAuthSessionAsync vs Linking)

On Android, `WebBrowser.openAuthSessionAsync(authUrl, "mobile://oauth-complete")` resolves
with `{ type: "dismiss" }` the instant the Chrome Custom Tab closes. The actual
`mobile://oauth-complete?...confirmToken=...` deep link is delivered as a SEPARATE Android
intent that reaches the JS `Linking` "url" listener ~50-100ms LATER.

**The bug:** resolving the race with `settle(null)` on `dismiss` tears down the Linking
listener before the URL event arrives, so the post-OAuth confirm call never fires and no
DB row is written. iOS is unaffected because `ASWebAuthenticationSession` returns
`{ type: "success", url }` directly.

**The fix:** on `type === "dismiss"`, do NOT settle immediately — start a ~500ms grace
timer. If the Linking URL arrives within the window, clear the timer and settle with the
URL; otherwise the timer settles null. Keep a `settled` guard (double-settle) and clear the
timer inside `settle` (leak safety). The `success` path still settles immediately.

**Why:** proven from production server logs — the callback 302 fired and stored the
confirm token, but `POST /confirm` was never called; the only request after callback was a
`useFocusEffect` connections refetch ~316ms later. That gap = tab closed + race already
settled null before the deep link landed.

**How to apply:** any Expo `openAuthSessionAsync` + `Linking` race for custom-scheme OAuth
redirects on Android. Two copies currently exist (onboarding + connected-accounts) — keep
them in sync or extract a shared helper.

**Diagnosis gotcha:** `console.log` only reaches Metro on a dev build connected to this
Metro server. Testing against the production app (`*.replit.app`) sends those logs to the
device console only — invisible to the agent. Use the dev build to capture `[OAUTH_DEBUG]`.

**Security note:** debug logs that print the redirect URL substring can expose part of the
single-use 5-min `confirmToken`. Remove `[OAUTH_DEBUG]` logging before final release.
