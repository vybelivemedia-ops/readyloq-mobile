import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const inspectionsTable = pgTable(
  "inspections",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companiesTable.id),
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
    // Client-generated idempotency key (UUID) so the offline-first mobile app can
    // retry inspection creation safely — a lost response never duplicates a row.
    clientKey: text("client_key"),
    // Optional future-scheduled date set by managers/dispatchers via the
    // scheduling calendar. Null means "unscheduled" (treated as same-day
    // on the calendar by falling back to createdAt for historical rows).
    scheduledDate: timestamp("scheduled_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    // On-site signature capture: SVG strings produced by the mobile signature
    // pad. ownerNotAvailable is set when the owner/tenant is absent and the
    // technician signs on their behalf. signedAt records the first signature.
    technicianSignature: text("technician_signature"),
    ownerSignature: text("owner_signature"),
    ownerNotAvailable: boolean("owner_not_available").notNull().default(false),
    signedAt: timestamp("signed_at"),
  },
  (t) => [
    uniqueIndex("inspections_company_client_key_uq").on(t.companyId, t.clientKey),
    index("inspections_technician_id_idx").on(t.technicianId),
    index("inspections_status_idx").on(t.status),
    index("inspections_company_status_idx").on(t.companyId, t.status),
    // Composite expression index supporting GET /api/schedule — allows the DB
    // to seek directly to the requested date window using COALESCE(scheduled_date,
    // created_at) without scanning every company inspection.
    index("inspections_company_cal_date_idx").using(
      "btree",
      t.companyId,
      sql`COALESCE(${t.scheduledDate}, ${t.createdAt})`,
    ),
  ],
);

export const inspectionMediaTable = pgTable("inspection_media", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  mediaType: text("media_type").notNull(), // "photo" | "video" | "voice"
  url: text("url").notNull(),
  filename: text("filename"),
  caption: text("caption"),
  durationSec: integer("duration_sec"),
  // Universal Vision Platform: which provider produced this evidence. The AI
  // pipeline never reads this — it exists for provenance (live capture vs.
  // imported footage) and per-source analytics. Defaults keep old rows valid.
  captureSource: text("capture_source").notNull().default("phone_camera"),
  // 0–100 capture-time quality score from the on-device gate (null = ungated).
  qualityScore: integer("quality_score"),
  // One-word label from the Gemini digital-zoom pass, e.g. "cockroach", "crack".
  // Set when a frame was cropped to this subject before or after storage.
  zoomSubject: text("zoom_subject"),
  // Device/EXIF context (dimensions, file size, provider id, device model…).
  captureMetadata: jsonb("capture_metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInspectionSchema = createInsertSchema(inspectionsTable).omit({ id: true, createdAt: true, mediaCount: true, findingsCount: true, aiAnalysisId: true, companyId: true });
export const insertInspectionMediaSchema = createInsertSchema(inspectionMediaTable).omit({ id: true, createdAt: true, companyId: true });

export type Inspection = typeof inspectionsTable.$inferSelect;
export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type InspectionMedia = typeof inspectionMediaTable.$inferSelect;
