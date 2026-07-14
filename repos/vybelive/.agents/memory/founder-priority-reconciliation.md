---
name: Founder-priority reconciliation
description: How Quinn retires stale priority claims that conflict with the declared operating profile, and the safety rules around deleting executive memory.
---

# Founder-priority reconciliation (V11 Tier 1)

Quinn's reasoning context surfaces "founder priorities" from TWO independent sources that can drift out of sync with the declared (Tier 0) operating profile:

1. **Inferred insights** — `founderProfileInsightsTable` (observed signals). HAS a soft-delete column (`isActive`).
2. **Executive memory** — `agentMemoryTable` rows of kind `directive`/`preference`, surfaced in conversation as "Founder priorities on record". Has NO lifecycle column (only `pinned`).

A seeded pinned Quinn directive ("the founder's top priority is creator retention") directly contradicted the declared launch-first top priority. The fix lives in `founderProfile.ts`.

## Rules / decisions

- **Tie of sources to truth:** the declared operating profile always wins. Reconciliation retires only items that DIRECTLY CONTRADICT the declared priority *order* (e.g. naming a different single top priority). Compatible nuance (e.g. "retention over acquisition") is KEPT.
- **Insights** are soft-retired (`isActive=false`, reason appended to evidence). Reversible.
- **Memory** has no soft-delete, so retiring = hard DELETE. Therefore:
  - **Pinned memory is NEVER auto-deleted by the AI classifier** — it is returned in `flaggedForReview` for explicit founder/operator review. Irreversible loss on a misclassification is unacceptable.
  - Only NON-pinned flagged rows are deleted, and only via the **explicitly-invoked** `reconcileFounderPriorities()`.
- **Autonomous loop only touches reversible state:** the fire-and-forget self-heal in `analyzeFounderMessage` calls ONLY the insights reconciler — never the memory one.
- **Safe-by-default:** every reconciler swallows errors and retires NOTHING when the AI provider falls back (e.g. 429). Verified: reconciliation no-ops cleanly under provider rate-limit.

**Why:** an AI classifier driving irreversible deletes of canonical executive memory autonomously is the main risk; pinned-protection + explicit-invocation + safe-fallback contain it.

**How to apply:** if you add a proper `isActive`/`retiredAt` lifecycle to `agent_memory` (Tier 4 — Expanded Company Memory), switch the memory reconciler from hard DELETE to soft-retire and you can then safely retire pinned rows too. Until then, keep pinned-protection. Also keep seed (`seedMissionControl.ts`) launch-aligned so a reseed never reintroduces a competing top priority.
