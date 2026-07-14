---
name: Autonomy escalation contract (Mission Control V7)
description: The fixed set of founder-escalation reasons Quinn's autonomous cycle may raise, and how milestone detection avoids cold-start spam.
---

Quinn's `runAutonomousCycle` (autonomyEngine.ts) may escalate to the founder ONLY for these four reasons, and must NEVER auto deploy/merge/publish/delete/spend/external (those become approvals, not direct actions):

1. `approval_required` — pending approvals exist.
2. `critical_blocker` — blocked tasks or critical reports.
3. `milestone_completed` — objectives that reached `completed` since the previous cycle.
4. `strategic_decision` — a portfolio asset is in critical overall health.

**Milestone detection — the non-obvious part:** there is no `completedAt` column on `agent_objectives`, only `updatedAt`. Milestones are detected as objectives with `status='completed'` AND `updatedAt > milestoneSince`, where `milestoneSince = previousCycle.startedAt ?? (now - 15min)`.

**Why:** the 15-minute cold-start fallback prevents the very first cycle (no prior cycle row) from escalating the *entire history* of already-completed objectives as if they just finished.

**How to apply:** if you add a real `completedAt` to objectives, switch the window predicate to it. Keep the escalation reason set to exactly these four — the Autonomy page and Diagnostics render them as free strings, so adding a new reason is safe UI-wise but must be a deliberate contract change.