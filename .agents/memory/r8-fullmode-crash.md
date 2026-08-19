---
name: Android startup crash — expo-background-fetch AnyTypeCache
description: Root cause, fix, and version history for the NoClassDefFoundError startup crash on Android builds.
---

# Android startup crash — expo-background-fetch AnyTypeCache

## The symptom
Every Android build crashes at startup (before any JS runs) with:

```
NoClassDefFoundError: expo/modules/kotlin/types/AnyTypeCache
at expo.modules.backgroundfetch.BackgroundFetchModule.definition(BackgroundFetchModule.kt:43)
```

## Root causes (two distinct issues)

### Issue A — R8 full mode (builds 194–201, FIXED)
`android.enableR8.fullMode=true` was re-enabled by a task agent commit.
R8 full mode strips `expo.modules.kotlin.services.*` and `expo.modules.kotlin.types.*`.
The `-dontwarn` in proguard-rules.pro suppressed the build warning but did NOT prevent the runtime crash.
**Fix:** keep all three R8 flags `false` in `android/gradle.properties`.

### Issue B — Wrong SDK version for expo-background-fetch (builds 210–212, FIXED)
The root problem: `expo-background-fetch` and `expo-task-manager` were installed at
`57.0.x` (the SDK 57 releases) instead of `14.0.x` (the correct SDK 54 releases).
The `57.0.x` packages were compiled by the Expo team against a newer `expo-modules-core`
that contains `AnyTypeCache`. Our runtime (`expo-modules-core@3.0.30`, part of SDK 54)
does not have that class → crash at startup.

Checking the Kotlin *source* of `BackgroundFetchModule.kt` showed no `AnyTypeCache`
reference, but the compiled AAR bytecode references it via inline function expansion by
the Kotlin compiler. Checking source was insufficient; the compiled AAR is what matters.

**Fix:** run `pnpm expo install --fix` to align all packages with the installed SDK:
- `expo-background-fetch@57.0.x` → `14.0.9`
- `expo-task-manager@57.0.x` → `14.0.9`
- Also updates `expo-file-system` patch version.
The 14.0.x packages were compiled against `expo-modules-core@3.0.x` — no AnyTypeCache.

## How to apply
- If the startup crash returns after an `expo-background-fetch` or `expo-task-manager` upgrade,
  run `pnpm expo install --fix` first to check if the versions got bumped to the wrong SDK.
- Never check Kotlin source files for AnyTypeCache — check the installed version numbers.
  SDK 54 correct versions: `expo-background-fetch@14.x`, `expo-task-manager@14.x`.

## Guards
- `scripts/check-r8-flags.sh` — asserts all three R8 flags are false.
- `scripts/eas-submit.sh` — runs R8 guard + metro check before submission.
- A proposed follow-up adds a package-version guard to catch wrong-SDK version drift.

## Version reference
| Package | SDK 54 (correct) | SDK 57 (wrong, crashes SDK 54) |
|---|---|---|
| expo-background-fetch | 14.0.x | 57.0.x |
| expo-task-manager | 14.0.x | 57.0.x |
| expo-modules-core | 3.0.x | has AnyTypeCache |
