---
name: Lib rebuild requirement
description: Must run typecheck:libs after schema changes or leaf packages won't see new exports
---

`lib/db` is a composite TypeScript project. After editing `lib/db/src/schema/index.ts`, TypeScript declaration files are stale until rebuilt.

**Rule:** After any change to a lib package (`lib/db`, `lib/api-zod`, etc.), run:
```
pnpm run typecheck:libs
```
before running leaf package typechecks (`pnpm --filter @workspace/api-server run typecheck`).

**Why:** Without a rebuild, TS resolves stale `.d.ts` files from the prior build and reports "Module has no exported member" for newly added exports.
