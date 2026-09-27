---
name: Ledger immutability trigger pattern
description: How to make a Postgres table genuinely tamper-proof (not just by convention) when the app connects as the table owner, and how to keep tests working against it.
---

## The constraint that rules out REVOKE

`REVOKE UPDATE/DELETE` doesn't work as a tamper-proofing mechanism in this deployment: the api-server connects to Postgres as the table's owner (there's no separate, lower-privileged runtime role), and table owners always retain full DML rights over their own tables regardless of what's revoked. A `BEFORE UPDATE OR DELETE` trigger that raises an exception is the mechanism that actually works under that constraint.

**Why:** discovered while making `inventory_transactions` (the chemical/inventory ledger) database-enforced append-only — the obvious first instinct (REVOKE) is a no-op for an owner-connected app.

## Trigger + session-GUC bypass for legitimate mutation

The trigger checks `current_setting('app.bypass_ledger_immutability', true) = 'on'` and allows the operation only then. The bypass is set via `SET LOCAL` inside an explicit `db.transaction()`, so it auto-reverts at commit/rollback and never leaks across pooled connections. Production code never sets it; only a small test helper does, for fixture cleanup.

**How to apply:** any table that needs the same "truly immutable, but tests still need to reset fixtures" property should follow this exact shape — trigger function + `RAISE EXCEPTION` + GUC-gated bypass — rather than inventing a new mechanism per table.

## Test database gotcha: drizzle-kit push doesn't create triggers

The isolated `<db>_test` database is built by running `drizzle-kit push --force` against `lib/db`'s schema — this manages tables/columns/indexes only, not triggers (triggers aren't representable in a drizzle `pgTable`). Any raw-SQL DB object (trigger, function) that production creates via an imperative migration file must ALSO be applied separately in `src/test/global-setup.ts` after the push, using a plain `pg.Client` against the derived test URL — importing the production migration module and calling its function would run against the wrong (dev) `DATABASE_URL`, since the test global-setup phase doesn't yet have the env override in effect. Export the raw SQL statements as a plain array so both call sites share one source of truth.
