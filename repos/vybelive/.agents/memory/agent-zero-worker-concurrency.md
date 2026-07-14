---
name: Agent Zero worker concurrency
description: Lease-token + CAS pattern required for the in-process job worker (agent_zero_jobs); how controls, recovery, and terminal writes stay race-free.
---

# Agent Zero worker concurrency contract

The in-process job worker (10s tick, ≤2 parallel, fire-and-forget `runJob`) is only safe because of three invariants. Any new job-row write MUST preserve them:

1. **Execution lease**: claiming a queued job sets `leaseToken = randomUUID()`. Every runner write to the job row is gated `WHERE id AND status='running' AND lease_token=<lease>`; the runner aborts when a between-step check or a `.returning()` gate comes back empty. Resume/retry/cancel and terminal writes null the lease, so a stale runner can never touch a re-claimed job.
2. **CAS transitions everywhere**: `controlJob` actions are conditional UPDATEs gated on the statuses the action is valid from (never plain `WHERE id=`), so terminal states can't be overwritten by a stale read. Retry flips the job row FIRST (CAS from failed/cancelled), then resets steps.
3. **No wedge**: the tick runs `recoverStaleRunningJobs()` — running jobs not owned by the in-memory `runningJobs` set and untouched for 10min are re-queued (checkpointed steps make resume safe). The `runJob` fire-and-forget `.catch` does a CAS fail-safe transition to `failed` (rootCause `engine_error`) so pre-loop/post-loop throws never leave `running` forever.

**Why:** architect review found three concrete races: worker crash wedging jobs in `running`; cancel overwriting a just-completed job; double execution after retry re-claim while the old runner was still mid-step.

**How to apply:** when adding new step kinds, control actions, or any other writer of `agent_zero_jobs.status`, gate the write on the same status+lease CAS and only emit side effects (events, Quinn reports) when `.returning()` confirms the write applied — otherwise you duplicate escalations/completion events.
