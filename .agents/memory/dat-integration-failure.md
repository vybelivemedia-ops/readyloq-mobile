---
name: DAT SDK integration failure & revert
description: Why the Meta Ray-Ban DAT SDK integration (expo-meta-wearables) failed across 10 builds and what was learned
---

## What was attempted

Integrated `expo-meta-wearables@0.4.0` to give the app access to Meta Ray-Ban glasses via the DAT (Device Access Toolkit) SDK (`mwdat-core`).

## Root causes of all 10 build failures (builds #72–#82)

### Problem 1 — AGP8 namespace missing (builds #72–#73)
Original `android/build.gradle` had no `namespace "expo.modules.metawearables"` — required for AGP8. Fixed via pnpm patch.

### Problem 2 — Wrong Maven group ID (build #75)
Original package used `com.meta.wearable.mwdat` as the Maven group. Actual group in GitHub Packages is `com.meta.wearable`. Fixed via pnpm patch.

### Problem 3 — Fat AAR duplicate classes (build #75)
`mwdat-core:0.3.0` was a fat AAR bundling all transitive deps → duplicate class errors at Gradle link time. Fixed by upgrading to `0.9.0` (clean, non-fat AARs).

### Problem 4 — `ExpoMetaWearablesModule` class missing (builds #77–#79)
`mwdat-core:0.9.0` dropped the `ExpoMetaWearablesModule` Kotlin class that `0.3.0` had embedded. Autolinking generates `ExpoModulesPackageList.java` in the `:expo` Gradle submodule that imports it → `cannot find symbol`.

**First fix attempt (wrong):** Placed `ExpoMetaWearablesModule.kt` in `android/app/src/main/java/`. `:expo` is a *dependency of* `:app`, not the reverse — it can't see `:app` source. Build still failed.

**Second fix attempt (correct approach, wrong lockfile):** Moved the Kotlin file into the `expo-meta-wearables` package via pnpm patch (`android/src/main/java/expo/modules/metawearables/`). But `pnpm-lock.yaml` wasn't included in the commit → EAS server installed old patch without the Kotlin file.

### Problem 5 — JVM target mismatch (build #80)
After the lockfile was fixed, a new error appeared: `expo-meta-wearables:compileReleaseKotlin` targets JVM 11 but `compileReleaseJavaWithJavac` runs at 17 on the EAS build server. The patch's `build.gradle` had `jvmTarget = '11'` and `JavaVersion.VERSION_11` — needed to be `'17'` / `VERSION_17`.

**Decision:** At this point (10 consecutive failures, $68+ in EAS overages) the user asked to revert to the last stable build.

## Revert

Hard-reset to commit `1ba57a2` (pre-DAT, versionCode 71). Bumped versionCode to 83 to skip failed builds. Build #83 submitted from clean stable state.

## What is needed to re-attempt the integration

1. Fix the pnpm patch `android/build.gradle` JVM targets:
   ```gradle
   compileOptions {
     sourceCompatibility JavaVersion.VERSION_17
     targetCompatibility JavaVersion.VERSION_17
   }
   kotlinOptions { jvmTarget = '17' }
   ```
2. Keep `ExpoMetaWearablesModule.kt` inside the package's `android/src/main/java/` (not in `:app`)
3. **Critically:** always stage and commit `pnpm-lock.yaml` alongside the patch file — they must change together

**Why:** When `pnpm.patchedDependencies` changes, the lockfile hash changes. If only the patch file is committed but not the lockfile, EAS installs the pre-patch package.
