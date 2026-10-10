/**
 * Idempotent startup migration: create a composite expression index on
 * (company_id, COALESCE(scheduled_date, created_at)) for the inspections table.
 *
 * This index allows GET /api/schedule to seek directly to the requested date
 * window without scanning every inspection for the company, making response
 * time proportional to the window size rather than total company history.
 *
 * CREATE INDEX CONCURRENTLY must run outside any transaction — drizzle's
 * db.execute() does not auto-wrap in a transaction, so this is safe. The
 * idempotency check (pg_indexes lookup) avoids re-creating the index on
 * every subsequent server boot.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const INDEX_NAME = "inspections_company_cal_date_idx";

async function indexExists(): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 FROM pg_indexes WHERE indexname = ${INDEX_NAME}`,
  );
  return result.rows.length > 0;
}

export async function migrateScheduleIndex(): Promise<void> {
  if (await indexExists()) {
    logger.info(`migrateScheduleIndex: index "${INDEX_NAME}" already exists — skipped`);
    return;
  }

  // CONCURRENTLY avoids an exclusive lock on the inspections table during
  // index creation, which is important for a large-history table. It cannot
  // run inside a transaction; db.execute() does not auto-wrap in one.
  await db.execute(
    sql.raw(`
      CREATE INDEX CONCURRENTLY ${INDEX_NAME}
      ON inspections (company_id, COALESCE(scheduled_date, created_at))
    `),
  );

  logger.info(`migrateScheduleIndex: created index "${INDEX_NAME}"`);
}
