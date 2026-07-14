// ─── OS Event Bus — Stripe Payment Domain Events ───────────────────────────────
// Payment, subscription, and invoice lifecycle events from Stripe webhooks.
// Consumed by the product, marketing, and executive reporting systems.

export type StripePlan = "free" | "pro" | "enterprise";

export interface StripePaymentPayload {
  /** Stripe PaymentIntent ID */
  paymentIntentId: string;
  /** Amount in cents */
  amountCents: number;
  currency: string;
  /** Stripe Customer ID */
  customerId: string;
  /** Internal VYBE user ID if known */
  userId: string | null;
  /** Plan being paid for */
  plan: StripePlan | null;
}

export interface StripeSubscriptionPayload {
  /** Stripe Subscription ID */
  subscriptionId: string;
  customerId: string;
  userId: string | null;
  plan: StripePlan;
  /** "monthly" | "yearly" */
  interval: "monthly" | "yearly";
  /** ISO timestamp of current period end */
  currentPeriodEnd: string;
  /** "active" | "trialing" | "past_due" | "canceled" */
  status: "active" | "trialing" | "past_due" | "canceled";
}

export interface StripeInvoicePayload {
  invoiceId: string;
  customerId: string;
  userId: string | null;
  /** Invoice total in cents */
  amountDue: number;
  currency: string;
  /** ISO due date */
  dueDate: string | null;
}

export interface StripeCustomerPayload {
  customerId: string;
  email: string;
  userId: string | null;
  plan: StripePlan;
}

export interface StripeEventMap {
  "stripe.payment.succeeded": StripePaymentPayload;
  "stripe.payment.failed": StripePaymentPayload;
  "stripe.subscription.created": StripeSubscriptionPayload;
  "stripe.subscription.updated": StripeSubscriptionPayload;
  "stripe.subscription.cancelled": StripeSubscriptionPayload;
  "stripe.invoice.paid": StripeInvoicePayload;
  "stripe.invoice.payment_failed": StripeInvoicePayload;
  "stripe.customer.created": StripeCustomerPayload;
}
