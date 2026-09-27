---
name: Predictive restocking design
description: Durable design decisions behind the FAIE predictive restock/adaptive logistics forecast, reusable beyond this one feature.
---

## Recency-weighted rate must normalize by the full lookback window, not just active days
When computing an exponentially-decayed "recent activity rate" from sparse/bursty event history, divide the weighted sum by the sum of weights over *every* day in the lookback window — not just the days that had activity. Normalizing only by active-day weight makes a single event look like a sustained daily rate (e.g. one 100-unit event "today" would imply ~100/day forever). Normalizing by the full window keeps sparse history honest while still letting recent, sustained activity dominate.

**Why:** A forecast that overreacts to one data point erodes trust immediately and produces wildly unstable recommendations across recomputes.

**How to apply:** Any time you build a "trend" or "velocity" signal from an event ledger with gaps (consumption, usage, activity), weight-normalize by the full time window's total possible weight, not the observed subset.

## "Acted on" should convert into the existing approval flow's own record type, not create a parallel path
When a predictive/forward-looking signal graduates into something actionable, have "converting"/"acting on it" create (or reuse) a row in the same table and pipeline that the existing reactive/manual version of that action already uses — rather than teaching the predictive signal to perform the terminal action (e.g. placing an order) directly.

**Why:** Keeps exactly one manager-approval → execution pipeline to test, audit, and reason about; the predictive path only ever produces a *better-timed suggestion*, never a second way to trigger the real-world effect.

**How to apply:** Any "smart suggestion" feature sitting in front of an existing manual workflow (restock orders, approvals, escalations) should convert into a row of the existing workflow's table, not call the terminal action itself.

## Guard upserts with a CASE so "reopen on new signal" doesn't silently undo an already-acted-on row
When a recomputed/derived row is upserted on a unique key and the recompute can re-fire ("still looks bad") for a row a human already resolved, guard the SET clause with `CASE WHEN status = '<terminal-state>' THEN <keep-old> ELSE <new-value> END` for both the status and any resolution-timestamp column. Do this per-column, not as an early bail-out on the whole upsert, so the row's other snapshot fields still refresh.

**Why:** Without the guard, a periodic or event-triggered recompute reopens a row the moment its underlying condition is still true, even after a manager converted/approved it — which looks like the system "forgot" their decision.

**How to apply:** Any table that's periodically recomputed in place (not derive-on-read) and has a terminal, human-driven status needs this guard on every upsert path (event-triggered and periodic-sweep), and GET routes for such tables must be pure reads with zero recompute-on-read side effects, or a dismissal appears to "come back" on refresh.

## The same guard applies across tables when a secondary flow writes into a primary flow's shared row
The upsert-guard principle above isn't limited to a signal's own table — it applies just as much when a *different* feature's "convert/link" action writes into another flow's row via the same unique key (e.g. a predictive-suggestion "act on this" button upserting into the reactive alert's own approval-queue table). If that shared row can already be in a terminal, human-approved state with a real-world side effect already fired (e.g. "approved" meaning a supplier order was already placed, guarded elsewhere by `WHERE status = 'pending'`), the second flow's upsert must leave a terminal row completely untouched (status, resolution timestamp, and snapshot fields) — not just avoid double-inserting. Silently resetting it back to a re-actionable state lets a later, unrelated approval click re-trigger the real-world action a second time, since the guard that prevents a duplicate lives on the *other* endpoint and only checks for the pre-transition status.

**Why:** A cross-flow write is easy to review as "does it create a duplicate row" and miss that it can also *mutate* an existing terminal row back into an actionable one, silently defeating a completion guard that lives in a completely different route.

**How to apply:** Before writing an upsert that shares a unique key with another flow's approval/terminal-state table, always ask "what does this write do if the existing row is already in a terminal, side-effect-causing state?" — the answer must be "nothing" (or an explicit link/no-op response), never "reopen it."

## Two different "status" vocabularies on one feature are easy to conflate — name them differently
A forecast/computation can have its own status vocabulary (e.g. "predicted-shortfall" / "healthy" / "insufficient-data") describing what the math concluded, while the persisted row also has a lifecycle status (e.g. "pending" / "dismissed" / "converted") describing whether a human acted on it. These are easy to conflate into a single `status` field/type on the client, especially when only rows in one forecast-status ever get persisted (so the forecast status itself never needs to reach the client at all).

**Why:** A frontend type that mixes both vocabularies compiles fine but is either dead code or a landmine for the next feature that tries to actually use it.

**How to apply:** When a backend computes an internal status to decide *whether* to persist something, and the persisted row has its own lifecycle status, don't expose the internal computation status to the client unless something concrete consumes it — and if you do, name the two fields unambiguously (e.g. `forecastStatus` vs. `status`).
