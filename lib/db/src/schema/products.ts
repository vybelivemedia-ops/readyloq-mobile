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

// ─── Products catalogue ───────────────────────────────────────────────────────
//
// A platform-wide chemical product catalogue. Products are NOT company-scoped
// (no companyId) — every company can use every active product. Company-specific
// customization and approval subsets are a future admin-UI concern (Task #68).
//
// Restricted-use products (productType = "restricted-use") require a certified
// applicator license. General-use products (productType = "general-use") do not.

export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    /** Display name, e.g. "Contrac Blox". */
    name: text("name").notNull(),
    /** EPA product registration number, e.g. "12455-76". */
    epaRegistrationNumber: text("epa_registration_number"),
    /** "restricted-use" | "general-use" */
    productType: text("product_type").notNull(),
    /** Human-readable active ingredient list, e.g. "Bromadiolone 0.005%". */
    activeIngredients: text("active_ingredients").notNull(),
    /** "DANGER" | "WARNING" | "CAUTION" | "NONE" */
    signalWord: text("signal_word"),
    manufacturerName: text("manufacturer_name"),
    /** Soft-delete: inactive products are hidden from quick-pick but kept for
     *  historical treatment log references. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("products_type_idx").on(t.productType)],
);

// ─── Label rules ──────────────────────────────────────────────────────────────
//
// Per-product application constraints derived from the product label. One-to-one
// with products (productId is unique). The mobile compliance wizard reads these
// to enforce all six guardrails before allowing a treatment to be logged.

export const productLabelRulesTable = pgTable("product_label_rules", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "cascade" }),

  // ── Guardrail 1: approved pests ──────────────────────────────────────────
  /** Array of pest type strings matching the mobile app's PEST_TYPES constants
   *  (e.g. ["Rodents", "Ants"]). */
  approvedPestTypes: jsonb("approved_pest_types")
    .$type<string[]>()
    .notNull()
    .default([]),

  // ── Guardrail 2: approved sites ──────────────────────────────────────────
  /** Array of site classification slugs (e.g. ["residential_interior",
   *  "commercial_exterior"]). Checked against the technician's selected site
   *  before allowing the application to proceed. */
  approvedSiteClassifications: jsonb("approved_site_classifications")
    .$type<string[]>()
    .notNull()
    .default([]),

  // ── Guardrail 3: equipment ────────────────────────────────────────────────
  /** Human-readable equipment type slugs required by the label
   *  (e.g. ["compressed_air_sprayer", "crack_crevice_tip"]). */
  requiredEquipmentTypes: jsonb("required_equipment_types")
    .$type<string[]>()
    .notNull()
    .default([]),
  /** Nozzle specification text from the label (e.g. "Fan-tip, 8002 flat fan"). */
  nozzleSpec: text("nozzle_spec"),
  /** Operating pressure range from the label (e.g. "30–60 psi"). */
  pressurePsi: text("pressure_psi"),
  /** Required droplet size classification (e.g. "Fine to medium"). */
  dropletSize: text("droplet_size"),

  // ── Guardrail 4: application rates ───────────────────────────────────────
  /** Maximum label rate in fluid ounces of product per 1,000 sq ft. Used to
   *  validate the rate calculator and block over-limit submissions (422). */
  maxRateOzPer1000Sqft: real("max_rate_oz_per_1000sqft"),
  /** Maximum label concentration in fluid ounces of product per gallon of
   *  finished spray solution. */
  maxRateOzPerGallon: real("max_rate_oz_per_gallon"),

  // ── Guardrail 5: mixing directions ───────────────────────────────────────
  /** Ordered array of plain-text mixing/dilution steps from the label. */
  mixingSteps: jsonb("mixing_steps").$type<string[]>().notNull().default([]),

  // ── Guardrail 6: environmental warnings ──────────────────────────────────
  /** Maximum ambient temperature (°F) for safe application per the label. */
  maxTempF: integer("max_temp_f"),
  /** Plant damage / phytotoxicity warning text from the label; null if none. */
  phytotoxicityNotes: text("phytotoxicity_notes"),
  /** Restricted-entry interval in hours (how long after application before
   *  re-entry without PPE). */
  reEntryIntervalHours: real("re_entry_interval_hours"),
  /** Minimum whole days that must pass before this product may legally be
   *  reapplied to the SAME site. Distinct from reEntryIntervalHours (a human
   *  safety window measured in hours); this is a label-defined retreatment
   *  interval measured in days. Null when the label sets no such minimum. */
  retreatmentIntervalDays: integer("retreatment_interval_days"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Zod schemas & TypeScript types ──────────────────────────────────────────

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});
export const selectProductSchema = createSelectSchema(productsTable);

export const insertLabelRulesSchema = createInsertSchema(
  productLabelRulesTable,
).omit({ id: true, createdAt: true });
export const selectLabelRulesSchema = createSelectSchema(productLabelRulesTable);

// Convenience: a product with its label rules inlined (used by the API response
// shape so consumers only need one request).
export const productWithRulesSchema = selectProductSchema.extend({
  labelRules: selectLabelRulesSchema.nullable(),
});

export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type ProductLabelRules = typeof productLabelRulesTable.$inferSelect;
export type InsertProductLabelRules = z.infer<typeof insertLabelRulesSchema>;
export type ProductWithRules = z.infer<typeof productWithRulesSchema>;
