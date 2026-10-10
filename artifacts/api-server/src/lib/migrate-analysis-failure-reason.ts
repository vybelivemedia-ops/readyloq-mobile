/**
 * Idempotent startup migration: add the `failure_reason` column to the
 * `analysis_results` table.
 *
 * New column:
 *   failure_reason  TEXT  — human-readable reason the analysis was skipped or
 *                           failed (e.g. "Photos could not be processed by the
 *                           AI analysis service"). NULL when the analysis
 *                           succeeded or no specific reason was recorded.
 *
 * Uses raw SQL so it is safe to run against a database that predates this
 * column; the ALTER is guarded by an information_schema existence check.
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

export async function migrateAnalysisFailureReason(): Promise<void> {
  if (!(await columnExists("analysis_results", "failure_reason"))) {
    await db.execute(
      sql`ALTER TABLE analysis_results ADD COLUMN failure_reason TEXT`,
    );
    logger.info("migrateAnalysisFailureReason: added analysis_results.failure_reason");
  }
}
