import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, text, timestamp, jsonb, uniqueIndex, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { companiesTable } from "./companies";
import { propertyProfilesTable } from "./properties";
import { inspectionsTable } from "./inspections";

export type LocationKind = "building" | "floor" | "unit" | "common_area";
export type VisitCoverageState = "not_inspected" | "in_progress" | "inspected" | "no_access";
export interface SpaceSnapshot {
  label: string;
  kind: "unit" | "common_area";
  commonAreaType: string | null;
  ancestors: { id: string; label: string; kind: LocationKind }[];
}

// Location IDs do not depend on labels, addresses, or floor numbering.
export const propertyLocationsTable = pgTable("property_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  propertyId: integer("property_id").notNull(),
  parentId: uuid("parent_id"),
  kind: text("kind").$type<LocationKind>().notNull(),
  label: text("label").notNull(),
  commonAreaType: text("common_area_type"),
  revision: integer("revision").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("property_locations_scope_id_uq").on(t.id, t.companyId, t.propertyId),
  index("property_locations_property_idx").on(t.companyId, t.propertyId),
  foreignKey({ name: "pf_locations_profile_fk", columns: [t.companyId, t.propertyId], foreignColumns: [propertyProfilesTable.companyId, propertyProfilesTable.id] }),
  foreignKey({ name: "pf_locations_parent_fk", columns: [t.companyId, t.propertyId, t.parentId], foreignColumns: [t.companyId, t.propertyId, t.id] }),
  check("property_locations_kind_ck", sql`${t.kind} IN ('building','floor','unit','common_area')`),
  check("property_locations_label_ck", sql`length(trim(${t.label})) BETWEEN 1 AND 120`),
  check("property_locations_revision_ck", sql`${t.revision} > 0`),
  check("property_locations_parent_ck", sql`(${t.kind} = 'building' AND ${t.parentId} IS NULL) OR (${t.kind} = 'common_area') OR (${t.kind} IN ('floor','unit') AND ${t.parentId} IS NOT NULL)`),
  check("property_locations_common_type_ck", sql`(${t.kind} = 'common_area' AND ${t.commonAreaType} IS NOT NULL) OR (${t.kind} <> 'common_area' AND ${t.commonAreaType} IS NULL)`),
]);

export const propertyVisitsTable = pgTable("property_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  propertyId: integer("property_id").notNull(),
  clientKey: uuid("client_key").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("property_visits_scope_id_uq").on(t.id, t.companyId, t.propertyId),
  uniqueIndex("property_visits_client_key_uq").on(t.companyId, t.propertyId, t.clientKey),
  foreignKey({ name: "pf_visits_profile_fk", columns: [t.companyId, t.propertyId], foreignColumns: [propertyProfilesTable.companyId, propertyProfilesTable.id] }),
]);

export const propertyVisitCoverageTable = pgTable("property_visit_coverage", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull(),
  propertyId: integer("property_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  snapshot: jsonb("snapshot").$type<SpaceSnapshot>().notNull(),
  state: text("state").$type<VisitCoverageState>().notNull().default("not_inspected"),
  // No AI/photo-count-derived outcome. Inspection linkage is explicit and optional.
  inspectionId: integer("inspection_id").references(() => inspectionsTable.id),
  reason: text("reason"),
  revision: integer("revision").notNull().default(1),
}, (t) => [
  uniqueIndex("property_coverage_visit_space_uq").on(t.visitId, t.spaceId),
  uniqueIndex("property_coverage_visit_inspection_uq").on(t.visitId, t.inspectionId),
  foreignKey({ name: "pf_coverage_visit_fk", columns: [t.companyId, t.propertyId, t.visitId], foreignColumns: [propertyVisitsTable.companyId, propertyVisitsTable.propertyId, propertyVisitsTable.id] }),
  foreignKey({ name: "pf_coverage_space_fk", columns: [t.companyId, t.propertyId, t.spaceId], foreignColumns: [propertyLocationsTable.companyId, propertyLocationsTable.propertyId, propertyLocationsTable.id] }),
  check("property_coverage_state_ck", sql`${t.state} IN ('not_inspected','in_progress','inspected','no_access')`),
  check("property_coverage_completion_ck", sql`${t.state} NOT IN ('in_progress','inspected') OR ${t.inspectionId} IS NOT NULL`),
  check("property_coverage_no_access_ck", sql`${t.state} <> 'no_access' OR (${t.reason} IS NOT NULL AND length(trim(${t.reason})) > 0)`),
]);

export const propertyLocationEventsTable = pgTable("property_location_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull(),
  propertyId: integer("property_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "pf_events_profile_fk", columns: [t.companyId, t.propertyId], foreignColumns: [propertyProfilesTable.companyId, propertyProfilesTable.id] }),
]);

export const insertPropertyLocationSchema = createInsertSchema(propertyLocationsTable).omit({ companyId: true, revision: true, createdAt: true, archivedAt: true });
export const insertPropertyVisitSchema = createInsertSchema(propertyVisitsTable).omit({ companyId: true, createdAt: true });
export type PropertyLocation = typeof propertyLocationsTable.$inferSelect;
