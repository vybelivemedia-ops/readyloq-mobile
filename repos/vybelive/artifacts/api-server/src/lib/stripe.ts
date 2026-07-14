import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-05-27.dahlia" as const;

let _stripe: Stripe | null = null;

/**
 * Returns the singleton Stripe client. Throws if STRIPE_SECRET_KEY is not set.
 * Call isStripeConfigured() first if you want a graceful 503 instead.
 */
export function getStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!_stripe) {
    _stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return _stripe;
}

/** True if STRIPE_SECRET_KEY is present in the environment. */
export function isStripeConfigured(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}
