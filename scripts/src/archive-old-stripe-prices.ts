/**
 * Archives dependency-free legacy ReadyLoq prices in Stripe test mode.
 *
 * This command is intentionally separate from catalog seeding. It refuses to
 * mutate anything when an old price is referenced by a current subscription,
 * subscription schedule, or open Checkout Session.
 */
import { getUncachableStripeClient } from "./stripeClient";

const CATALOG_VERSION = "readyloq_2026_09";
const CURRENT_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
]);

async function main() {
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(null);
  if ((account as unknown as { livemode?: boolean }).livemode === true) {
    throw new Error("Refusing archive: Stripe account is live mode.");
  }

  const activePrices = (await stripe.prices.list({ active: true, limit: 100 })).data;
  const productCache = new Map<string, Awaited<ReturnType<typeof stripe.products.retrieve>>>();
  const legacyPrices = [];

  for (const price of activePrices) {
    if (price.metadata?.catalog_version === CATALOG_VERSION) continue;
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    let product = productCache.get(productId);
    if (!product) {
      product = await stripe.products.retrieve(productId);
      productCache.set(productId, product);
    }
    if (!("deleted" in product) && product.name.startsWith("ReadyLoq")) {
      legacyPrices.push(price);
    }
  }

  const legacyIds = new Set(legacyPrices.map((price) => price.id));
  const blockers: Array<Record<string, string>> = [];
  const subscriptions = (await stripe.subscriptions.list({ status: "all", limit: 100 })).data;
  for (const subscription of subscriptions) {
    if (!CURRENT_SUBSCRIPTION_STATUSES.has(subscription.status)) continue;
    for (const item of subscription.items.data) {
      if (legacyIds.has(item.price.id)) {
        blockers.push({
          kind: "subscription",
          id: subscription.id,
          status: subscription.status,
          price_id: item.price.id,
        });
      }
    }
  }

  const schedules = (await stripe.subscriptionSchedules.list({ limit: 100 })).data;
  for (const schedule of schedules) {
    for (const phase of schedule.phases) {
      for (const item of phase.items) {
        const priceId = typeof item.price === "string" ? item.price : item.price.id;
        if (legacyIds.has(priceId)) {
          blockers.push({
            kind: "subscription_schedule",
            id: schedule.id,
            status: schedule.status,
            price_id: priceId,
          });
        }
      }
    }
  }

  const openSessions = (await stripe.checkout.sessions.list({ status: "open", limit: 100 })).data;
  for (const session of openSessions) {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    for (const item of lineItems.data) {
      if (item.price && legacyIds.has(item.price.id)) {
        blockers.push({
          kind: "checkout_session",
          id: session.id,
          status: session.status ?? "open",
          price_id: item.price.id,
        });
      }
    }
  }

  if (blockers.length > 0) {
    console.log(JSON.stringify({ archived: [], blockers }, null, 2));
    throw new Error("Refusing archive: legacy prices still have current dependencies.");
  }

  const archived = [];
  for (const price of legacyPrices) {
    await stripe.prices.update(price.id, { active: false });
    archived.push(price.id);
  }

  console.log(JSON.stringify({
    mode: "test",
    archived,
    blockers: [],
    existing_subscriptions_modified: false,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Legacy price archive failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});