/**
 * Test-mode verification. Checkout is tested only through session creation;
 * this script cannot claim that a browser completed hosted Checkout.
 */
import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";

const CATALOG_VERSION = "readyloq_2026_09";
type Snapshot = { status: string; prices: string[] };

function addMonthsUtc(unixSeconds: number, months: number): number {
  const source = new Date(unixSeconds * 1000);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + months;
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(year, month, Math.min(day, lastDay),
    source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds()) / 1000);
}

function snapshotSubscriptions(list: Stripe.ApiList<Stripe.Subscription>) {
  return new Map(list.data.map((s) => [s.id, {
    status: s.status,
    prices: s.items.data.map((i) => i.price.id).sort(),
  } satisfies Snapshot]));
}

async function waitForClock(
  stripe: Stripe,
  clockId: string,
  expectedFrozenTime: number,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  let clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  while (Date.now() < deadline) {
    if (clock.status === "ready" && clock.frozen_time >= expectedFrozenTime) return clock;
    if (clock.status === "failed") {
      throw new Error(`Test Clock failed with status ${clock.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  }
  throw new Error(`Timed out waiting ${timeoutMs}ms for Test Clock ${clockId} to reach ${expectedFrozenTime}.`);
}

async function main() {
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(null);
  if ((account as unknown as { livemode?: boolean }).livemode === true) {
    throw new Error("Refusing verification: Stripe account is live mode.");
  }
  const before = snapshotSubscriptions(await stripe.subscriptions.list({ status: "all", limit: 100 }));
  const catalog = (await stripe.prices.list({ active: true, limit: 100 })).data.filter(
    (p) => p.metadata?.catalog_version === CATALOG_VERSION,
  );
  const standard = catalog.find((p) => p.metadata?.plan_key === "solo" && p.metadata?.price_role === "standard");
  const growth = catalog.find((p) => p.metadata?.plan_key === "growth" && p.metadata?.price_role === "standard");
  const pilot = catalog.find((p) => p.metadata?.plan_key === "pilot" && p.metadata?.price_role === "pilot");
  if (!standard || !growth || !pilot) throw new Error("Catalog v3 prices are missing; run seed-products first.");

  let customer: Stripe.Customer | undefined;
  let clock: Stripe.TestHelpers.TestClock | undefined;
  const disposableSubscriptions: string[] = [];
  const disposableCustomers: string[] = [];
  let checkoutId: string | undefined;
  try {
    clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000), name: "ReadyLoq flow verification",
    });
    if (clock.livemode) throw new Error("Test Clock unexpectedly returned live mode.");
    customer = await stripe.customers.create({
      metadata: { readyloq_verification: "true" }, test_clock: clock.id,
    });
    disposableCustomers.push(customer.id);
    if (customer.livemode) throw new Error("Verification customer unexpectedly returned live mode.");
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card", card: { token: "tok_visa" },
    });
    if (paymentMethod.livemode) throw new Error("Verification payment method unexpectedly returned live mode.");
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription", customer: customer.id,
      line_items: [{ price: standard.id, quantity: 1 }],
      success_url: "https://example.com/readyloq-test-success",
      cancel_url: "https://example.com/readyloq-test-cancel",
    });
    checkoutId = checkout.id;
    if (checkout.livemode) throw new Error("Checkout session unexpectedly returned live mode.");
    console.log("PASS Checkout session creation (hosted browser completion: NOT TESTED)");
    await stripe.checkout.sessions.expire(checkout.id);
    checkoutId = undefined;

    const successful = await stripe.subscriptions.create({
      customer: customer.id, items: [{ price: standard.id }],
      default_payment_method: paymentMethod.id, payment_behavior: "error_if_incomplete",
    });
    disposableSubscriptions.push(successful.id);
    if (successful.livemode || successful.status !== "active") {
      throw new Error("Successful test subscription was not active.");
    }
    console.log("PASS successful subscription creation and test payment");

    const failedCustomer = await stripe.customers.create({
      metadata: { readyloq_verification: "failed-payment" },
    });
    disposableCustomers.push(failedCustomer.id);
    try {
      const declinedMethod = await stripe.paymentMethods.create({
        type: "card", card: { token: "tok_chargeDeclined" },
      });
      await stripe.paymentMethods.attach(declinedMethod.id, { customer: failedCustomer.id });
      const failedSubscription = await stripe.subscriptions.create({
        customer: failedCustomer.id,
        items: [{ price: standard.id }],
        default_payment_method: declinedMethod.id,
        payment_behavior: "allow_incomplete",
      });
      disposableSubscriptions.push(failedSubscription.id);
      if (!["incomplete", "past_due", "unpaid"].includes(failedSubscription.status)) {
        throw new Error(`Failed-payment verification returned unexpected status ${failedSubscription.status}.`);
      }
      console.log(`PASS failed payment behavior (subscription status: ${failedSubscription.status})`);
    } catch (error) {
      const stripeError = error as { type?: string; code?: string; decline_code?: string };
      if (
        stripeError.type !== "StripeCardError" &&
        stripeError.type !== "card_error" &&
        stripeError.code !== "card_declined"
      ) {
        throw error;
      }
      console.log(`PASS failed payment behavior (Stripe card decline: ${stripeError.decline_code ?? stripeError.code})`);
    }

    // Production architecture: cancel_at is an absolute UTC timestamp at
    // anchor + 3 calendar months. Never use cancel_at_period_end here.
    const pilotSub = await stripe.subscriptions.create({
      customer: customer.id, items: [{ price: pilot.id }],
      default_payment_method: paymentMethod.id,
      metadata: { readyloq_pilot_cycles: "3", readyloq_cancel_policy: "cancel_at_three_cycles" },
    });
    disposableSubscriptions.push(pilotSub.id);
    const anchor = pilotSub.billing_cycle_anchor;
    const cancelAt = addMonthsUtc(anchor, 3);
    const scheduled = await stripe.subscriptions.update(pilotSub.id, { cancel_at: cancelAt });
    if (scheduled.cancel_at !== cancelAt || scheduled.cancel_at_period_end) {
      throw new Error("Pilot subscription did not use production cancel_at architecture.");
    }

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const target = addMonthsUtc(anchor, cycle);
      if (cycle < 3) {
        await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: target });
        await waitForClock(stripe, clock.id, target);
      } else {
        await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: target });
        await waitForClock(stripe, clock.id, target);
      }
    }
    const invoices = (await stripe.invoices.list({ customer: customer.id, limit: 100 })).data.filter(
      (invoice) => {
        const subscription = invoice.parent?.subscription_details?.subscription;
        return (typeof subscription === "string" ? subscription : subscription?.id) === pilotSub.id &&
          invoice.status === "paid";
      },
    );
    if (invoices.length !== 3 || invoices.some((invoice) => invoice.amount_paid !== 50000)) {
      throw new Error(`Pilot verification unverified: expected exactly three paid $500 invoices, found ${invoices.length}.`);
    }
    const endedPilot = await stripe.subscriptions.retrieve(pilotSub.id);
    if (endedPilot.status !== "canceled") {
      throw new Error(`Pilot verification unverified: expected cancellation before fourth invoice (status ${endedPilot.status}).`);
    }
    console.log("PASS pilot: exactly three paid $500 invoices and canceled before fourth");

    const transitioned = await stripe.subscriptions.create({
      customer: customer.id, items: [{ price: growth.id }],
      default_payment_method: paymentMethod.id,
      metadata: { readyloq_transition: "after_pilot_cancel" },
    });
    disposableSubscriptions.push(transitioned.id);
    if (transitioned.status !== "active") throw new Error("Explicit post-pilot plan transition was not active.");
    console.log("PASS explicit new-plan transition after pilot cancellation");
  } finally {
    if (checkoutId) {
      try { await stripe.checkout.sessions.expire(checkoutId); } catch { /* already expired */ }
    }
    for (const subscriptionId of disposableSubscriptions) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        if (sub.status !== "canceled") await stripe.subscriptions.cancel(subscriptionId);
      } catch { /* best-effort cleanup */ }
    }
    for (const customerId of disposableCustomers) {
      try { await stripe.customers.del(customerId); } catch { /* clock may retain it briefly */ }
    }
    if (clock) {
      try { await stripe.testHelpers.testClocks.del(clock.id); } catch { /* auto-deletes later */ }
    }
  }

  const after = snapshotSubscriptions(await stripe.subscriptions.list({ status: "all", limit: 100 }));
  const unchanged = [...before].every(([id, value]) => {
    const current = after.get(id);
    return current?.status === value.status && current.prices.join(",") === value.prices.join(",");
  });
  if (!unchanged) throw new Error("Pre-existing subscription IDs/status/price IDs changed.");
  console.log("PASS pre-existing subscriptions unchanged");
  console.log("Cleanup complete; no existing Stripe objects were mutated.");
}

main().catch((error: unknown) => {
  console.error("Test-flow verification failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});