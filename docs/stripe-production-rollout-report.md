# ReadyLoq Stripe production catalog rollout report

**Status:** blocked before mutation  
**Catalog:** `readyloq_2026_09`  
**Date:** 2026-09-21

## Preflight result

No production Stripe objects were created, changed, or archived.

The Stripe connection available to the workspace is a development binding:

- Stripe account: `acct_1TzMFrAMHJlP129I`
- `livemode`: `false`
- charges enabled: `false`
- payouts enabled: `false`
- connection environment: `development`
- connection has a Stripe test sandbox ID

This account is not suitable for the requested production rollout. The existing
test-mode catalog and verification flow remain unchanged.

## Required production procedure

1. Install or connect **Replit Integrated Payments** for the intended live
   Stripe account.
2. Verify that the connection reports `environment=production` and that a
   read-only Stripe account/balance check reports `livemode=true`.
3. Confirm the live account ID and charges/payouts state before running any
   write.
4. Run the additive catalog seed for the six standard monthly plans and the
   `$500/month` Suburban Pilot. Use immutable versioned prices and keep
   Enterprise+ custom with no Stripe Price.
5. Snapshot all subscriptions, subscription schedules, and open Checkout
   Sessions, including their referenced price IDs.
6. Do not update any subscription item or plan. Do not archive a price with a
   current subscription, schedule phase, or open Checkout Session reference.
7. Run production-safe checks for catalog shape, checkout session creation and
   expiration, webhook handling, pilot cancellation at the third monthly
   boundary, and explicit post-pilot plan acceptance. Do not use real payment
   methods or create a live charge merely to test a decline.

## Rollback and containment

- Stripe Price objects are immutable. If a newly created price is wrong, set
  only that new price to `active=false`; do not delete it and do not alter
  existing subscriber items.
- Keep existing subscribers on their current price IDs. There is no automatic
  migration rollback because this rollout performs no subscription migration.
- If checkout or webhook smoke checks fail, disable the newly seeded prices,
  stop presenting them in checkout, and preserve the audit snapshots.
- If an old-price dependency is found, do not archive that old price. Resolve
  the dependent checkout/session or schedule deliberately and rerun the audit.
- For the pilot, cancellation must remain an absolute timestamp at the original
  billing anchor plus three calendar months. Never replace it with an automatic
  standard-plan transition; the customer must explicitly accept a new plan.

## Completion gate

This report is not a claim that production rollout completed. The rollout can
be completed only after the live production binding is available and the
account identity and `livemode=true` check pass immediately before mutation.