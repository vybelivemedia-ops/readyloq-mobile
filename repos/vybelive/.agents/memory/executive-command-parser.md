---
name: Executive command parser status tracking
description: Non-obvious gotchas when running background "command" analyses for Mission Control executives
---

# Executive command status tracking

When a founder's chat message is detected as a command, the backend runs a real
capability inspection in a detached (fire-and-forget) background runner, then
flips the executive's status/statusMessage to a working state and restores it on
completion.

## Capability discriminator: use ROLES_WITH_CAPABILITY, not hasCapability
`CAPABILITY_INFO` includes `chief_of_staff` (for its UI responsibility/resources
blurb), so `hasCapability("chief_of_staff")` returns **true** — but
`runCapability("chief_of_staff")` throws because it has no inspector (it
aggregates other reports instead). To decide "can this role run a single
capability inspection?", test membership in `ROLES_WITH_CAPABILITY`, NOT
`hasCapability`.
**Why:** mixing the two left chief-of-staff commands hitting the default `throw`
and the task stuck `blocked`.

## Restoring working status: track in-memory, do NOT count tasks
To avoid clearing a still-running sibling command's working state, the runner must
know if other command executions are in flight for the same executive.
Do this with an in-process `Map<execId, Set<taskId>>` (the runner is in-process).
**Do NOT** decide by querying `agentTasksTable` for `in_progress` + `origin
"founder"` tasks — seed/backlog tasks are also `in_progress`/`founder`, so an
executive with a seeded in-progress task would get stuck on "Running command…"
forever after any command finished.
**How to apply:** mark active at runner start, delete on settle; only restore the
resting status (+ null statusMessage) when the set is empty, else keep
status=active with a generic working message.

## Pre-existing: Mission Control routes are unauthenticated
The entire mission-control router has no `requireAuth` (verified: unauthenticated
GET returns 200). This predates the command-parser feature and applies to every
mission-control endpoint, so securing it is its own scoped change, not part of
command-parser work. Note it if cost-amplifying/command endpoints become a real
exposure concern.
