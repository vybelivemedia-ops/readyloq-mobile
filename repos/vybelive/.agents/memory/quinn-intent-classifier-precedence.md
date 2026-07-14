---
name: Quinn classifyIntent precedence
description: Why approval-queue / specific intents can be silently misrouted to objective_execution despite being highest pattern priority.
---

In `chiefConversation.ts` `classifyIntent`, the INTENT_PATTERNS priority array lists
`approval_request` first, but several EARLY gates run before any pattern matching and
can preempt it:
1. memory-op regex
2. affirmation + active objective
3. status-query regex
4. `inferObjectiveText` (terse directives)
5. protected-category directive
6. `ACTION_VERB_FIRST_RE` (>4 words) — includes verbs like `check`, `review`,
   `inspect`, `audit`, `confirm`, `verify`
7. `parseExecutiveCommand().isCommand`

**Why it bites:** an imperative approval query like "Check the approval queue — any
pending approvals?" hits the action-verb gate (`check`) and returns
`objective_execution`, so it never reaches the `approval_request` pattern. This
silently launches an objective instead of answering an approval question.

**How to apply:** when an intent must win for a specific phrasing, add a targeted
early return for that phrasing BEFORE the action-verb/command gates — do not rely on
the pattern-priority array alone. The V11.2 fix added an approval-queue regex early
return right after the memory-op check.
