---
name: DB schema rebuild
description: How to propagate lib/db schema changes to packages that use TypeScript project references
---

## Rule
After editing any file under `lib/db/src/`, run:
```
pnpm exec tsc --build lib/db/tsconfig.json
```

This regenerates `lib/db/dist/*.d.ts` which the api-server (and any other package referencing lib/db via `tsconfig.json` `references`) reads at typecheck time.

## Why
`lib/db` is set up with `composite: true` + `emitDeclarationOnly: true`. The api-server's `tsconfig.json` references it via project references. TypeScript resolves types from `lib/db/dist/` (prebuilt), NOT from source. If you skip the rebuild, tsc reports false errors like "Property 'newField' does not exist on type 'Finding'" even though the source has the field.

## Symptom
```
src/routes/analysis.ts(478,9): error TS2353: Object literal may only specify known properties, and 'candidates' does not exist in type 'Finding'.
```
...when `Finding` in source clearly has `candidates`. = stale .d.ts.

## Note
`lib/db` has no `build` npm script; the only way to rebuild is the explicit `tsc --build` invocation above.
