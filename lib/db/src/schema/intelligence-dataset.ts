import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  real,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

/**
 * ReadyLoq Intelligence Dataset & AI Learning Center (Phase 1).
 *
 * Technicians contribute verified field photos + findings to build a pest-control
 * field-intelligence dataset. Every record is STRICTLY company-private: rows carry
 * a company_id and are only ever read/written through requireAuth + requireCompany.
 *
 * PRIVACY BY CONSTRUCTION: records never store customer names, addresses, company
 * names, or technician names — only the image, AI suggestion, confirmed labels,
 * environmental context, and treatment outcomes. The only people-links are numeric
 * user ids (created_by / reviewed_by) used for workflow + per-company analytics.
 *
 * EXPORT-READY FOR PHASE 2 (no migration needed later): `anonymized_at` + `export_id`
 * on records, the nullable-company `intelligence_training_exports` table, and the
 * `companies.intelligence_sharing_enabled` opt-in toggle let a future Platform Admin
 * build an anonymized cross-company training dataset without schema changes.
 */

// ── Shared taxonomy ──────────────────────────────────────────────────────────
// Single source of truth for category groups + subcategories. Used by the AI
// prompt, server-side validation, and surfaced to the client via GET
// /intelligence-dataset/categories so the UI never hardcodes the taxonomy.
export type TaxonomyItem = { slug: string; label: string };
export type TaxonomyGroup = {
  slug: string;
  label: string;
  description: string;
  subcategories: TaxonomyItem[];
};

export const INTELLIGENCE_TAXONOMY: TaxonomyGroup[] = [
  {
    slug: "pest",
    label: "Pests",
    description: "A live or dead pest specimen visible in the image.",
    subcategories: [
      { slug: "cockroach", label: "Cockroach" },
      { slug: "mouse", label: "Mouse" },
      { slug: "rat", label: "Rat" },
      { slug: "ant", label: "Ant" },
      { slug: "termite", label: "Termite" },
      { slug: "bed_bug", label: "Bed Bug" },
      { slug: "fly", label: "Fly" },
      { slug: "stored_product_pest", label: "Stored Product Pest" },
      { slug: "wasp_bee", label: "Wasp / Bee" },
      { slug: "spider", label: "Spider" },
      { slug: "flea_tick", label: "Flea / Tick" },
      { slug: "other_pest", label: "Other Pest" },
    ],
  },
  {
    slug: "pest_evidence",
    label: "Pest Evidence",
    description: "Signs of pest activity rather than the pest itself.",
    subcategories: [
      { slug: "droppings", label: "Droppings" },
      { slug: "gnaw_marks", label: "Gnaw Marks" },
      { slug: "rub_marks", label: "Rub / Grease Marks" },
      { slug: "nesting_material", label: "Nesting Material" },
      { slug: "shed_skins", label: "Shed Skins" },
      { slug: "egg_cases", label: "Egg Cases / Ootheca" },
      { slug: "damaged_product", label: "Damaged Product / Packaging" },
      { slug: "carcass", label: "Carcass" },
      { slug: "tracks", label: "Tracks / Runways" },
    ],
  },
  {
    slug: "conducive_condition",
    label: "Conducive Conditions",
    description: "Environmental conditions that attract or sustain pests.",
    subcategories: [
      { slug: "standing_water", label: "Standing Water" },
      { slug: "moisture_leak", label: "Moisture / Leak" },
      { slug: "food_debris", label: "Food Debris" },
      { slug: "clutter_harborage", label: "Clutter / Harborage" },
      { slug: "vegetation_overgrowth", label: "Vegetation Overgrowth" },
      { slug: "improper_storage", label: "Improper Storage" },
      { slug: "grease_buildup", label: "Grease Buildup" },
      { slug: "drain_issue", label: "Drain Issue" },
    ],
  },
  {
    slug: "entry_point",
    label: "Entry Points",
    description: "Openings that allow pests to enter a structure.",
    subcategories: [
      { slug: "door_gap", label: "Door Gap" },
      { slug: "wall_penetration", label: "Wall Penetration" },
      { slug: "utility_penetration", label: "Utility Penetration" },
      { slug: "foundation_crack", label: "Foundation Crack" },
      { slug: "vent_gap", label: "Vent Gap" },
      { slug: "window_gap", label: "Window Gap" },
      { slug: "roof_soffit_gap", label: "Roof / Soffit Gap" },
      { slug: "pipe_penetration", label: "Pipe Penetration" },
    ],
  },
  {
    slug: "structural_deficiency",
    label: "Structural Deficiencies",
    description: "Damaged or missing exclusion components.",
    subcategories: [
      { slug: "damaged_door_sweep", label: "Damaged Door Sweep" },
      { slug: "torn_screen", label: "Torn Screen" },
      { slug: "cracked_foundation", label: "Cracked Foundation" },
      { slug: "gap_in_wall", label: "Gap in Wall" },
      { slug: "deteriorated_seal", label: "Deteriorated Seal / Caulk" },
      { slug: "missing_weatherstrip", label: "Missing Weatherstripping" },
      { slug: "damaged_vent_cover", label: "Damaged Vent Cover" },
    ],
  },
  {
    slug: "treatment_verification",
    label: "Treatment Verification",
    description: "Documentation that a treatment or correction was performed.",
    subcategories: [
      { slug: "bait_station_placement", label: "Bait Station Placement" },
      { slug: "monitor_device", label: "Monitor Device" },
      { slug: "exclusion_repair", label: "Exclusion Repair" },
      { slug: "treatment_applied", label: "Treatment Applied" },
      { slug: "sanitation_corrected", label: "Sanitation Corrected" },
      { slug: "follow_up_clear", label: "Follow-Up Clear" },
    ],
  },
];

export const TAXONOMY_CATEGORY_SLUGS = INTELLIGENCE_TAXONOMY.map((g) => g.slug);

// ── Enumerated values ────────────────────────────────────────────────────────
export type IntelligenceStatus =
  | "pending" // L1: AI suggested, awaiting technician confirmation
  | "confirmed" // L2/L3: technician(s) confirmed, awaiting manager review
  | "approved" // L4/L5: manager verified
  | "rejected" // manager rejected
  | "skipped"; // technician skipped (retained, excluded from dataset)

export type IntelligenceSeverity = "low" | "moderate" | "high" | "critical";

export type TreatmentOutcome =
  | "resolved"
  | "improved"
  | "unchanged"
  | "worsened"
  | "pending"
  | "not_applicable";

// The full structured AI suggestion. Retained verbatim alongside the technician's
// final labels so the (AI suggestion -> human correction) delta is preserved as a
// training signal for future ReadyLoq intelligence.
export type AiPrediction = {
  category: string | null;
  subcategory: string | null;
  confidence: number; // 0..1
  tags: string[];
  possiblePest: string | null;
  possibleConduciveCondition: string | null;
  possibleEntryPoint: string | null;
  suggestedCorrectiveAction: string | null;
  rationale: string | null;
  // Structured field-detection detail for the live AI Inspection Panel.
  // Optional so older stored predictions (and loosely-typed test doubles)
  // remain valid; each is null when the image shows no such evidence.
  possibleLifeStage?: string | null;
  possibleHarborage?: string | null;
  possibleMoistureIssue?: string | null;
  possibleStructuralIssue?: string | null;
  // Inspection zone (scene) the photo depicts, as a zone-coverage taxonomy
  // slug, or null when the scene is unclear. Drives live completeness scoring.
  zone?: string | null;
  // RLQ-002: top-3 pest species candidates with confidence scores, sorted
  // descending. Absent on older predictions; [] when no pest is visible.
  pestCandidates?: Array<{ species: string; confidence: number }>;
  // AI-estimated physical dimensions of the structural defect detected in this
  // photo. Populated only when possibleStructuralIssue is non-null. Based on
  // visible reference objects and structural norms in the scene — accuracy varies;
  // hardware laser readings override these in the app's Exclusion pricing engine.
  measurementEstimate?: {
    /** Estimated linear footage of the defect run (gap perimeter, roofline run, etc.). */
    linearFt?: number | null;
    /** Estimated gap or opening width in inches. */
    gapWidthIn?: number | null;
    /** Estimated defect height in feet. */
    heightFt?: number | null;
    /** AI confidence in these dimension estimates (0–1). */
    confidence: number;
    source: "ai_vision_estimate";
  } | null;
};

// ── Tables ───────────────────────────────────────────────────────────────────
export const intelligenceRecordsTable = pgTable(
  "intelligence_records",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),

    // Image (object-storage path, scoped to the company)
    imageUrl: text("image_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),

    // AI suggestion (immutable training signal)
    aiPrediction: jsonb("ai_prediction").$type<AiPrediction | null>(),
    aiConfidence: real("ai_confidence"),

    // Confirmed labels (technician confirms/corrects; manager may refine on review)
    category: text("category"),
    subcategory: text("subcategory"),
    possiblePest: text("possible_pest"),
    possibleConduciveCondition: text("possible_conducive_condition"),
    possibleEntryPoint: text("possible_entry_point"),
    correctiveAction: text("corrective_action"),
    severity: text("severity").$type<IntelligenceSeverity>(),
    whatIsShown: text("what_is_shown"),
    whyItMatters: text("why_it_matters"),
    notes: text("notes"),

    // Treatment outcome tracking
    treatmentOutcome: text("treatment_outcome").$type<TreatmentOutcome>(),
    daysUntilFollowup: integer("days_until_followup"),

    // Workflow + verification
    verificationLevel: integer("verification_level").notNull().default(1), // 1..5
    status: text("status").$type<IntelligenceStatus>().notNull().default("pending"),
    approvedForTraining: boolean("approved_for_training").notNull().default(false),
    // null until the technician acts; true if they changed the AI's category/subcategory
    aiCorrected: boolean("ai_corrected"),

    // People (numeric ids only — never names)
    createdBy: integer("created_by")
      .notNull()
      .references(() => usersTable.id),
    confirmedBy: integer("confirmed_by").references(() => usersTable.id),
    reviewedBy: integer("reviewed_by").references(() => usersTable.id),

    // Phase 2 export-readiness (reserved; unused in Phase 1)
    anonymizedAt: timestamp("anonymized_at"),
    exportId: integer("export_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
    reviewedAt: timestamp("reviewed_at"),
  },
  (t) => ({
    companyIdx: index("intelligence_records_company_idx").on(t.companyId),
    companyStatusIdx: index("intelligence_records_company_status_idx").on(
      t.companyId,
      t.status,
    ),
  }),
);

export const intelligenceTagsTable = pgTable(
  "intelligence_tags",
  {
    id: serial("id").primaryKey(),
    // Denormalized company_id keeps tag queries tenant-safe without a join.
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    recordId: integer("record_id")
      .notNull()
      .references(() => intelligenceRecordsTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    source: text("source").$type<"ai" | "technician" | "manager">().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    recordIdx: index("intelligence_tags_record_idx").on(t.recordId),
  }),
);

export const intelligenceReviewsTable = pgTable("intelligence_reviews", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id),
  recordId: integer("record_id")
    .notNull()
    .references(() => intelligenceRecordsTable.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id")
    .notNull()
    .references(() => usersTable.id),
  action: text("action")
    .$type<"approve" | "reject" | "edit" | "expert_verify">()
    .notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const intelligenceVotesTable = pgTable(
  "intelligence_votes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    recordId: integer("record_id")
      .notNull()
      .references(() => intelligenceRecordsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    vote: text("vote").$type<"confirm" | "dispute">().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    recordUserUnique: uniqueIndex("intelligence_votes_record_user_unique").on(
      t.recordId,
      t.userId,
    ),
  }),
);

// Created in Phase 1 (export-ready) but only lightly used; the anonymized
// cross-company export job is Phase 2. company_id is NULLABLE so a future
// platform-wide export can span companies (null) while a per-company export
// references its company.
export const intelligenceTrainingExportsTable = pgTable(
  "intelligence_training_exports",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companiesTable.id),
    status: text("status")
      .$type<"pending" | "ready" | "failed">()
      .notNull()
      .default("pending"),
    recordCount: integer("record_count").notNull().default(0),
    minVerificationLevel: integer("min_verification_level").notNull().default(4),
    criteria: jsonb("criteria").$type<Record<string, unknown>>(),
    fileUrl: text("file_url"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

// ── Types ────────────────────────────────────────────────────────────────────
export type IntelligenceRecord = typeof intelligenceRecordsTable.$inferSelect;
export type InsertIntelligenceRecord = typeof intelligenceRecordsTable.$inferInsert;
export type IntelligenceTag = typeof intelligenceTagsTable.$inferSelect;
export type IntelligenceReview = typeof intelligenceReviewsTable.$inferSelect;
export type IntelligenceVote = typeof intelligenceVotesTable.$inferSelect;
export type IntelligenceTrainingExport =
  typeof intelligenceTrainingExportsTable.$inferSelect;

export const intelligenceSeverityEnum = z.enum([
  "low",
  "moderate",
  "high",
  "critical",
]);
export const treatmentOutcomeEnum = z.enum([
  "resolved",
  "improved",
  "unchanged",
  "worsened",
  "pending",
  "not_applicable",
]);
