import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";
import { stripeStorage } from "./stripeStorage";
import type { Company } from "@workspace/db";

export type SubscriptionTier = "solo" | "growth";
export type BillingPeriod = "monthly" | "yearly";

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
 * Plans:
 *   solo   — flat $69/mo or $690/yr
 *   growth — $129/mo base + $39/mo per additional seat
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
   * Finds the active price IDs for a given plan and billing period.
   * Queries the stripe.prices table (already synced by stripe-replit-sync).
   * Returns { basePriceId, perSeatPriceId? }.
   */
  async resolvePriceIds(
    tier: SubscriptionTier,
    period: BillingPeriod,
  ): Promise<{ basePriceId: string; perSeatPriceId?: string }> {
    const interval = period === "monthly" ? "month" : "year";
    const rows = await stripeStorage.listProductsWithPrices();

    const planKey = tier === "solo" ? "solo" : "growth";
    const prices = rows.filter(
      (r) =>
        (r.price_metadata as Record<string, string>)?.plan === planKey &&
        (r.recurring as { interval?: string } | null)?.interval === interval,
    );

    const base = prices.find(
      (r) =>
        (r.price_metadata as Record<string, string>)?.plan_type === "flat" ||
        (r.price_metadata as Record<string, string>)?.plan_type === "base",
    );
    const perSeat = prices.find(
      (r) => (r.price_metadata as Record<string, string>)?.plan_type === "per_seat",
    );

    if (!base) {
      throw new Error(
        `No ${tier} ${period} base price found in stripe.prices. ` +
          "Run the seed script and restart the server to trigger a backfill.",
      );
    }

    return {
      basePriceId: base.price_id as string,
      perSeatPriceId: perSeat?.price_id as string | undefined,
    };
  }

  // ── Checkout ──────────────────────────────────────────────────────────────

  /**
   * Creates a Stripe Checkout Session.
   *
   * Solo:   single line item (flat price, quantity 1).
   * Growth: two line items — base (qty 1) + per_seat (qty = additionalSeats).
   *         additionalSeats defaults to 0 (owner-only); Owner upgrades later.
   */
  async createCheckoutSession(opts: {
    customerId: string;
    tier: SubscriptionTier;
    period: BillingPeriod;
    companyId: number;
    additionalSeats?: number;   // Growth only; default 0
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const stripe = await getUncachableStripeClient();
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
        additionalSeats: String(additionalSeats),
      },
      subscription_data: {
        metadata: {
          companyId: String(opts.companyId),
          tier: opts.tier,
        },
      },
      // Allow promo codes on the checkout page
      allow_promotion_codes: true,
    });
  }

  // ── Seat management (Growth Team only) ───────────────────────────────────

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
