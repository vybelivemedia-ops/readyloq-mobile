---
name: Quinn protected-action gating (launch-then-gate)
description: How Mission Control's Chief-of-Staff AI treats protected actions — never block objective creation, only gate the irreversible step.
---

# Quinn protected-action gating — launch-then-gate model

Protected categories must NEVER block objective creation. When the founder asks
for something whose final step is irreversible, Quinn still creates the objective
and mobilizes the team for all safe prep (planning, analysis, inspection,
scheduling, delegation, collaboration, memory, reports). The irreversible step is
gated by attaching a *pending approval row tied to the objective*; orchestration
runs the prep, then `maybeFinalizeObjective` holds the objective at
`needs_approval` while that approval is pending.

**Why:** Earlier versions hard-blocked at three layers (intent classify, the
deterministic converse, and a route hard-override that flipped launch→approval),
so a word like "release" produced no objective at all. The COO model requires the
team to do the reversible work autonomously and only stop the founder for the
actual risky action.

**The five — and ONLY five — approval buckets:** Deploy, Merge, Delete, Money,
External services. Everything else is autonomous. `detectProtectedCategory` is a
regex list keyed to these buckets; do not re-broaden it to release/publish/hire/
fire/announce — those are objectives, not gates.

**How to apply / gotchas:**
- "delete" is a PROTECTED DATA action, not a memory verb. The deterministic
  memory-forget regex must NOT include "delete" or it silently swallows
  "delete all X" into a memory op instead of a gated objective. (forget/remove/
  clear stay as memory verbs.)
- Bare affirmations ("yes", "do it") resolve against conversation history via
  `extractActiveObjective`, which skips the current affirmation. Gate the
  affirmation→execution classification on `extractActiveObjective(...)` being
  non-null, NOT on `recentMessages.length > 0` — the founder message is inserted
  BEFORE history is loaded, so a first-message "Yes" otherwise launches a
  nonsensical objective. No active objective → fall through to clarify.
- The converse result must preserve `needsApprovalCategory` for BOTH
  `intent:"launch"` and `intent:"approval_required"` (AI path previously dropped
  it unless approval_required), so AI-inferred protected risk still gates.
- Route resolves the bucket as `result.needsApprovalCategory ?? detectProtectedCategory(text)`
  and skips gating when the message is a pure question (ends with "?").
- Short directives ("release", "ship", "fix critical issues") expand to concrete
  objective text via an inferObjectiveText shorthand map before launch.
