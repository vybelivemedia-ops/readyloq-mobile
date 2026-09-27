import { getStripeSync, getUncachableStripeClient, getStripeCredentials } from "./stripeClient";
import { stripeStorage } from "./stripeStorage";
import { logger } from "./logger";
import type Stripe from "stripe";

/** Add calendar months in UTC, preserving end-of-month semantics safely. */
export function addUtcMonths(unixSeconds: number, months: number): number {
  const date = new Date(unixSeconds * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return Math.floor(date.getTime() / 1000);
}

/**
 * WebhookHandlers: processes raw Stripe webhook payloads.
 *
 * Two-phase processing:
 *   1. stripe-replit-sync.processWebhook — syncs Stripe data to stripe.* tables.
 *   2. ReadyLoq-specific handlers — persist tier/status to the companies table
 *      so license checks don't need live Stripe API calls.
 */
export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "This usually means express.json() parsed the body before this handler. " +
          "FIX: Ensure the webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    // Phase 1: stripe-replit-sync handles data sync to stripe.* tables
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // Phase 2: parse the event and apply ReadyLoq-specific company updates
    try {
      const stripe = await getUncachableStripeClient();
      const credentials = await getStripeCredentials();
      const webhookSecret = credentials.webhookSecret;

      let event: Stripe.Event;
      if (webhookSecret) {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } else {
        // No signing secret — parse without verification (dev/test only)
        event = JSON.parse(payload.toString()) as Stripe.Event;
        logger.warn("Stripe webhook: no signing secret configured — skipping signature verification");
      }

      await WebhookHandlers.handleReadyLoqEvent(event);
    } catch (err) {
      // Log but don't re-throw — the stripe-replit-sync sync already succeeded
      logger.warn({ err }, "ReadyLoq webhook post-processing failed");
    }
  }

  /**
   * Handles ReadyLoq-specific webhook logic:
   * - Persists tier + status to companies table (so license checks are fast)
   * - Clears subscription info when a subscription is canceled/deleted
   */
  private static async handleReadyLoqEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const companyId = Number(session.metadata?.companyId);
        const tier = session.metadata?.tier as "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot" | undefined;
        const subscriptionId = session.subscription as string | undefined;

        if (!companyId || !tier || !subscriptionId) {
          logger.warn(
            { sessionId: session.id },
            "checkout.session.completed: missing companyId/tier/subscriptionId in metadata",
          );
          break;
        }

        if (tier === "pilot") {
          const stripe = await getUncachableStripeClient();
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const anchor = subscription.billing_cycle_anchor;
          const cancelAt = addUtcMonths(anchor, 3);
          if (subscription.cancel_at !== cancelAt) {
            await stripe.subscriptions.update(subscriptionId, {
              // Preserve Stripe's original anchor; this makes the three-cycle
              // cutoff deterministic without changing the grandfathered price.
              billing_cycle_anchor: "unchanged",
              cancel_at: cancelAt,
            });
          }
        }

        await stripeStorage.updateCompanyStripeInfo(companyId, {
          stripeSubscriptionId: subscriptionId,
          subscriptionTier: tier,
          subscriptionStatus: "active",
        });
        logger.info({ companyId, tier, subscriptionId }, "Subscription activated");
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = Number(sub.metadata?.companyId);
        const tier = sub.metadata?.tier as "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot" | undefined;

        if (!companyId) break;

        await stripeStorage.updateCompanyStripeInfo(companyId, {
          stripeSubscriptionId: sub.id,
          subscriptionTier: tier ?? undefined,
          subscriptionStatus: sub.status,
        });
        logger.info({ companyId, status: sub.status }, "Subscription updated");
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = Number(sub.metadata?.companyId);

        if (!companyId) {
          // Try looking up by subscription ID
          const company = await stripeStorage.getCompanyBySubscriptionId(sub.id);
          if (company) {
            await stripeStorage.updateCompanyStripeInfo(company.id, {
              subscriptionTier: null,
              subscriptionStatus: "canceled",
            });
            logger.info({ companyId: company.id }, "Subscription deleted — access revoked");
          }
          break;
        }

        await stripeStorage.updateCompanyStripeInfo(companyId, {
          subscriptionTier: null,
          subscriptionStatus: "canceled",
        });
        logger.info({ companyId }, "Subscription deleted — access revoked");
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const company = await stripeStorage.getCompanyByCustomerId(customerId);
        if (company) {
          await stripeStorage.updateCompanyStripeInfo(company.id, {
            subscriptionStatus: "past_due",
          });
          logger.warn({ companyId: company.id }, "Invoice payment failed — marked past_due");
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const company = await stripeStorage.getCompanyByCustomerId(customerId);
        if (company?.subscriptionStatus === "past_due") {
          await stripeStorage.updateCompanyStripeInfo(company.id, {
            subscriptionStatus: "active",
          });
          logger.info({ companyId: company.id }, "Invoice paid — restored to active");
        }
        break;
      }

      default:
        // Unhandled event types are fine — stripe-replit-sync handles the data sync
        break;
    }
  }
}
