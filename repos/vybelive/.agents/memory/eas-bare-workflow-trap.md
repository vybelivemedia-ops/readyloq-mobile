---
name: EAS bare-workflow & project-root traps
description: Why an EAS build can silently ignore app.config.ts (version/config) — stale android/ dir and stray root app.json/eas.json
---

Two independent traps caused EAS builds to ship versionName 1.0.0 / versionCode 2 instead of app.config.ts values:

1. **Stale `android/` dir flips EAS to bare workflow.** If `artifacts/mobile/android/` exists (e.g. left behind by a one-off `expo prebuild` during debugging — it's gitignored so invisible in git status), EAS skips managed prebuild and builds that native project as-is, ignoring app.config.ts version, versionCode, plugins, everything. **How to apply:** before any EAS build, ensure `artifacts/mobile/android/` and `ios/` do not exist (`rm -rf`), unless intentionally bare.
2. **Stray `app.json`/`eas.json` at the monorepo root break project-root detection.** A root `app.json` of `{"expo":{}}` + root `eas.json` (with `appVersionSource: remote`) made eas-cli/EAS resolve an empty config. These must never exist at workspace root — the only Expo config lives in `artifacts/mobile/`.

Also: **EAS archive bloat kills uploads.** In `EAS_NO_VCS=1` mode the whole workspace is archived; `.local` (agent state), `.cache`, `.pythonlibs` grew to ~2GB and compression died silently. Root `.easignore` now excludes them — keep it.

**Verification loop that caught this:** `eas build:inspect --stage archive` shows the exact upload contents; after build, download the APK and check versionName/versionCode with androguard. `eas build:view` metadata for IN_PROGRESS builds is computed from the stripped local copy and can be wrong — trust only the final APK.

**Shell constraints on Replit:** eas upload takes >2min; detached processes get reaped between tool calls. Pattern that works: `setsid sh -c '...' & disown` then `sleep`+poll *within the same bash call*.
