---
name: API server standalone worker bundle
description: How to add a standalone scheduled/cron worker entry to the api-server esbuild build
---

# Standalone worker bundle in api-server

To add a one-shot background worker (e.g. a daily lifecycle/cron job) that runs
separately from the long-running Express server:

- Put the entry in `artifacts/api-server/src/jobs/<name>.ts` with a `main()` that
  does the work and `process.exit(0)`/`exit(1)` so a scheduler sees success/failure.
- Add its path to the `entryPoints` array in `artifacts/api-server/build.mjs`
  (esbuild already does multi-entry; output mirrors the src tree →
  `dist/jobs/<name>.mjs`).
- Add an npm script: `"jobs:<name>": "node --enable-source-maps ./dist/jobs/<name>.mjs"`.

**Why:** the API server bundles with esbuild (single `buildAll`); a second entry
point is the cleanest way to ship a worker that shares the same code/deps without
a second build config.

**How to apply:** deploy the worker as a Replit **Scheduled Deployment** — build
command `pnpm --filter @workspace/api-server run build`, run command
`pnpm --filter @workspace/api-server run jobs:<name>`. Make sure timeline-based
sweeps are idempotent so re-runs are safe.
