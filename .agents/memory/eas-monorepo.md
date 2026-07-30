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

The inotify watcher limit (65536) in the Replit container cannot be raised (write to `/proc/sys/fs/inotify/max_user_watches` is permission-denied). Metro exhausts the limit when watching `node_modules/.pnpm` (thousands of static directories).

**Fix** in `metro.config.js`:
- Remove `workspaceRoot` from `watchFolders` — only add specific source dirs (`lib/`, platform packages).
- Add `node_modules/.pnpm` to `blockList` so Metro uses it for resolution only (not watching).

**Why:** The pnpm virtual store is static at runtime; no files in it change during development. Metro only needs to watch source packages.

## react-native-ble-plx symlink

The package is in the pnpm virtual store at `node_modules/.pnpm/react-native-ble-plx@3.2.1_<hash>/node_modules/react-native-ble-plx`. Symlink it to `artifacts/readyloq-app/node_modules/react-native-ble-plx` for TypeScript resolution. The EAS cloud build installs it natively.
