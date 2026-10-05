import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";

export const baitStationsTable = pgTable("bait_stations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  locationType: text("location_type"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  lastCheckedAt: timestamp("last_checked_at"),
  /** Stable client-generated idempotency key, scoped to tenant + inspection. */
  clientKey: text("client_key"),
  /** Hash of the original create payload, retained across later PATCH updates. */
  clientPayloadHash: text("client_payload_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bait_stations_company_inspection_client_key_unique")
    .on(table.companyId, table.inspectionId, table.clientKey),
]);

export const insertBaitStationSchema = createInsertSchema(baitStationsTable).omit({
  id: true,
  createdAt: true,
  companyId: true,
  clientKey: true,
  clientPayloadHash: true,
});

export type BaitStation = typeof baitStationsTable.$inferSelect;
export type InsertBaitStation = z.infer<typeof insertBaitStationSchema>;
