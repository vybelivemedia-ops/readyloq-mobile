import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inspectionsTable = pgTable("inspections", {
  id: serial("id").primaryKey(),
  siteAddress: text("site_address").notNull(),
  clientName: text("client_name"),
  technicianName: text("technician_name").notNull(),
  technicianId: text("technician_id"),
  status: text("status").notNull().default("pending"),
  pestTypes: jsonb("pest_types").$type<string[]>().default([]),
  severity: text("severity"),
  notes: text("notes"),
  mediaCount: integer("media_count").notNull().default(0),
  findingsCount: integer("findings_count").notNull().default(0),
  aiAnalysisId: integer("ai_analysis_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const inspectionMediaTable = pgTable("inspection_media", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  mediaType: text("media_type").notNull(), // "photo" | "video" | "voice"
  url: text("url").notNull(),
  filename: text("filename"),
  caption: text("caption"),
  durationSec: integer("duration_sec"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInspectionSchema = createInsertSchema(inspectionsTable).omit({ id: true, createdAt: true, mediaCount: true, findingsCount: true, aiAnalysisId: true });
export const insertInspectionMediaSchema = createInsertSchema(inspectionMediaTable).omit({ id: true, createdAt: true });

export type Inspection = typeof inspectionsTable.$inferSelect;
export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type InspectionMedia = typeof inspectionMediaTable.$inferSelect;
