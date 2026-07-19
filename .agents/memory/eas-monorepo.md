---
name: EAS build setup for ReadyLoq monorepo
description: How to trigger EAS cloud builds when @platform/* workspace deps can't resolve on EAS servers
---

## The Problem
`artifacts/readyloq-app` has four `workspace:*` deps (`@platform/camera-core`, `@platform/provider-registry`, `@platform/shared-types`, `@platform/smart-vision`). EAS archives only the app subdirectory by default (with `EAS_NO_VCS=1`), so EAS servers can't resolve those deps and the build fails in ~22 seconds.

Two packages (`camera-core`, `shared-types`) also have no `package.json` at all — they're symlinked directories in the local workspace.

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
cd /home/runner/workspace/artifacts/readyloq-app && node scripts/eas-vendor-setup.js && EAS_NO_VCS=1 eas build --platform android --profile development --non-interactive --no-wait; node scripts/eas-vendor-restore.js
```

Run this via a Replit workflow (not bare bash — the bash tool times out in 2 min and background processes are reaped when it returns).

**Why `EAS_NO_VCS=1`**: Without it, EAS runs git commands (including write ops like `git stash`) which are blocked by the Replit bash interceptor.

**Why a Workflow**: The compression + upload takes >2 min; the bash tool's 120s limit isn't enough. Create an "EAS Build" workflow, wait ~90s, check logs, then remove the workflow.

## eas.json profiles
- `development`: APK with dev client (`"developmentClient": true`) — NOT Expo Go
- `preview`: standalone APK for internal testing
- `production`: AAB for Play Store, with `autoIncrement`

## .easignore
Root-level `.easignore` at workspace root:
```
**/node_modules
node_modules
.git
**/.git
```

App-level `artifacts/readyloq-app/.easignore`:
```
node_modules
.git
```

## Why
- `EAS_NO_VCS=1` archives from CWD, skipping git — needed because git write ops are blocked in main agent
- 8.5 MB archive (source only, node_modules excluded)
- The vendor/ copies (src or dist) get `file:` linked by pnpm on EAS servers
- Metro transpiles vendored TypeScript via updated `transformIgnorePatterns`
