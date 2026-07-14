---
name: Objective idempotency (dedupKey)
description: Design and pitfalls of the dedupKey column on agentObjectivesTable — Drizzle nullable eq() trap and correct objective status enum values.
---

## The design

`agentObjectivesTable.dedupKey` (nullable `text`) holds a stable structured key
set at creation time. Every autonomous creation path calls `findOrResumeObjective`
before inserting to prevent duplicates across scheduler cycles.

Key conventions:
- Portfolio path: `portfolio:${wd.key}:${wd.assetSlug}`
- Engineering path: `engineering:${productSlug}`
- Blocker remediation: `blocker:${row.dedupeKey}`

`findOrResumeObjective` state machine:
- `planning | in_progress | needs_approval` → return id (skip, already being worked)
- `failed`, retryCount < MAX (3) → reset to `in_progress`, bump retryCount, return id
- `failed`, retryCount ≥ MAX → call `ensureApproval` once (idempotent by title), return id
- not found → return null (caller creates new row with the key)

## Drizzle pitfall: nullable columns and eq()

`eq(agentObjectivesTable.dedupKey, someString)` **fails with TS2769** when the
column is nullable (`text("dedup_key")` without `.notNull()`).

**Fix:** use `sql\`"dedup_key" = ${value}\`` instead of `eq()`. This bypasses
the Drizzle overload resolution issue on nullable columns.

**Why:** Drizzle's `eq()` overloads don't match `string` against `string | null`
column types in TypeScript strict mode.

## Objective status enum

Valid values in `objectiveStatusEnum`:
`"planning" | "in_progress" | "needs_approval" | "completed" | "failed"`

There is **NO** `"blocked"` or `"cancelled"` status on objectives.
- Use `"needs_approval"` for the "waiting on founder" state.
- `"blocked"` is a status on the **blockers** table, not objectives.
- `inArray(agentObjectivesTable.status, [...])` will get TS2769 if you include
  a string not in the enum literal union.
