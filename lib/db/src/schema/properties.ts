import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";

// Property Intelligence Feed — the authored overlay that persists across all
// visits to a property. Recurring issues, historical photos, and visit history
// are NOT stored here; they are derived at read time from analysis_results,
// inspection_media, and inspections. Everything is keyed by a normalized
// addressKey (see artifacts/api-server/src/lib/property-intelligence.ts) so it
// stays consistent with the existing siteAddress grouping in intelligence.ts.
// addressKey is unique PER COMPANY (two companies may track the same address).

export interface Hotspot {
  zone: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export const propertyProfilesTable = pgTable(
  "property_profiles",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companiesTable.id),
    addressKey: text("address_key").notNull(),
    siteAddress: text("site_address").notNull(),
    clientName: text("client_name"),
    propertyType: text("property_type"),
    technicianKnowledge: text("technician_knowledge"),
    hotspots: jsonb("hotspots").$type<Hotspot[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyAddressKey: uniqueIndex("property_profiles_company_address_key").on(t.companyId, t.addressKey),
    // drizzle-kit introspects UNIQUE columns in table order, not key order.
    // Keep the same key set; never replace an existing FK target to reorder it.
    companyIdKey: unique("property_profiles_company_id_uq").on(t.id, t.companyId),
  }),
);

export const propertyNotesTable = pgTable("property_notes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  addressKey: text("address_key").notNull(),
  note: text("note").notNull(),
  zone: text("zone"),
  category: text("category"),
  authorName: text("author_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// AI-synthesized memory written after each completed inspection.
// Stores distilled pest history and recurring findings so that technicians
// get instant context at the start of a new inspection — without needing to
// re-derive it from raw analysis_results on every lookup.
// Scoped strictly to (companyId, addressKey): two tenants sharing a physical
// address never see each other's memory.
export const propertyMemoryTable = pgTable(
  "property_memory",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => companiesTable.id),
    addressKey: text("address_key").notNull(),
    // The canonical display address stored alongside the key for easy rendering.
    siteAddress: text("site_address").notNull(),
    // FK to the most recent inspection that contributed to this memory row.
    lastInspectionId: integer("last_inspection_id").references(() => inspectionsTable.id, { onDelete: "set null" }),
    lastVisitedAt: timestamp("last_visited_at"),
    // AI-distilled list of pest species identified across all prior visits.
    historicalPests: jsonb("historical_pests").$type<string[]>().default([]),
    // AI-summarised recurring findings (description + category + frequency).
    historicalFindings: jsonb("historical_findings").$type<HistoricalFinding[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Primary lookup: one memory row per (company, address).
    companyAddressIdx: index("property_memory_company_address_idx").on(t.companyId, t.addressKey),
  }),
);

export interface HistoricalFinding {
  category: string;
  description: string;
  /** Number of visits where this finding appeared. */
  frequency: number;
  /** Most recently seen severity level. */
  severity?: "low" | "medium" | "high";
}

export const insertPropertyProfileSchema = createInsertSchema(propertyProfilesTable).omit({ id: true, createdAt: true, updatedAt: true, companyId: true });
export const insertPropertyNoteSchema = createInsertSchema(propertyNotesTable).omit({ id: true, createdAt: true, companyId: true });
export const insertPropertyMemorySchema = createInsertSchema(propertyMemoryTable).omit({ id: true, createdAt: true, updatedAt: true, companyId: true });

export type PropertyProfile = typeof propertyProfilesTable.$inferSelect;
export type InsertPropertyProfile = z.infer<typeof insertPropertyProfileSchema>;
export type PropertyNote = typeof propertyNotesTable.$inferSelect;
export type InsertPropertyNote = z.infer<typeof insertPropertyNoteSchema>;
export type PropertyMemory = typeof propertyMemoryTable.$inferSelect;
export type InsertPropertyMemory = z.infer<typeof insertPropertyMemorySchema>;
