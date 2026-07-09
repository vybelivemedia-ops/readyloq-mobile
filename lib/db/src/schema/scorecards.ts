import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";

/**
 * Inspection Scorecards — the management lens over each completed analysis.
 *
 * Computed 100% deterministically (pure math over stored verified findings —
 * NO AI involvement) in a fire-and-forget hook after each analysis run, and
 * upserted so re-analysis refreshes the same row. Technicians never see
 * scorecards: quality scoring is a coaching tool for management, so every
 * route serving these rows is gated at requireRole("manager").
 */

export type ScorecardRiskLevel = "low" | "medium" | "high" | "critical";

/** 0–100 sub-scores that make the quality score reproducible and explainable. */
export interface ScorecardComponents {
  /** Photos captured vs. a reasonable evidence baseline. */
  photoCoverage: number;
  /** Share of findings whose evidence quality was rated good/excellent. */
  evidenceQuality: number;
  /** Average model confidence across findings (0–100). */
  avgConfidence: number;
  /** Share of opportunity-mapped findings that got a matching recommendation. */
  recommendationCoverage: number;
}

/**
 * A verified finding that maps to a service type but had NO matching
 * recommendation recorded — a concrete, evidence-backed miss (deterministic
 * keyword mapping, same approach as the intelligence unreported-opportunity
 * logic).
 */
export interface MissedOpportunity {
  findingId: number;
  serviceType: string;
  description: string;
  severity: string;
}

export const inspectionScorecardsTable = pgTable(
  "inspection_scorecards",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    inspectionId: integer("inspection_id")
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: "cascade" }),
    // Denormalized for per-technician aggregation without joins.
    technicianName: text("technician_name").notNull().default(""),
    qualityScore: integer("quality_score").notNull(),
    components: jsonb("components").$type<ScorecardComponents>().notNull(),
    missedOpportunities: jsonb("missed_opportunities")
      .$type<MissedOpportunity[]>()
      .notNull()
      .default([]),
    // Severity-weighted risk snapshot FROZEN at computation time so history
    // doesn't shift as later inspections happen.
    riskScore: integer("risk_score").notNull(),
    riskLevel: text("risk_level").$type<ScorecardRiskLevel>().notNull(),
    findingsCount: integer("findings_count").notNull().default(0),
    photosAnalyzed: integer("photos_analyzed").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("inspection_scorecards_company_idx").on(t.companyId),
    // One scorecard per inspection — recomputation upserts.
    inspectionIdx: uniqueIndex("inspection_scorecards_inspection_idx").on(t.inspectionId),
  }),
);

export type InspectionScorecard = typeof inspectionScorecardsTable.$inferSelect;
