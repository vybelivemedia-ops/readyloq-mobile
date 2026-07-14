---
name: Stripe v22 subscription field changes
description: Breaking API changes in stripe@22 (2026-05-27.dahlia) that affect subscription lifecycle handlers
---

## Rule

In Stripe API version `2026-05-27.dahlia` (stripe@22.x), `current_period_end` and `current_period_start` were **removed from the top-level `Stripe.Subscription` object**. They now live on each `SubscriptionItem`.

**Wrong (v21 and earlier):**
```typescript
new Date(sub.current_period_end * 1000)  // TS2339 error
```

**Correct (v22 / dahlia):**
```typescript
const itemPeriodEnd = sub.items.data[0]?.current_period_end;
const periodEnd = itemPeriodEnd
  ? new Date(itemPeriodEnd * 1000)
  : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback
```

`cancel_at_period_end` and `billing_cycle_anchor` remain on the top-level Subscription object — unchanged.

**Why:** Stripe's dahlia API restructured billing periods to be per-item rather than per-subscription, to support subscriptions with items on different billing cycles.

**How to apply:** Any code that reads `sub.current_period_end` from a `Stripe.Subscription` (event payload or API response) must be updated to `sub.items.data[0]?.current_period_end`.
