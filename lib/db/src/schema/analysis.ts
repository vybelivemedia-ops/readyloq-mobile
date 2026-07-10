import { pgTable, serial, integer, text, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";
import { companiesTable } from "./companies";

export const analysisResultsTable = pgTable("analysis_results", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // "pending" | "complete" | "failed"
  findings: jsonb("findings").$type<Finding[]>().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().default([]),
  // Video evidence attached to the inspection. We record video metadata here so
  // the analysis result is an honest, complete picture of the evidence reviewed,
  // but we DELIBERATELY do not derive findings from video yet. `frameAnalysisStatus`
  // is the forward hook for future per-frame video analysis.
  videoEvidence: jsonb("video_evidence").$type<VideoEvidence[]>().default([]),
  // Storage paths of photos the vision model has ALREADY assessed in this run
  // (including clean photos that produced no finding). Lets the live-inspection
  // flow re-run analysis cheaply: previously-assessed photos are carried over
  // instead of re-sent to the model. Failed photos are NOT recorded so they
  // retry on the next run.
  analyzedImagePaths: jsonb("analyzed_image_paths").$type<string[]>().default([]),
  // Per-photo zone classification (storage path -> zone slug) from the vision
  // model's scene detection. Carried forward across live re-runs like findings,
  // so clean photos (which produce no finding) still count toward zone coverage.
  photoZones: jsonb("photo_zones").$type<Record<string, string>>().default({}),
  // Live inspection completeness snapshot: covered zones vs. the property-type +
  // pest-overlay required set. Recomputed on every analyze and at finalization.
  // Null until the first analysis runs.
  coverage: jsonb("coverage").$type<CoverageSnapshot | null>(),
  overallConfidence: real("overall_confidence"),
  riskLevel: text("risk_level"),
  technicianFeedback: text("technician_feedback"),
  feedbackStatus: text("feedback_status"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export interface Finding {
  id: number;
  category: string;
  description: string;
  confidence: number;
  severity: string;
  location: string | null;
  imageUrl: string | null;
  treatment: string | null;
  exclusionOpportunity: boolean | null;
  evidenceQuality?: "excellent" | "good" | "fair" | null;
  // Structured detection detail for the live AI Inspection Panel. All fields
  // come straight from the vision model's assessment of a real photo — null /
  // absent means that photo showed no such evidence. Optional so findings
  // stored before these fields existed remain valid.
  species?: string | null;
  lifeStage?: string | null;
  conduciveCondition?: string | null;
  harborage?: string | null;
  moisture?: string | null;
  structuralIssue?: string | null;
  // Inspection zone this finding belongs to (slug from the zone-coverage
  // taxonomy), when the vision model could place it. Null / absent when the
  // scene was unclear — it simply doesn't count toward completeness.
  zone?: string | null;
}

/** A single inspection zone in a coverage snapshot. */
export interface CoverageZone {
  slug: string;
  label: string;
}

/**
 * Live inspection completeness snapshot. Computed server-side from the set of
 * covered zones (per-photo AI scene detection + attribute-derived zones from
 * findings) against the required zone set for the property type, promoted by
 * pest-specific overlays. ONLY required zones drive `completenessPct`;
 * recommended zones surface as softer `suggested` hints.
 */
export interface CoverageSnapshot {
  /** Normalized property type used to select the requirement matrix. */
  propertyType: string;
  /** 0-100, share of required zones that have at least one covering photo. */
  completenessPct: number;
  requiredZones: CoverageZone[];
  coveredRequired: CoverageZone[];
  uncoveredRequired: CoverageZone[];
  /** Recommended (not required) zones still uncovered — softer prompts. */
  suggested: CoverageZone[];
}

/** A single counted evidence label within an evidence group. */
export interface EvidenceCount {
  /** Stable key (lower-cased label) for React lists. */
  key: string;
  /** Display label, straight from the model's detection (first casing kept). */
  label: string;
  count: number;
}

/**
 * One category in the live evidence tally. `total` is the count of findings that
 * carry this category's attribute and is the PRIMARY display number ("3 Moisture").
 * `items` is a per-label breakdown — meaningful for pest species; for structural /
 * moisture the model's free text tends to be all-unique, so treat items as
 * secondary detail, not a sum.
 */
export interface EvidenceGroup {
  key: "pests" | "structural" | "moisture" | "exclusion";
  label: string;
  total: number;
  items: EvidenceCount[];
}

/**
 * Real-time evidence tally for the live AI Inspection Engine. DERIVED on read
 * from the analysis row's `findings` + `videoEvidence` — never persisted, so it
 * can never be stale. A single finding may contribute to multiple groups (a photo
 * can show a pest AND moisture AND an entry point), so the group totals are
 * independent and MUST NOT be summed to reach `totalEvidence`.
 */
export interface EvidenceSummary {
  /** Distinct evidence items reviewed: photo findings + attached videos. */
  totalEvidence: number;
  /** Photo-derived findings count. */
  photoEvidence: number;
  /** Attached video count (videos are reviewed evidence, not analyzed findings). */
  videoEvidence: number;
  /** Non-empty groups only, in a stable display order. */
  groups: EvidenceGroup[];
}

/**
 * Metadata about a video attached to an inspection, recorded on the analysis
 * result as reviewed evidence. Videos are NOT analyzed into findings — see
 * `frameAnalysisStatus`, the forward hook for future per-frame analysis.
 */
export interface VideoEvidence {
  url: string;
  filename: string | null;
  durationSec: number | null;
  label: string | null;
  frameAnalysisStatus: "pending";
}

export const insertAnalysisResultSchema = createInsertSchema(analysisResultsTable).omit({ id: true, createdAt: true, companyId: true });
export type AnalysisResult = typeof analysisResultsTable.$inferSelect;
export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
