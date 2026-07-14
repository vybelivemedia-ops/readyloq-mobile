---
name: Build provenance injection
description: How git provenance is injected into all six artifact builds and the no-.git pitfalls
---
Rule: build provenance (branch/SHA/message/timestamp/tree status/source) comes from `lib/build-info` `getBuildInfo()` with priority live git → committed `build-info.json` snapshot → literal "unknown"s. Never fabricate values.
**Why:** deployment builds and EAS servers (EAS_NO_VCS=1) have no `.git`; a runtime/git-only approach silently loses provenance there, and an ungated snapshot silently goes stale.
**How to apply:**
- Server: capture at runtime module load (plain node can't import TS at build time); expose via /api/version + pino base fields.
- Vite apps: `define: { __BUILD_INFO__: JSON.stringify(getBuildInfo(import.meta.dirname)) }` — evaluated at build time in the config, which CAN import TS lib source.
- Mobile: app.config.ts must inline the capture (Expo config loader compiles standalone); snapshot lives at artifacts/mobile/build-info.json and MUST be committed (EAS archive honors .gitignore).
- Any script that triggers eas build/update must first run `node scripts/src/write-build-info.mjs` or the snapshot is stale; consumers can detect via `source: "snapshot"`.
