/**
 * Idempotent startup migration: ensure the inspection_sync_logs table has the
 * success and error_message columns added in the v2 schema.
 *
 * New columns:
 *   success       BOOLEAN NOT NULL DEFAULT TRUE — whether the push succeeded
 *   error_message TEXT                          — error detail from the external system (null on success)
 *
 * Also makes result_json nullable so failed attempts can be recorded without
 * a result payload.
 *
 * Uses raw SQL so it is safe to run against a database that predates these
 * columns; each ALTER is guarded by an IF NOT EXISTS check.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}`,
  );
  return result.rows.length > 0;
}

export async function migrateSyncLogs(): Promise<void> {
  // Ensure the table itself exists before trying to add columns.  It will
  // normally exist because it was created by the initial schema push, but on a
  // fresh DB it might not if startup runs before the seed.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS inspection_sync_logs (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      system_type   TEXT    NOT NULL,
      success       BOOLEAN NOT NULL DEFAULT TRUE,
      error_message TEXT,
      synced_at     TIMESTAMP NOT NULL DEFAULT NOW(),
      result_json   JSONB
    )
  `);

  if (!(await columnExists("inspection_sync_logs", "success"))) {
    await db.execute(
      sql`ALTER TABLE inspection_sync_logs ADD COLUMN success BOOLEAN NOT NULL DEFAULT TRUE`,
    );
    logger.info("migrateSyncLogs: added inspection_sync_logs.success");
  }

  if (!(await columnExists("inspection_sync_logs", "error_message"))) {
    await db.execute(
      sql`ALTER TABLE inspection_sync_logs ADD COLUMN error_message TEXT`,
    );
    logger.info("migrateSyncLogs: added inspection_sync_logs.error_message");
  }

  // Make result_json nullable if it was created as NOT NULL on an older schema.
  // This is a no-op when the column is already nullable.
  await db.execute(
    sql`ALTER TABLE inspection_sync_logs ALTER COLUMN result_json DROP NOT NULL`,
  ).catch(() => {
    // Ignore — column may already be nullable or table may not exist yet.
  });
}
