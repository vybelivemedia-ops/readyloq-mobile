---
name: Phase 11 Founder Acceptance readiness
description: All 7 Phase 11 criteria confirmed working end-to-end; remaining gaps were exec status + provider reliability UI.
---

## Rule
Phase 11 (Founder Acceptance) is fully operational. Any future regression check should verify:
- Quinn 5-min scheduler fires `processObjectives()` → `autoDispatchAgentZero` (≤3 jobs/cycle)
- AZ worker picks up jobs in 10-sec tick, writes execution entries, +20% progressPercent per run
- `autoDispatchAgentZero` updates owning exec's `status = "active"` via `sql\`"role" = ${ownerRole}\`` (bypass pgEnum cast)
- `/mission-control/learning` includes `providerReliability` rows (ordered by `sql\`last_seen_at desc\``)
- Protected-action gate blocks deploy/delete/spend/merge/external ops for founder sign-off

## Why
Phase 11 48-hr Founder Acceptance test requires all criteria provably working before test start.

## Confirmed facts
- OpenAI gpt-4o: 0% success (quota-exhausted, ~1.4s fast-fail)
- Anthropic claude-sonnet-4-6: 100% success (13-18s per call)
- `providerReliabilityTable` has no `updatedAt` — order by `sql\`last_seen_at desc\`` not `desc(table.lastSeenAt)` (Drizzle generates blank column name for this table)
