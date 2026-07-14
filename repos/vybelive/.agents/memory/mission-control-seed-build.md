---
name: Mission Control seed runs prebuilt dist
description: Why reseeding MC silently uses stale code unless you rebuild first
---

`pnpm --filter @workspace/api-server run seed:mission-control` executes the
**prebuilt** `dist/jobs/seedMissionControl.mjs`, NOT the TypeScript source.

**Why:** the seed npm script runs `node ./dist/jobs/...`, so any change to seed
logic or to schema/services it imports is invisible until esbuild re-bundles.

**How to apply:** always run `pnpm --filter @workspace/api-server run build`
BEFORE reseeding after editing seed code, schema, or any service the seed pulls
in. Symptom of forgetting: seed "completes" but new/renamed fields, tables, or
linked sample data don't appear in API responses.
