import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Client Portal Access — grants a property manager (an external Clerk user
 * who is NOT in the usersTable) read-only access to one or more buildings
 * serviced by a pest control company.
 *
 * Isolation: every API query in the /client/* routes must:
 *   1. Look up the caller's clerkUserId here to find their companyId + siteAddresses
 *   2. Scope ALL DB queries to that companyId AND to the allowed siteAddresses list
 *
 * A property manager with access to Building A of Company X can NEVER see:
 *   - Building B of Company X (different address not in their siteAddresses)
 *   - Any building of Company Y (different companyId)
 */
export const clientPortalAccessTable = pgTable(
  "client_portal_access",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    // Clerk user ID of the property manager (external customer, not in usersTable).
    clerkUserId: text("clerk_user_id").notNull(),
    // Human-readable label set by the granting manager (e.g. "Jane Smith – 123 Main St").
    label: text("label"),
    // Email address for display/reference; not used for auth (Clerk handles that).
    email: text("email"),
    // The building addresses this property manager may view. Must be a non-empty
    // subset of the company's siteAddress values in the inspections table.
    siteAddresses: jsonb("site_addresses").$type<string[]>().notNull().default([]),
    // Drizzle userId of the manager who granted access (nullable: set to null if
    // the granting user is later removed from the company).
    grantedByUserId: integer("granted_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // A single Clerk user can have at most one access record per company
    // (managers extend their siteAddresses list rather than creating duplicates).
    uniqueIndex("client_portal_access_company_clerk_uq").on(t.companyId, t.clerkUserId),
    index("client_portal_access_clerk_idx").on(t.clerkUserId),
    index("client_portal_access_company_idx").on(t.companyId),
  ],
);

export type ClientPortalAccess = typeof clientPortalAccessTable.$inferSelect;
