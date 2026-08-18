# EAS Build Gate

EAS preview builds cost real money (~$0.80/build on the Starter plan overage rate).
**Read this before triggering any EAS build.** Two checks are mandatory. One question
must be answered yes. If any check fails or the answer is no, do not submit.

---

## Step 1 — Do you actually need a build?

EAS builds compile native Android code. They are only required when the **native
layer** changes. Pure JavaScript/TypeScript changes are served to the existing
installed APK via Metro dev server — they do not need a new build.

### ✅ Needs a build
| Change type | Example |
|---|---|
| New native package installed | Adding `expo-camera`, `react-native-ble-plx` |
| Existing native package version bump | Upgrading `expo-task-manager` from 57.0.1 → 57.0.10 |
| `app.json` plugin added or changed | New `expo-notifications` plugin config |
| `AndroidManifest.xml` changed | New permission, intent filter |
| `android/` Gradle files changed | `build.gradle`, `gradle.properties`, ProGuard rules |
| `metro.config.js` changed | blockList, watchFolders, resolver |
| `babel.config.js` changed | New transform or preset |
| EAS profile config changed | `eas.json` env vars, `buildType`, `gradleCommand` |

### ❌ Does NOT need a build
| Change type | Example |
|---|---|
| Screen changes | New component, layout tweak, style update |
| New hook or utility | `useVoiceField`, `ssrfSafeFetch` |
| API call changes | New route, updated payload shape |
| Copy / string changes | Label text, error messages |
| Test files | `*.test.ts`, `*.spec.ts` |
| API server changes | `artifacts/api-server/` — not bundled into APK |
| Portal / marketing changes | Other workspace artifacts |

**When in doubt:** if the change is only in `app/`, `src/`, or `hooks/` and touches
no file listed in the "Needs a build" table, it does not need a build.

---

## Step 2 — Run both pre-flight checks (mandatory)

Both checks must pass before submitting. They run in under 2 minutes combined and
catch the two failure modes that caused builds 194–206 to burn through $184 in credits.

### Check 1: R8 flags guard
Verifies that the three minification flags in `android/gradle.properties` are all
`false`. R8 full mode causes a `NoClassDefFoundError` startup crash in
`expo-task-manager` that is not caught until the APK is installed and launched.

```bash
bash scripts/check-r8-flags.sh
```

Expected output: `R8 guard PASSED — all flags are correctly set to false.`

If it fails: revert all three flags to `false` in
`artifacts/readyloq-app/android/gradle.properties`. Do not add `-dontwarn` rules
as a workaround — they silence the compile error but not the runtime crash.

### Check 2: Metro bundle check
Runs `expo export --platform android --no-minify` locally. Catches any module that
Metro would bundle but Hermes cannot execute (e.g. vite/vitest leaking in via a
transitive import). Builds 204 and 205 both failed on EAS for exactly this reason;
this check catches it in ~60–90 seconds without spending a credit.

```bash
bash artifacts/readyloq-app/scripts/check-metro-bundle.sh
```

Expected output: `Metro bundle check PASSED — bundle is clean.`

If it fails: fix the bundling error shown in the output (typically a blocked module
leaking through a new import path), confirm the fix passes locally, then re-run
before submitting.

#### Verifying the guard itself (after any metro.config.js change)

If you refactor `metro.config.js` — especially the `blockList` section — run the
self-test to confirm the vite/vitest guard is still effective:

```bash
bash artifacts/readyloq-app/scripts/check-metro-bundle.sh --test
```

The `--test` flag temporarily comments out the four vite/vitest `blockList` regexes,
runs a full `expo export`, and asserts the export **fails**. A `Self-test PASSED`
result means removing the guard actually breaks the build — i.e. the guard is real.
A `Self-test FAILED` result means vite/vitest are no longer reachable from the import
graph and the guard may need updating; investigate before relying on this check.

This self-test takes the same ~60–90 seconds as a normal check and restores
`metro.config.js` unconditionally (even on Ctrl-C).

---

## Step 3 — Submit with `--no-wait`

Always use `--no-wait`. Never block a tool call waiting for the build to finish —
the bash tool has a 120-second timeout and the build takes 15–25 minutes.

```bash
cd artifacts/readyloq-app
EAS_NO_VCS=1 EAS_SKIP_AUTO_FINGERPRINT=1 EXPO_TOKEN=$EXPO_TOKEN \
  npx eas build --platform android --profile preview --non-interactive --no-wait
```

Check build status later via:
```bash
cd artifacts/readyloq-app && EXPO_TOKEN=$EXPO_TOKEN npx eas build:list --limit 5
```

---

## Failure triage (do not re-submit blindly)

If a build errors, diagnose the failure **before** submitting again.

| Error in EAS log | Fix | Re-submit? |
|---|---|---|
| `Metro bundling failed` / `module-runner.js SyntaxError` | A blocked module leaked in. Update `metro.config.js` blockList. Run Metro check locally first. | Only after local Metro check passes |
| `NoClassDefFoundError` at startup | R8 flags re-enabled. Run R8 guard. | Only after R8 guard passes |
| `Unknown error in Bundle JavaScript phase` | `watchFolders` missing pnpm root. Check `metro.config.js` `watchFolders` includes `../../node_modules`. | Only after local Metro check passes |
| Gradle compile error (not R8) | Read the full Gradle log on expo.dev — usually a missing dependency or API level mismatch | Fix root cause first |
| Upload / network timeout | Retry once; if it times out again check EAS status page | Yes, once |

**Never submit a second build to "see if it fixes itself."** Every build is a charge.

---

## Workflows already wired (run before submitting)

Two Replit workflows exist for exactly this purpose:

- **`android-r8-guard`** — runs `bash scripts/check-r8-flags.sh`
- **`android-metro-check`** — runs `bash artifacts/readyloq-app/scripts/check-metro-bundle.sh`

Run both from the Replit workflow panel and confirm both show green before submitting.

# EAS Build Guidelines — ReadyLoq Android App

> **$184 in overages this billing period** came from repeated debug builds during the R8 crash investigation. Every EAS build costs a credit and real money. Read this before submitting one.

---


## When you DO need an EAS build

Trigger a new EAS build only when the change involves one or more of the following:

| Category | Examples |
|----------|----------|
| **New native package** | Adding a package with a `plugin` in `app.json`, native modules, JNI code, or anything listed under `expo-modules-core` |
| **Gradle change** | `android/build.gradle`, `android/app/build.gradle`, `android/gradle.properties` |
| **app.json plugin change** | Adding, removing, or modifying any entry under `"plugins"` in `app.json` |
| **Android manifest change** | `android/app/src/main/AndroidManifest.xml` — new permissions, intent filters, receivers |
| **Native code change** | Any file under `android/` or `ios/` that isn't auto-generated by Expo |
| **SDK upgrade** | Bumping the `expo` package version itself, which may update native module versions |
| **EAS config change** | Modifying `eas.json` build profiles — env vars, gradleCommand, distribution |

---


## When you do NOT need an EAS build

These changes are pure JS/TS and are served by the Metro bundler at runtime via the Expo dev server or an OTA update:

- Screen changes, component refactors, new hooks
- API call changes (URLs, payloads, headers)
- Copy, labels, or color/style changes
- New context providers, state management, or React Navigation routes
- New TypeScript types or interfaces
- Changes to workspace library packages (`lib/`, `repos/platform/packages/`) that have no native code
- Bug fixes in `.ts` / `.tsx` files
- Adding or modifying tests

**When in doubt:** if `grep -r "android\|ios\|native\|plugin" <changed-file>` returns nothing relevant, it is almost certainly a JS-only change.

---


### 2. R8 flag guard (`android-r8-guard`)

```bash
bash scripts/check-r8-flags.sh
```

**What it catches:**
- Any of the three R8/minification flags being re-enabled in `android/gradle.properties`

The three flags that **must stay `false`**:

```properties
android.enableMinifyInReleaseBuilds=false
android.enableShrinkResourcesInReleaseBuilds=false
android.enableR8.fullMode=false
```

Enabling any of them caused builds 194–201 to either fail at compile time or crash immediately at startup with `NoClassDefFoundError` in `expo-task-manager`. The parser handles all Java Properties spec forms (`:` separator, whitespace separator, line continuations, Unicode escapes) — it cannot be bypassed by formatting tricks.

---


### 1. Metro bundle check (`android-metro-check`)

```bash
bash artifacts/readyloq-app/scripts/check-metro-bundle.sh
```

**What it catches:**
- `vite` / `vitest` modules leaking into the Android bundle (the root cause of the builds 204–205 failures — Metro bundled `vite/module-runner.js`, which is illegal in Hermes)
- Any bundling error that would cause EAS to fail at the JS compilation step
- Test files (`__tests__/`, `.test.ts`, `.spec.ts`) accidentally included in the bundle

Runs `expo export --platform android --no-minify` in an isolated temp directory (~30–90 seconds). Output is discarded; only the exit code matters.

**The authoritative guard** is the `blockList` in `metro.config.js`. This script confirms the guard is working.


## Build profiles quick reference

| Profile | `buildType` | Use for |
|---------|-------------|---------|
| `development` | `apk` | Local dev client — install on a physical device for native debugging |
| `preview` | `apk` (assembleRelease) | Beta / internal testing via `preview` channel |
| `production` | `app-bundle` (bundleRelease) | Play Store submission |

**Development builds** use the `developmentClient: true` flag — they include the Expo dev client so you can load JS over the network. They are the most expensive to rebuild because they bundle all native modules. Prefer the Expo dev server (`npx expo start`) for day-to-day work and only submit a `development` build when you need a new native module tested on a physical device.

---


## Quick decision flowchart

```
Did you change a file under android/, ios/, or app.json plugins?
  YES → Did check-metro-bundle.sh and check-r8-flags.sh both pass?
          YES → Submit EAS build
          NO  → Fix the failure first
  NO  → Is it a new package that has native code (expo plugin / JNI)?
          YES → Same as above
          NO  → No EAS build needed. Use `npx expo start` or push an OTA update.
```

---


## Historical context

| Incident | Root cause | Cost |
|----------|-----------|------|
| Builds 194–201 | R8 full mode + minify enabled → `NoClassDefFoundError` at startup | ~8 build credits |
| Builds 204–205 | `vite/module-runner.js` bundled by Metro → Hermes parse failure | 2 build credits |
| This billing period | Repeated debug builds during R8 investigation | $184 overages |

The `android-r8-guard` and `android-metro-check` workflows exist specifically to prevent these from recurring.

## Required pre-flight checks before any EAS build

Both of the following workflow checks **must pass** before you submit an EAS build. They run locally in seconds and catch the failures that previously burned debug build credits.


## The core question: does this change touch native code?

If the answer is **no**, you do not need an EAS build. Use the Expo dev server instead.

---


## Pre-build checklist

Before submitting any EAS build, confirm all of the following:

- [ ] The change actually requires a native rebuild (see the table above)
- [ ] `bash artifacts/readyloq-app/scripts/check-metro-bundle.sh` exits 0
- [ ] `bash scripts/check-r8-flags.sh` exits 0
- [ ] The correct EAS profile is selected (`development` / `preview` / `production`)
- [ ] You know why the previous build failed before submitting a retry

---
