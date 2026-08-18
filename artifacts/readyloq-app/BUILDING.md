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
