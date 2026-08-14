/**
 * Idempotent startup migration: add the `analysis_errors` column to the
 * `analysis_results` table.
 *
 * New column:
 *   analysis_errors  INTEGER  — count of photos that failed AI analysis in the
 *                               most recent analyze run (null = pre-migration row;
 *                               0 = all photos processed; >0 = partial failure).
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

export async function migrateAnalysisErrors(): Promise<void> {
  if (!(await columnExists("analysis_results", "analysis_errors"))) {
    await db.execute(
      sql`ALTER TABLE analysis_results ADD COLUMN analysis_errors INTEGER`,
    );
    logger.info("migrateAnalysisErrors: added analysis_results.analysis_errors");
  }
}
