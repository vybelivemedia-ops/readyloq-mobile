---
name: Scheduled social post retry & reschedule
description: Auto-retry classification, DI-testable publisher, and the approval-gate trap when rescheduling/retrying scheduled social posts.
---

# Scheduled social post retry & reschedule

## Publisher run-loop is dependency-injected for testing
The publisher loop touches real DB + network, so it accepts injectable `{ store, publish, now }`.
**Why:** DI is the only way to unit-test the retry/CAS logic offline; the in-memory test store's
claim must be a synchronous check-and-set to faithfully model the DB conditional-UPDATE that prevents
double-publishing under concurrency. Don't "simplify" the test store to an async claim — it stops
modeling the race the CAS exists to prevent.

## Transient vs permanent failure classification
Rule: 429/5xx and any unknown/non-typed throw = transient → requeue with exponential backoff until a
retry cap, then `failed`; explicitly-permanent errors go straight to `failed`.
**Why:** raw network blips shouldn't burn the retry budget as hard failures, but an infinite requeue
would wedge the queue — the cap is the safety valve.

## The approval-gate trap on reschedule/retry (bug fixed here)
The publisher's due-filter requires `status='scheduled' AND (requiresApproval=false OR approvedAt IS NOT NULL)`.
So any flow that flips a post back to `scheduled` MUST re-derive approval the same way creation does:
`nextStatus = (requiresApproval && approvedAt == null) ? 'pending_approval' : 'scheduled'`.
**Why:** a post cancelled while still pending approval has `approvedAt=null`; forcing it straight to
`scheduled` makes it permanently invisible to the publisher (looks queued, never runs).
**How to apply:** the reschedule endpoint (`POST /mission-control/social/schedule/:id/reschedule`, failed/cancelled only)
and any future retry/requeue path must apply this derivation, not a blind `status:'scheduled'`.
