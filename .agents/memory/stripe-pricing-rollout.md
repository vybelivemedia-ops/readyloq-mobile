---
name: Stripe pricing rollout
description: Durable business and safety rules for ReadyLoq pricing changes and the three-cycle pilot.
---

Use immutable, versioned Stripe Price objects for pricing changes. Existing subscribers remain on their current prices unless the owner separately approves a migration. Seed new catalogs additively, audit subscriptions, schedules, and open Checkout Sessions before archiving old prices, and keep test and production rollouts separate.

**Why:** Pricing changes affect real charges. Grandfathering avoids surprise billing, while dependency checks prevent checkout or active subscriptions from breaking when old prices are archived.

**How to apply:** The pilot is a monthly recurring price for exactly three paid billing cycles. Set an explicit cancellation timestamp from the original billing-cycle anchor, never auto-swap it to a standard plan, and require the customer to select and accept the next plan after the pilot ends.

The workspace Stripe connector may remain a development/test sandbox even after Stripe integration setup. A production rollout requires Replit Integrated Payments for the intended live account, followed by a read-only `livemode=true` and account-identity check immediately before mutation.

**Why:** The development binding exposed a test account with charges and payouts disabled; creating prices there would not satisfy a production rollout and could produce a false completion report.

**How to apply:** Treat `environment=development`, a sandbox ID, or `livemode=false` as a hard preflight blocker. Never substitute test prices for live prices or weaken the existing test-mode guard.