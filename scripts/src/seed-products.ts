/**
 * ReadyLoq catalog v3 seed (Stripe test mode only).
 *
 * This script is deliberately additive: it never deactivates products or prices.
 */
import { getUncachableStripeClient } from "./stripeClient";

export const CATALOG_VERSION = "readyloq_2026_09";

const PLANS = [
  ["solo", "ReadyLoq Solo", 9900],
  ["micro", "ReadyLoq Micro", 29900],
  ["small", "ReadyLoq Small", 69900],
  ["growth", "ReadyLoq Growth", 129900],
  ["professional", "ReadyLoq Professional", 249900],
  ["enterprise", "ReadyLoq Enterprise", 450000],
] as const;
const PILOT = ["pilot", "ReadyLoq Suburban Pilot", 50000] as const;

async function assertTestMode(stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>) {
  const account = await stripe.accounts.retrieve(null);
  if ((account as unknown as { livemode?: boolean }).livemode === true) {
    throw new Error("Refusing to seed: Stripe account is live mode.");
  }
}

async function seedPlan(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  [planKey, name, amount]: readonly [string, string, number],
  role: "standard" | "pilot",
) {
  const metadata = {
    catalog_version: CATALOG_VERSION,
    plan_key: planKey,
    billing_period: "month",
    price_role: role,
    billing_model: "flat",
  };
  const products = await stripe.products.search({
    query: `metadata['catalog_version']:'${CATALOG_VERSION}' AND metadata['plan_key']:'${planKey}'`,
  });
  const product = products.data.find((p) => p.active) ??
    await stripe.products.create({ name, description: `${name} monthly subscription`, metadata });
  if (product.livemode) throw new Error(`Refusing to use live-mode product ${product.id}.`);
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = prices.data.find((p) =>
    p.unit_amount === amount && p.currency === "usd" &&
    p.recurring?.interval === "month" &&
    p.metadata?.catalog_version === CATALOG_VERSION &&
    p.metadata?.plan_key === planKey && p.metadata?.price_role === role,
  );
  if (match) {
    if (match.livemode) throw new Error(`Refusing to use live-mode price ${match.id}.`);
    console.log(`exists ${planKey} ${match.id}`);
    return;
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
    metadata,
  });
  if (price.livemode) throw new Error(`Stripe returned a live-mode price ${price.id}.`);
  console.log(`created ${planKey} ${price.id}`);
}

async function main() {
  const stripe = await getUncachableStripeClient();
  await assertTestMode(stripe);
  console.log(`ReadyLoq catalog ${CATALOG_VERSION} (test mode)`);
  for (const plan of PLANS) await seedPlan(stripe, plan, "standard");
  await seedPlan(stripe, PILOT, "pilot");
  console.log("Enterprise+ is custom and intentionally has no Stripe price.");
}

main().catch((error: unknown) => {
  console.error("Catalog seed failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});