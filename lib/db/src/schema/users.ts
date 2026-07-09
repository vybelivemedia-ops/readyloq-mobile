import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

// Rank order (see api-server require-auth ROLE_RANK):
// technician < sales < manager < owner. `sales` exists for Opportunity
// Intelligence: it can see the Opportunity Log but gains NO manager powers.
export type UserRole = "owner" | "manager" | "sales" | "technician";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  // Nullable: a freshly signed-in user has no company until they create one or
  // accept an invite (onboarding gate). requireCompany blocks tenant routes
  // until this is set.
  companyId: integer("company_id").references(() => companiesTable.id),
  role: text("role").$type<UserRole>().notNull().default("technician"),
  // Closed-beta access gate. Default ON so existing/owner/manager users are never
  // locked out; managers can revoke a technician's access from the Beta Center,
  // which blocks tenant data routes with { code: "beta_access_disabled" }.
  betaAccess: boolean("beta_access").notNull().default(true),
  // Updated (throttled) by requireAuth so the Beta Center can show tester activity.
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
