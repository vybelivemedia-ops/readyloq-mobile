import { Router, type Request, type Response } from "express";
import { stripeService } from "../lib/stripeService";
import { stripeStorage } from "../lib/stripeStorage";
import { logger } from "../lib/logger";
import {
  requireAuth,
  requireCompany,
  requireRole,
} from "../middleware/require-auth";

const router = Router();

const BILLING_RETURN_URL =
  process.env.BILLING_RETURN_URL ?? "https://readyloq.com";

// All routes that require owner-level auth use this stack
const ownerOnly = [requireAuth, requireCompany, requireRole("owner")];
// Routes that just need a valid, company-linked session
const memberAuth = [requireAuth, requireCompany];

// ── GET /billing/plans ── public listing of all active plans ─────────────────
// Used by the pricing screen; no auth required so prospects can browse.
// Returns products grouped with their prices and plan metadata.
router.get("/plans", async (_req: Request, res: Response) => {
  try {
    const rows = await stripeStorage.listProductsWithPrices();

    // Group prices by product
    const productsMap = new Map<
      string,
      {
        id: string;
        name: string;
        description: string | null;
        metadata: Record<string, string>;
        prices: Array<{
          id: string;
          unit_amount: number;
          currency: string;
          recurring: unknown;
          metadata: Record<string, string>;
        }>;
      }
    >();

    for (const row of rows) {
      const id = row.product_id as string;
      if (!productsMap.has(id)) {
        productsMap.set(id, {
          id,
          name: row.product_name as string,
          description: (row.product_description as string) ?? null,
          metadata: (row.product_metadata as Record<string, string>) ?? {},
          prices: [],
        });
      }
      if (row.price_id) {
        productsMap.get(id)!.prices.push({
          id: row.price_id as string,
          unit_amount: row.unit_amount as number,
          currency: row.currency as string,
          recurring: row.recurring,
          metadata: (row.price_metadata as Record<string, string>) ?? {},
        });
      }
    }

    return res.json({ data: Array.from(productsMap.values()) });
  } catch (err) {
    logger.error({ err }, "[billing] /plans error");
    return res.status(500).json({ error: "Failed to load plans" });
  }
});

// ── GET /billing/license ── login-time license status check ──────────────────
// Called on app startup to determine if the user's company has an active
// subscription and what tier/seat limits apply. Any authenticated team member
// can call this (not just owners).
router.get("/license", ...memberAuth, async (req: Request, res: Response) => {
  try {
    const licenseStatus = await stripeService.getLicenseStatus(
      req.user!.companyId!,
    );
    return res.json(licenseStatus);
  } catch (err) {
    logger.error({ err }, "[billing] /license error");
    return res.status(500).json({ error: "Failed to fetch license status" });
  }
});

// ── GET /billing/subscription ── full subscription record (Owner only) ────────
router.get("/subscription", ...ownerOnly, async (req: Request, res: Response) => {
  const company = await stripeStorage.getCompany(req.user!.companyId!);
  if (!company?.stripeSubscriptionId) {
    return res.json({ subscription: null });
  }

  try {
    const subscription = await stripeStorage.getSubscription(
      company.stripeSubscriptionId,
    );
    const items = await stripeStorage.getSubscriptionItems(
      company.stripeSubscriptionId,
    );
    return res.json({ subscription, items });
  } catch (err) {
    logger.error({ err }, "[billing] /subscription error");
    return res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

// ── POST /billing/checkout ── create Stripe Checkout Session (Owner only) ────
// Body: { tier: 'solo' | 'growth', period: 'monthly' | 'yearly', seats?: number }
// seats is the number of ADDITIONAL seats beyond the owner (Growth only).
router.post("/checkout", ...ownerOnly, async (req: Request, res: Response) => {
  const {
    tier,
    period = "monthly",
    seats = 0,
    email,
  } = req.body as {
    tier?: "solo" | "growth";
    period?: "monthly" | "yearly";
    seats?: number;
    email?: string;
  };

  if (!tier || (tier !== "solo" && tier !== "growth")) {
    return res
      .status(400)
      .json({ error: "tier is required and must be 'solo' or 'growth'" });
  }
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const company = await stripeStorage.getCompany(req.user!.companyId!);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  try {
    const customerId = await stripeService.getOrCreateCustomer(company, email);

    const session = await stripeService.createCheckoutSession({
      customerId,
      tier,
      period: period as "monthly" | "yearly",
      companyId: company.id,
      additionalSeats: tier === "growth" ? Math.max(0, Number(seats)) : 0,
      successUrl: `${BILLING_RETURN_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${BILLING_RETURN_URL}/billing/cancel`,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    logger.error({ err }, "[billing] /checkout error");
    return res
      .status(500)
      .json({ error: (err as Error).message || "Failed to create checkout session" });
  }
});

// ── PATCH /billing/seats ── update billed seat count (Owner only) ─────────────
// Growth Team only. Adjusts the per-seat subscription item in Stripe.
// Body: { seats: number }  — total ADDITIONAL seats (total team - 1 for owner).
router.patch("/seats", ...ownerOnly, async (req: Request, res: Response) => {
  const { seats } = req.body as { seats?: number };

  if (seats === undefined || typeof seats !== "number" || seats < 0) {
    return res
      .status(400)
      .json({ error: "seats must be a non-negative number" });
  }

  const company = await stripeStorage.getCompany(req.user!.companyId!);
  if (!company?.stripeSubscriptionId) {
    return res.status(400).json({
      error: "No active subscription found. Complete checkout first.",
    });
  }
  if (company.subscriptionTier !== "growth") {
    return res.status(400).json({
      error: "Seat management is only available on the Growth Team plan.",
    });
  }

  try {
    await stripeService.updateSubscriptionSeats(company.id, seats);
    return res.json({ ok: true, additionalSeats: seats });
  } catch (err) {
    logger.error({ err }, "[billing] /seats error");
    return res.status(500).json({ error: "Failed to update seat count" });
  }
});

// ── POST /billing/portal ── Stripe Customer Portal session (Owner only) ───────
// Lets the Owner manage payment methods, invoices, and cancel subscription.
router.post("/portal", ...ownerOnly, async (req: Request, res: Response) => {
  const company = await stripeStorage.getCompany(req.user!.companyId!);
  if (!company?.stripeCustomerId) {
    return res.status(400).json({
      error: "No billing account found. Complete a checkout first.",
    });
  }

  try {
    const session = await stripeService.createPortalSession(
      company.stripeCustomerId,
      `${BILLING_RETURN_URL}/billing`,
    );
    return res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "[billing] /portal error");
    return res.status(500).json({ error: "Failed to open billing portal" });
  }
});

export default router;
