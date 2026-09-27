import { db } from "@workspace/db";
import { companiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * StripeStorage: read Stripe data from the `stripe` schema (managed by
 * stripe-replit-sync) and read/write application Stripe IDs from/to the
 * ReadyLoq `companies` table.
 *
 * ReadyLoq billing model: one Stripe customer per Company.
 * The Owner pays; the subscription covers the whole team.
 *
 * The current catalog is monthly, fixed-price, and versioned in Stripe
 * metadata. Legacy subscriptions remain readable for grandfathered customers.
 */
export class StripeStorage {
  // ── Stripe schema queries (read-only) ──────────────────────────────────────

  async getProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`,
    );
    return result.rows[0] ?? null;
  }

  async listProducts(active = true) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active} ORDER BY name`,
    );
    return result.rows;
  }

  /** Returns only active products and prices from the current catalog. */
  async listProductsWithPrices(_active = true) {
    const result = await db.execute(
      sql`
        SELECT
          p.id            AS product_id,
          p.name          AS product_name,
          p.description   AS product_description,
          p.active        AS product_active,
          p.metadata      AS product_metadata,
          pr.id           AS price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active       AS price_active,
          pr.metadata     AS price_metadata
        FROM stripe.products p
        LEFT JOIN stripe.prices pr
          ON pr.product = p.id AND pr.active = true
         WHERE p.active = true
           AND p.metadata->>'catalog_version' = 'readyloq_2026_09'
        ORDER BY p.name, pr.unit_amount
      `,
    );
    return result.rows;
  }

  async getPrice(priceId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE id = ${priceId}`,
    );
    return result.rows[0] ?? null;
  }

  async getSubscription(subscriptionId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`,
    );
    return result.rows[0] ?? null;
  }

  /**
   * Returns subscription items for a subscription.
   * For Growth Team subscriptions this returns two items:
   *   - base price (quantity 1)
   *   - per-seat price (quantity = additional seats billed)
   */
  async getSubscriptionItems(subscriptionId: string) {
    const result = await db.execute(
      sql`
        SELECT si.id, si.price, si.quantity, pr.metadata AS price_metadata
        FROM stripe.subscription_items si
        JOIN stripe.prices pr ON pr.id = si.price
        WHERE si.subscription = ${subscriptionId}
      `,
    );
    return result.rows;
  }

  async getCustomer(customerId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.customers WHERE id = ${customerId}`,
    );
    return result.rows[0] ?? null;
  }

  /** Any locally synced subscription that has not reached a terminal state. */
  async hasCurrentSubscriptionForCustomer(customerId: string): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT 1
      FROM stripe.subscriptions
      WHERE customer = ${customerId}
        AND status NOT IN ('canceled', 'incomplete_expired')
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  // ── Companies table (application Stripe references) ───────────────────────

  async getCompany(companyId: number) {
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));
    return company ?? null;
  }

  async getCompanyBySubscriptionId(subscriptionId: string) {
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.stripeSubscriptionId, subscriptionId));
    return company ?? null;
  }

  async getCompanyByCustomerId(customerId: string) {
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.stripeCustomerId, customerId));
    return company ?? null;
  }

  async updateCompanyStripeInfo(
    companyId: number,
    stripeInfo: {
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      subscriptionTier?: "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot" | null;
      subscriptionStatus?: string | null;
    },
  ) {
    const [updated] = await db
      .update(companiesTable)
      .set(stripeInfo as typeof companiesTable.$inferInsert)
      .where(eq(companiesTable.id, companyId))
      .returning();
    return updated;
  }

  /**
   * Returns the number of active (non-owner) team members for a company.
   * Used to compute the additional seat count for Growth Team billing.
   */
  async getActiveTeamMemberCount(companyId: number) {
    const result = await db.execute(
      sql`
        SELECT COUNT(*) AS count
        FROM users
        WHERE company_id = ${companyId}
          AND beta_access IS NOT FALSE
      `,
    );
    return Number((result.rows[0] as { count: string }).count ?? "0");
  }

  /**
   * Returns the additional seat count billed in Stripe for a Growth Team
   * subscription (i.e., quantity on the per_seat subscription item).
   */
  async getBilledSeatCount(subscriptionId: string): Promise<number> {
    const result = await db.execute(
      sql`
        SELECT si.quantity
        FROM stripe.subscription_items si
        JOIN stripe.prices pr ON pr.id = si.price
        WHERE si.subscription = ${subscriptionId}
          AND pr.metadata->>'plan_type' = 'per_seat'
        LIMIT 1
      `,
    );
    return Number((result.rows[0] as { quantity: string } | undefined)?.quantity ?? "0");
  }
}

export const stripeStorage = new StripeStorage();
