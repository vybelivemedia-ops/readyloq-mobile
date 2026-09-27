---
name: Orval zod-target naming collision for path+query operations
description: Adding an OpenAPI GET with both a path param and a query param breaks lib/api-zod's typecheck with a TS2308 ambiguous-export error; how to fix without touching generated files.
---

## The gotcha
`lib/api-spec/openapi.yaml` had no operation combining `in: path` and `in: query` parameters until Task 924 added `GET /schedule/route-outlook/{inspectionId}?tzOffsetMinutes=`. Running `pnpm run codegen` (orval) for that shape produces a real naming collision inside `lib/api-zod`'s own output:
- `generated/api.ts` exports a zod object `Get<Op>Params` for the **path** param(s) and a separate `Get<Op>QueryParams` for the query param(s) — this half is fine.
- `generated/types/get<op>Params.ts` (the split-mode TS type file) ALSO names itself `Get<Op>Params`, but its content is the **query** params type (matching the react-query client's `params?: Get<Op>Params` function-argument convention).

`lib/api-zod/src/index.ts` does `export * from "./generated/api"` and `export * from "./generated/types"`, so both same-named, differently-typed exports collide → `tsc --build` fails with TS2308 on the barrel file, even though orval itself generates successfully.

**Why this exists:** upstream orval (v8.9.1) naming inconsistency between its zod-schema naming pass (path-only params suffixed just "Params") and its split-mode TS-type naming pass (non-path params also suffixed just "Params" when there's no query-only special case) — only surfaces when one operation has both param kinds.

**How to apply:** `lib/api-zod/src/index.ts` is hand-written (not generated) — fix it there, not in generated files (which get wiped on every codegen run). Add an explicit `export type { Get<Op>Params } from "./generated/types/get<op>Params";` after the two `export *` lines. An explicit named export always wins over `export *` ambiguity for that identifier, so this shadows the collision in favor of the (correct, more useful) query-params type without touching orval config or generated output. Re-run `pnpm run codegen && pnpm -w run typecheck:libs` to confirm.
