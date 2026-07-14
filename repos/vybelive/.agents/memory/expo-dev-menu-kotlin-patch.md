---
name: Expo dev-tooling SDK-mismatch Kotlin errors
description: Why EAS Android Kotlin build failures in expo-dev-menu/expo-dev-launcher are a symptom of mixed-SDK expo-* versions, and the correct fix (align all expo-* to one SDK).
---

## The Rule

Never run an `expo-*` package at a version from a different SDK line than the installed `expo` core. The authoritative version for every Expo package lives in `bundledNativeModules.json` inside the installed `expo` core — that is what `expo install` / `expo install --fix` reads. Align to it; do not patch around a mismatch.

**Why:** Dev tooling from a newer SDK line references Kotlin APIs from a newer `expo-modules-core` than an older core provides. Concretely, SDK-56-line `expo-dev-menu`/`expo-dev-launcher` reference `expo-modules-core@3.1.x` symbols (`OptimizedRecord`, `AnyTypeCache`) and an interface method (`onDidCreateReactActivityDelegateNotification`) that do not exist in the SDK-54 `expo-modules-core@3.0.30`. EAS Android **debug/development** APK builds then fail with "Unresolved reference: OptimizedRecord" and "overrides nothing". Release AAB builds are unaffected because `src/debug/java` is skipped during release compilation — so the failure only shows up in dev builds. A `postinstall` Kotlin-patch script was once used to strip those symbols; that treats the symptom, not the cause.

**How to apply:** If EAS Android shows those Kotlin errors, do NOT patch the Kotlin. Find the `expo-*` package(s) sitting on a different SDK line than the core and bring them back in line (revert to the `bundledNativeModules.json` version, or `npx expo install --fix` when network allows). Verify after install: no `expo-*` entry from a foreign SDK major remains in the mobile importer of `pnpm-lock.yaml`, and the resolved dev tooling's `android/` is free of `OptimizedRecord`/`AnyTypeCache`. Stale foreign-version dirs left in the unpruned `node_modules/.pnpm` virtual store are harmless — EAS builds fresh from the lockfile.

**Context:** As of this writing the app is pinned to SDK 54 (core `expo@54.0.34`). SDK 56 is stable (RN 0.85 / React 19.2) but aligning UP is a high-risk native migration; aligning DOWN to the core's SDK is the low-risk fix. `patch-meta-dat.js` is a separate, unrelated third-party patch (Meta wearables) — leave it alone.
