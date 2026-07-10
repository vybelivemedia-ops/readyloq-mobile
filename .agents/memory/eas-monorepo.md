---
name: EAS build setup for ReadyLoq
description: Which Expo project is the real buildable app, how EAS cloud builds run from the pnpm monorepo, and the non-obvious failure modes
---

## The real app is artifacts/readyloq-app — NOT readyloq-mobile/
`readyloq-mobile/` at git-root level is a bare create-expo-app skeleton ("Open up App.tsx…") that only holds an old EAS projectId (f7de276e…). Never build it. The canonical app is `artifacts/readyloq-app` (expo-router, Clerk, camera), linked to its own EAS project (projectId lives in its app.json `extra.eas.projectId`; created via `eas init --non-interactive --force`).

**Why:** Both dirs contain app.json + eas.json; a naive agent will build the skeleton. The GitHub origin remote is even named readyloq-mobile.git, adding to the confusion.

## Proven EAS cloud build recipe (from this monorepo)
- Run from `artifacts/readyloq-app` with `EAS_NO_VCS=1` — this packs ONLY the app dir (~800 KB, no workspace root, no lockfile) and sidesteps the dirty-git-tree block (agent cannot git commit).
- No lockfile ⇒ EAS runs `yarn install` with fresh resolution every build. Transitive deps can drift: `@wallet-standard/app` began requiring Node ≥22 while the EAS image default was Node 20 ⇒ Install-dependencies phase failure. **Fix:** pin `"node": "22.14.0"` in every eas.json build profile.
- `eas build --non-interactive --no-wait --json` then poll `eas build:view <id> --json`. Run the submission SYNCHRONOUSLY — with `EAS_SKIP_AUTO_FINGERPRINT=1` the upload+queue finishes well under 2 min. Do NOT background it: nohup/setsid+disown processes are killed when the agent shell exits (verified twice — no build ever queued). Cloud build itself takes ~15–20 min; poll with sleep ≤85s per call to stay under the 2-min tool timeout.
- Fetch failed-build logs via GraphQL: POST api.expo.dev/graphql with `Authorization: Bearer $EXPO_TOKEN`, query `{ builds { byId(buildId:"…") { logFiles } } }`; download with `curl --compressed` (files are gzip NDJSON).
- The "custom metro.config.js does not extend @expo/metro-config" warning is a false positive when the config is `getDefaultConfig(__dirname)` from expo/metro-config.

## Rule that still holds
Never allow a root-level `app.json` at the git root — EAS workers treat the repo root as the Expo project and fail with "expo package not found". Env vars (EXPO_PUBLIC_*) must live in per-profile `env` blocks of eas.json, not .env (gitignored ⇒ excluded from upload). Bump android.versionCode every release so APKs install over old ones.

## GitHub push
No GitHub connector/credentials exist in the workspace shell — `git push origin main` fails with auth error. User must push via the Replit Git pane or connect GitHub.
