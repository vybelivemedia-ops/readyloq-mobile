---
name: ReadyLoq multi-tenancy (per-company isolation)
description: Conventions and decisions for the tenant boundary — adding tables, scoping queries, storage, reserved companies, and the API test harness.
---

# ReadyLoq multi-tenancy

Tenant boundary = ReadyLoq's own Postgres. `companies` table + `users.company_id`.
One company per user (v1). Roles `owner|manager|technician` with hierarchy
owner >= manager >= technician (enforced by `requireRole`).

## Rules to follow for any NEW tenant table or route
- Add `company_id integer NOT NULL references(companies.id)` to the table.
- Mount the route under `requireAuth, requireCompany` (see `routes/index.ts`).
- Scope **every** query (list/read/update/delete) with `companyId = getCompanyId(req)`
  (`lib/tenant.ts`). `getCompanyId` throws if the guards are missing — fail loud.
- For child writes, first verify the **parent row belongs to the caller's company**,
  then stamp the child with the caller's company.

**Why:** DEVIATION by design — there are NO composite parent(id, company_id) DB FKs.
Parent↔child company integrity lives at the app layer only. The single DB FK to
`companies` guarantees a valid company per row; composite FKs + RLS are a deferred
hardening follow-up. If you skip the app-layer parent check, you reintroduce IDOR.

## Reserved companies (not obvious, don't delete)
- slug `platform` — owns the pre-login ReadyLoq brand. Public `GET /branding/active`
  and `GET /branding/` serve its active profile. Authed `GET /branding/company`
  serves the caller company's brand.
- slug `legacy` — owns all pre-tenancy rows/objects. Un-namespaced storage objects
  (`/objects/uploads/...`) are readable only by legacy-company members.

## Storage tenancy
- Uploads namespaced `companies/{companyId}/uploads/{uuid}`.
- Serve-time auth derives scope via `objectPathCompanyScope(path)` BEFORE any GCS
  call and 404s on mismatch (never reveal another company's object exists).

## API test harness (vitest)
- Runs against an isolated `<db>_test` database (see `src/test/test-db.ts` +
  `global-setup.ts` which `drizzle-kit push`es the schema). Single fork, sequential
  (`fileParallelism:false`, `singleFork:true`) because tests mutate shared global
  state (e.g. the single active branding profile).
- Mock `@clerk/express`: `getAuth` returns a hoisted `authState`, `clerkMiddleware`
  is a passthrough. Drive identity with `authState.userId`.
- To test storage serving, **partial-mock** `../lib/objectStorage`
  (`{...actual, ObjectStorageService}`) so `objectPathCompanyScope` /
  `ObjectNotFoundError` stay real and only the GCS methods are stubbed.
- Two-company isolation suite: `artifacts/api-server/src/routes/isolation.test.ts`.

## Gotcha: repo typecheck is red on the frontend
`pnpm run typecheck` (root) includes `artifacts/readyloq`, which carries ~22
PRE-EXISTING tsc errors (SpeechRecognition/MediaStreamVideoTrack globals,
generated-hook `queryKey` required, possibly-undefined fields). These predate the
multi-tenancy work and are unrelated to it; readyloq builds via Vite/esbuild which
doesn't typecheck, so they don't block dev. Don't attribute them to backend changes.
