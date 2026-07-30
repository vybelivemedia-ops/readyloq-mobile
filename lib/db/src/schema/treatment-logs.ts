import {
  pgTable,
  serial,
  text,
  real,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";
import { productsTable } from "./products";

// ─── Treatment logs ───────────────────────────────────────────────────────────
//
// Per-application record created when a technician completes the compliance
// wizard on a job site. One inspection may have multiple treatment logs (e.g.
// a rodenticide in the attic and a residual in the kitchen).
//
// Company-scoped for full tenant isolation. productId references the global
// product catalogue; all other fields are technician-supplied at application
// time after passing the six compliance guardrails.

export interface ChecklistItem {
  /** Display label shown in the pre-mix checklist (e.g. "Nitrile gloves worn"). */
  label: string;
  /** Whether the technician checked this item before applying. */
  checked: boolean;
}

export const treatmentLogsTable = pgTable(
  "treatment_logs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    inspectionId: integer("inspection_id")
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),

    /** Clerk user ID of the applying technician (for FIFRA record-keeping). */
    technicianId: text("technician_id"),

    // ── Application details ────────────────────────────────────────────────
    /** Target pest type, e.g. "Rodents" (must match PEST_TYPES). */
    targetPest: text("target_pest").notNull(),
    /** Site classification slug, e.g. "residential_interior". */
    siteClassification: text("site_classification").notNull(),

    // ── Area / measurement ─────────────────────────────────────────────────
    /** Treated area in square feet; null for linear-footage applications. */
    areaSqft: real("area_sqft"),
    /** Treated linear footage; null for area applications. */
    linearFt: real("linear_ft"),

    // ── Mix / rate ─────────────────────────────────────────────────────────
    /** Actual dilution used in oz of product per gallon of water. */
    dilutionOzPerGallon: real("dilution_oz_per_gallon"),
    /** Total product volume applied in fluid ounces. Used for rate validation:
     *  appliedRate = (totalProductOz / areaSqft) × 1000 must not exceed
     *  label_rules.maxRateOzPer1000Sqft. */
    totalProductOz: real("total_product_oz"),

    // ── Equipment ──────────────────────────────────────────────────────────
    /** Equipment type used (technician-confirmed, e.g. "compressed_air_sprayer"). */
    equipmentUsed: text("equipment_used"),

    // ── Checklist ─────────────────────────────────────────────────────────
    /** Completed pre-mix checklist items (PPE + mixing steps). */
    checklistItems: jsonb("checklist_items")
      .$type<ChecklistItem[]>()
      .default([]),

    // ── Environmental ─────────────────────────────────────────────────────
    /** Ambient temperature at time of application (°F), technician-entered. */
    tempAtApplicationF: integer("temp_at_application_f"),
    /** True when the technician explicitly acknowledged an environmental
     *  warning (over-temp or phytotoxicity risk). */
    environmentalWarningAcknowledged: boolean("environmental_warning_acknowledged")
      .notNull()
      .default(false),

    notes: text("notes"),
    /** When the product was applied (defaults to submission time). */
    appliedAt: timestamp("applied_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("treatment_logs_inspection_idx").on(t.inspectionId),
    index("treatment_logs_company_idx").on(t.companyId),
    index("treatment_logs_technician_idx").on(t.technicianId),
    index("treatment_logs_product_idx").on(t.productId),
  ],
);

// ─── Zod schemas & TypeScript types ──────────────────────────────────────────

export const insertTreatmentLogSchema = createInsertSchema(
  treatmentLogsTable,
).omit({ id: true, createdAt: true, companyId: true });

export const selectTreatmentLogSchema = createSelectSchema(treatmentLogsTable);

export type TreatmentLog = typeof treatmentLogsTable.$inferSelect;
export type InsertTreatmentLog = z.infer<typeof insertTreatmentLogSchema>;
