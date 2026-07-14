---
name: Objective orchestration finalization
description: Correctness rules for Chief-of-Staff objective fan-out — report scoping, idempotent finalize, failure transitions.
---

# Mission Control objective orchestration finalize

The Chief-of-Staff loop fans one founder objective out to many execs, then compiles
one aggregated briefing. `maybeFinalizeObjective` is reachable from BOTH the
orchestration runner AND the approval-decision endpoint, so it must be safe under
concurrent calls.

## Report aggregation must be objective-scoped
- `agent_reports` carries `objective_id`. The briefing (and the objective detail
  endpoint) MUST aggregate via `latestReportForObjective(execId, objectiveId)`, never
  `latestReportFor(execId)` (the exec's global latest).
- **Why:** an exec can file an unrelated report (separate single-exec command)
  between fan-out and finalize; global-latest would leak that report into the wrong
  objective's briefing — a data-integrity failure.
- **How to apply:** when adding any new objective-scoped report producer, pass the
  `objectiveId` into `generateAndStoreReport(exec, report, objectiveId)`.

## Finalize must be atomic (no duplicate briefings)
- Claim finalization with a conditional UPDATE: flip objective status to `completed`
  WHERE status IN (planning,in_progress,needs_approval) `.returning()`. Only the
  caller whose update returns a row composes the briefing; losers return early.
- **Why:** two concurrent callers both passing a read-only `status !== completed`
  guard would each insert a briefing report + message (last write wins on
  `briefingReportId`, orphaning the other).
- **How to apply:** never gate finalize on a plain SELECT-then-act; the conditional
  UPDATE row count IS the mutex.

## Orchestration throw must reach a terminal state
- The fire-and-forget `runObjectiveOrchestration(...).catch()` must move the objective
  to `failed` (conditional UPDATE, same status guard) and settle the chief to idle.
- **Why:** otherwise an unhandled throw leaves the objective stuck forever in
  planning/in_progress with no recovery signal.

## OpenAI fallback is load-bearing
- The proxy key hits 429 `insufficient_quota` regularly. `decomposeObjective` and
  `composeBriefing` both fall back to deterministic logic and the whole loop still
  completes correctly. Always verify the fallback path, not just the AI path.
