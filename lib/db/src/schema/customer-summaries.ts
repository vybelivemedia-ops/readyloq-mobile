import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";
import { usersTable } from "./users";

/**
 * Customer Summaries — the homeowner-friendly lens over an inspection.
 *
 * The body is an AI REPHRASE of the verified findings (grounded: the
 * generator receives only stored findings/recommendations and its output is
 * fidelity-gated — dollar figures rejected, empty evidence rejected). It is
 * the ONLY artifact that can ever leave the company, and only via an explicit
 * manager approval that mints an expiring share token.
 *
 * Lifecycle: draft (auto-generated, editable by manager+) → approved (frozen
 * body, share token minted). Regeneration is blocked once approved.
 */

export type CustomerSummaryStatus = "draft" | "approved";

export const customerSummariesTable = pgTable(
  "customer_summaries",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    inspectionId: integer("inspection_id")
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: text("status").$type<CustomerSummaryStatus>().notNull().default("draft"),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
    approvedAt: timestamp("approved_at"),
    // Unguessable capability token (crypto random, base64url). Null until
    // approved. The public share route looks up SOLELY by this token and
    // returns a uniform 404 for missing/unapproved/expired.
    shareToken: text("share_token"),
    shareExpiresAt: timestamp("share_expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("customer_summaries_company_idx").on(t.companyId),
    inspectionIdx: uniqueIndex("customer_summaries_inspection_idx").on(t.inspectionId),
    shareTokenIdx: uniqueIndex("customer_summaries_share_token_idx").on(t.shareToken),
  }),
);

export type CustomerSummary = typeof customerSummariesTable.$inferSelect;
