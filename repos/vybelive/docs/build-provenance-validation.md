# Build Provenance Validation Report

Date: 2026-07-08 · Validated commit: `28d6ed3` (`oauth-investigation`, dirty working tree at validation time)

## What was injected

Every artifact build now carries Git provenance metadata: **branch, commit SHA, commit message, build timestamp, working-tree status (clean/dirty/unknown), and source (git/snapshot/unknown)**.

Shared capture logic lives in `lib/build-info` (`getBuildInfo()`: live git → `build-info.json` snapshot → explicit unknowns). `scripts/src/write-build-info.mjs` refreshes committed snapshots (repo root + `artifacts/mobile/`) and is prepended to the root `build` script, so environments without `.git` (deployments, EAS servers) fall back to the trigger-time snapshot instead of lying.

## Per-artifact validation results

| Artifact | Mechanism | Evidence |
|---|---|---|
| **api-server** | Runtime capture at process start (`src/lib/buildInfo.ts`); exposed via `GET /api/version` (OpenAPI `BuildProvenance` schema, Zod-validated) and stamped on every pino log line (`buildCommit`, `buildBranch`) | `curl localhost:80/api/version` → `{"branch":"oauth-investigation","commitSha":"28d6ed3db8ef…","commitMessage":"Update app version and adjust for foldable screens","workingTreeStatus":"dirty","source":"git"}`; `node build.mjs` succeeds |
| **mission-control** | Vite `define: __BUILD_INFO__` in `vite.config.ts`; `src/buildInfo.ts` sets `window.__VYBE_BUILD_INFO__` + console banner; sidebar **BuildStamp** shows UI + API build (via generated `useGetServerVersion` hook) | Production build OK; SHA found in `dist/public/assets/index-CW3JCRwl.js` |
| **website** | Same Vite define + `window.__VYBE_BUILD_INFO__` pattern | Build OK; SHA in `dist/public/assets/index-i6WUPSJh.js` |
| **marketing** | Same pattern | Build OK; SHA in `dist/public/assets/index-DFrEfIEz.js` |
| **mockup-sandbox** | Same pattern (dev-only artifact, included for completeness) | Build OK; SHA in `dist/assets/index-CQzSUOVC.js` |
| **mobile** | Inline capture in `app.config.ts` → `extra.buildInfo` in the Expo manifest; read via `constants/buildInfo.ts` (expo-constants); logged at app start in `app/_layout.tsx`. On EAS (no `.git` with `EAS_NO_VCS=1`), falls back to the committed `artifacts/mobile/build-info.json` snapshot | `npx expo config --json` → `extra.buildInfo` contains full SHA `28d6ed3db8ef…`, branch, message, timestamp, `source: "git"` |

## Consumption points

- **Mission Control**: sidebar Build stamp (UI + API commit/branch, dirty marker `*`)
- **Release reports / deployment diagnostics**: `GET /api/version` (contract-first, in OpenAPI spec)
- **Crash reporting**: every server log line carries `buildCommit`/`buildBranch`; web apps expose `window.__VYBE_BUILD_INFO__`; mobile logs a `[build]` banner and exports `buildInfo` for future crash hooks
- **CI/CD**: root `pnpm run build` refreshes snapshots first; full `pnpm run typecheck` passes across all 7 leaf packages

## Freshness guarantees (no-git build paths)

- Root `pnpm run build` refreshes both snapshots before anything else runs — Replit deployments (which build from a git checkout) always embed the trigger-time commit.
- All EAS trigger scripts in `artifacts/mobile/package.json` (`build:beta:android`, `build:beta:ios`, `update:beta`) now prepend `node ../../scripts/src/write-build-info.mjs`, so the committed `artifacts/mobile/build-info.json` is refreshed at trigger time before the archive is uploaded (EAS servers have no `.git` under `EAS_NO_VCS=1`).
- If `eas build` is ever invoked directly (bypassing those scripts), run `node scripts/src/write-build-info.mjs` first — otherwise the app reports the last-refreshed snapshot, honestly labeled `source: "snapshot"`.
- Consumers can always distinguish live git (`source: "git"`) from trigger-time snapshot (`"snapshot"`) from no data (`"unknown"`).

## Failure behavior

No silent fabrication: if neither git nor a snapshot is available, all fields are the literal string `"unknown"` with `source: "unknown"`.
