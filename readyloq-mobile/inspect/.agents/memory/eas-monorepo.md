---
name: EAS Monorepo Setup
description: Non-obvious EAS/Expo configuration for the readyloq-mobile subdirectory in a pnpm monorepo
---

## Rule
Never allow a root-level `app.json` to exist when the Expo app lives in a subdirectory (`readyloq-mobile/`). EAS cloud build workers scan the git root first; if they find an `app.json` there, they treat the repo root as the Expo project and fail with "The expo package was not found" because `expo` is not in the root `package.json`.

**Why:** EAS Cloud Build clones the full git repo at the git root. A root `app.json` overrides subdirectory project detection. Root `package.json` is the pnpm workspace root (no expo dep) + has a preinstall hook that rejects npm/yarn, making any EAS install attempt at root doubly fatal.

**How to apply:** If EAS builds fail with "expo package not found" during Prebuild, check for a stale `app.json` at the git root before anything else.

## readyloq-mobile layout (correct state)
- `readyloq-mobile/` — Expo project root, EAS project ID `f7de276e-8765-4a57-9b97-1218c90b6ed7`
- `readyloq-mobile/eas.json` — EAS build profiles, intentionally inside the subdirectory
- `readyloq-mobile/package-lock.json` — npm lockfile for `npm ci` on EAS cloud (NOT pnpm)
- `readyloq-mobile/` is intentionally excluded from `pnpm-workspace.yaml` (manages own deps via npm)
- `android/` and `ios/` are gitignored — EAS cloud regenerates them via `expo prebuild`
