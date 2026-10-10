import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function migrateMissionControl(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS access_suspended BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_approvals (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        expected_access_state BOOLEAN,
        request TEXT NOT NULL,
        reason TEXT NOT NULL,
        idempotency_key TEXT,
        note TEXT,
        decided_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        decided_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      ALTER TABLE mission_control_approvals
        ADD COLUMN IF NOT EXISTS expected_access_state BOOLEAN
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS mission_control_approvals_idempotency_uq
      ON mission_control_approvals(idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_approvals_status_created_idx
      ON mission_control_approvals(status, created_at)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_audit (
        id SERIAL PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_audit_created_idx
      ON mission_control_audit(created_at)
    `);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION mission_control_audit_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'mission control audit rows are append-only';
      END;
      $$
    `);
    await db.execute(sql`
      DROP TRIGGER IF EXISTS mission_control_audit_immutable_trigger
      ON mission_control_audit
    `);
    await db.execute(sql`
      CREATE TRIGGER mission_control_audit_immutable_trigger
      BEFORE UPDATE OR DELETE ON mission_control_audit
      FOR EACH ROW EXECUTE FUNCTION mission_control_audit_immutable()
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_incidents (
        id SERIAL PRIMARY KEY,
        reference TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        inspection_id INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        session_id INTEGER REFERENCES meta_glasses_sessions(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'open',
        severity TEXT NOT NULL DEFAULT 'medium',
        assigned_to TEXT,
        acknowledged_at TIMESTAMP,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE mission_control_incidents
        ADD COLUMN IF NOT EXISTS inspection_id INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES meta_glasses_sessions(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS mission_control_incidents_reference_uq
      ON mission_control_incidents(reference)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_incidents_company_idx
      ON mission_control_incidents(company_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_agent_tasks (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_by TEXT NOT NULL,
        result TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP,
        heartbeat_at TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      ALTER TABLE mission_control_agent_tasks
        ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMP
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_agent_tasks_company_created_idx
      ON mission_control_agent_tasks(company_id, created_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_agent_tasks_status_created_idx
      ON mission_control_agent_tasks(status, created_at)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_delegations (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES mission_control_agent_tasks(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        specialist TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        result TEXT,
        error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        CONSTRAINT mission_control_delegations_task_specialist_uq UNIQUE (task_id, specialist)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_delegations_company_task_idx
      ON mission_control_delegations(company_id, task_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_work_traces (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES mission_control_agent_tasks(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        delegation_id INTEGER REFERENCES mission_control_delegations(id) ON DELETE CASCADE,
        actor TEXT NOT NULL,
        event TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_work_traces_company_task_idx
      ON mission_control_work_traces(company_id, task_id, id)
    `);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION mission_control_work_trace_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'mission control work traces are append-only';
      END;
      $$
    `);
    await db.execute(sql`
      DROP TRIGGER IF EXISTS mission_control_work_trace_immutable_trigger ON mission_control_work_traces
    `);
    await db.execute(sql`
      CREATE TRIGGER mission_control_work_trace_immutable_trigger
      BEFORE UPDATE OR DELETE ON mission_control_work_traces
      FOR EACH ROW EXECUTE FUNCTION mission_control_work_trace_immutable()
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_control_inspection_events (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        inspection_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        source_record_type TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        occurred_at TIMESTAMP,
        idempotency_key TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        origin TEXT NOT NULL DEFAULT 'newly_generated',
        CONSTRAINT mission_control_inspection_events_origin_check
          CHECK (origin = 'newly_generated')
      )
    `);
    // Earlier dev/test startups may have created an inspection FK here. Drop
    // only a single-column FK on inspection_id; retain every event row and the
    // company FK so immutable history can outlive its live inspection record.
    await db.execute(sql`
      DO $$
      DECLARE inspection_fk RECORD;
      BEGIN
        FOR inspection_fk IN
          SELECT constraint_row.conname, constraint_row.conrelid
          FROM pg_constraint AS constraint_row
          JOIN pg_attribute AS column_row
            ON column_row.attrelid = constraint_row.conrelid
            AND column_row.attname = 'inspection_id'
          WHERE constraint_row.conrelid = 'mission_control_inspection_events'::regclass
            AND constraint_row.contype = 'f'
            AND cardinality(constraint_row.conkey) = 1
            AND constraint_row.conkey[1] = column_row.attnum
        LOOP
          EXECUTE format(
            'ALTER TABLE %s DROP CONSTRAINT %I',
            inspection_fk.conrelid::regclass,
            inspection_fk.conname
          );
        END LOOP;
      END;
      $$
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS mission_control_inspection_events_company_idempotency_uq
      ON mission_control_inspection_events(company_id, idempotency_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_inspection_events_company_inspection_recorded_idx
      ON mission_control_inspection_events(company_id, inspection_id, recorded_at, id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_inspection_events_entity_idx
      ON mission_control_inspection_events(company_id, entity_type, entity_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mission_control_inspection_events_source_idx
      ON mission_control_inspection_events(company_id, source_record_type, source_record_id)
    `);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION mission_control_inspection_event_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'mission control inspection events are append-only';
      END;
      $$
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'mission_control_inspection_event_immutable_trigger'
            AND tgrelid = 'mission_control_inspection_events'::regclass
            AND NOT tgisinternal
        ) THEN
          CREATE TRIGGER mission_control_inspection_event_immutable_trigger
          BEFORE UPDATE OR DELETE ON mission_control_inspection_events
          FOR EACH ROW EXECUTE FUNCTION mission_control_inspection_event_immutable();
        END IF;
      END;
      $$
    `);
    logger.info("[migrate-mission-control] Mission Control tables ready");
  } catch (err) {
    logger.error({ err }, "[migrate-mission-control] Migration failed");
    throw err;
  }
}