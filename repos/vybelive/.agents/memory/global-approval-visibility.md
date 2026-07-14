---
name: Global approval visibility
description: NULL-objective founder approvals must be surfaced in a global queue, not only via per-objective counts.
---

**Rule:** Any surface that lets the founder decide approvals must render the full `GET /approvals?status=pending` list. Never rely solely on per-objective `pendingApprovalCount` (computed via `inArray(objectiveId, ids)`) — approvals with `objective_id = NULL` (global autonomy escalations like "Critical blocker needs founder attention") match no objective and become invisible and undecidable.

**Why:** This caused a multi-day full-system stall: an orphaned pending approval was counted by Quinn's chat context, briefing, and autonomy signals (all query globally) but appeared nowhere in the UI. The founder could never decide it, so every autonomy cycle re-escalated `approval_required`, the briefing repeated the same summary for days, and progression froze. The decision endpoint itself handles NULL objectiveId fine (guards the finalize call).

**How to apply:** New approval-related UI goes through the global list endpoint (same params/queryKey as Quinn's nudge → identical counts by construction). Stale orphaned escalations can be safely cleared with a "later" (defer) decision — `ensureApproval` dedupes only against *pending*, so the engine re-escalates a fresh one if the condition persists. Prod DB is read-only from the agent; prod orphans are cleared by the founder in the UI after republish.
