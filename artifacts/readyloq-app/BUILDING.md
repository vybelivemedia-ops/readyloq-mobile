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

**When in doubt:** if the change is only in `app/`, `hooks/`, `components/`, or `lib/`
and touches no file listed in the "Needs a build" table, it does not need a build.

---

## Step 2 — Submit via the wrapper (mandatory)

Use `scripts/eas-submit.sh` instead of calling `eas build` directly. The wrapper
runs both mandatory pre-flight checks and aborts before spending a build credit if
either fails.

```bash
# From workspace root:
bash scripts/eas-submit.sh \
  --platform android --profile preview --non-interactive --no-wait
```

The wrapper:
1. Runs `check-r8-flags.sh` (~1 s) — aborts if any R8/minification flag is enabled
2. Runs `check-metro-bundle.sh` (~60–90 s) — aborts if the bundle has a Hermes-illegal module
3. Calls `eas build` with all forwarded flags only if both pass

### Dry run (verify checks without spending a credit)

```bash
bash scripts/eas-submit.sh \
  --platform android --profile preview --non-interactive --no-wait --dry-run
```

Runs both checks and prints what the `eas build` command would be, without submitting.

### What each check catches

**R8 flags guard** (`scripts/check-r8-flags.sh`):
Verifies all three minification flags in `android/gradle.properties` are `false`.
R8 full mode causes a `NoClassDefFoundError` startup crash in `expo-task-manager` —
build passes but APK crashes immediately on launch (builds 194–201).

If it fails: revert all three flags to `false`. Do not add `-dontwarn` rules as a
workaround — they silence the compile error but not the runtime crash.

```properties
android.enableR8.fullMode=false
android.enableMinifyInReleaseBuilds=false
android.enableShrinkResourcesInReleaseBuilds=false
```

**Metro bundle check** (`artifacts/readyloq-app/scripts/check-metro-bundle.sh`):
Runs `expo export --platform android --no-minify` locally. Catches any module that
Metro bundles but Hermes cannot execute (e.g. `vite/module-runner.js` leaking in via
a transitive import). Builds 204 and 205 both failed this way; this check catches it
locally without spending a credit.

If it fails: fix the bundling error shown in the output, confirm the fix passes
locally, then re-run.

#### Verifying the Metro guard itself (after any `metro.config.js` change)

```bash
bash artifacts/readyloq-app/scripts/check-metro-bundle.sh --test
```

Temporarily comments out the vite/vitest `blockList` regexes, runs a full export,
and asserts the export fails. A `Self-test PASSED` result means the guard is real.
Restores `metro.config.js` unconditionally even on Ctrl-C.

---

## Check build status

```bash
cd artifacts/readyloq-app && EXPO_TOKEN=$EXPO_TOKEN npx eas build:list --limit 5
```

Always use `--no-wait` when submitting. Never block a tool call waiting for a build
to finish — the bash tool has a 120-second timeout and builds take 15–25 minutes.

---

## Failure triage — do not re-submit blindly

| Error in EAS log | Fix | Re-submit? |
|---|---|---|
| `Metro bundling failed` / `module-runner.js SyntaxError` | Blocked module leaked in. Fix `metro.config.js` blockList. Re-run Metro check locally. | Only after Metro check passes |
| `NoClassDefFoundError` at startup | R8 flags re-enabled. Re-run R8 guard. | Only after R8 guard passes |
| `Unknown error in Bundle JavaScript phase` | `watchFolders` missing pnpm root. Verify `metro.config.js` `watchFolders` includes `../../node_modules`. | Only after Metro check passes |
| Gradle compile error (not R8) | Read the full Gradle log on expo.dev — usually a missing dep or API level mismatch | Fix root cause first |
| Upload / network timeout | Retry once; if it times out again check EAS status page | Yes, once |

**Never submit a second build to "see if it fixes itself."** Every build is a charge.

---

## Replit validation workflows

Two Replit workflows run these checks on demand from the workflow panel:

- **`android-r8-guard`** — runs `bash scripts/check-r8-flags.sh`
- **`android-metro-check`** — runs `bash artifacts/readyloq-app/scripts/check-metro-bundle.sh`

---

## Historical context

| Incident | Root cause | Cost |
|---|---|---|
| Builds 194–201 | R8 full mode + minify enabled → `NoClassDefFoundError` at startup | ~8 build credits |
| Builds 204–205 | `vite/module-runner.js` bundled by Metro → Hermes parse failure | 2 build credits |
| This billing period | Repeated debug builds during R8 investigation | $184 overages |

#### Confirming the guard catches a new dependency that imports vite

The `--test` flag above tests from the blockList side (removes the guard). A
complementary regression test confirms the guard catches contamination that arrives
**via a new package's import graph** — the real-world failure mode when a developer
adds a dependency that transitively pulls in vite.

```bash
bash artifacts/readyloq-app/scripts/test-new-dep-vite-leak.sh
```

This script runs a **single export with three enforced assertions** (~60–90 s):

**Pre-conditions (verified before the export):**
1. vite is present in the workspace `node_modules` (i.e., it is installed and in a
   path Metro's `nodeModulesPaths` would find).
2. vite is resolvable via `Node.js require()` from the `app/` directory using the
   same paths Metro uses — proving that without the blockList the probe's
   `import "vite"` would reach vite.

**Enforced assertions on the export output:**
1. `check-metro-bundle.sh` must exit non-zero.
2. The error output must contain `__new-dep-probe__` — proving Metro traversed
   the import chain to the probe file (not a generic unrelated failure).
3. A single output line must contain both `vite` and `__new-dep-probe__` — matching
   Metro's resolver diagnostic (`Unable to resolve module vite from .../app/__new-dep-probe__.ts`).
   No line in the probe's source file contains both strings, so this cannot be a
   false positive from Metro echoing the probe's source context.

Together the pre-conditions and all three assertions prove the blockList is the
specific cause: vite IS reachable without it, and the error is traceable to the
probe's `import "vite"`.

**Cleanup and safety:** `app/_layout.tsx` is restored unconditionally on EXIT,
SIGTERM, and SIGHUP. Every mutation uses a unique marker string so that
`check-metro-bundle.sh` (and the stale-run guard at the top of this script) can
detect and clean up leftover changes even after a SIGKILL.

Run this test any time a new dependency is added that might pull vite into its
transitive closure, or after any change to `metro.config.js` resolver configuration.

---


