/**
 * Idempotent startup migration for multi-family unit/apartment tagging.
 *
 * Both columns are nullable so existing commercial and single-family
 * inspection records remain valid without a backfill.
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

export async function migrateInspectionUnitNumbers(): Promise<void> {
  if (!(await columnExists("inspections", "unit_number"))) {
    await db.execute(
      sql`ALTER TABLE inspections ADD COLUMN unit_number TEXT`,
    );
    logger.info("migrateInspectionUnitNumbers: added inspections.unit_number");
  }

  if (!(await columnExists("inspection_media", "unit_number"))) {
    await db.execute(
      sql`ALTER TABLE inspection_media ADD COLUMN unit_number TEXT`,
    );
    logger.info("migrateInspectionUnitNumbers: added inspection_media.unit_number");
  }
}