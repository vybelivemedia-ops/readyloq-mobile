/** Read-only report of active prices and references to non-v3 prices. */
import { getUncachableStripeClient } from "./stripeClient";
const CATALOG_VERSION = "readyloq_2026_09";

async function main() {
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(null);
  if ((account as unknown as { livemode?: boolean }).livemode === true) {
    throw new Error("Refusing audit: Stripe account is live mode.");
  }

  const prices = (await stripe.prices.list({ active: true, limit: 100 })).data;
  const old = prices.filter((p) => p.metadata?.catalog_version !== CATALOG_VERSION);
  const subscriptions = (await stripe.subscriptions.list({ status: "all", limit: 100 })).data;
  const schedules = (await stripe.subscriptionSchedules.list({ limit: 100 })).data;
  const openSessions = (await stripe.checkout.sessions.list({ status: "open", limit: 100 })).data;
  const relevant = new Set(["active", "trialing", "past_due", "incomplete", "unpaid"]);
  const priceIds = new Set(old.map((p) => p.id));
  const subscriptionReferences = subscriptions
    .filter((s) => relevant.has(s.status))
    .flatMap((s) => s.items.data.filter((i) => priceIds.has(i.price.id)).map((i) => ({
      subscription_id: s.id, status: s.status, price_id: i.price.id,
    })));
  const scheduleReferences = schedules.flatMap((s) =>
    s.phases.flatMap((phase) => phase.items.filter((i) => priceIds.has(
      typeof i.price === "string" ? i.price : i.price.id,
    )).map((i) => ({
      schedule_id: s.id, status: s.status,
      price_id: typeof i.price === "string" ? i.price : i.price.id,
    }))),
  );
  const checkoutReferences = [];
  for (const session of openSessions) {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    for (const item of lineItems.data) {
      if (item.price && priceIds.has(item.price.id)) {
        checkoutReferences.push({
          checkout_session_id: session.id,
          status: session.status,
          price_id: item.price.id,
        });
      }
    }
  }
  console.log(JSON.stringify({
    mode: "test",
    old_active_prices: old.map((p) => ({ id: p.id, product: p.product, unit_amount: p.unit_amount, metadata: p.metadata })),
    subscription_references: subscriptionReferences,
    schedule_references: scheduleReferences,
    checkout_references: checkoutReferences,
    mutations: [],
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Catalog audit failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});