import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";
import { stripeStorage } from "./stripeStorage";
import type { Company } from "@workspace/db";

export type SubscriptionTier = "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot";
export type BillingPeriod = "monthly";
export const READYLOQ_CATALOG_VERSION = "readyloq_2026_09";

/** Shape returned by getLicenseStatus — consumed by the app on login */
export interface LicenseStatus {
  tier: SubscriptionTier | null;
  status: string | null;           // Stripe subscription.status or null
  isActive: boolean;               // true when status is active / trialing
  billedSeats: number;             // additional seats billed (0 for solo)
  activeTeamMembers: number;       // actual headcount in the company
  seatOverage: number;             // max(0, activeTeamMembers - 1 - billedSeats)
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/**
 * StripeService: direct Stripe API operations for ReadyLoq.
 *
 * Billing model: one Stripe customer per Company (B2B).
 * The Owner creates the checkout; the subscription covers the whole team.
 *
 * Current plans are fixed-price monthly tiers. Existing growth subscriptions
 * remain grandfathered and are not modified by new checkout flows.
 */
export class StripeService {
  // ── Customer management ───────────────────────────────────────────────────

  async getOrCreateCustomer(company: Company, ownerEmail: string): Promise<string> {
    if (company.stripeCustomerId) {
      return company.stripeCustomerId;
    }

    const stripe = await getUncachableStripeClient();
    const customer = await stripe.customers.create({
      email: ownerEmail,
      name: company.name,
      metadata: {
        companyId: String(company.id),
        companySlug: company.slug,
      },
    });

    await stripeStorage.updateCompanyStripeInfo(company.id, {
      stripeCustomerId: customer.id,
    });

    return customer.id;
  }

  // ── Pricing helpers ───────────────────────────────────────────────────────

  /**
   * Finds the active current-catalog price for a monthly plan.
   */
  async resolvePriceIds(
    tier: SubscriptionTier,
    period: BillingPeriod,
  ): Promise<{ basePriceId: string; perSeatPriceId?: string }> {
    if (period !== "monthly") throw new Error("ReadyLoq billing is monthly only");
    const rows = await stripeStorage.listProductsWithPrices();

    const planKey = tier;
    const prices = rows.filter(
      (r) =>
        (r.price_metadata as Record<string, string>)?.catalog_version === READYLOQ_CATALOG_VERSION &&
        (r.price_metadata as Record<string, string>)?.plan_key === planKey &&
        (r.price_metadata as Record<string, string>)?.billing_period === "month" &&
        (r.recurring as { interval?: string } | null)?.interval === "month",
    );

    const base = prices[0];

    if (!base) {
      throw new Error(
        `No ${tier} ${period} base price found in stripe.prices. ` +
          "Run the seed script and restart the server to trigger a backfill.",
      );
    }

    return {
      basePriceId: base.price_id as string,
      perSeatPriceId: undefined,
    };
  }

  async hasCurrentSubscription(customerId: string): Promise<boolean> {
    if (await stripeStorage.hasCurrentSubscriptionForCustomer(customerId)) return true;
    const stripe = await getUncachableStripeClient();
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    return subscriptions.data.some((sub) => !["canceled", "incomplete_expired"].includes(sub.status));
  }

  // ── Checkout ──────────────────────────────────────────────────────────────

  /**
   * Creates a Stripe Checkout Session.
   *
   * New tiers use one fixed-price line item. The legacy seat argument remains
   * accepted so grandfathered Growth management callers do not break.
   */
  async createCheckoutSession(opts: {
    customerId: string;
    tier: SubscriptionTier;
    period: BillingPeriod;
    companyId: number;
    additionalSeats?: number;   // Retained only for grandfathered Growth callers
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = await getUncachableStripeClient();
    const company = await stripeStorage.getCompany(opts.companyId);
    if (company?.stripeSubscriptionId &&
        company.subscriptionStatus &&
        !["canceled", "incomplete_expired"].includes(company.subscriptionStatus)) {
      throw new Error("A current subscription already exists for this company");
    }
    if (await this.hasCurrentSubscription(opts.customerId)) {
      throw new Error("A current subscription already exists for this customer");
    }
    const { basePriceId, perSeatPriceId } = await this.resolvePriceIds(
      opts.tier,
      opts.period,
    );

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: basePriceId, quantity: 1 },
    ];

    const additionalSeats = opts.additionalSeats ?? 0;
    if (opts.tier === "growth" && perSeatPriceId && additionalSeats > 0) {
      lineItems.push({ price: perSeatPriceId, quantity: additionalSeats });
    }

    return stripe.checkout.sessions.create({
      customer: opts.customerId,
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "subscription",
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: {
        companyId: String(opts.companyId),
        tier: opts.tier,
        plan_key: opts.tier,
        catalog_version: READYLOQ_CATALOG_VERSION,
        additionalSeats: String(additionalSeats),
      },
      subscription_data: {
        metadata: {
          companyId: String(opts.companyId),
          tier: opts.tier,
          plan_key: opts.tier,
          catalog_version: READYLOQ_CATALOG_VERSION,
        },
      },
      // Allow promo codes on the checkout page
      allow_promotion_codes: true,
    });
  }

  // ── Legacy seat management (grandfathered Growth only) ───────────────────

  /**
   * Updates the per-seat quantity on an active Growth Team subscription.
   * No-op if the company is on the Solo plan or has no subscription.
   *
   * additionalSeats = total active team members - 1 (owner is covered by base).
   */
  async updateSubscriptionSeats(
    companyId: number,
    additionalSeats: number,
  ): Promise<void> {
    const company = await stripeStorage.getCompany(companyId);
    if (!company?.stripeSubscriptionId || company.subscriptionTier !== "growth") {
      return; // Not on Growth — nothing to update
    }

    const stripe = await getUncachableStripeClient();
    const sub = await stripe.subscriptions.retrieve(company.stripeSubscriptionId, {
      expand: ["items"],
    });

    // Find the per-seat subscription item
    const perSeatItem = sub.items.data.find(
      (item) =>
        (item.price.metadata as Record<string, string>)?.plan_type === "per_seat",
    );

    if (!perSeatItem) {
      // No per-seat item yet — if additionalSeats > 0, we need to add it.
      // This can happen if the owner subscribed with 0 additional seats.
      if (additionalSeats > 0) {
        const { perSeatPriceId } = await this.resolvePriceIds("growth", "monthly");
        if (perSeatPriceId) {
          await stripe.subscriptionItems.create({
            subscription: company.stripeSubscriptionId,
            price: perSeatPriceId,
            quantity: additionalSeats,
          });
        }
      }
      return;
    }

    if (additionalSeats === 0) {
      // Remove the per-seat item entirely
      await stripe.subscriptionItems.del(perSeatItem.id, {
        proration_behavior: "create_prorations",
      });
    } else {
      await stripe.subscriptionItems.update(perSeatItem.id, {
        quantity: additionalSeats,
        proration_behavior: "create_prorations",
      });
    }
  }

  // ── Billing portal ────────────────────────────────────────────────────────

  async createPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  // ── License status ────────────────────────────────────────────────────────

  /**
   * Returns a structured license status for a company.
   * Called on app login and from GET /billing/license.
   *
   * Combines data from the companies table (cached tier/status), the
   * stripe.subscriptions table, and the live user count.
   */
  async getLicenseStatus(companyId: number): Promise<LicenseStatus> {
    const company = await stripeStorage.getCompany(companyId);
    if (!company) {
      return {
        tier: null, status: null, isActive: false,
        billedSeats: 0, activeTeamMembers: 0, seatOverage: 0,
        stripeCustomerId: null, stripeSubscriptionId: null,
      };
    }

    const activeMembers = await stripeStorage.getActiveTeamMemberCount(companyId);

    // If no subscription is on file, return unlicensed
    if (!company.stripeSubscriptionId) {
      return {
        tier: null,
        status: null,
        isActive: false,
        billedSeats: 0,
        activeTeamMembers: activeMembers,
        seatOverage: 0,
        stripeCustomerId: company.stripeCustomerId ?? null,
        stripeSubscriptionId: null,
      };
    }

    // Read cached status (written by webhook handler)
    const tier = company.subscriptionTier ?? null;
    const status = company.subscriptionStatus ?? null;
    const isActive = status === "active" || status === "trialing";

    let billedSeats = 0;
    if (tier === "growth") {
      billedSeats = await stripeStorage.getBilledSeatCount(
        company.stripeSubscriptionId,
      );
    }

    // For Solo: seat limit = 1. For Growth: owner + billedSeats.
    const seatCapacity = tier === "solo" ? 1 : 1 + billedSeats;
    const seatOverage = Math.max(0, activeMembers - seatCapacity);

    return {
      tier,
      status,
      isActive,
      billedSeats,
      activeTeamMembers: activeMembers,
      seatOverage,
      stripeCustomerId: company.stripeCustomerId ?? null,
      stripeSubscriptionId: company.stripeSubscriptionId,
    };
  }

  // ── Read helpers ──────────────────────────────────────────────────────────

  async getSubscription(subscriptionId: string) {
    return stripeStorage.getSubscription(subscriptionId);
  }

  async listPlans() {
    return stripeStorage.listProductsWithPrices();
  }
}

export const stripeService = new StripeService();
