import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";
import { usersTable } from "./users";

/**
 * Opportunity Intelligence — the hidden Opportunity Log.
 *
 * Opportunities are mined automatically (and asynchronously) from VERIFIED
 * inspection findings after each analysis run. Technicians never see these
 * tables: every route serving them is gated at requireRole("sales") or above,
 * and no technician-facing payload (inspections/analysis/reports) ever joins
 * against them.
 *
 * No fabrication: every opportunity must cite the finding IDs and photos that
 * justify it (`evidenceFindingIds` / `evidenceImagePaths`), and value is a
 * tier — never an invented dollar figure.
 */

export type OpportunityCategory =
  | "revenue"
  | "additional_service"
  | "structural"
  | "conducive_condition"
  | "property_risk"
  | "pest_trend"
  | "preventative";

export const OPPORTUNITY_CATEGORIES: OpportunityCategory[] = [
  "revenue",
  "additional_service",
  "structural",
  "conducive_condition",
  "property_risk",
  "pest_trend",
  "preventative",
];

export type OpportunityStatus = "new" | "reviewed" | "quoted" | "won" | "lost" | "dismissed";

export const OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  "new",
  "reviewed",
  "quoted",
  "won",
  "lost",
  "dismissed",
];

export type OpportunityValueTier = "low" | "medium" | "high";

export type OpportunityRiskLevel = "low" | "medium" | "high" | "critical";

export const opportunitiesTable = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    inspectionId: integer("inspection_id")
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: "cascade" }),
    // Denormalized so repeat inspections at the same address strengthen one
    // opportunity instead of spawning duplicates, and so trends can group by
    // property without joins.
    propertyAddress: text("property_address").notNull(),
    category: text("category").$type<OpportunityCategory>().notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    // Normalized category+title key used for app-level dedupe against OPEN
    // opportunities at the same address (see opportunity-ai synthesis).
    fingerprint: text("fingerprint").notNull(),
    // Grounding: IDs of the verified findings (within the source analysis run)
    // that justify this opportunity. Synthesis rejects candidates whose IDs
    // don't match real findings — an opportunity with no evidence cannot exist.
    evidenceFindingIds: jsonb("evidence_finding_ids").$type<number[]>().notNull().default([]),
    evidenceImagePaths: jsonb("evidence_image_paths").$type<string[]>().notNull().default([]),
    // Tier, not dollars: the model has no real pricing data, so dollar figures
    // would be fabricated. Owners can map tiers onto their own price book.
    estimatedValueTier: text("estimated_value_tier").$type<OpportunityValueTier>().notNull(),
    confidence: real("confidence").notNull(),
    // Computed (pure math, never AI): worst severity among the CURRENTLY
    // cited findings. Nullable so pre-existing rows stay valid.
    riskLevel: text("risk_level").$type<OpportunityRiskLevel>(),
    // Computed priority 0–100 (severity 35% / confidence 25% / tier 25% /
    // recurrence 15%) — recomputed on strengthen. The AI never ranks itself.
    priority: integer("priority").notNull().default(0),
    // HUMAN-ONLY dollars (whole dollars). Sales/manager enters this when they
    // actually price the work; synthesis/strengthen never touches it.
    estimatedAnnualValue: integer("estimated_annual_value"),
    status: text("status").$type<OpportunityStatus>().notNull().default("new"),
    assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("opportunities_company_idx").on(t.companyId),
    companyAddressIdx: index("opportunities_company_address_idx").on(
      t.companyId,
      t.propertyAddress,
    ),
    // DB-level dedupe guarantee: at most ONE open opportunity per
    // (company, address, fingerprint). Closes the race where two concurrent
    // analysis runs both pass the app-level read-then-insert check — the
    // loser hits a unique violation and falls back to strengthening.
    openFingerprintIdx: uniqueIndex("opportunities_open_fingerprint_idx")
      .on(t.companyId, t.propertyAddress, t.fingerprint)
      .where(sql`status IN ('new', 'reviewed', 'quoted')`),
  }),
);

/**
 * Audit trail: who created/viewed/changed/assigned each opportunity. Gives
 * owners accountability over the pipeline without ever involving technicians.
 */
export type OpportunityEventAction =
  | "created"
  | "strengthened"
  | "viewed"
  | "status_changed"
  | "assigned"
  | "note_added"
  | "value_set";

export const opportunityEventsTable = pgTable(
  "opportunity_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    opportunityId: integer("opportunity_id")
      .notNull()
      .references(() => opportunitiesTable.id, { onDelete: "cascade" }),
    // Null for system-generated events (AI synthesis creates/strengthens).
    userId: integer("user_id").references(() => usersTable.id),
    action: text("action").$type<OpportunityEventAction>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyOppIdx: index("opportunity_events_company_opp_idx").on(t.companyId, t.opportunityId),
  }),
);

/**
 * Per-company tuning. One row per company (created on first read). `enabled`
 * kills the whole subsystem; `minConfidence` filters synthesis output;
 * `enabledCategories` null means "all categories".
 */
export const opportunitySettingsTable = pgTable("opportunity_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .unique()
    .references(() => companiesTable.id),
  enabled: boolean("enabled").notNull().default(true),
  minConfidence: real("min_confidence").notNull().default(0.5),
  enabledCategories: jsonb("enabled_categories").$type<OpportunityCategory[] | null>(),
  /**
   * Counts synthesis failures since the last successful run. Reset to 0 on
   * any successful synthesis completion. Owners can see this on the briefing
   * screen and trigger a catch-up run when it is > 0.
   */
  synthesisFailuresSinceLastSuccess: integer("synthesis_failures_since_last_success")
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Manager/sales notes on an opportunity — an immutable, accountable thread
 * (corrections are new notes, never edits). Replaces a single overwritable
 * "manager notes" field.
 */
export const opportunityNotesTable = pgTable(
  "opportunity_notes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    opportunityId: integer("opportunity_id")
      .notNull()
      .references(() => opportunitiesTable.id, { onDelete: "cascade" }),
    authorUserId: integer("author_user_id")
      .notNull()
      .references(() => usersTable.id),
    // Role AT THE TIME OF WRITING — kept even if the author's role changes.
    authorRole: text("author_role").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyOppIdx: index("opportunity_notes_company_opp_idx").on(t.companyId, t.opportunityId),
  }),
);

export type Opportunity = typeof opportunitiesTable.$inferSelect;
export type OpportunityEvent = typeof opportunityEventsTable.$inferSelect;
export type OpportunitySettings = typeof opportunitySettingsTable.$inferSelect;
export type OpportunityNote = typeof opportunityNotesTable.$inferSelect;
