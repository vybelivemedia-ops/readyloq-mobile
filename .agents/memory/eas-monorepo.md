---
name: EAS build setup
description: Monorepo EAS build quirks — vendor script, EAS_NO_VCS, metro watchFolders, ENOSPC fix
---

## Key constraints

- **Vendor script**: workspace `*` deps must be vendored before EAS upload; the upload contains node_modules.
- **EAS_NO_VCS=1**: required because the sandbox has no git remote reachable by EAS.
- **EAS_SKIP_AUTO_FINGERPRINT=1**: prevents EAS from re-fingerprinting the build.
- **metro transformIgnorePatterns**: `@platform/*` packages must be included (not excluded) in the Metro transform list.
- **EAS Build workflow 120s bash timeout**: use `--no-wait` flag to submit and exit; the build runs async on EAS servers.

## pnpm override for react-native-ble-plx

`react-native-ble-plx@3.2.1` ships `"expo": "^51.0.14"` as a runtime dep, which pulls `@expo/cli@0.18 → tar@6.2.1`. The Replit firewall blocks `tar-6.2.1`.

**Fix** (root `package.json`):
```json
"pnpm": {
  "overrides": {
    "react-native-ble-plx>expo": "54.0.36"
  }
}
```

This redirects ble-plx's expo dep to the already-installed expo@54, avoiding the old CLI chain.

## Metro ENOSPC fix

The inotify watcher limit (65536) in the Replit container cannot be raised. Metro exhausts the limit when watching `node_modules/.pnpm` (thousands of static directories).

**Fix** in `metro.config.js`:
- Remove `workspaceRoot` from `watchFolders` — only add specific source dirs (`lib/`, platform packages).
- Do NOT add `node_modules/.pnpm` to `blockList` — see below.

**Why:** Metro only watches `projectRoot` + `watchFolders`. Since `.pnpm` is in neither, it won't be watched. The blockList is unnecessary for ENOSPC and harmful for EAS.

## CRITICAL: watchFolders must include workspaceRoot on EAS (not on Replit)

Metro refuses to bundle files whose symlink-resolved real path lands **outside** `projectRoot + watchFolders`. All pnpm packages are symlinked into `node_modules/.pnpm` at the monorepo root. Without `workspaceRoot` in `watchFolders`, Metro throws "Unable to resolve module expo-router/entry.js" in the EAGER_BUNDLE phase.

**Replit constraint:** Watching workspaceRoot hits the inotify limit (~65k watches) because `.pnpm` has 200k+ entries → ENOSPC.

**EAS:** No meaningful inotify cap — watching workspaceRoot is safe.

**Fix (verified working):** Gate on `REPLIT_DEV_DOMAIN` (always set in Replit dev, never on EAS):
```js
const isReplit = !!process.env.REPLIT_DEV_DOMAIN;
if (!isReplit && fs.existsSync(workspaceRoot)) {
  extraWatchFolders.push(workspaceRoot);
}
```

**Do NOT put `node_modules/.pnpm` in `blockList`** — blockList prevents file reads (not just watching), breaking symlink resolution for all pnpm-managed packages.

## react-native-ble-plx symlink

The package is in the pnpm virtual store at `node_modules/.pnpm/react-native-ble-plx@3.2.1_<hash>/node_modules/react-native-ble-plx`. Symlink it to `artifacts/readyloq-app/node_modules/react-native-ble-plx` for TypeScript resolution. The EAS cloud build installs it natively.
