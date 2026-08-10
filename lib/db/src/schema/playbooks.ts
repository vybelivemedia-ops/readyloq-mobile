/**
 * Company Playbooks — tenant-scoped SOPs, target-pest protocols, and
 * required safety / treatment steps that the Learning Engine enforces
 * during AI review and on the inspection summary screen.
 *
 * companyId is an integer FK (matches every other table in this schema).
 */
import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { companiesTable } from './companies';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Identifies a pest category or species the playbook applies to. */
export type PlaybookPestTarget = string; // e.g. "rodent", "german_cockroach", "bed_bug"

/** A mandatory action or treatment step that must be logged. */
export type PlaybookRequiredStep = {
  id: string;       // stable slug, e.g. "apply_bait_stations"
  label: string;    // human-readable, e.g. "Apply bait stations"
};

/** A restricted chemical product name or class. */
export type ChemicalRestriction = {
  name: string;     // e.g. "Fipronil" or "any pyrethroid"
  reason?: string;  // optional note for technicians
};

// ── Table ─────────────────────────────────────────────────────────────────────

export const companyPlaybooksTable = pgTable('company_playbooks', {
  id: serial('id').primaryKey(),

  companyId: integer('company_id')
    .notNull()
    .references(() => companiesTable.id, { onDelete: 'cascade' }),

  /** Display name shown to technicians, e.g. "Commercial Rodent Protocol". */
  title: text('title').notNull(),

  /** Pest categories / species this playbook governs. */
  targetPests: jsonb('target_pests')
    .$type<PlaybookPestTarget[]>()
    .default([])
    .notNull(),

  /** Mandatory steps — every one must be evidenced in the inspection. */
  requiredSteps: jsonb('required_steps')
    .$type<PlaybookRequiredStep[]>()
    .default([])
    .notNull(),

  /** Chemicals disallowed or restricted under this playbook. */
  chemicalRestrictions: jsonb('chemical_restrictions')
    .$type<ChemicalRestriction[]>()
    .default([])
    .notNull(),

  /** Free-form notes or compliance references for technicians. */
  notes: text('notes'),

  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ── Zod / insert schema ───────────────────────────────────────────────────────

// Omit server-generated and tenant fields. JSONB validation happens in the
// route handler via a manually defined Zod schema (drizzle-zod cannot infer
// .$type<>() generics at runtime, and .extend() hits version-mismatch errors
// with the drizzle-zod@0.8 / zod/v4 pairing used in this workspace).
export const insertPlaybookSchema = createInsertSchema(
  companyPlaybooksTable,
).omit({ id: true, companyId: true, createdAt: true, updatedAt: true });

// ── Inferred types ────────────────────────────────────────────────────────────

export type CompanyPlaybook = typeof companyPlaybooksTable.$inferSelect;
export type NewCompanyPlaybook = typeof companyPlaybooksTable.$inferInsert;
