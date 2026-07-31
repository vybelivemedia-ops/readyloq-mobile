/**
 * Technician daily rig — the set of products a tech loads onto their truck
 * each morning.  One row per (company, technician, date); upserted every time
 * the tech updates their selection.  Date is stored as a simple ISO date string
 * ("YYYY-MM-DD") so midnight resets work cleanly regardless of timezone.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Route assignment — a product-to-pest pairing for a technician's day.
 * Stored as JSONB in the `assignments` column.
 */
export interface DbRouteAssignment {
  productId: number;
  targetPest: string;
  notes?: string;
}

export const technicianDailyRigsTable = pgTable(
  "technician_daily_rigs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** Clerk userId — the technician who owns this rig configuration. */
    technicianId: text("technician_id").notNull(),
    /** ISO date string "YYYY-MM-DD" — the day this rig configuration applies to. */
    rigDate: date("rig_date").notNull(),
    /**
     * @deprecated Use `assignments` instead.
     * Kept for zero-downtime migration; API reads `assignments` with fallback.
     */
    productIds: jsonb("product_ids").$type<number[]>().default([]),
    /**
     * Ordered list of product-to-pest route assignments for this day.
     * Replaces the simpler `productIds` inventory model.
     */
    assignments: jsonb("assignments").$type<DbRouteAssignment[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_rigs_tech_date_uq").on(t.companyId, t.technicianId, t.rigDate),
    index("daily_rigs_company_date_idx").on(t.companyId, t.rigDate),
    index("daily_rigs_technician_idx").on(t.technicianId),
  ],
);

export type TechnicianDailyRig = typeof technicianDailyRigsTable.$inferSelect;
export type InsertTechnicianDailyRig = typeof technicianDailyRigsTable.$inferInsert;
