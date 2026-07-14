import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

// Closed-beta operations tables. All are company-scoped (the tenant boundary).
// These back the manager/owner "Beta Center" plus the all-user feedback dialog.

export type BetaFeedbackType = "bug" | "feature" | "ai_accuracy";
export type BetaFeedbackStatus = "open" | "triaged" | "resolved";
export type BetaFeedbackSeverity = "low" | "medium" | "high";

// Technician/manager-submitted feedback during the beta. Optional FK-ish context
// columns (plain integers, mirroring company_invites.createdByUserId) let a report
// point at the inspection/analysis/report it concerns without cascade coupling.
export const betaFeedbackTable = pgTable(
  "beta_feedback",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id"),
    type: text("type").$type<BetaFeedbackType>().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: text("severity").$type<BetaFeedbackSeverity>(),
    status: text("status").$type<BetaFeedbackStatus>().notNull().default("open"),
    inspectionId: integer("inspection_id"),
    analysisId: integer("analysis_id"),
    reportId: integer("report_id"),
    context: jsonb("context"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("beta_feedback_company_idx").on(t.companyId),
  }),
);

export type ErrorCategory = "upload" | "ai" | "report" | "auth";

// Centralized, company-scoped error/event log. Anonymous 401 / no_company
// failures are intentionally NOT persisted here (no safe tenant boundary) and
// stay in pino only. Written best-effort via logErrorEvent (never throws).
export const errorEventsTable = pgTable(
  "error_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id"),
    category: text("category").$type<ErrorCategory>().notNull(),
    message: text("message").notNull(),
    context: jsonb("context"),
    inspectionId: integer("inspection_id"),
    reportId: integer("report_id"),
    source: text("source").$type<"server" | "client">().notNull().default("server"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("error_events_company_idx").on(t.companyId),
  }),
);

// Per-company completion state for the canonical closed-beta checklist. Rows are
// created lazily on first toggle (the item list itself lives in code), keyed by a
// stable itemKey so the checklist content can evolve without orphaning state.
export const betaChecklistStateTable = pgTable(
  "beta_checklist_state",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at"),
    doneByUserId: integer("done_by_user_id"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyItemUnique: uniqueIndex("beta_checklist_company_item_unique").on(
      t.companyId,
      t.itemKey,
    ),
  }),
);

export const insertBetaFeedbackSchema = createInsertSchema(betaFeedbackTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BetaFeedback = typeof betaFeedbackTable.$inferSelect;
export type InsertBetaFeedback = z.infer<typeof insertBetaFeedbackSchema>;
export type ErrorEvent = typeof errorEventsTable.$inferSelect;
export type BetaChecklistState = typeof betaChecklistStateTable.$inferSelect;
