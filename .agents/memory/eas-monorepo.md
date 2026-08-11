---
name: EAS build setup
description: EAS monorepo build configuration, Metro config pitfalls, and pnpm symlink resolution for cloud builds.
---

# EAS Build Setup

## EAS workflow flags
- `EAS_NO_VCS=1` — required; repo is not a bare git checkout on Replit
- `EAS_SKIP_AUTO_FINGERPRINT=1` — avoid fingerprint mismatch noise
- `ble-plx > expo` override in root `package.json` avoids tar@6.2.1 firewall block

## Root cause of "Unknown error in Bundle JavaScript phase" (all historical failures)

Gradle's `build.gradle` resolves the entry file at build time:
```groovy
entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')", projectRoot, "android", "absolute"].execute(null, rootDir).text.trim())
```

`expo/scripts/resolveAppEntry` follows pnpm symlinks and returns the **real path**
into `.pnpm/`, e.g.:
```
workspaceRoot/node_modules/.pnpm/expo-router@6.0.24_.../node_modules/expo-router/entry.js
```

Metro must have this path inside `projectRoot` or `watchFolders`.

On **Replit**: `getDefaultConfig()` auto-discovers the pnpm workspace and adds
`workspaceRoot/node_modules` to `watchFolders`. ✓

On **EAS cloud**: `getDefaultConfig()` auto-discovery fails (Metro starts from a
different CWD), so `workspaceRoot/node_modules` is never in `watchFolders`. Metro
cannot find the entry file → UNKNOWN_ERROR.

## Metro config — three rules that must ALL hold

### 1. Pin `config.projectRoot` to an absolute path
`getDefaultConfig(__dirname)` returns `projectRoot: '.'` (CWD-relative). On EAS
cloud the bundle phase may run from a different working directory, making `.`
resolve to the wrong place.

**Fix:** `config.projectRoot = __dirname` (the absolute path of the app dir).

### 2. Explicitly add `rootNodeModules` to `watchFolders`
Do NOT rely on `getDefaultConfig()` auto-discovery for this — it works on Replit
but silently omits it on EAS. Compute it via `path.resolve(__dirname, '../../node_modules')`.

**Fix:**
```js
const rootNodeModules = path.resolve(__dirname, '../../node_modules');
const extra = new Set(config.watchFolders ?? []);
if (fs.existsSync(rootNodeModules)) extra.add(rootNodeModules);
extra.add(libRoot);
extra.add(platformPackagesRoot);
config.watchFolders = [...extra];
```

**Why:**  pnpm symlinks in the app's `node_modules/` resolve to real paths in
`workspaceRoot/node_modules/.pnpm/`. Both the entry file (resolved by Gradle)
and all transitive imports land there. Metro must watch that tree.

### 3. Pin `nodeModulesPaths` to both app and workspace node_modules
```js
config.resolver.nodeModulesPaths = [appNodeModules, rootNodeModules];
```

## Verification checklist before triggering EAS
1. `cd artifacts/readyloq-app && npx expo export --platform android` must produce
   a `.hbc` file in `dist/` locally.
2. Commit + push before triggering EAS (EAS reads from the archive, not live files).
3. Only trigger ONE build per fix attempt — the archive upload + queue adds cost.

## Other EAS flags / notes
- `EAS_SKIP_AUTO_FINGERPRINT=1` avoids fingerprint mismatch if `.expo/` is stale
- Archive is 485 MB (whole workspace, node_modules excluded by `.easignore`)
- `autoIncrement: true` in preview/production bumps `versionCode` on each build
