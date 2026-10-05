import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
import type { Finding } from "./analysis";

/**
 * AI-generated narrative report. Produced on demand from an inspection's data
 * (findings, voice transcripts, photo labels, property metadata) by a single
 * text-model call and snapshotted onto the report so it stays stable. Every
 * field is always present after a successful generation (server normalizes
 * defaults), so PDF/UI rendering never has to guard for partial output.
 */
export interface AiReportNarrative {
  executiveSummary: string;
  inspectionFindings: string;
  evidenceObserved: string;
  pestActivityAssessment: string;
  structuralDeficiencies: string;
  sanitationConcerns: string;
  recommendedCorrectiveActions: string[];
  monitoringRecommendations: string[];
  followUpSchedule: string;
  technicianNotes: string;
  managerReviewNotes: string;
  propertyType: string;
  model: string;
  generatedAt: string;
  /**
   * Optional for backward compatibility with narratives generated before
   * these sections existed; always present on new generations.
   */
  conduciveConditions?: string;
  customerRecommendations?: string[];
}

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  clientName: text("client_name"),
  siteAddress: text("site_address").notNull(),
  status: text("status").notNull().default("draft"),
  findings: jsonb("findings").$type<Finding[]>().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().default([]),
  treatmentNotes: text("treatment_notes"),
  exclusionOpportunities: jsonb("exclusion_opportunities").$type<string[]>().default([]),
  technicianName: text("technician_name").notNull(),
  inspectionDate: text("inspection_date").notNull(),
  severity: text("severity"),
  pdfUrl: text("pdf_url"),
  aiNarrative: jsonb("ai_narrative").$type<AiReportNarrative>(),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true, companyId: true });
export type Report = typeof reportsTable.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
