---
name: EAS dev build setup & triggering
description: How dev-client builds are configured (Metro dev-build mode vs Expo Go) and how to actually trigger an EAS build from the Replit main agent.
---

## Dev-build mode

`expo-dev-client` plugin in app config + an eas.json profile with
`developmentClient: true` switches the app from Expo Go to a custom dev build.
Required for native-only modules (Agora, etc.) that Expo Go can't load.
The `development` profile builds an installable APK (`android.buildType: "apk"`,
`distribution: "internal"`); `preview` bundles JS standalone (no dev client).

## Triggering an EAS build from the Replit main agent

`eas build` invokes `git` internally (even index-refreshing reads) to archive the
project. The Replit main-agent sandbox blocks those git writes — the command dies
with "Destructive git operations are not allowed ... /home/runner/workspace/.git/index.lock",
and it can leave a stale 0-byte `.git/index.lock` the main agent cannot remove
(the guard also blocks `rm` of that path).

**Fix:** run with `EAS_NO_VCS=1`, e.g.
`EAS_NO_VCS=1 eas build --platform android --profile development --non-interactive --no-wait`.
This makes EAS skip git entirely and archive the working dir, honoring `.gitignore`
(so `node_modules` is excluded) — works fine for this pnpm monorepo. Auth is via the
`EXPO_TOKEN` secret (`eas whoami` confirms). Poll status with `eas build:view <id>`.

**Why:** EAS_NO_VCS is a supported EAS mode, not a workaround; it's the clean way to
build where git is restricted. A development-profile Android build is the definitive
check that all `expo-*` packages are SDK-aligned — it compiles the native Kotlin that
release AAB builds skip, so it surfaces SDK-mismatch errors that AAB builds hide.
