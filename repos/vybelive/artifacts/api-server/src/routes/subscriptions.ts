import { Router } from "express";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type Stripe from "stripe";
import {
  db,
  subscriptionPlansTable,
  subscriptionsTable,
  stripeWebhookEventsTable,
  usersTable,
} from "@workspace/db";
import { CreateSubscriptionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getStripe, isStripeConfigured } from "../lib/stripe";
import { logger } from "../lib/logger";

const router = Router();

// ─── Plan definitions ──────────────────────────────────────────────────────────

const DEFAULT_PLANS = [
  {
    id: "plan_free",
    name: "free",
    price: 0,
    interval: "monthly" as const,
    features: [
      "1 streaming platform",
      "5 AI clips/month",
      "10 stream hours/month",
      "Basic analytics",
    ],
    maxPlatforms: 1,
    maxClipsPerMonth: 5,
    maxStreamHoursPerMonth: 10,
    stripePriceId: null,
  },
  {
    id: "plan_pro",
    name: "pro",
    price: 29,
    interval: "monthly" as const,
    features: [
      "Unlimited platforms",
      "100 AI clips/month",
      "Unlimited stream hours",
      "Advanced analytics",
      "Priority support",
      "Custom RTMP destinations",
    ],
    maxPlatforms: null,
    maxClipsPerMonth: 100,
    maxStreamHoursPerMonth: null,
    stripePriceId: null,
  },
  {
    id: "plan_enterprise",
    name: "enterprise",
    price: 99,
    interval: "monthly" as const,
    features: [
      "Everything in Pro",
      "Unlimited AI clips",
      "White-label streaming",
      "Dedicated support",
      "SLA guarantee",
      "Custom integrations",
    ],
    maxPlatforms: null,
    maxClipsPerMonth: null,
    maxStreamHoursPerMonth: null,
    stripePriceId: null,
  },
];

async function ensurePlansExist() {
  for (const plan of DEFAULT_PLANS) {
    const existing = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, plan.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(subscriptionPlansTable).values(plan);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPlanEnum(name: string): "free" | "pro" | "enterprise" {
  if (name === "pro") return "pro";
  if (name === "enterprise") return "enterprise";
  return "free";
}

function getBaseUrl(req: import("express").Request): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]!.trim()}`;
  return `${req.protocol}://${req.get("host")}`;
}

function mapStripeStatus(
  s: Stripe.Subscription.Status
): "active" | "past_due" | "canceled" | "trialing" {
  if (s === "active") return "active";
  if (s === "past_due") return "past_due";
  if (s === "canceled") return "canceled";
  if (s === "trialing") return "trialing";
  // incomplete / incomplete_expired / unpaid — treat as active until Stripe
  // sends a definitive update so we don't prematurely downgrade the user.
  return "active";
}

/** Upsert a subscription row and sync users.plan. */
async function upsertSubscription(
  userId: string,
  data: {
    planId: string;
    planName: string;
    status: "active" | "past_due" | "canceled" | "trialing";
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  }
): Promise<void> {
  const existing = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(subscriptionsTable)
      .set(data)
      .where(eq(subscriptionsTable.userId, userId));
  } else {
    await db.insert(subscriptionsTable).values({
      id: randomUUID(),
      userId,
      ...data,
    });
  }

  await db
    .update(usersTable)
    .set({ plan: toPlanEnum(data.planName) })
    .where(eq(usersTable.id, userId));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/subscriptions/plans
router.get("/subscriptions/plans", async (_req, res) => {
  try {
    await ensurePlansExist();
    const plans = await db.select().from(subscriptionPlansTable);
    const ordered = DEFAULT_PLANS.map(
      (p) => plans.find((dbp) => dbp.id === p.id) ?? p
    );
    res.json(ordered);
  } catch {
    res.json(DEFAULT_PLANS);
  }
});

// GET /api/subscriptions/me
router.get("/subscriptions/me", requireAuth, async (req, res) => {
  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.auth!.userId))
    .limit(1);

  if (!subscription) {
    res.status(404).json({ error: "No active subscription" });
    return;
  }
  res.json(subscription);
});

// POST /api/subscriptions — free-plan provisioning only
//
// Security: paid plan upgrades are NEVER accepted from clients directly.
// Allowing clients to self-select paid plans would grant free pro/enterprise
// access. Paid plan activation requires a verified payment event:
//   - POST /api/subscriptions/checkout → initiates Stripe checkout
//   - POST /api/subscriptions/webhook  → Stripe event (signature-verified)
//   - POST /api/admin/users/:id/plan   → admin-only manual override (beta)
router.post("/subscriptions", requireAuth, async (req, res) => {
  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const plan = DEFAULT_PLANS.find((p) => p.id === parsed.data.planId);
  if (!plan) {
    res.status(400).json({ error: "Plan not found" });
    return;
  }

  if (plan.id !== "plan_free" || plan.price > 0) {
    res.status(403).json({
      error:
        "Paid plan upgrades require a verified payment. Use POST /api/subscriptions/checkout to start.",
      code: "PAYMENT_REQUIRED",
    });
    return;
  }

  const userId = req.auth!.userId;
  const existing = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let subscription;
  if (existing.length > 0) {
    [subscription] = await db
      .update(subscriptionsTable)
      .set({
        planId: plan.id,
        planName: plan.name,
        status: "active",
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
      })
      .where(eq(subscriptionsTable.userId, userId))
      .returning();
  } else {
    [subscription] = await db
      .insert(subscriptionsTable)
      .values({
        id: randomUUID(),
        userId,
        planId: plan.id,
        planName: plan.name,
        status: "active",
        currentPeriodEnd,
      })
      .returning();
  }

  await db
    .update(usersTable)
    .set({ plan: "free" })
    .where(eq(usersTable.id, userId));

  res.status(201).json(subscription);
});

// POST /api/subscriptions/checkout — initiate Stripe checkout for a paid plan
router.post("/subscriptions/checkout", requireAuth, async (req, res) => {
  const { planId } = (req.body ?? {}) as { planId?: string };
  if (!planId) {
    res.status(400).json({ error: "planId is required" });
    return;
  }

  const plan = DEFAULT_PLANS.find((p) => p.id === planId);
  if (!plan) {
    res.status(400).json({ error: "Plan not found" });
    return;
  }
  if (plan.price === 0) {
    res.status(400).json({ error: "Use POST /api/subscriptions for the free plan" });
    return;
  }

  if (!isStripeConfigured()) {
    res.status(503).json({
      error:
        "Payment provider not configured. Contact support or add STRIPE_SECRET_KEY to enable checkout.",
      code: "PAYMENT_NOT_CONFIGURED",
    });
    return;
  }

  const userId = req.auth!.userId;
  const stripe = getStripe();

  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const [existingSub] = await db
    .select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  let customerId = existingSub?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user?.email ?? undefined,
      metadata: { userId },
    });
    customerId = customer.id;
    req.log.info({ userId, customerId }, "stripe: created new customer");
  }

  const baseUrl = getBaseUrl(req);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `VYBE ${plan.name.toUpperCase()}`,
            description: plan.features.join(" · "),
          },
          recurring: { interval: "month" },
          unit_amount: plan.price * 100,
        },
        quantity: 1,
      },
    ],
    // Store userId and planId on the subscription itself so subscription
    // lifecycle events (created / updated / deleted) can identify the user
    // without an extra lookup.
    subscription_data: {
      metadata: { userId, planId },
    },
    metadata: { userId, planId },
    success_url: `${baseUrl}/api/subscriptions/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/api/subscriptions/checkout/cancel`,
  });

  req.log.info(
    { userId, planId, sessionId: session.id, customerId },
    "stripe: checkout session created"
  );

  res.json({ checkoutUrl: session.url });
});

// GET /api/subscriptions/checkout/success — landing page after successful payment
router.get("/subscriptions/checkout/success", (_req, res) => {
  res.send(
    `<!doctype html><html><head><title>Payment successful</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px;background:#0d0d0d;color:#fff}
h1{color:#39FF14}p{color:#aaa;margin-top:12px}</style></head>
<body><h1>✅ Payment successful!</h1>
<p>Your VYBE LIVE plan has been upgraded.<br>Return to the app to start streaming.</p>
</body></html>`
  );
});

// GET /api/subscriptions/checkout/cancel — landing page after cancelled payment
router.get("/subscriptions/checkout/cancel", (_req, res) => {
  res.send(
    `<!doctype html><html><head><title>Payment cancelled</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px;background:#0d0d0d;color:#fff}
h1{color:#fff}p{color:#aaa;margin-top:12px}</style></head>
<body><h1>Payment cancelled</h1>
<p>No charge was made. Return to the VYBE LIVE app to try again.</p>
</body></html>`
  );
});

// POST /api/subscriptions/webhook — Stripe webhook (server-authoritative plan activation)
//
// Security: this is the ONLY path that upgrades paid plans.
// - req.body is a raw Buffer (express.raw middleware applied in app.ts before express.json)
// - stripe.webhooks.constructEvent() verifies the Stripe-Signature header
// - stripeWebhookEventsTable prevents duplicate processing on Stripe retries
router.post("/subscriptions/webhook", async (req, res) => {
  const stripeWebhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!stripeWebhookSecret) {
    req.log?.warn("stripe webhook: STRIPE_WEBHOOK_SECRET not configured");
    res.status(503).json({ error: "Webhook handler not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing Stripe-Signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, stripeWebhookSecret);
  } catch (err) {
    req.log?.warn({ err }, "stripe webhook: signature verification failed");
    res.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }

  req.log.info({ eventId: event.id, eventType: event.type }, "stripe webhook: received");

  // ── Idempotency guard ───────────────────────────────────────────────────
  const [alreadyProcessed] = await db
    .select({ id: stripeWebhookEventsTable.id })
    .from(stripeWebhookEventsTable)
    .where(eq(stripeWebhookEventsTable.id, event.id))
    .limit(1);

  if (alreadyProcessed) {
    req.log.info({ eventId: event.id }, "stripe webhook: duplicate, skipping");
    res.json({ received: true, skipped: "duplicate" });
    return;
  }

  // ── Event handling ──────────────────────────────────────────────────────
  try {
    await handleStripeEvent(event);
  } catch (err) {
    req.log.error(
      { err, eventId: event.id, eventType: event.type },
      "stripe webhook: handler error"
    );
    // Return 200 so Stripe does not retry — a handler error is a code bug,
    // not a transient failure. Retrying would cause duplicate DB mutations.
    res.json({ received: true, error: "Handler error — check server logs" });
    return;
  }

  // ── Record processed event ──────────────────────────────────────────────
  await db
    .insert(stripeWebhookEventsTable)
    .values({ id: event.id })
    .catch((err) => {
      // Non-fatal: idempotency table write failed. Log and continue.
      logger.warn({ err, eventId: event.id }, "stripe webhook: failed to record event id");
    });

  req.log.info({ eventId: event.id, eventType: event.type }, "stripe webhook: processed");
  res.json({ received: true });
});

// DELETE /api/subscriptions/me — mark for cancellation at period end
router.delete("/subscriptions/me", requireAuth, async (req, res) => {
  const [updated] = await db
    .update(subscriptionsTable)
    .set({ cancelAtPeriodEnd: true })
    .where(eq(subscriptionsTable.userId, req.auth!.userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "No subscription found" });
    return;
  }
  res.json(updated);
});

// ─── Stripe event handlers ────────────────────────────────────────────────────

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.status !== "complete") {
        logger.info(
          { sessionId: session.id, status: session.status },
          "stripe: checkout.session.completed — session not complete, skipping"
        );
        return;
      }

      const userId = session.metadata?.["userId"];
      const planId = session.metadata?.["planId"];

      if (!userId || !planId) {
        logger.warn(
          { sessionId: session.id },
          "stripe: checkout.session.completed — missing userId/planId metadata"
        );
        return;
      }

      const plan = DEFAULT_PLANS.find((p) => p.id === planId);
      if (!plan) {
        logger.warn({ planId }, "stripe: checkout.session.completed — unknown planId");
        return;
      }

      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : (session.customer?.id ?? null);
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null);

      // Retrieve real period end from the Stripe subscription if available.
      // In Stripe API v2026-05-27.dahlia (dahlia), current_period_end moved from
      // the top-level Subscription object to the first SubscriptionItem.
      let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      if (subscriptionId) {
        try {
          const stripe = getStripe();
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const itemPeriodEnd = sub.items.data[0]?.current_period_end;
          if (itemPeriodEnd) periodEnd = new Date(itemPeriodEnd * 1000);
        } catch {
          // Non-fatal: fall back to calculated period end
        }
      }

      await upsertSubscription(userId, {
        planId: plan.id,
        planName: plan.name,
        status: "active",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });

      logger.info(
        { userId, planId, customerId, subscriptionId },
        "stripe: checkout.session.completed — plan activated"
      );
      break;
    }

    case "customer.subscription.created": {
      // checkout.session.completed is the primary activation event because it
      // fires after payment is confirmed and carries session.metadata.planId.
      // subscription.created fires first (before payment) and may not have
      // planId yet if the metadata hasn't propagated. We store what we can and
      // let checkout.session.completed handle full activation.
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.["userId"];
      const planId = sub.metadata?.["planId"];

      if (!userId || !planId) {
        logger.info(
          { subId: sub.id },
          "stripe: customer.subscription.created — no metadata yet, deferring to checkout.session.completed"
        );
        return;
      }

      const plan = DEFAULT_PLANS.find((p) => p.id === planId);
      if (!plan) return;

      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      const createdPeriodEnd =
        sub.items.data[0]?.current_period_end != null
          ? new Date(sub.items.data[0].current_period_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await upsertSubscription(userId, {
        planId: plan.id,
        planName: plan.name,
        status: mapStripeStatus(sub.status),
        currentPeriodEnd: createdPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
      });

      logger.info(
        { userId, planId, subId: sub.id },
        "stripe: customer.subscription.created — subscription stored"
      );
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;

      const [existingSub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.stripeSubscriptionId, sub.id))
        .limit(1);

      if (!existingSub) {
        logger.warn(
          { subId: sub.id },
          "stripe: customer.subscription.updated — no matching local subscription"
        );
        return;
      }

      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const newStatus = mapStripeStatus(sub.status);
      const updatedPeriodEnd =
        sub.items.data[0]?.current_period_end != null
          ? new Date(sub.items.data[0].current_period_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db
        .update(subscriptionsTable)
        .set({
          status: newStatus,
          currentPeriodEnd: updatedPeriodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          stripeCustomerId: customerId,
        })
        .where(eq(subscriptionsTable.id, existingSub.id));

      // If Stripe marks the subscription canceled/past_due, sync the user plan
      if (newStatus === "canceled") {
        await db
          .update(subscriptionsTable)
          .set({ planId: "plan_free", planName: "free" })
          .where(eq(subscriptionsTable.id, existingSub.id));
        await db
          .update(usersTable)
          .set({ plan: "free" })
          .where(eq(usersTable.id, existingSub.userId));
      }

      logger.info(
        { subId: sub.id, userId: existingSub.userId, status: newStatus },
        "stripe: customer.subscription.updated — status synced"
      );
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;

      const [existingSub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.stripeSubscriptionId, sub.id))
        .limit(1);

      if (!existingSub) {
        logger.warn(
          { subId: sub.id },
          "stripe: customer.subscription.deleted — no matching local subscription"
        );
        return;
      }

      await db
        .update(subscriptionsTable)
        .set({
          planId: "plan_free",
          planName: "free",
          status: "canceled",
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        })
        .where(eq(subscriptionsTable.id, existingSub.id));

      await db
        .update(usersTable)
        .set({ plan: "free" })
        .where(eq(usersTable.id, existingSub.userId));

      logger.info(
        { subId: sub.id, userId: existingSub.userId },
        "stripe: customer.subscription.deleted — user downgraded to free"
      );
      break;
    }

    default:
      logger.info({ eventType: event.type }, "stripe webhook: unhandled event type");
  }
}

export default router;
