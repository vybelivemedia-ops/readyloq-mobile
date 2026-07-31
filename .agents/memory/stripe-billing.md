---
name: Stripe billing integration
description: How stripe-replit-sync is wired into the ReadyLoq API server — credential field names, migration path quirks, and backfill gotchas.
---

## Credential field names
The Replit connector API (`/api/v2/connection?include_secrets=true&connector_names=stripe`) returns settings with keys:
- `secret` → Stripe secret key (sk_test_... / sk_live_...)
- `publishable` → Stripe publishable key
- `webhook_secret` → webhook signing secret (if configured)

**NOT** `secret_key` or `api_key`. Failing to match these field names causes a silent "not connected" error even when the integration is healthy.

## StripeSync constructor
Use `stripeSecretKey` (not `stripeApiKey`):
```ts
new StripeSync({ stripeSecretKey: secret, databaseUrl });
// OR with pool:
new StripeSync({ stripeSecretKey, stripeWebhookSecret, poolConfig: { connectionString: databaseUrl } });
```

## stripe-replit-sync must be externalized from esbuild
`stripe-replit-sync` reads migration `.sql` files relative to its own `__dirname` at runtime.
esbuild bundles it and replaces `__dirname` with a build-time path that doesn't exist at runtime → `runMigrations` reports success but creates no tables.

**Fix:** add `"stripe-replit-sync"` to the `external` array in `artifacts/api-server/build.mjs`.

## syncBackfill must pass `{ object: 'all' }`
Calling `sync.syncBackfill()` with no args uses a function reference as the switch discriminant → hits default case → syncs nothing.
Always call: `sync.syncBackfill({ object: 'all' })`.

## Route registration
- `/billing/plans` — public (no auth); handled inside billingRouter
- `/billing/subscription`, `/billing/checkout`, `/billing/portal` — Owner-only; `requireAuth + requireCompany + requireRole("owner")` applied per-route inside billing.ts
- billingRouter mounted once: `router.use("/billing", billingRouter)` — no dual registration needed

## Stripe webhook
Registered before `express.json()` in `app.ts` using `express.raw({ type: 'application/json' })`.
Stripe signature header: `stripe-signature` (lowercase).

## Pricing model (v2)
- **Solo Operator**: flat $69/mo or $690/yr — metadata `{ plan: "solo", billing_model: "flat" }`
- **Growth Team**: $129/mo base + $39/mo per additional seat (yearly: $1,290 + $390/seat)
  - Two prices per interval: `plan_type: "base"` (always qty=1) + `plan_type: "per_seat"` (qty = additionalSeats)
- Old v1 products (Solo $49, Team $149, Enterprise $299) deactivated in Stripe but still in stripe.products with `active` generated column — filter by `metadata->>'billing_model' IS NOT NULL` in listProductsWithPrices.

## Seed script
`pnpm --filter @workspace/scripts exec tsx src/seed-products.ts` — idempotent; skips existing products/prices.
Deactivates legacy products by name, then creates v2 plans.

## DB schema additions
- `companies.subscription_tier` text — 'solo' | 'growth' | null (cached from webhooks)
- `companies.subscription_status` text — Stripe status string (cached from webhooks)

**Why:** These quirks (field names, external build, syncBackfill arg) took multiple debug cycles to discover; recording them prevents repeating the same work.
