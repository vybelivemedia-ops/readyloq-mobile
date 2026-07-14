---
name: Denormalized counter consistency for graph edges
description: How to maintain followersCount/followingCount (and similar denormalized counts) safely alongside edge insert/delete.
---

# Denormalized counter consistency for graph edges

When an edge table (e.g. `followsTable`) backs denormalized counters on another
table (`usersTable.followersCount/followingCount`), the edge mutation and the
counter update must happen in **one `db.transaction`**, and the counter must only
move when an edge actually changed.

- Insert: `tx.insert(edge).onConflictDoNothing({ target: [colA, colB] }).returning(...)`.
  Only bump counters if `rows.length > 0`. This makes concurrent/duplicate
  follows idempotent and avoids 500s from unique-index races.
- Delete: `tx.delete(edge)...returning(...)`; only decrement if a row was removed.
  Use `GREATEST(count - 1, 0)` to clamp.
- Validate target existence first and return 404 if missing (matches the
  OpenAPI 404 path on follow/unfollow).

**Why:** read-then-insert plus two independent counter UPDATEs outside a
transaction is race-prone and can drift the denormalized counts from edge truth.

**How to apply:** reuse this pattern for any graph/count feature (blocks, likes,
DM participants, etc.). Keep the OpenAPI `security: [bearerAuth: []]` and response
codes in sync with the route's actual auth + 404 behavior. Whenever a denormalized
count column is introduced, also ship a backfill script that recomputes it from
the edge table in one transaction (see `scripts/src/backfill-follow-counts.ts`),
and run it during rollout — counters on pre-existing rows start at 0 otherwise.
