import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

/**
 * Sales Proposals — the sales lens over the Opportunity Log.
 *
 * A proposal is a human-assembled bundle of opportunities for one property:
 * sales picks the opportunities, writes the intro, and (outside the AI's
 * reach) turns value tiers into real prices. `opportunityIds` has no FK, so
 * every write that touches the list re-validates same-company + open status.
 *
 * Paperwork track: draft → sent → accepted | declined. Accepting a proposal
 * does NOT auto-win the underlying opportunities — that stays a human
 * decision on the log itself.
 */

export type ProposalStatus = "draft" | "sent" | "accepted" | "declined";

export const PROPOSAL_STATUSES: ProposalStatus[] = ["draft", "sent", "accepted", "declined"];

export const salesProposalsTable = pgTable(
  "sales_proposals",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    propertyAddress: text("property_address").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<ProposalStatus>().notNull().default("draft"),
    // Same-company, open-at-attach-time opportunity IDs (validated on every
    // mutation of this list — jsonb carries no FK).
    opportunityIds: jsonb("opportunity_ids").$type<number[]>().notNull().default([]),
    intro: text("intro"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("sales_proposals_company_idx").on(t.companyId),
    companyAddressIdx: index("sales_proposals_company_address_idx").on(
      t.companyId,
      t.propertyAddress,
    ),
  }),
);

export type SalesProposal = typeof salesProposalsTable.$inferSelect;
