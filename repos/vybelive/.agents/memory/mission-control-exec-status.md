---
name: Mission Control exec status on overlapping objectives
description: How executive status is kept accurate when two founder objectives run concurrently, and where the specialist "second teammate" consult is wired.
---

# Exec status under overlap + specialist consult wiring

## Overlap-safe exec status (settleExecStatus)
When two founder objectives run at once they can assign — or hand off to — the
**same** executive. The naive `settleExecStatus(execId)` flips the exec to
idle/needs_approval as soon as ONE workstream finishes, which wrongly shows an
exec as idle while a sibling objective still has it working.

**Rule:** every engagement must be a refcounted pair — `beginExecWork(execId)`
paired with `settleExecStatus(execId)`, and the pair MUST be wrapped in
`try/finally` so the settle always runs even if a workstream step throws.
`settleExecStatus` only really settles (idle/needs_approval) when the refcount
reaches 0; otherwise it leaves the live working status intact.

**Why:** without try/finally a mid-loop throw leaks the count → the exec is stuck
"busy" forever (worse than the original early-idle flicker). With the guard, a
leak is impossible by construction.

**How to apply:** engagement points live in `runObjectiveOrchestration`
(primary assignment + collaboration target). Dev-reset endpoints
(reset-executive-team / reset-quinn-reasoning) must clear/delete the in-memory
map alongside `activeCommandTasks`.

**Deliberately NOT refcounted:** the chief_of_staff (Quinn). Its status is set
directly during decompose/compile-briefing/finalize, and its lifecycle spans the
approval-gating flow (maybeFinalizeObjective can run many times, only the CAS
"claim" completes). A refcount there risks a permanent stuck-busy. The chief
being idle during another objective's fan-out is *accurate* — chief only works
during planning/briefing, not during exec fan-out — so the tiny transient is
acceptable.

**Dead code, do not resurrect for this:** `executeCommandInBackground` +
`activeCommandTasks`/`markCommandActive`/`settleExecutiveStatus` are NOT the live
path (only cleared in reset routes). The live path is
`runObjectiveOrchestration` → `setExecStatus`/`settleExecStatus`.

## Specialist "second teammate" consult (consultBenchForReport)
The bench consult is a shared helper `consultBenchForReport(exec, base,
focusText, ctx?)` that mutates the report (findings/summary) and records a
collaboration activity. Used in BOTH the objective path (`inspectAndReport`, focus
= assignment focus) and the standalone `POST /executives/:id/report` route (focus
derived from the report's own headline+summary+findings). `consultSpecialist`
never throws (degrades to null), matching happens only via
`matchSpecialistsForRole` keyword triggers scoped to the exec's own bench — so no
infinite loop and no duplicate memory (single report → approval → briefing
pipeline).
