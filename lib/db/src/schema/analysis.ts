import { pgTable, serial, integer, text, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";

export const analysisResultsTable = pgTable("analysis_results", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // "pending" | "complete" | "failed"
  findings: jsonb("findings").$type<Finding[]>().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().default([]),
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
}

export const insertAnalysisResultSchema = createInsertSchema(analysisResultsTable).omit({ id: true, createdAt: true });
export type AnalysisResult = typeof analysisResultsTable.$inferSelect;
export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
