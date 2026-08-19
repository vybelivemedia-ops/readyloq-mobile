---
name: Android startup crash — expo-background-fetch AnyTypeCache
description: Root cause, fix, and version pin for the NoClassDefFoundError startup crash on Android builds.
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
R8 full mode strips `expo.modules.kotlin.services.*` and `expo.modules.kotlin.types.*` because they
aren't reachable via static analysis. The `-dontwarn` in proguard-rules.pro suppressed the build
warning but did NOT prevent the runtime crash.
**Fix:** keep all three R8 flags `false` in `android/gradle.properties`.

### Issue B — expo-background-fetch version mismatch (build 210, FIXED)
Even with R8 OFF, `expo-background-fetch@57.0.10+` and `expo-task-manager@57.0.10+` crash with the
same `AnyTypeCache` error. Cause: the Expo team compiled these packages against a newer
expo-modules-core that contains `AnyTypeCache`. Our runtime is `expo-modules-core@3.0.30`, which
does NOT have that class. The crash is a genuine missing class, not an R8 stripping issue.
`expo-background-fetch@57.0.0–57.0.9` were compiled against the older expo-modules-core and are safe.
**Fix:** pin both packages to `57.0.9` (exact, no caret) in `artifacts/readyloq-app/package.json`.

## How to apply
- If the startup crash returns after an `expo-background-fetch` or `expo-task-manager` upgrade,
  check whether the newly installed version was compiled against a newer expo-modules-core:
  look for `AnyTypeCache.kt` under `node_modules/.pnpm/expo-modules-core@*/`.
- If the class exists, the runtime is compatible and the pin can be removed.
- If the class is absent, keep the pin at 57.0.9 (or the highest safe version).

## Guards
- `scripts/check-r8-flags.sh` — asserts all three R8 flags are false.
- `scripts/eas-submit.sh` — runs R8 guard + metro check before submission.
- A version-drift guard for expo-background-fetch is a proposed follow-up task.

## Version reference
- Safe: expo-background-fetch 57.0.0 – 57.0.9
- Broken: expo-background-fetch 57.0.10+ (with expo-modules-core@3.0.30)
- expo-modules-core@3.1.0 canaries may add AnyTypeCache; check before unpinning.
