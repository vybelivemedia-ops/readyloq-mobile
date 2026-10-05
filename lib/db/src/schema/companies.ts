import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { UserRole } from "./users";

// The tenant boundary for ReadyLoq. Every tenant record carries a company_id
// FK to this table. v1 is one company per user; a user with companyId === null
// has not been onboarded into a company yet (see require-auth requireCompany).
export const companiesTable = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Opt-IN (default OFF) to the Phase 2 shared, anonymized intelligence network.
    // When false, this company's verified records are never eligible for the
    // platform-wide training dataset. Phase 1 keeps everything company-private.
    intelligenceSharingEnabled: boolean("intelligence_sharing_enabled")
      .notNull()
      .default(false),
    // Platform-level access control. Suspended tenants are denied by the
    // authenticated request middleware before tenant routes are reached.
    accessSuspended: boolean("access_suspended").notNull().default(false),
    // Stripe billing — per-company subscription (Owner pays for the whole team).
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    // Cached from Stripe webhooks — avoids live API round-trips on each request.
    // Current catalog tier; legacy growth subscriptions remain grandfathered.
    subscriptionTier: text("subscription_tier").$type<
      "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot"
    >(),
    // Mirrors Stripe subscription.status: 'active' | 'trialing' | 'past_due' |
    // 'canceled' | 'incomplete' | 'unpaid'. null = no subscription.
    subscriptionStatus: text("subscription_status"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("companies_slug_unique").on(t.slug),
  }),
);

// Manager/owner-issued invitations. A token carries the target company + role;
// an invited user accepts it after signing in to join the company.
export const companyInvitesTable = pgTable(
  "company_invites",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    email: text("email"),
    role: text("role").$type<UserRole>().notNull().default("technician"),
    createdByUserId: integer("created_by_user_id"),
    acceptedByUserId: integer("accepted_by_user_id"),
    expiresAt: timestamp("expires_at"),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("company_invites_token_unique").on(t.token),
  }),
);

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
});

export type Company = typeof companiesTable.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type CompanyInvite = typeof companyInvitesTable.$inferSelect;
