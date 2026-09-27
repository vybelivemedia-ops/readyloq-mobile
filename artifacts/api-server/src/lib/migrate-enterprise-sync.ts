/**
 * Durable bidirectional enterprise sync state.
 *
 * Drizzle owns the TypeScript schema and test-database shape. This startup
 * migration keeps existing development/deployed databases safe when the API
 * starts before a publish-time schema diff has been applied.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function migrateEnterpriseSync(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE enterprise_outbox
        ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
        ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS locked_by TEXT
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS enterprise_outbox_idempotency_uidx
        ON enterprise_outbox(idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS integration_entity_links (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider            TEXT NOT NULL,
        entity_type         TEXT NOT NULL,
        local_entity_id     INTEGER,
        external_id         TEXT NOT NULL,
        external_parent_id  TEXT,
        external_version    TEXT,
        source_updated_at   TIMESTAMP,
        source_hash         TEXT,
        last_synced_at      TIMESTAMP,
        metadata            JSONB NOT NULL DEFAULT '{}',
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT integration_entity_links_external_uq
          UNIQUE (company_id, provider, entity_type, external_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_entity_links_local_idx
        ON integration_entity_links (company_id, provider, entity_type, local_entity_id)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS integration_sync_messages (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider            TEXT NOT NULL,
        direction           TEXT NOT NULL,
        entity_type         TEXT NOT NULL,
        operation           TEXT NOT NULL,
        local_entity_id     INTEGER,
        external_id         TEXT,
        idempotency_key     TEXT NOT NULL,
        payload_json        JSONB NOT NULL,
        status              TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count       INTEGER NOT NULL DEFAULT 0,
        available_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        locked_at           TIMESTAMP,
        locked_by           TEXT,
        last_error_code     TEXT,
        last_error_message  TEXT,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        processed_at        TIMESTAMP,
        CONSTRAINT integration_sync_messages_idempotency_uq
          UNIQUE (company_id, provider, idempotency_key)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_sync_messages_ready_idx
        ON integration_sync_messages (status, available_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_sync_messages_company_idx
        ON integration_sync_messages (company_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_sync_messages_entity_idx
        ON integration_sync_messages (company_id, entity_type, external_id)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS integration_sync_runs (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider            TEXT NOT NULL,
        direction           TEXT NOT NULL,
        entity_type         TEXT NOT NULL,
        status              TEXT NOT NULL,
        cursor_before       TEXT,
        cursor_after        TEXT,
        records_seen        INTEGER NOT NULL DEFAULT 0,
        records_created     INTEGER NOT NULL DEFAULT 0,
        records_updated     INTEGER NOT NULL DEFAULT 0,
        records_failed      INTEGER NOT NULL DEFAULT 0,
        started_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at         TIMESTAMP,
        error_code          TEXT,
        error_message       TEXT,
        metadata            JSONB NOT NULL DEFAULT '{}'
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_sync_runs_company_idx
        ON integration_sync_runs (company_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_sync_runs_lookup_idx
        ON integration_sync_runs (company_id, provider, direction, entity_type, started_at)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS integration_conflicts (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider            TEXT NOT NULL,
        entity_type         TEXT NOT NULL,
        local_entity_id     INTEGER,
        external_id         TEXT,
        field_name          TEXT NOT NULL,
        local_value         JSONB,
        external_value      JSONB,
        status              TEXT NOT NULL DEFAULT 'open',
        resolution           TEXT,
        resolved_by         INTEGER,
        resolved_at         TIMESTAMP,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_conflicts_company_status_idx
        ON integration_conflicts (company_id, status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS integration_conflicts_entity_idx
        ON integration_conflicts (company_id, entity_type, external_id)
    `);

    logger.info("[migrate-enterprise-sync] Durable integration sync tables ready");
  } catch (err) {
    logger.error({ err }, "[migrate-enterprise-sync] Migration failed");
    throw err;
  }
}