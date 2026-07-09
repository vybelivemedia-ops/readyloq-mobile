---
name: ReadyLoq native Windows/EAS build
description: Why the standalone Android native build fails on Windows and how EAS cloud build sidesteps it; standalone eas.json setup
---

## "ninja: error: manifest 'build.ninja' still dirty after 100 tries" is NOT a repo bug
When building `artifacts/readyloq-app` as a standalone native Android app on Windows, this Ninja/CMake failure (in the react-native-worklets C++ compile) is an environment/toolchain problem, not a project misconfiguration.

**Verified clean in-repo:** reanimated resolves to 4.x requiring `react-native-worklets 0.5-0.8`; worklets 0.5.1 is in range AND is exactly what Expo SDK 54 pins (`expo/bundledNativeModules.json`). babel.config.js is stock `babel-preset-expo` (auto-injects the worklets plugin — never add it manually). metro.config.js is default. No react-native.config.js, no duplicate installs. expo-doctor 18/18.

**Real Windows causes:** stale `android/app/.cxx` CMake cache after MOVING the project (keeps old absolute paths → perpetual dirty loop); Gradle `--build-cache` + `--configure-on-demand` flags (not part of Expo defaults; replay stale native outputs); future-dated file timestamps / clock skew. Fix = delete `android/` + `.cxx`, rebuild with plain `npx expo run:android` (no extra flags).

**Cannot disable the C++/ninja build:** Reanimated 4 REQUIRES the New Architecture, so `newArchEnabled: false` is not an option to avoid the native compile.

**Where the bad Gradle flags come from:** not the repo (CNG regenerates `android/`, no committed gradle.properties). They come from Android Studio settings or a user-added gradle.properties.

## Escape hatch: EAS cloud build (recommended when Windows toolchain fights back)
EAS Build compiles on Expo's Linux builders, bypassing the entire Windows toolchain. `.gitignore` already excludes `android/`/`ios/` so cloud prebuilds clean (the broken local `android/` never uploads).

**Standalone eas.json** (lives in `artifacts/readyloq-app`, travels to the zip root): `cli.appVersionSource: local`; profiles = development (developmentClient + apk), preview (internal apk — the installable test build), production (app-bundle). The development profile requires `expo-dev-client`. `android.versionCode` / `ios.buildNumber` added to app.json for local version source. First build needs `eas login` + `eas init` to create the projectId — do NOT hardcode one.

**Side effect:** installing `expo-dev-client` makes `expo start` default to "development build" mode; Expo Go is still reachable via "press s".

## EAS APK crash at startup = missing EXPO_PUBLIC_* env
The dev workflow injects EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY / EXPO_PUBLIC_DOMAIN at `expo start`; an EAS cloud build gets NONE of these → ClerkProvider throws before the ErrorBoundary (it sits inside the provider) → insta-crash on splash. **Fix:** env values must live in per-profile `env` blocks in eas.json — NOT a `.env` file, because `.gitignore` excludes `.env` and EAS respects .gitignore on upload. Publishable key + domain are public by design, safe to commit. `_layout.tsx` now renders an explicit config-error screen instead of crashing when the key is absent.
**Limitation to restate to the user:** the APK targets the Replit DEV domain — backend only reachable while the workspace runs. A store/production build needs a deployed backend domain + pk_live key in the production profile, then rebuild.

## Deliverable zip
`readyloq-native-app.zip` = curated standalone file set. The `zip` CLI is NOT installed in this Replit env — build the archive with Python `zipfile` from an explicit file list. Exclude `.replit-artifact/artifact.toml` (Replit coupling) plus node_modules/android/ios/.expo.
