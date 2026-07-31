/**
 * ReadyLoq Stripe product seed — v2
 *
 * Pricing model:
 *   Solo Operator:  $69/month or $690/year (flat, single seat)
 *   Growth Team:    $129/month base + $39/month per additional active seat
 *                   ($1,290/year base + $390/year per additional seat)
 *
 * Idempotent — safe to run multiple times; skips anything that already exists.
 * Deactivates old v1 products (Solo $49, Team $149, Enterprise $299) so they
 * no longer appear on pricing screens.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 */
import { getUncachableStripeClient } from "./stripeClient";

// ── Old v1 plan names to deactivate (if still active) ────────────────────────
const LEGACY_PLAN_NAMES = ["ReadyLoq Solo", "ReadyLoq Team", "ReadyLoq Enterprise"];

// ── New v2 plan definitions ───────────────────────────────────────────────────
const SOLO_PLAN = {
  name: "ReadyLoq Solo Operator",
  description:
    "Full AI inspection platform for solo operators — FAIE Vision AI, offline sync, and the single-operator dashboard.",
  metadata: { plan: "solo", billing_model: "flat" },
  prices: [
    { interval: "month" as const, unit_amount: 6900,   label: "$69/mo" },
    { interval: "year"  as const, unit_amount: 69000,  label: "$690/yr" },
  ],
};

const GROWTH_PLAN = {
  name: "ReadyLoq Growth Team",
  description:
    "Multi-operator platform with Owner, Manager, Sales Lead, and Tech roles. Pipeline tracking and hot-zone mapping included.",
  metadata: { plan: "growth", billing_model: "per_seat" },
  // Two price "types" per interval: base (flat) + per_seat (metered by quantity)
  base_prices: [
    { interval: "month" as const, unit_amount: 12900,  label: "$129/mo base" },
    { interval: "year"  as const, unit_amount: 129000, label: "$1,290/yr base" },
  ],
  per_seat_prices: [
    { interval: "month" as const, unit_amount: 3900,   label: "$39/mo per additional seat" },
    { interval: "year"  as const, unit_amount: 39000,  label: "$390/yr per additional seat" },
  ],
};

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  console.log("ReadyLoq Stripe product seed (v2)\n");

  // ── Step 1: Deactivate legacy v1 products ──────────────────────────────────
  console.log("Checking for legacy v1 products to deactivate...");
  for (const legacyName of LEGACY_PLAN_NAMES) {
    const results = await stripe.products.search({
      query: `name:'${legacyName}' AND active:'true'`,
    });
    for (const product of results.data) {
      await stripe.products.update(product.id, { active: false });
      console.log(`  ✗ Deactivated legacy product: ${legacyName} (${product.id})`);
    }
  }
  console.log();

  // ── Step 2: Solo Operator (flat pricing) ───────────────────────────────────
  console.log(`[Solo Operator] ${SOLO_PLAN.description}`);
  const existingSolo = await stripe.products.search({
    query: `name:'${SOLO_PLAN.name}' AND active:'true'`,
  });
  let soloProductId: string;
  if (existingSolo.data.length > 0) {
    soloProductId = existingSolo.data[0].id;
    console.log(`  ✓ Product exists (${soloProductId})`);
  } else {
    const p = await stripe.products.create({
      name: SOLO_PLAN.name,
      description: SOLO_PLAN.description,
      metadata: SOLO_PLAN.metadata,
    });
    soloProductId = p.id;
    console.log(`  + Created product (${soloProductId})`);
  }

  for (const price of SOLO_PLAN.prices) {
    const existing = await stripe.prices.list({
      product: soloProductId,
      active: true,
      recurring: { interval: price.interval },
      limit: 5,
    });
    const tagged = existing.data.find(
      (pr) => pr.metadata?.billing_period === price.interval,
    );
    if (tagged) {
      console.log(`  ✓ ${price.label} price exists (${tagged.id})`);
    } else {
      const pr = await stripe.prices.create({
        product: soloProductId,
        unit_amount: price.unit_amount,
        currency: "usd",
        recurring: { interval: price.interval },
        metadata: {
          billing_period: price.interval,
          plan: "solo",
          plan_type: "flat",
        },
      });
      console.log(`  + Created ${price.label} (${pr.id})`);
    }
  }
  console.log();

  // ── Step 3: Growth Team (base + per-seat pricing) ──────────────────────────
  console.log(`[Growth Team] ${GROWTH_PLAN.description}`);
  const existingGrowth = await stripe.products.search({
    query: `name:'${GROWTH_PLAN.name}' AND active:'true'`,
  });
  let growthProductId: string;
  if (existingGrowth.data.length > 0) {
    growthProductId = existingGrowth.data[0].id;
    console.log(`  ✓ Product exists (${growthProductId})`);
  } else {
    const p = await stripe.products.create({
      name: GROWTH_PLAN.name,
      description: GROWTH_PLAN.description,
      metadata: GROWTH_PLAN.metadata,
    });
    growthProductId = p.id;
    console.log(`  + Created product (${growthProductId})`);
  }

  // Base prices
  for (const price of GROWTH_PLAN.base_prices) {
    const existing = await stripe.prices.list({ product: growthProductId, active: true, limit: 20 });
    const tagged = existing.data.find(
      (pr) => pr.metadata?.plan_type === "base" && pr.metadata?.billing_period === price.interval,
    );
    if (tagged) {
      console.log(`  ✓ ${price.label} base price exists (${tagged.id})`);
    } else {
      const pr = await stripe.prices.create({
        product: growthProductId,
        unit_amount: price.unit_amount,
        currency: "usd",
        recurring: { interval: price.interval },
        metadata: {
          billing_period: price.interval,
          plan: "growth",
          plan_type: "base",
        },
      });
      console.log(`  + Created ${price.label} base (${pr.id})`);
    }
  }

  // Per-seat prices
  for (const price of GROWTH_PLAN.per_seat_prices) {
    const existing = await stripe.prices.list({ product: growthProductId, active: true, limit: 20 });
    const tagged = existing.data.find(
      (pr) => pr.metadata?.plan_type === "per_seat" && pr.metadata?.billing_period === price.interval,
    );
    if (tagged) {
      console.log(`  ✓ ${price.label} per-seat price exists (${tagged.id})`);
    } else {
      const pr = await stripe.prices.create({
        product: growthProductId,
        unit_amount: price.unit_amount,
        currency: "usd",
        recurring: { interval: price.interval },
        metadata: {
          billing_period: price.interval,
          plan: "growth",
          plan_type: "per_seat",
        },
      });
      console.log(`  + Created ${price.label} (${pr.id})`);
    }
  }

  console.log();
  console.log("✅ Done — webhooks will sync products/prices to the database.");
  console.log(
    "   Next: restart the API server and run syncBackfill to populate stripe.products.",
  );
}

seedProducts().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
