import {
  pgTable,
  serial,
  integer,
  real,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * FAIE (Field AI Image Engine) Training Images
 *
 * Stores references to images ingested through the three FAIE training
 * pipelines. Images are held in object storage; this table holds metadata
 * and the storage path so records are queryable by companyId / category
 * for future model fine-tuning runs.
 *
 * record_type discriminates the three ingest sources:
 *   "dataset"    — accepted finding (per-company positive reinforcement)
 *   "global"     — every field photo upload (global pool)
 *   "anonymized" — technician-corrected finding (no PII, cross-company)
 */
export const faieTrainingImagesTable = pgTable(
  "faie_training_images",
  {
    id: serial("id").primaryKey(),

    /** "dataset" | "global" | "anonymized" */
    recordType: text("record_type").notNull(),

    /**
     * Company that owns this record.
     * NULL for anonymized records (privacy by construction).
     */
    companyId: integer("company_id"),

    /** dataset: finding id from the mobile app */
    findingId: text("finding_id"),

    /** dataset: pest/defect label that was accepted */
    label: text("label"),

    /** dataset / anonymized: AI confidence at ingest time */
    confidence: real("confidence"),

    /** global: Clerk user id of the uploading technician */
    technicianId: text("technician_id"),

    /** global: upload source tag e.g. "mobile_upload" */
    source: text("source"),

    /** anonymized: pest or defect category */
    category: text("category"),

    /** anonymized: structural context string */
    context: text("context"),

    /** Canonical object-storage path e.g. /objects/companies/5/uploads/<uuid> */
    imageUrl: text("image_url").notNull(),

    ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
  },
  (t) => [
    index("faie_training_company_idx").on(t.companyId),
    index("faie_training_type_idx").on(t.recordType),
    index("faie_training_category_idx").on(t.category),
  ],
);

export type FaieTrainingImage = typeof faieTrainingImagesTable.$inferSelect;
export type InsertFaieTrainingImage =
  typeof faieTrainingImagesTable.$inferInsert;
