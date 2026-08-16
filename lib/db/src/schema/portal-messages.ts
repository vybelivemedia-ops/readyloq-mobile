import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

/**
 * In-portal messaging between property managers (clients) and
 * dispatchers / service providers.
 *
 * Identity model:
 *   - companyId  — the pest-control company that owns the thread
 *   - siteAddress — the human-readable address used throughout the client portal
 *                   (matches inspectionsTable.siteAddress and clientPortalAccessTable.siteAddresses)
 *   - senderType — 'client' (property manager) or 'provider' (dispatcher/tech)
 *   - senderClerkId — Clerk user ID for deduplication and audit
 *   - senderName — display name cached at send time
 */
export const portalMessagesTable = pgTable(
  "portal_messages",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companiesTable.id),
    siteAddress: text("site_address").notNull(),
    senderType: text("sender_type").notNull(), // 'client' | 'provider'
    senderClerkId: text("sender_clerk_id").notNull(),
    senderName: text("sender_name"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyAddressIdx: index("portal_messages_company_address_idx").on(
      t.companyId,
      t.siteAddress,
    ),
  }),
);

export const insertPortalMessageSchema = createInsertSchema(
  portalMessagesTable,
).omit({ id: true, createdAt: true, companyId: true });

export type PortalMessage = typeof portalMessagesTable.$inferSelect;
export type InsertPortalMessage = z.infer<typeof insertPortalMessageSchema>;
