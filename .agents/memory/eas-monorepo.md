---
name: EAS build setup for ReadyLoq monorepo
description: How to trigger EAS cloud builds when @platform/* workspace deps can't resolve on EAS servers
---

## The Problem
`artifacts/readyloq-app` has four `workspace:*` deps (`@platform/camera-core`, `@platform/provider-registry`, `@platform/shared-types`, `@platform/smart-vision`). EAS archives only the app subdirectory by default (with `EAS_NO_VCS=1`), so EAS servers can't resolve those deps and the build fails in ~22 seconds.

## The Solution: Vendor Script + Workflow

**`artifacts/readyloq-app/scripts/eas-vendor-setup.js`**
- Copies src/ (or dist/ for `core`) of all 5 platform packages into `vendor/@platform/`
- Creates `package.json` for packages that don't have one
- Patches internal `workspace:*` deps to `file:../X`
- Patches the app's `package.json` to use `file:vendor/@platform/X`
- Backs up original `package.json` as `package.json.bak`

**`artifacts/readyloq-app/scripts/eas-vendor-restore.js`**
- Restores `package.json` from backup
- Removes the `vendor/` directory

**Metro config** (`metro.config.js`) must include `@platform/.*` in `transformIgnorePatterns` exclusion so Metro transpiles the vendored TypeScript source files.

## Build Command (via Replit Workflow)
```
cd /home/runner/workspace/artifacts/readyloq-app && node scripts/eas-vendor-setup.js && rm -rf /tmp/rl_eas_build && cp -r . /tmp/rl_eas_build/ && rm -rf /tmp/rl_eas_build/node_modules /tmp/rl_eas_build/.git /tmp/rl_eas_build/.expo && ln -s /home/runner/workspace/artifacts/readyloq-app/node_modules /tmp/rl_eas_build/node_modules && cd /tmp/rl_eas_build && PATH="/home/runner/workspace/node_modules/.bin:$PATH" EAS_NO_VCS=1 EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform android --profile development --non-interactive --no-wait; cd /home/runner/workspace/artifacts/readyloq-app && node scripts/eas-vendor-restore.js && rm -rf /tmp/rl_eas_build
```

Run this via a Replit workflow (not bare bash — the bash tool times out in 2 min and background processes are reaped when it returns).

**Why `EAS_NO_VCS=1`**: Without it, EAS runs git commands (including write ops like `git stash`) which are blocked by the Replit bash interceptor.
**Why `EAS_SKIP_AUTO_FINGERPRINT=1`**: EAS fingerprint scanner walks into pnpm's `.pnpm` store and crashes on missing native C++ dirs inside `react-native-reanimated`. Always set this flag.
**Why a Workflow**: The compression + upload takes >2 min; the bash tool's 120s limit isn't enough.

## Required Package Versions for SDK 54 + RN 0.81.5

**Critical**: `react-native-reanimated ~4.1.1` (NOT 3.x) + `react-native-worklets 0.5.1` (separate peer dep).

- reanimated 3.x removed `Systrace.TRACE_TAG_REACT_JAVA_BRIDGE` (removed in RN 0.81) and uses old `LengthPercentage.resolve(int,int)` signature (changed to `resolve(float)` in RN 0.81) → Java compile failure at ~4 min.
- reanimated 4.x requires `newArchEnabled=true` and the companion `react-native-worklets` package.
- `expo/bundledNativeModules.json` (SDK 54.0.35) authoritative: `react-native-reanimated ~4.1.1`, `react-native-worklets 0.5.1`.

## New Architecture

`newArchEnabled=true` in `android/gradle.properties` — **required** for reanimated v4. The old note about "New Arch + expo-dev-client causes launch crash" was outdated; expo-dev-client 6.0.21 + SDK 54.0.35 + RN 0.81.5 work correctly with New Architecture. All key native modules (whisper.rn 0.7.0 has `codegenConfig`, react-native-keyboard-controller 1.18.5, etc.) support New Arch.

## Getting Build Logs from EAS GraphQL

EAS logs are NOT returned by `eas build --wait`. To get actual Gradle errors:
1. `builds { byId(buildId: "...") { logFileUrls } }` — returns GCS signed URL (valid 15 min)
2. `curl -s --compressed "$URL"` — file is brotli-compressed, curl auto-decompresses
3. Parse as NDJSON: each line is `{"phase":"RUN_GRADLEW","level":30,"msg":"...","time":"..."}`
4. Filter by `phase == "RUN_GRADLEW"` and `level >= 40` or search for "error"/"FAILED"

## eas.json profiles
- `development`: APK with dev client (`"developmentClient": true`) — NOT Expo Go
- `preview`: standalone APK for internal testing
- `production`: AAB for Play Store, with `autoIncrement`

## .easignore
Root-level `.easignore` at workspace root excludes `**/node_modules`, `.git`, `**/.git`.
App-level `artifacts/readyloq-app/.easignore` excludes `node_modules`, `.git`.

## EAS Project
- Project ID: `7927cf86-2cbd-4c14-9bd5-d43f2beabec8`, Account: `hgwashingllc`
- EAS CLI at: `/home/runner/workspace/node_modules/.bin/eas`
