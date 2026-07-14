---
name: API Server Testing
description: How automated tests run for the Express api-server (vitest + isolated test DB + Clerk auth mocking)
---

## Test runner
- `@workspace/api-server` uses **vitest** (`pnpm --filter @workspace/api-server run test`). Test files live next to source as `src/**/*.test.ts`. Helpers/setup in `src/test/`.
- esbuild build only bundles `src/index.ts`, so `*.test.ts` never reach the production bundle. Safe to colocate.

## Isolated test database (the key decision)
- Tests run against a **separate `<db>_test` Postgres database**, NOT the dev DB. **Why:** branding activate/delete/restore-defaults mutate global state (the single `isActive` row); running them on the shared dev DB would corrupt live branding.
- `src/test/global-setup.ts` (vitest `globalSetup`) creates `<db>_test` via a raw `pg` client against the `postgres` maintenance DB, then `drizzle-kit push --force` pushes the full schema into it.
- `vitest.config.ts` injects `DATABASE_URL=<test url>` via `test.env`, so workers' `@workspace/db` pool points at the test DB. URL derivation helpers in `src/test/test-db.ts`.
- CREATE DATABASE IS permitted on this Replit Postgres (host `helium`). Confirmed working.
- Config uses `pool: forks` + `singleFork: true` + `fileParallelism: false` so all tests share one process sequentially (branding state is global).

## Mocking Clerk auth
- Mock `@clerk/express`: override `getAuth` to return a test-controlled `{ userId }` and stub `clerkMiddleware` to a no-op. Use `vi.hoisted(() => ({ authState }))` so the hoisted `vi.mock` factory can reference the mutable auth state. Set `authState.userId` per test to simulate unauth / technician / manager.
- `requireAuth` still does the REAL DB user lookup/JIT-provision, so seed `usersTable` rows (manager/technician with known clerkUserIds) in `beforeAll`. This exercises real RBAC.
- For storage tests, also `vi.mock("../lib/objectStorage")` to avoid real GCS calls.

## Pre-existing typecheck failures (do NOT think tests broke them)
- `pnpm --filter @workspace/api-server run typecheck` already fails on baseline with many `TS7030: Not all code paths return a value` errors in existing route/middleware files (express handlers that `return res.json(...)` in some branches, `next()`/nothing in others). These predate the test work and are unrelated. The added test files introduce zero new typecheck errors. `pnpm build` (esbuild) does not typecheck, so it passes.

## E2E limitation
The Playwright testing subagent's Clerk override (`testClerkAuth: true`) cannot establish a session on the Expo dev domain (`*.expo.spock.replit.dev`) — it works only for apps served through the standard localhost proxy. Authenticated e2e/screenshots of the Expo app on web are not feasible; verify auth-gated mobile flows on a real device instead.
