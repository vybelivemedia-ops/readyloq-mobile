---
name: Founder Decision Model (V6.8)
description: How Quinn predicts/scores Founder decisions; the record-vs-decide race rule.
---

# Founder Decision Model (Mission Control V6.8)

Quinn predicts how the Founder would decide on a pending approval BEFORE recommending,
records the prediction, then scores it against the Founder's actual decision. Built on
the V6.5 founder-profile insights (deterministic rule-based predictor — works with AI
unavailable in dev).

## Record-vs-decide race (the load-bearing rule)
**Predictions must be durably committed BEFORE the Founder can decide.** Record the
prediction with `await` at approval-escalation time, NOT fire-and-forget.

**Why:** scoring finds the latest *unscored* prediction for an approval; if a decision
lands (or the async insert fails) before the prediction row commits, scoring finds
nothing and the learning label is lost forever — silently undercounting accuracy. The
escalation runs on the background orchestration path, so awaiting two extra queries
does not affect the Founder's request latency.

**How to apply:** any new prediction-producing path must persist the prediction before
the corresponding decision endpoint can run. Scoring stays fire-and-forget (it only
updates an already-committed row).

## Prediction inference is exact-word, evidence-only
The rule-based matcher uses `\bword\b` regexes on insight text — "approves" does NOT
match `\bapprove\b`. Confidence is capped by evidence: never "high" unless ≥2 distinct
signals agree; "uncertain" → confidence forced low and is never scored correct/incorrect
(it explicitly asked for confirmation, so it neither helps nor hurts accuracy).

## Act-vs-confirm gate
HIGH confidence → act decisively; MEDIUM → lean but soften; LOW/uncertain → request
confirmation. The same gate is mirrored in the service output, the injected context
block, and the QUINN_SYSTEM_PROMPT — keep all three in lockstep if the thresholds change.
