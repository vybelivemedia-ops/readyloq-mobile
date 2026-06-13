import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Property Intelligence Feed — the authored overlay that persists across all
// visits to a property. Recurring issues, historical photos, and visit history
// are NOT stored here; they are derived at read time from analysis_results,
// inspection_media, and inspections. Everything is keyed by a normalized
// addressKey (see artifacts/api-server/src/lib/property-intelligence.ts) so it
// stays consistent with the existing siteAddress grouping in intelligence.ts.

export interface Hotspot {
  zone: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export const propertyProfilesTable = pgTable("property_profiles", {
  id: serial("id").primaryKey(),
  addressKey: text("address_key").notNull().unique(),
  siteAddress: text("site_address").notNull(),
  clientName: text("client_name"),
  propertyType: text("property_type"),
  technicianKnowledge: text("technician_knowledge"),
  hotspots: jsonb("hotspots").$type<Hotspot[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const propertyNotesTable = pgTable("property_notes", {
  id: serial("id").primaryKey(),
  addressKey: text("address_key").notNull(),
  note: text("note").notNull(),
  zone: text("zone"),
  category: text("category"),
  authorName: text("author_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPropertyProfileSchema = createInsertSchema(propertyProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPropertyNoteSchema = createInsertSchema(propertyNotesTable).omit({ id: true, createdAt: true });

export type PropertyProfile = typeof propertyProfilesTable.$inferSelect;
export type InsertPropertyProfile = z.infer<typeof insertPropertyProfileSchema>;
export type PropertyNote = typeof propertyNotesTable.$inferSelect;
export type InsertPropertyNote = z.infer<typeof insertPropertyNoteSchema>;
