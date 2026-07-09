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
