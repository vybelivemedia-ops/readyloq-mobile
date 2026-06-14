import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";
import { companiesTable } from "./companies";
import type { Finding } from "./analysis";

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true, companyId: true });
export type Report = typeof reportsTable.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
