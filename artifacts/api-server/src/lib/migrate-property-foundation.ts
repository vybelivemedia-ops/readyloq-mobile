import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Additive only. No historical UPDATE/DELETE, no automatic address/unit matching.
// The transaction advisory lock serializes concurrent API startup migrations.
export const PROPERTY_FOUNDATION_SQL = [
  // Match model/table order for new keys; IF NOT EXISTS preserves existing
  // indexes and their dependent FKs even when their equivalent key order differs.
  `CREATE UNIQUE INDEX IF NOT EXISTS property_profiles_company_id_uq ON property_profiles(id,company_id)`,
  // Adopt the existing index without rebuilding it. Drizzle introspects a
  // referenced standalone index as a unique constraint; model it the same way.
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='property_profiles_company_id_uq' AND conrelid='property_profiles'::regclass) THEN ALTER TABLE property_profiles ADD CONSTRAINT property_profiles_company_id_uq UNIQUE USING INDEX property_profiles_company_id_uq; END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS property_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES companies(id),
    property_id integer NOT NULL, parent_id uuid, kind text NOT NULL, label text NOT NULL,
    common_area_type text, revision integer NOT NULL DEFAULT 1, archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT property_locations_kind_ck CHECK (kind IN ('building','floor','unit','common_area')),
    CONSTRAINT property_locations_label_ck CHECK (length(trim(label)) BETWEEN 1 AND 120),
    CONSTRAINT property_locations_revision_ck CHECK (revision > 0),
    CONSTRAINT property_locations_parent_ck CHECK ((kind='building' AND parent_id IS NULL) OR kind='common_area' OR (kind IN ('floor','unit') AND parent_id IS NOT NULL)),
    CONSTRAINT property_locations_common_type_ck CHECK ((kind='common_area' AND common_area_type IS NOT NULL) OR (kind<>'common_area' AND common_area_type IS NULL)),
    CONSTRAINT pf_locations_profile_fk FOREIGN KEY(company_id,property_id) REFERENCES property_profiles(company_id,id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_locations_scope_id_uq ON property_locations(id,company_id,property_id)`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='property_locations_scope_id_uq' AND conrelid='property_locations'::regclass) THEN ALTER TABLE property_locations ADD CONSTRAINT property_locations_scope_id_uq UNIQUE USING INDEX property_locations_scope_id_uq; END IF; END $$`,
  `CREATE INDEX IF NOT EXISTS property_locations_property_idx ON property_locations(company_id,property_id)`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pf_locations_parent_fk' AND conrelid='property_locations'::regclass) THEN
    ALTER TABLE property_locations ADD CONSTRAINT pf_locations_parent_fk FOREIGN KEY(company_id,property_id,parent_id) REFERENCES property_locations(company_id,property_id,id);
    END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS property_visits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES companies(id), property_id integer NOT NULL,
    client_key uuid NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pf_visits_profile_fk FOREIGN KEY(company_id,property_id) REFERENCES property_profiles(company_id,id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_visits_scope_id_uq ON property_visits(id,company_id,property_id)`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='property_visits_scope_id_uq' AND conrelid='property_visits'::regclass) THEN ALTER TABLE property_visits ADD CONSTRAINT property_visits_scope_id_uq UNIQUE USING INDEX property_visits_scope_id_uq; END IF; END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_visits_client_key_uq ON property_visits(company_id,property_id,client_key)`,
  `CREATE TABLE IF NOT EXISTS property_visit_coverage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL, property_id integer NOT NULL,
    visit_id uuid NOT NULL, space_id uuid NOT NULL, snapshot jsonb NOT NULL,
    state text NOT NULL DEFAULT 'not_inspected', inspection_id integer REFERENCES inspections(id),
    reason text, revision integer NOT NULL DEFAULT 1,
    CONSTRAINT pf_coverage_visit_fk FOREIGN KEY(company_id,property_id,visit_id) REFERENCES property_visits(company_id,property_id,id),
    CONSTRAINT pf_coverage_space_fk FOREIGN KEY(company_id,property_id,space_id) REFERENCES property_locations(company_id,property_id,id),
    CONSTRAINT property_coverage_state_ck CHECK (state IN ('not_inspected','in_progress','inspected','no_access')),
    CONSTRAINT property_coverage_completion_ck CHECK (state NOT IN ('in_progress','inspected') OR inspection_id IS NOT NULL),
    CONSTRAINT property_coverage_no_access_ck CHECK (state <> 'no_access' OR (reason IS NOT NULL AND length(trim(reason)) > 0)))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_coverage_visit_space_uq ON property_visit_coverage(visit_id,space_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS property_coverage_visit_inspection_uq ON property_visit_coverage(visit_id,inspection_id)`,
  `CREATE TABLE IF NOT EXISTS property_location_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL, property_id integer NOT NULL,
    actor text NOT NULL, action text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pf_events_profile_fk FOREIGN KEY(company_id,property_id) REFERENCES property_profiles(company_id,id))`,
  // Reconcile partial schema-push attempts too: CREATE TABLE IF NOT EXISTS alone
  // cannot repair a table created before its referenced unique index existed.
  ...[
    ["property_locations", "pf_locations_profile_fk", "FOREIGN KEY(company_id,property_id) REFERENCES property_profiles(company_id,id)"],
    ["property_visits", "pf_visits_profile_fk", "FOREIGN KEY(company_id,property_id) REFERENCES property_profiles(company_id,id)"],
    ["property_visit_coverage", "pf_coverage_visit_fk", "FOREIGN KEY(company_id,property_id,visit_id) REFERENCES property_visits(company_id,property_id,id)"],
    ["property_visit_coverage", "pf_coverage_space_fk", "FOREIGN KEY(company_id,property_id,space_id) REFERENCES property_locations(company_id,property_id,id)"],
    ["property_location_events", "pf_events_profile_fk", "FOREIGN KEY(company_id,property_id) REFERENCES property_profiles(company_id,id)"],
  ].map(([table, name, definition]) => `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='${name}' AND conrelid='${table}'::regclass) THEN ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}; END IF; END $$`),
] as const;

export async function migratePropertyFoundation() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73194021)`);
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    for (const statement of PROPERTY_FOUNDATION_SQL) await tx.execute(sql.raw(statement));
  });
}
